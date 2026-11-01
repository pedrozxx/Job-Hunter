import * as cheerio from "cheerio";
import type { EmailBruto } from "../../clients/gmail.js";
import { extractEmail, inferModalidade, inferNivel, normalizeLink, vagaId } from "../../normalize.js";
import type { Vaga } from "../../types.js";

const PREFIXO = /^\s*\[vaga\]\s*/i;
const URL_RE = /https?:\/\/[^\s<>"')\]]+/;

/** `meuEmail`: endereço do dono, que nunca é o contato da vaga (aparece em encaminhamentos). */
export function parseVagaManual(e: EmailBruto, meuEmail?: string): Vaga[] {
  const corpo = e.text.trim() ? e.text : cheerio.load(e.html).text().replace(/[ \t]+/g, " ").trim();
  let url = corpo.match(URL_RE)?.[0];
  if (!url && e.html) url = cheerio.load(e.html)("a[href^=http]").first().attr("href");
  if (!url) return [];
  const link = normalizeLink(url.replace(/[.,;]+$/, ""));
  const titulo = e.subject.replace(PREFIXO, "").trim();
  return [
    {
      id: vagaId(link),
      fonte: "gmail-manual",
      titulo,
      empresa: "desconhecida",
      local: null,
      modalidade: inferModalidade(`${titulo} ${corpo}`),
      nivel: inferNivel(titulo),
      descricao: corpo,
      link,
      emailContato: extractEmail(corpo, meuEmail ? [meuEmail] : []),
      coletadaEm: new Date().toISOString(),
    },
  ];
}
