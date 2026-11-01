import { afterEach, describe, expect, test, vi } from "vitest";
import type { GmailClient, NovoRascunho } from "../../src/clients/gmail.js";
import type { SheetsRepo } from "../../src/clients/sheets.js";
import { gmailDryRun, runSend } from "../../src/jobs/send.js";
import type { CandidaturaRow, FilaRow, LogRow } from "../../src/types.js";

const agora = new Date("2026-11-04T13:00:00Z"); // quarta-feira
const DIA = 24 * 3600 * 1000;
const iso = (d: Date) => d.toISOString();

type Msg = { deMim: boolean; data: Date; messageId: string };

class GmailFalso implements GmailClient {
  rascunhos: NovoRascunho[] = [];
  enviados: string[] = [];
  existentes = new Set<string>();
  threads = new Map<string, Msg[]>();
  async buscar() {
    return [];
  }
  async criarRascunho(r: NovoRascunho) {
    this.rascunhos.push(r);
    const n = this.rascunhos.length;
    this.existentes.add(`d${n}`);
    return { draftId: `d${n}`, threadId: r.threadId ?? `t${n}` };
  }
  async rascunhoExiste(id: string) {
    return this.existentes.has(id);
  }
  async enviarRascunho(id: string) {
    this.enviados.push(id);
  }
  async mensagensDaThread(t: string) {
    return this.threads.get(t) ?? [];
  }
}

// Stateful fake: updates are applied, like the real sheet, so a second run sees the first one.
class RepoFalso implements SheetsRepo {
  logs: LogRow[] = [];
  ordem: string[] = [];
  falhaAtualizarFila = false;
  falhaAdicionarCand = 0;
  falhaAtualizarCand?: (p: Partial<CandidaturaRow>) => boolean;
  constructor(public fila: FilaRow[] = [], public cands: CandidaturaRow[] = []) {}
  async lerFila() { return structuredClone(this.fila); }
  async adicionarFila() {}
  async atualizarFila(id: string, p: Partial<FilaRow>) {
    if (this.falhaAtualizarFila && p.status === "processada") throw new Error("sheets caiu");
    this.ordem.push(`fila:${id}`);
    Object.assign(this.fila.find((r) => r.id === id)!, p);
  }
  async lerCandidaturas() { return structuredClone(this.cands); }
  async adicionarCandidatura(r: CandidaturaRow) {
    if (this.falhaAdicionarCand-- > 0) throw new Error("append falhou");
    this.ordem.push(`cand:${r.id}`);
    this.cands.push(r);
  }
  async atualizarCandidatura(id: string, p: Partial<CandidaturaRow>) {
    if (this.falhaAtualizarCand?.(p)) throw new Error("update falhou");
    Object.assign(this.cands.find((c) => c.id === id)!, p);
  }
  async log(r: LogRow) { this.logs.push(r); }
  async idsVistos() { return new Set<string>(); }
}

function fila(id: string, o: Partial<FilaRow> = {}): FilaRow {
  return {
    id, fonte: "github-repo", titulo: `Dev ${id}`, empresa: "Acme", local: null, modalidade: "remoto",
    nivel: "junior", descricao: "", link: `https://x/${id}`, emailContato: `rh-${id}@acme.test`,
    coletadaEm: iso(agora), nota: 80, mensagem: `Mensagem editada ${id}`, decisao: "aprovar", status: "novo", ...o,
  };
}

function cand(id: string, o: Partial<CandidaturaRow> = {}): CandidaturaRow {
  return {
    id, data: iso(new Date(agora.getTime() - 20 * DIA)), empresa: "Acme", titulo: `Dev ${id}`, canal: "email",
    status: "enviada", idRascunho: "dx", idThread: `th-${id}`, followupEm: "", idRascunhoFollowup: "", ...o,
  };
}

function setup(f: FilaRow[] = [], c: CandidaturaRow[] = []) {
  const gmail = new GmailFalso();
  const repo = new RepoFalso(f, c);
  const pdf = vi.fn(async () => Buffer.from("pdf"));
  const run = () => runSend({ gmail, repo, pdf, agora });
  return { gmail, repo, pdf, run };
}

afterEach(() => vi.unstubAllEnvs());

describe("runSend: novas aprovacoes", () => {
  test("aprovada com e-mail vira rascunho com a mensagem editada da Fila, sem chamar LLM", async () => {
    const { gmail, repo, run } = setup([fila("a")]);
    const r = await run();
    expect(r).toEqual({ rascunhos: 1, manuais: 0, followups: 0 });
    expect(gmail.rascunhos[0]!.corpo).toBe("Mensagem editada a");
    expect(gmail.rascunhos[0]!.para).toBe("rh-a@acme.test");
    expect(repo.cands[0]).toMatchObject({
      id: "a", canal: "email", status: "rascunho criado", idRascunho: "d1", idThread: "t1", followupEm: "",
    });
    expect(repo.fila[0]!.status).toBe("processada");
  });

  test("com ENVIO_DIRETO a candidatura nasce 'enviada' com followupEm em 7 dias", async () => {
    vi.stubEnv("ENVIO_DIRETO", "true");
    const { gmail, repo, run } = setup([fila("a")]);
    await run();
    expect(gmail.enviados).toEqual(["d1"]);
    expect(repo.cands[0]).toMatchObject({ status: "enviada", followupEm: iso(new Date(agora.getTime() + 7 * DIA)) });
  });

  test("aprovada sem e-mail vira 'aplicar manualmente'", async () => {
    const { gmail, repo, pdf, run } = setup([fila("a", { emailContato: null, mensagem: "" })]);
    const r = await run();
    expect(r).toEqual({ rascunhos: 0, manuais: 1, followups: 0 });
    expect(gmail.rascunhos).toHaveLength(0);
    expect(pdf).not.toHaveBeenCalled();
    expect(repo.cands[0]).toMatchObject({ canal: "formulario", status: "aplicar manualmente", idRascunho: "" });
    expect(repo.fila[0]!.status).toBe("processada");
  });

  test("respeita o teto: excedente fica 'aguardando semana' na Fila, melhores notas primeiro", async () => {
    const usadas = Array.from({ length: 28 }, (_, i) => cand(`u${i}`, { data: iso(new Date(agora.getTime() - DIA)) }));
    const { repo, run } = setup(
      [fila("baixa", { nota: 61 }), fila("alta", { nota: 95 }), fila("media", { nota: 70 })],
      usadas,
    );
    const r = await run();
    expect(r.rascunhos).toBe(2);
    const status = Object.fromEntries(repo.fila.map((f) => [f.id, f.status]));
    expect(status).toEqual({ alta: "processada", media: "processada", baixa: "aguardando semana" });
  });

  test("rodar duas vezes nao cria rascunho duplicado", async () => {
    const { gmail, run } = setup([fila("a"), fila("b", { emailContato: null })]);
    await run();
    const r2 = await run();
    expect(r2).toEqual({ rascunhos: 0, manuais: 0, followups: 0 });
    expect(gmail.rascunhos).toHaveLength(1);
  });

  test("grava a candidatura antes de marcar a Fila e, apos queda entre os dois, nao duplica", async () => {
    const { gmail, repo, run } = setup([fila("a")]);
    repo.falhaAtualizarFila = true;
    await run();
    expect(repo.ordem).toEqual(["fila:a", "cand:a"]);
    expect(repo.logs.some((l) => l.erro.includes("sheets caiu"))).toBe(true);
    repo.falhaAtualizarFila = false;
    const r = await run();
    expect(r.rascunhos).toBe(0);
    expect(gmail.rascunhos).toHaveLength(1);
    expect(repo.cands).toHaveLength(1);
    expect(repo.fila[0]!.status).toBe("processada");
  });

  test("falha ao gravar a candidatura apos criar o rascunho: segunda execucao nao cria outro", async () => {
    const { gmail, repo, run } = setup([fila("a")]);
    repo.falhaAdicionarCand = 1;
    await run();
    expect(gmail.rascunhos).toHaveLength(1);
    expect(repo.fila[0]!.status).toBe("enviando");
    expect(repo.logs[0]!.erro).toContain("draftId=d1");
    expect(repo.logs[0]!.erro).toContain("threadId=t1");
    const r = await run();
    expect(r.rascunhos).toBe(0);
    expect(gmail.rascunhos).toHaveLength(1);
    expect(repo.cands).toHaveLength(0);
    expect(repo.logs.some((l) => l.erro.includes("manualmente"))).toBe(true);
  });

  test("falha ao reservar a Fila ('enviando') pula a linha sem tocar o Gmail", async () => {
    const { gmail, repo, run } = setup([fila("a")]);
    const orig = repo.atualizarFila.bind(repo);
    repo.atualizarFila = async (id, p) => {
      if (p.status === "enviando") throw new Error("sheets caiu");
      return orig(id, p);
    };
    await run();
    expect(gmail.rascunhos).toHaveLength(0);
    expect(repo.cands).toHaveLength(0);
    expect(repo.fila[0]!.status).toBe("novo");
  });

  test("linha 'aguardando semana' e aprovada em uma semana posterior", async () => {
    const usadas = Array.from({ length: 30 }, (_, i) => cand(`u${i}`, { data: iso(new Date(agora.getTime() - DIA)) }));
    const { gmail, repo } = setup([fila("a")], usadas);
    const deps = { gmail, repo, pdf: async () => Buffer.from("pdf") };
    await runSend({ ...deps, agora });
    expect(repo.fila[0]!.status).toBe("aguardando semana");
    const r = await runSend({ ...deps, agora: new Date(agora.getTime() + 7 * DIA) });
    expect(r.rascunhos).toBe(1);
    expect(repo.fila[0]!.status).toBe("processada");
  });

  test("linha com decisao 'aprovar' e mensagem vazia em e-mail e pulada e logada", async () => {
    const { gmail, repo, run } = setup([fila("a", { mensagem: "  " }), fila("b")]);
    const r = await run();
    expect(r.rascunhos).toBe(1);
    expect(gmail.rascunhos).toHaveLength(1);
    expect(repo.fila.find((f) => f.id === "a")!.status).toBe("novo");
    expect(repo.logs).toHaveLength(1);
    expect(repo.logs[0]).toMatchObject({ job: "send", fonte: "send" });
    expect(repo.logs[0]!.erro).toContain("a");
  });

  test("erro em uma linha e logado e nao impede as outras", async () => {
    const { gmail, repo, run } = setup([fila("a", { emailContato: "invalido" }), fila("b", { nota: 10 })]);
    const original = gmail.criarRascunho.bind(gmail);
    gmail.criarRascunho = async (r) => {
      if (r.para === "invalido") throw new Error("destinatario ruim");
      return original(r);
    };
    const r = await run();
    expect(r.rascunhos).toBe(1);
    expect(repo.logs[0]!.erro).toContain("destinatario ruim");
    expect(repo.fila.find((f) => f.id === "b")!.status).toBe("processada");
  });

  test("PDF so e baixado se houver ao menos um rascunho a criar, e uma unica vez", async () => {
    const vazio = setup([fila("a", { emailContato: null })]);
    await vazio.run();
    expect(vazio.pdf).not.toHaveBeenCalled();

    const dois = setup([fila("a"), fila("b")]);
    await dois.run();
    expect(dois.pdf).toHaveBeenCalledTimes(1);
  });
});

describe("runSend: status e follow-up", () => {
  test("rascunho que sumiu e thread com mensagem deMim vira 'enviada' com followupEm", async () => {
    const enviadaEm = new Date(agora.getTime() - 2 * DIA);
    const { gmail, repo, run } = setup([], [cand("a", { status: "rascunho criado", idRascunho: "d9" })]);
    gmail.threads.set("th-a", [{ deMim: true, data: enviadaEm, messageId: "<m1>" }]);
    await run();
    expect(repo.cands[0]).toMatchObject({ status: "enviada", followupEm: iso(new Date(enviadaEm.getTime() + 7 * DIA)) });
  });

  test("rascunho que ainda existe, ou que sumiu sem mensagem deMim, nao muda", async () => {
    const { gmail, repo, run } = setup(
      [],
      [
        cand("a", { status: "rascunho criado", idRascunho: "d1" }),
        cand("b", { status: "rascunho criado", idRascunho: "d2" }),
      ],
    );
    gmail.existentes.add("d1");
    gmail.threads.set("th-a", [{ deMim: true, data: agora, messageId: "<m>" }]);
    await run();
    expect(repo.cands.map((c) => c.status)).toEqual(["rascunho criado", "rascunho criado"]);
    // Thread de "b" sumiu (o cliente devolve [] no 404): fica como esta, sem erro no Log.
    expect(repo.logs).toEqual([]);
  });

  test("status colocado a mao pelo dono nunca e alterado", async () => {
    const msgs: Msg[] = [
      { deMim: true, data: new Date(agora.getTime() - 9 * DIA), messageId: "<m1>" },
      { deMim: false, data: new Date(agora.getTime() - 8 * DIA), messageId: "<m2>" },
    ];
    const { gmail, repo, run } = setup(
      [],
      (["respondeu", "entrevista", "recusada", ""] as const).map((s, i) => cand(`x${i}`, { status: s })),
    );
    for (let i = 0; i < 4; i++) gmail.threads.set(`th-x${i}`, msgs);
    await run();
    expect(repo.cands.map((c) => c.status)).toEqual(["respondeu", "entrevista", "recusada", ""]);
  });

  test("enviada ha 7 dias sem resposta de terceiro e sem followup cria rascunho de follow-up", async () => {
    const { gmail, repo, run } = setup(
      [fila("a", { status: "processada", emailContato: "rh@acme.test" })],
      [cand("a", { followupEm: iso(new Date(agora.getTime() - 1000)) })],
    );
    gmail.threads.set("th-a", [
      { deMim: true, data: new Date(agora.getTime() - 8 * DIA), messageId: "<primeira>" },
      { deMim: true, data: new Date(agora.getTime() - 7 * DIA), messageId: "<ultima>" },
    ]);
    const r = await run();
    expect(r.followups).toBe(1);
    expect(gmail.rascunhos[0]).toMatchObject({ para: "rh@acme.test", threadId: "th-a", inReplyTo: "<ultima>" });
    expect(repo.cands[0]!.idRascunhoFollowup).toBe("d1");
    expect((await run()).followups).toBe(0);
  });

  test("followup ainda nao devido nao e criado", async () => {
    const { gmail, run } = setup(
      [fila("a", { status: "processada" })],
      [cand("a", { followupEm: iso(new Date(agora.getTime() + DIA)) })],
    );
    gmail.threads.set("th-a", [{ deMim: true, data: agora, messageId: "<m>" }]);
    expect((await run()).followups).toBe(0);
  });

  test("enviada ha 7 dias com resposta de terceiro vira 'respondeu' e nao cria follow-up", async () => {
    const { gmail, repo, run } = setup(
      [fila("a", { status: "processada" })],
      [cand("a", { followupEm: iso(new Date(agora.getTime() - DIA)) })],
    );
    gmail.threads.set("th-a", [
      { deMim: true, data: new Date(agora.getTime() - 8 * DIA), messageId: "<m1>" },
      { deMim: false, data: new Date(agora.getTime() - 3 * DIA), messageId: "<m2>" },
    ]);
    const r = await run();
    expect(r.followups).toBe(0);
    expect(gmail.rascunhos).toHaveLength(0);
    expect(repo.cands[0]!.status).toBe("respondeu");
  });

  test("follow-up: falha ao gravar o id apos criar o rascunho nao gera segundo follow-up", async () => {
    const { gmail, repo, run } = setup(
      [fila("a", { status: "processada" })],
      [cand("a", { followupEm: iso(new Date(agora.getTime() - 1000)) })],
    );
    gmail.threads.set("th-a", [{ deMim: true, data: new Date(agora.getTime() - 8 * DIA), messageId: "<m>" }]);
    repo.falhaAtualizarCand = (p) => Boolean(p.idRascunhoFollowup && p.idRascunhoFollowup !== "pendente");
    await run();
    expect(gmail.rascunhos).toHaveLength(1);
    expect(repo.cands[0]!.idRascunhoFollowup).toBe("pendente");
    expect(repo.logs[0]!.erro).toContain("draftId=d1");
    repo.falhaAtualizarCand = undefined;
    const r = await run();
    expect(r.followups).toBe(0);
    expect(gmail.rascunhos).toHaveLength(1);
  });

  test("recrutador respondeu e o dono respondeu de volta antes da proxima execucao: 'respondeu', sem follow-up", async () => {
    const { gmail, repo, run } = setup(
      [fila("a", { status: "processada" })],
      [cand("a", { followupEm: iso(new Date(agora.getTime() - DIA)) })],
    );
    gmail.threads.set("th-a", [
      { deMim: true, data: new Date(agora.getTime() - 9 * DIA), messageId: "<m1>" },
      { deMim: false, data: new Date(agora.getTime() - 5 * DIA), messageId: "<m2>" },
      { deMim: true, data: new Date(agora.getTime() - 4 * DIA), messageId: "<m3>" },
    ]);
    const r = await run();
    expect(r.followups).toBe(0);
    expect(repo.cands[0]!.status).toBe("respondeu");
  });

  test("follow-up sem linha correspondente na Fila e pulado e logado", async () => {
    const { gmail, repo, run } = setup([], [cand("a", { followupEm: iso(new Date(agora.getTime() - DIA)) })]);
    gmail.threads.set("th-a", [{ deMim: true, data: new Date(agora.getTime() - 8 * DIA), messageId: "<m>" }]);
    const r = await run();
    expect(r.followups).toBe(0);
    expect(repo.logs).toHaveLength(1);
    expect(repo.logs[0]!.erro).toContain("a");
  });
});

describe("gmailDryRun", () => {
  test("criarRascunho e enviarRascunho so registram; leituras passam para o cliente real", async () => {
    const real = new GmailFalso();
    real.existentes.add("dx");
    const dry = gmailDryRun(real);
    const r = await runSend({
      gmail: dry,
      repo: new RepoFalso([fila("a")]),
      pdf: async () => Buffer.from("pdf"),
      agora,
    });
    expect(r.rascunhos).toBe(1);
    expect(real.rascunhos).toHaveLength(0);
    expect(real.enviados).toHaveLength(0);
    expect(dry.simulados).toEqual(["criarRascunho:rh-a@acme.test"]);
    expect(await dry.rascunhoExiste("dx")).toBe(true);
  });

  test("com ENVIO_DIRETO o dry-run tambem nao envia", async () => {
    vi.stubEnv("ENVIO_DIRETO", "true");
    const real = new GmailFalso();
    const dry = gmailDryRun(real);
    await runSend({ gmail: dry, repo: new RepoFalso([fila("a")]), pdf: async () => Buffer.alloc(0), agora });
    expect(real.enviados).toHaveLength(0);
    expect(dry.simulados.some((s) => s.startsWith("enviarRascunho"))).toBe(true);
  });
});
