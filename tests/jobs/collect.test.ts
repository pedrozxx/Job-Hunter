import { describe, expect, test } from "vitest";
import { runCollect } from "../../src/jobs/collect.js";
import type { GmailClient } from "../../src/clients/gmail.js";
import type { LlmClient } from "../../src/clients/llm.js";
import type { SheetsRepo } from "../../src/clients/sheets.js";
import { REPOS_VAGAS } from "../../src/config.js";
import type { Perfil } from "../../src/secrets.js";
import type { CandidaturaRow, FilaRow, LogRow } from "../../src/types.js";

const agora = new Date("2026-11-04T13:00:00Z");
const desde = new Date(agora.getTime() - 26 * 3600 * 1000);
const perfil: Perfil = { markdown: "PERFIL", termosExclusao: [] };
const TRECHO = "Construí um painel em React com TypeScript no meu último projeto.";

type Issue = { title: string; html_url: string; body: string; labels: { name: string }[] };

// body "NOTA:xx" tells the fake Haiku which score to return; "QUEBRA" makes it answer garbage.
function issue(n: number, nota: number | "QUEBRA"): Issue {
  return {
    title: `[Acme] Desenvolvedor Junior ${n}`,
    html_url: `https://github.com/frontendbr/vagas/issues/${n}`,
    body: `Vaga com React. NOTA:${nota}`,
    labels: [{ name: "Remoto" }, { name: "Júnior" }],
  };
}

function fetchCom(issues: Issue[], falhaRepo?: string): typeof fetch {
  return (async (u: RequestInfo | URL) => {
    const url = String(u);
    if (falhaRepo && url.includes(falhaRepo)) return new Response("{}", { status: 404 });
    const dados = url.includes(REPOS_VAGAS[0]!) ? issues : [];
    return new Response(JSON.stringify(dados), { status: 200 });
  }) as typeof fetch;
}

class LlmFalso implements LlmClient {
  chamadas: Parameters<LlmClient["gerar"]>[0][] = [];
  async gerar(r: Parameters<LlmClient["gerar"]>[0]): Promise<string> {
    this.chamadas.push(r);
    if (r.modelo.includes("sonnet")) return TRECHO;
    const m = r.usuario.match(/NOTA:(\w+)/);
    if (!m || m[1] === "QUEBRA") return "isto nao e json";
    return JSON.stringify({ nota: Number(m[1]), motivo: "ok", atende: ["React"], falta: [] });
  }
  get haiku() {
    return this.chamadas.filter((c) => c.modelo.includes("haiku")).length;
  }
  get sonnet() {
    return this.chamadas.filter((c) => c.modelo.includes("sonnet")).length;
  }
}

class RepoFalso implements SheetsRepo {
  adicionadas: FilaRow[] = [];
  logs: LogRow[] = [];
  chamadasAdicionar = 0;
  constructor(
    public fila: FilaRow[] = [],
    public cands: CandidaturaRow[] = [],
    public vistos: string[] = [],
    public falhaAoAdicionar = false,
  ) {}
  async lerFila() { return this.fila; }
  async adicionarFila(r: FilaRow[]) {
    this.chamadasAdicionar++;
    if (this.falhaAoAdicionar) throw new Error("append falhou");
    this.adicionadas.push(...r);
  }
  async atualizarFila() {}
  async lerCandidaturas() { return this.cands; }
  async adicionarCandidatura() {}
  async atualizarCandidatura() {}
  async log(r: LogRow) { this.logs.push(r); }
  async idsVistos() { return new Set(this.vistos); }
}

const gmailVazio: GmailClient = {
  buscar: async () => [],
  criarRascunho: async () => ({ draftId: "", threadId: "" }),
  rascunhoExiste: async () => false,
  enviarRascunho: async () => {},
  mensagensDaThread: async () => [],
};

function rodar(o: { issues?: Issue[]; repo?: RepoFalso; llm?: LlmFalso; gmail?: GmailClient; fetchFn?: typeof fetch }) {
  const repo = o.repo ?? new RepoFalso();
  const llm = o.llm ?? new LlmFalso();
  const p = runCollect({
    gmail: o.gmail ?? gmailVazio,
    repo,
    llm,
    fetchFn: o.fetchFn ?? fetchCom(o.issues ?? []),
    perfil,
    curriculo: "CV",
    agora,
    desde,
  });
  return { p, repo, llm };
}

const logDe = (repo: RepoFalso, fonte: string) => repo.logs.find((l) => l.fonte === fonte)!;

function candidaturasDaSemana(n: number): CandidaturaRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`, data: agora.toISOString(), empresa: "X", titulo: "Y", canal: "email" as const,
    status: "enviada" as const, idRascunho: "", idThread: "", followupEm: "", idRascunhoFollowup: "",
  }));
}

describe("runCollect", () => {
  test("vagas abaixo de 60 não entram na Fila, mas entram na contagem do Log", async () => {
    const { p, repo, llm } = rodar({ issues: [issue(1, 80), issue(2, 59)] });
    const r = await p;
    expect(repo.adicionadas).toHaveLength(1);
    expect(repo.adicionadas[0]).toMatchObject({ nota: 80, status: "novo", decisao: "" });
    expect(repo.adicionadas[0]!.mensagem).toContain(TRECHO);
    expect(llm.haiku).toBe(2);
    expect(llm.sonnet).toBe(1);
    expect(logDe(repo, "github-repo")).toMatchObject({ coletadas: 2, passaramFiltro: 2, acimaCorte: 1 });
    expect(r).toEqual({ coletadas: 2, filaNova: 1, falhaSistemica: false });
  });

  test("vaga já vista não chama o Claude", async () => {
    const vista = issue(1, 90);
    const repo = new RepoFalso();
    const nova = rodar({ issues: [vista], repo: new RepoFalso() });
    await nova.p;
    repo.vistos = [nova.repo.adicionadas[0]!.id];
    const { p, llm } = rodar({ issues: [vista], repo });
    await p;
    expect(llm.chamadas).toHaveLength(0);
    expect(repo.adicionadas).toHaveLength(0);
    expect(logDe(repo, "github-repo")).toMatchObject({ coletadas: 1, passaramFiltro: 0, acimaCorte: 0 });
  });

  test("semana cheia: grava status 'semana cheia' sem chamar o Sonnet", async () => {
    const aprovadas = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, decisao: "aprovar", status: "novo" }) as FilaRow);
    const cheiaPorFila = new RepoFalso(aprovadas, []);
    const a = rodar({ issues: [issue(1, 90)], repo: cheiaPorFila });
    await a.p;
    expect(a.llm.sonnet).toBe(0);
    expect(cheiaPorFila.adicionadas[0]).toMatchObject({ status: "semana cheia", mensagem: "", decisao: "" });

    const cheiaPorCands = new RepoFalso([], candidaturasDaSemana(30));
    const b = rodar({ issues: [issue(1, 90)], repo: cheiaPorCands });
    await b.p;
    expect(b.llm.sonnet).toBe(0);
    expect(cheiaPorCands.adicionadas[0]!.status).toBe("semana cheia");
  });

  test("aprovações já processadas não contam para a semana cheia", async () => {
    const processadas = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, decisao: "aprovar", status: "processada" }) as FilaRow);
    const repo = new RepoFalso(processadas, []);
    const { p, llm } = rodar({ issues: [issue(1, 90)], repo });
    await p;
    expect(llm.sonnet).toBe(1);
    expect(repo.adicionadas[0]!.status).toBe("novo");
  });

  test("erro numa fonte vai para o Log e a outra fonte segue", async () => {
    const gmail: GmailClient = { ...gmailVazio, buscar: async () => { throw new Error("gmail fora do ar"); } };
    const { p, repo } = rodar({ issues: [issue(1, 80)], gmail });
    await p;
    expect(repo.adicionadas).toHaveLength(1);
    expect(logDe(repo, "gmail").erro).toContain("gmail fora do ar");
    expect(logDe(repo, "github-repo").erro).toBe("");

    const r2 = rodar({ issues: [issue(1, 80)], fetchFn: fetchCom([issue(1, 80)], REPOS_VAGAS[1]) });
    await r2.p;
    expect(logDe(r2.repo, "github-repo").erro).toContain(REPOS_VAGAS[1]);
    expect(logDe(r2.repo, "github-repo").acimaCorte).toBe(1);
  });

  test("ErroPontuacao numa vaga vai para o Log e as outras seguem", async () => {
    const { p, repo } = rodar({ issues: [issue(1, "QUEBRA"), issue(2, 85)] });
    await p;
    expect(repo.adicionadas.map((r) => r.nota)).toEqual([85]);
    const erros = repo.logs.filter((l) => l.fonte === "score");
    expect(erros).toHaveLength(1);
    expect(erros[0]!.erro).toMatch(/[0-9a-f]{40}/);
    expect(erros[0]).toMatchObject({ job: "collect", coletadas: 0, passaramFiltro: 0, acimaCorte: 0 });
    expect(logDe(repo, "github-repo")).toMatchObject({ passaramFiltro: 2, acimaCorte: 1 });
  });

  test("Log tem uma linha por fonte com coletadas, passaramFiltro e acimaCorte", async () => {
    const { p, repo } = rodar({ issues: [issue(1, 70), issue(2, 10)] });
    await p;
    const fontes = repo.logs.filter((l) => l.fonte !== "score").map((l) => l.fonte).sort();
    expect(fontes).toEqual(["github-repo", "gmail"]);
    expect(logDe(repo, "github-repo")).toMatchObject({ job: "collect", coletadas: 2, passaramFiltro: 2, acimaCorte: 1, erro: "" });
    expect(logDe(repo, "gmail")).toMatchObject({ job: "collect", coletadas: 0, passaramFiltro: 0, acimaCorte: 0, erro: "" });
    expect(logDe(repo, "gmail").data).toBe(agora.toISOString());
  });

  test("falha ao gravar a Fila é registrada no Log e relançada", async () => {
    const repo = new RepoFalso([], [], [], true);
    const { p } = rodar({ issues: [issue(1, 80)], repo });
    await expect(p).rejects.toThrow("append falhou");
    expect(repo.logs.some((l) => l.erro.includes("append falhou"))).toBe(true);
  });

  test("grava a Fila em uma única chamada", async () => {
    const { p, repo } = rodar({ issues: [issue(1, 80), issue(2, 90), issue(3, 70)] });
    await p;
    expect(repo.chamadasAdicionar).toBe(1);
    expect(repo.adicionadas).toHaveLength(3);
  });
});

describe("runCollect: falha sistemica", () => {
  const todosFalham: typeof fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;

  test("fonte inteira fora do ar (Gmail) marca falha, depois de gravar o Log", async () => {
    const gmail: GmailClient = { ...gmailVazio, buscar: async () => { throw new Error("gmail fora do ar"); } };
    const { p, repo } = rodar({ issues: [issue(1, 80)], gmail });
    expect((await p).falhaSistemica).toBe(true);
    expect(logDe(repo, "gmail").erro).toContain("gmail fora do ar");
  });

  test("todos os repositorios do GitHub falhando marca falha", async () => {
    const { p, repo } = rodar({ fetchFn: todosFalham });
    expect((await p).falhaSistemica).toBe(true);
    expect(logDe(repo, "github-repo").erro).toContain(REPOS_VAGAS[0]);
  });

  test("um repositorio falhando sozinho nao marca falha", async () => {
    const { p } = rodar({ fetchFn: fetchCom([issue(1, 80)], REPOS_VAGAS[1]) });
    expect((await p).falhaSistemica).toBe(false);
  });

  test("alerta do LinkedIn sem vagas reconhecidas nao conta como fonte fora do ar", async () => {
    const gmail: GmailClient = {
      ...gmailVazio,
      buscar: async () => [{
        id: "e1", threadId: "t1", from: "LinkedIn <jobalerts-noreply@linkedin.com>", subject: "Vagas",
        date: agora, html: "<html><body><p>nada aqui</p></body></html>", text: "",
      }],
    };
    const { p, repo } = rodar({ issues: [issue(1, 80)], gmail });
    expect((await p).falhaSistemica).toBe(false);
    expect(logDe(repo, "gmail").erro).toContain("Alerta sem vagas reconhecidas");
  });

  test("todas as chamadas ao Claude falhando marca falha", async () => {
    const llm = new LlmFalso();
    llm.gerar = async () => { throw new Error("claude-haiku-5-5: resposta cortada (stop_reason max_tokens, limite 16000)"); };
    const { p, repo } = rodar({ issues: [issue(1, 80), issue(2, 90)], llm });
    expect((await p).falhaSistemica).toBe(true);
    expect(repo.logs.filter((l) => l.fonte === "score")).toHaveLength(2);
  });

  test("so uma vaga falhando no Claude nao marca falha; sem vagas tambem nao", async () => {
    const { p } = rodar({ issues: [issue(1, "QUEBRA"), issue(2, 85)] });
    expect((await p).falhaSistemica).toBe(false);
    const vazio = rodar({ issues: [] });
    expect((await vazio.p).falhaSistemica).toBe(false);
  });
});
