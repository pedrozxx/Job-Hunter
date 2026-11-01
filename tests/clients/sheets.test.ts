import { describe, it, expect } from "vitest";
import type { sheets_v4 } from "googleapis";
import { makeSheetsRepo } from "../../src/clients/sheets.js";
import type { CandidaturaRow, FilaRow, LogRow } from "../../src/types.js";

type Write = { range: string; values: unknown[][]; valueInputOption: string | undefined };

function fakeApi(tabs: Record<string, string[][]>) {
  const writes: Write[] = [];
  const nome = (range: string) => range.split("!")[0].replace(/^'|'$/g, "");
  const api = {
    spreadsheets: {
      values: {
        async get({ range }: { range: string }) {
          const rows = tabs[nome(range)] ?? [];
          return { data: { values: range.endsWith("!1:1") ? rows.slice(0, 1) : rows } };
        },
        async append({ range, valueInputOption, requestBody }: any) {
          const t = (tabs[nome(range)] ??= []);
          for (const r of requestBody.values) t.push(r.map(String));
          writes.push({ range, values: requestBody.values, valueInputOption });
          return { data: {} };
        },
        async batchUpdate({ requestBody }: any) {
          for (const d of requestBody.data) {
            const m = /^'?([^'!]+)'?!([A-Z]+)(\d+)$/.exec(d.range)!;
            const col = [...m[2]].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
            const row = tabs[m[1]][Number(m[3]) - 1];
            while (row.length <= col) row.push("");
            row[col] = String(d.values[0][0]);
            writes.push({ range: d.range, values: d.values, valueInputOption: requestBody.valueInputOption });
          }
          return { data: {} };
        },
      },
    },
  };
  return { api: api as unknown as sheets_v4.Sheets, tabs, writes };
}

const HEAD_FILA = "id,coletada_em,fonte,empresa,titulo,nivel,modalidade,local,link,email_contato,nota,atende,motivo,falta,mensagem,decisao,status".split(",");
const HEAD_CAND = "id,data,empresa,titulo,canal,status,id_rascunho,id_thread,followup_em,id_rascunho_followup".split(",");

const fila = (o: Partial<FilaRow> = {}): FilaRow => ({
  id: "a1", fonte: "gmail-gupy", titulo: "Dev", empresa: "Acme", local: "Recife", modalidade: "remoto",
  nivel: "junior", descricao: "", link: "https://x.test/1", emailContato: "rh@x.test",
  coletadaEm: "2026-11-01T10:00:00Z", nota: 80, motivo: "ok", atende: ["ts", "node"], falta: ["aws", "go"],
  mensagem: "Ola", decisao: "", status: "novo", ...o,
});
const cand = (o: Partial<CandidaturaRow> = {}): CandidaturaRow => ({
  id: "c1", data: "2026-11-01", empresa: "Acme", titulo: "Dev", canal: "email", status: "rascunho criado",
  idRascunho: "d1", idThread: "t1", followupEm: "", idRascunhoFollowup: "", ...o,
});

describe("SheetsRepo", () => {
  it("cabecalho define a coluna: colunas reordenadas pelo Pedro continuam funcionando", async () => {
    const reord = [...HEAD_FILA].reverse();
    const f = fakeApi({ Fila: [reord] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila()]);
    expect(f.tabs.Fila[1][reord.indexOf("empresa")]).toBe("Acme");
    expect(f.tabs.Fila[1][reord.indexOf("nota")]).toBe("80");
    const lida = (await repo.lerFila())[0];
    expect(lida).toMatchObject({ id: "a1", empresa: "Acme", nota: 80, coletadaEm: "2026-11-01T10:00:00Z", emailContato: "rh@x.test" });
    await repo.atualizarFila("a1", { status: "processada" });
    expect(f.tabs.Fila[1][reord.indexOf("status")]).toBe("processada");
  });

  it("atualizarFila acha a linha pelo id mesmo com linhas ordenadas por nota", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila({ id: "a1", nota: 50 }), fila({ id: "a2", nota: 90 })]);
    f.tabs.Fila.splice(1, 2, ...[...f.tabs.Fila.slice(1)].reverse()); // Pedro ordenou por nota
    await repo.atualizarFila("a1", { decisao: "aprovar", mensagem: "Editada" });
    const lidas = await repo.lerFila();
    expect(lidas.find((r) => r.id === "a1")).toMatchObject({ decisao: "aprovar", mensagem: "Editada" });
    expect(lidas.find((r) => r.id === "a2")).toMatchObject({ decisao: "", mensagem: "Ola" });
  });

  it("atualiza so as celulas alteradas", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila()]);
    f.writes.length = 0;
    await repo.atualizarFila("a1", { status: "semana cheia" });
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0].range).toMatch(/!Q2$/);
  });

  it("atualizarFila com id inexistente lanca erro", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA] });
    await expect(makeSheetsRepo(f.api, "S").atualizarFila("nada", { status: "novo" })).rejects.toThrow(/nada/);
  });

  it("id duplicado: atualiza a primeira ocorrencia", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila(), fila()]);
    await repo.atualizarFila("a1", { status: "processada" });
    const r = await repo.lerFila();
    expect(r.map((x) => x.status)).toEqual(["processada", "novo"]);
  });

  it("idsVistos junta Fila e Candidaturas", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA], Candidaturas: [HEAD_CAND] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila({ id: "a1" })]);
    await repo.adicionarCandidatura(cand({ id: "c1" }));
    expect([...(await repo.idsVistos())].sort()).toEqual(["a1", "c1"]);
  });

  it("falta/atende sao gravados como texto separado por '; ' e lidos de volta como array", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila()]);
    expect(f.tabs.Fila[1][HEAD_FILA.indexOf("falta")]).toBe("aws; go");
    expect(f.tabs.Fila[1][HEAD_FILA.indexOf("atende")]).toBe("ts; node");
    const r = (await repo.lerFila())[0];
    expect(r.falta).toEqual(["aws", "go"]);
    expect(r.atende).toEqual(["ts", "node"]);
  });

  it("linha sem nota: campos de pontuacao ficam undefined; com nota e listas vazias, []", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([
      fila({ id: "x", nota: undefined, motivo: undefined, atende: undefined, falta: undefined, local: null, emailContato: null }),
      fila({ id: "y", falta: [], atende: [] }),
    ]);
    const [x, y] = await repo.lerFila();
    expect(x).toMatchObject({ nota: undefined, motivo: undefined, atende: undefined, falta: undefined, local: null, emailContato: null });
    expect(y).toMatchObject({ nota: 80, falta: [], atende: [] });
  });

  it("celula de decisao com 'Aprovar ' e lida como 'aprovar'; valor desconhecido vira vazio", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila({ id: "a" }), fila({ id: "b" })]);
    f.tabs.Fila[1][HEAD_FILA.indexOf("decisao")] = "Aprovar ";
    f.tabs.Fila[2][HEAD_FILA.indexOf("decisao")] = "talvez";
    expect((await repo.lerFila()).map((r) => r.decisao)).toEqual(["aprovar", ""]);
  });

  it("escreve com RAW para que '=cmd' nunca seja avaliado como formula", async () => {
    const f = fakeApi({ Fila: [HEAD_FILA], Candidaturas: [HEAD_CAND], Log: [["data", "job", "fonte", "coletadas", "passaram_filtro", "acima_corte", "erro"]] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarFila([fila({ empresa: "=HYPERLINK(\"http://evil\")" })]);
    await repo.atualizarFila("a1", { mensagem: "=1+1" });
    await repo.adicionarCandidatura(cand({ titulo: "+cmd" }));
    await repo.atualizarCandidatura("c1", { status: "enviada" });
    const l: LogRow = { data: "d", job: "collect", fonte: "x", coletadas: 1, passaramFiltro: 2, acimaCorte: 3, erro: "@boom" };
    await repo.log(l);
    expect(f.writes.length).toBe(5);
    expect(f.writes.every((w) => w.valueInputOption === "RAW")).toBe(true);
  });

  it("candidaturas e log: ida e volta, numeros como numeros", async () => {
    const f = fakeApi({ Candidaturas: [HEAD_CAND], Log: [["data", "job", "fonte", "coletadas", "passaram_filtro", "acima_corte", "erro"]] });
    const repo = makeSheetsRepo(f.api, "S");
    await repo.adicionarCandidatura(cand());
    await repo.atualizarCandidatura("c1", { status: "enviada", followupEm: "2026-11-08" });
    expect(await repo.lerCandidaturas()).toEqual([cand({ status: "enviada", followupEm: "2026-11-08" })]);
    await repo.log({ data: "d", job: "send", fonte: "", coletadas: 7, passaramFiltro: 5, acimaCorte: 2, erro: "" });
    expect(f.tabs.Log[1]).toEqual(["d", "send", "", "7", "5", "2", ""]);
  });

  it("falha claramente se a aba nao tem a coluna a escrever", async () => {
    const f = fakeApi({ Fila: [["id", "status"], ["a1", "novo"]] });
    await expect(makeSheetsRepo(f.api, "S").adicionarFila([fila()])).rejects.toThrow(/coletada_em/);
    await expect(makeSheetsRepo(f.api, "S").atualizarFila("a1", { mensagem: "x" })).rejects.toThrow(/mensagem/);
  });
});
