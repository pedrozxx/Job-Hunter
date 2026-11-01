// Creates the Fila, Candidaturas and Log tabs (with headers) and the decisao dropdown.
// Usage: SHEET_ID=... npx tsx scripts/setup-sheet.ts  (uses the OAuth client from src/clients/google.ts)
import type { sheets_v4 } from "googleapis";
import { ABAS, COLUNAS_CAND, COLUNAS_FILA, COLUNAS_LOG } from "../src/clients/sheets.js";

const ABAS_COM_CABECALHO = [
  { nome: ABAS.fila, headers: COLUNAS_FILA.map((c) => c.header) },
  { nome: ABAS.candidaturas, headers: COLUNAS_CAND.map((c) => c.header) },
  { nome: ABAS.log, headers: COLUNAS_LOG.map((c) => c.header) },
];

export async function configurarPlanilha(api: sheets_v4.Sheets, spreadsheetId: string): Promise<void> {
  const { data } = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  const existentes = new Map((data.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0]));

  const criar = ABAS_COM_CABECALHO.filter((a) => !existentes.has(a.nome));
  if (criar.length > 0) {
    const res = await api.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: criar.map((a) => ({ addSheet: { properties: { title: a.nome } } })) },
    });
    for (const r of res.data.replies ?? []) {
      const p = r.addSheet?.properties;
      if (p?.title) existentes.set(p.title, p.sheetId ?? 0);
    }
    await api.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: criar.map((a) => ({ range: `'${a.nome}'!A1`, values: [a.headers] })),
      },
    });
  }

  const colDecisao = COLUNAS_FILA.findIndex((c) => c.header === "decisao");
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId: existentes.get(ABAS.fila),
              startRowIndex: 1,
              startColumnIndex: colDecisao,
              endColumnIndex: colDecisao + 1,
            },
            rule: {
              condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "aprovar" }, { userEnteredValue: "descartar" }] },
              showCustomUi: true,
              strict: false, // tolerate stray capitalisation; the repo normalises on read
            },
          },
        },
      ],
    },
  });
}

if (process.argv[1]?.endsWith("setup-sheet.ts")) {
  const { makeGoogleClients } = await import("../src/clients/google.js");
  const id = process.env.SHEET_ID;
  if (!id) {
    console.error("Defina SHEET_ID antes de rodar.");
    process.exit(1);
  }
  await configurarPlanilha(makeGoogleClients().sheets, id);
  console.log("Planilha configurada.");
}
