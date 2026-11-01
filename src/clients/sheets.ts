import type { sheets_v4 } from "googleapis";
import type { RetryOpts } from "../retry.js";
import type { CandidaturaRow, FilaRow, LogRow } from "../types.js";
import { anotarStatus, chamar } from "./googleErrors.js";

export interface SheetsRepo {
  lerFila(): Promise<FilaRow[]>;
  adicionarFila(r: FilaRow[]): Promise<void>;
  atualizarFila(id: string, p: Partial<FilaRow>): Promise<void>;
  lerCandidaturas(): Promise<CandidaturaRow[]>;
  adicionarCandidatura(r: CandidaturaRow): Promise<void>;
  atualizarCandidatura(id: string, p: Partial<CandidaturaRow>): Promise<void>;
  log(r: LogRow): Promise<void>;
  idsVistos(): Promise<Set<string>>;
}

// "str": text, empty cell reads "". "nullstr": text, empty cell reads null.
// "num": number, empty reads 0 (log columns are always filled).
// "list": array joined by "; ". "id": text, trimmed. "enum": hand-edited by the owner, so read
// trimmed and lowercased; a value outside `valores` reads "" (like an undecided decisao) and never crashes.
type Kind = "str" | "nullstr" | "num" | "list" | "id" | "enum";
type Col<T> = { header: string; campo: keyof T & string; kind: Kind; valores?: readonly string[] };
const DECISOES = ["aprovar", "descartar"] as const;
const CANAIS = ["email", "formulario"] as const;
const STATUS_CAND = [
  "rascunho criado", "aplicar manualmente", "enviada", "respondeu", "entrevista", "recusada", "sem resposta",
] as const;

export const COLUNAS_FILA: Col<FilaRow>[] = [
  { header: "id", campo: "id", kind: "id" },
  { header: "coletada_em", campo: "coletadaEm", kind: "str" },
  { header: "fonte", campo: "fonte", kind: "str" },
  { header: "empresa", campo: "empresa", kind: "str" },
  { header: "titulo", campo: "titulo", kind: "str" },
  { header: "nivel", campo: "nivel", kind: "str" },
  { header: "modalidade", campo: "modalidade", kind: "str" },
  { header: "local", campo: "local", kind: "nullstr" },
  { header: "link", campo: "link", kind: "str" },
  { header: "email_contato", campo: "emailContato", kind: "nullstr" },
  { header: "nota", campo: "nota", kind: "num" },
  { header: "atende", campo: "atende", kind: "list" },
  { header: "motivo", campo: "motivo", kind: "str" },
  { header: "falta", campo: "falta", kind: "list" },
  { header: "mensagem", campo: "mensagem", kind: "str" },
  { header: "decisao", campo: "decisao", kind: "enum", valores: DECISOES },
  { header: "status", campo: "status", kind: "str" },
];

export const COLUNAS_CAND: Col<CandidaturaRow>[] = [
  { header: "id", campo: "id", kind: "id" },
  { header: "data", campo: "data", kind: "str" },
  { header: "empresa", campo: "empresa", kind: "str" },
  { header: "titulo", campo: "titulo", kind: "str" },
  { header: "canal", campo: "canal", kind: "enum", valores: CANAIS },
  { header: "status", campo: "status", kind: "enum", valores: STATUS_CAND },
  { header: "id_rascunho", campo: "idRascunho", kind: "str" },
  { header: "id_thread", campo: "idThread", kind: "str" },
  { header: "followup_em", campo: "followupEm", kind: "str" },
  { header: "id_rascunho_followup", campo: "idRascunhoFollowup", kind: "str" },
];

export const COLUNAS_LOG: Col<LogRow>[] = [
  { header: "data", campo: "data", kind: "str" },
  { header: "job", campo: "job", kind: "str" },
  { header: "fonte", campo: "fonte", kind: "str" },
  { header: "coletadas", campo: "coletadas", kind: "num" },
  { header: "passaram_filtro", campo: "passaramFiltro", kind: "num" },
  { header: "acima_corte", campo: "acimaCorte", kind: "num" },
  { header: "erro", campo: "erro", kind: "str" },
];

export const ABAS = { fila: "Fila", candidaturas: "Candidaturas", log: "Log" } as const;

const SEP = "; ";

function paraCelula(v: unknown, kind: Kind): string | number {
  if (v === undefined || v === null) return "";
  if (kind === "list") return Array.isArray(v) ? v.join(SEP) : String(v);
  if (kind === "num") return typeof v === "number" ? v : Number(v);
  return String(v);
}

function deCelula(c: unknown, kind: Kind, valores?: readonly string[]): unknown {
  const vazio = c === undefined || c === null || c === "";
  switch (kind) {
    case "num": {
      if (vazio) return undefined;
      const n = typeof c === "number" ? c : Number(String(c).replace(",", "."));
      return Number.isFinite(n) ? n : undefined;
    }
    case "list":
      return vazio ? [] : String(c).split(";").map((x) => x.trim()).filter(Boolean);
    case "nullstr":
      return vazio ? null : String(c);
    case "enum": {
      const t = vazio ? "" : String(c).trim().toLowerCase();
      return valores?.includes(t) ? t : "";
    }
    case "id":
      return vazio ? "" : String(c).trim();
    default:
      return vazio ? "" : String(c);
  }
}

type Tabela = { headers: string[]; linhas: unknown[][] };

export function makeSheetsRepo(api: sheets_v4.Sheets, sheetId: string, opts: RetryOpts = {}): SheetsRepo {
  const q = (aba: string) => `'${aba}'`;

  async function ler(aba: string): Promise<Tabela> {
    const res = await chamar(
      () =>
        api.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: q(aba),
          valueRenderOption: "UNFORMATTED_VALUE",
        }),
      opts,
    );
    const [cab = [], ...linhas] = (res.data.values ?? []) as unknown[][];
    return { headers: cab.map((h) => String(h).trim()), linhas };
  }

  async function lerCabecalho(aba: string): Promise<string[]> {
    const res = await chamar(
      () => api.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${q(aba)}!1:1` }),
      opts,
    );
    return ((res.data.values?.[0] ?? []) as unknown[]).map((h) => String(h).trim());
  }

  function indice(headers: string[], col: { header: string }, aba: string): number {
    const i = headers.indexOf(col.header);
    if (i < 0) throw new Error(`Coluna "${col.header}" nao existe na aba ${aba}`);
    return i;
  }

  function parse<T>(t: Tabela, cols: Col<T>[], aba: string): T[] {
    const idx = cols.map((c) => indice(t.headers, c, aba));
    return t.linhas
      .filter((l) => l.some((c) => c !== "" && c !== undefined && c !== null))
      .map((l) => {
        const o: Record<string, unknown> = {};
        cols.forEach((c, k) => {
          o[c.campo] = deCelula(l[idx[k]], c.kind, c.valores);
        });
        return o as T;
      });
  }

  // Rows are located by the value of the "id" column, never by position, so the owner can sort
  // or filter the sheet. If the same id appears twice, the first occurrence wins and the rest are
  // left untouched (no error, nothing reported).
  async function atualizar<T>(aba: string, cols: Col<T>[], id: string, p: Partial<T>): Promise<void> {
    const t = await ler(aba);
    const iId = indice(t.headers, { header: "id" }, aba);
    const pos = t.linhas.findIndex((l) => String(l[iId] ?? "").trim() === id.trim());
    if (pos < 0) throw new Error(`id "${id}" nao encontrado na aba ${aba}`);
    const linhaNaPlanilha = pos + 2;
    const data: sheets_v4.Schema$ValueRange[] = [];
    for (const c of cols) {
      const v = (p as Record<string, unknown>)[c.campo];
      if (v === undefined) continue;
      const i = indice(t.headers, c, aba);
      data.push({ range: `${q(aba)}!${letra(i)}${linhaNaPlanilha}`, values: [[paraCelula(v, c.kind)]] });
    }
    if (data.length === 0) return;
    await chamar(
      () =>
        api.spreadsheets.values.batchUpdate({
          spreadsheetId: sheetId,
          requestBody: { valueInputOption: "RAW", data },
        }),
      opts,
    );
  }

  async function adicionar<T>(aba: string, cols: Col<T>[], rows: T[]): Promise<void> {
    if (rows.length === 0) return;
    const headers = await lerCabecalho(aba);
    const idx = cols.map((c) => indice(headers, c, aba));
    const values = rows.map((r) => {
      const linha: (string | number)[] = Array(headers.length).fill("");
      cols.forEach((c, k) => {
        linha[idx[k]] = paraCelula((r as Record<string, unknown>)[c.campo], c.kind);
      });
      return linha;
    });
    // No retry: a 5xx after the server applied the append would duplicate rows.
    try {
      await api.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: q(aba),
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values },
      });
    } catch (e) {
      anotarStatus(e);
      throw e;
    }
  }

  async function lerFila(): Promise<FilaRow[]> {
    return parse<FilaRow>(await ler(ABAS.fila), COLUNAS_FILA, ABAS.fila).map((r) => ({
      ...r,
      descricao: "", // not stored in the sheet
      ...(r.nota === undefined ? { nota: undefined, motivo: undefined, atende: undefined, falta: undefined } : {}),
    }));
  }

  return {
    lerFila,
    adicionarFila: (r) => adicionar(ABAS.fila, COLUNAS_FILA, r),
    atualizarFila: (id, p) => atualizar(ABAS.fila, COLUNAS_FILA, id, p),
    lerCandidaturas: async () => parse<CandidaturaRow>(await ler(ABAS.candidaturas), COLUNAS_CAND, ABAS.candidaturas),
    adicionarCandidatura: (r) => adicionar(ABAS.candidaturas, COLUNAS_CAND, [r]),
    atualizarCandidatura: (id, p) => atualizar(ABAS.candidaturas, COLUNAS_CAND, id, p),
    log: (r) => adicionar(ABAS.log, COLUNAS_LOG, [r]),
    async idsVistos() {
      const [f, c] = await Promise.all([ler(ABAS.fila), ler(ABAS.candidaturas)]);
      const ids = new Set<string>();
      for (const [t, aba] of [[f, ABAS.fila], [c, ABAS.candidaturas]] as const) {
        const i = indice(t.headers, { header: "id" }, aba);
        for (const l of t.linhas) {
          const v = String(l[i] ?? "").trim();
          if (v) ids.add(v);
        }
      }
      return ids;
    },
  };
}

function letra(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
