import * as cheerio from "cheerio";
import type { EmailBruto } from "../../clients/gmail.js";
import { inferModalidade, inferNivel, vagaId } from "../../normalize.js";
import type { Vaga } from "../../types.js";

const VIEW = /\/jobs\/view\/([^/?#]*)/;

function limpar(t: string): string {
  return t.replace(/\s+/g, " ").trim();
}

export function parseLinkedinAlert(e: EmailBruto, onErro?: (fonte: string, err: unknown) => void): Vaga[] {
  const $ = cheerio.load(e.html);
  const coletadaEm = new Date().toISOString();
  const vistos = new Set<string>();
  const vagas: Vaga[] = [];
  $('a[href*="/jobs/view/"]').each((_, el) => {
    const titulo = limpar($(el).text());
    if (!titulo) return; // ancora do logo ou do cartao inteiro
    try {
      const id = $(el).attr("href")?.match(VIEW)?.[1] ?? "";
      if (!/^\d+$/.test(id)) throw new Error(`Link de vaga sem id numerico: ${$(el).attr("href")}`);
      if (vistos.has(id)) return;
      const linha = limpar($(el).closest("tr").next("tr").find("p").first().text());
      const [empresa = "", ...resto] = linha.split(" · ");
      if (!empresa) throw new Error(`Vaga sem empresa: ${titulo}`);
      const local = resto.join(" · ") || null;
      const link = `https://linkedin.com/jobs/view/${id}`;
      vistos.add(id);
      vagas.push({
        id: vagaId(link),
        fonte: "gmail-linkedin",
        titulo,
        empresa,
        local,
        modalidade: inferModalidade(`${titulo} ${local ?? ""}`),
        nivel: inferNivel(titulo),
        descricao: local ?? "",
        link,
        emailContato: null,
        coletadaEm,
      });
    } catch (err) {
      onErro?.("gmail-linkedin", err);
    }
  });
  return vagas;
}
