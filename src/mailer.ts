import { readFileSync } from "node:fs";
import type { GmailClient } from "./clients/gmail.js";
import { envioDireto, nomeCandidato } from "./config.js";
import type { CandidaturaRow, FilaRow } from "./types.js";

const TEMPLATE_FOLLOWUP = new URL("../templates/followup.md", import.meta.url);

function umaLinha(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

export async function criarRascunhoCandidatura(
  gmail: GmailClient,
  row: FilaRow,
  pdf: Buffer,
): Promise<{ draftId: string; threadId: string }> {
  if (!row.emailContato?.trim()) throw new Error("Vaga sem e-mail de contato");
  const r = await gmail.criarRascunho({
    para: row.emailContato.trim(),
    assunto: `Candidatura: ${umaLinha(row.titulo)}`,
    corpo: row.mensagem,
    anexo: { nome: "curriculo.pdf", pdf },
  });
  if (envioDireto()) await gmail.enviarRascunho(r.draftId);
  return r;
}

export async function criarRascunhoFollowup(
  gmail: GmailClient,
  c: CandidaturaRow,
  ultimaMsgId: string,
  para: string,
): Promise<{ draftId: string }> {
  const titulo = umaLinha(c.titulo);
  const valores: Record<string, string> = { vaga: titulo, nome: nomeCandidato() };
  const corpo = readFileSync(TEMPLATE_FOLLOWUP, "utf8")
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
      if (!(k in valores)) throw new Error(`Marcador desconhecido no template: ${k}`);
      return valores[k];
    })
    .trim();
  const { draftId } = await gmail.criarRascunho({
    para,
    assunto: `Re: Candidatura: ${titulo}`,
    corpo,
    threadId: c.idThread,
    inReplyTo: ultimaMsgId,
  });
  return { draftId };
}
