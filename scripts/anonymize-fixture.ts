// Uso: ANON_NOMES="nome|sobrenome" ANON_EMAIL=voce@gmail.com tsx scripts/anonymize-fixture.ts <entrada.html> <saida.html>
// Troca dados pessoais por ficticios, zera valores de parametros de rastreio e
// remove ruido (estilos, imagens, comentarios) para o fixture ficar pequeno.
import { readFileSync, writeFileSync } from "node:fs";

export function anonimizar(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<img\b[^>]*>/gi, "");
  s = s.replace(/\sstyle="[^"]*"/gi, "");
  s = s.replace(/\s(?:class|width|height|valign|align|border|cellspacing|cellpadding|role|dir|target)="[^"]*"/gi, "");
  // pessoal: padroes do dono vem do ambiente, nada pessoal fica no repositorio
  const nomes = process.env.ANON_NOMES; // regex, ex.: "fulano|sobrenome"
  if (nomes) s = s.replace(new RegExp(nomes, "gi"), "Maria Exemplo");
  const email = process.env.ANON_EMAIL; // endereco exato
  if (email) s = s.split(email).join("maria@example.com");
  s = s.replace(/(?:\+55\s*)?\(\d{2}\)\s*9?\d{4}-?\d{4}|\b\d{2}\s9?\d{4}-\d{4}\b/g, "(11) 90000-0000");
  // rastreio: mantem as chaves, zera os valores dentro de href
  s = s.replace(/href="([^"]*)"/gi, (_m, url: string) => {
    const [base = "", q] = url.split("?");
    if (q === undefined) return `href="${base}"`;
    const params = q
      .split(/&amp;|&/)
      .filter(Boolean)
      .map((p) => `${p.split("=")[0]}=X`)
      .join("&amp;");
    return `href="${base}?${params}"`;
  });
  // tokens longos soltos
  s = s.replace(/[A-Za-z0-9_%+=\/-]{40,}/g, "X");
  return s.replace(/\s+/g, " ").trim();
}

if (process.argv[1]?.endsWith("anonymize-fixture.ts")) {
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) {
    console.error("Uso: tsx scripts/anonymize-fixture.ts <entrada.html> <saida.html>");
    process.exit(1);
  }
  writeFileSync(saida, anonimizar(readFileSync(entrada, "utf8")) + "\n");
}
