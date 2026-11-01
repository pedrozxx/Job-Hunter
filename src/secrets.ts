import { readFileSync } from "node:fs";

export type Perfil = { markdown: string; termosExclusao: string[] };

const EXEMPLOS = new URL("../examples/", import.meta.url);

function usaExemplos(): boolean {
  return process.env.NODE_ENV === "test" || process.argv.includes("--dry-run");
}

function carregar(
  env: NodeJS.ProcessEnv,
  variavel: string,
  arquivoExemplo: string,
): string {
  const valor = env[variavel];
  if (valor) return Buffer.from(valor, "base64").toString("utf8");
  if (usaExemplos()) return readFileSync(new URL(arquivoExemplo, EXEMPLOS), "utf8");
  throw new Error(`Variável ${variavel} ausente (base64 esperado)`);
}

export function carregarPerfil(env: NodeJS.ProcessEnv = process.env): Perfil {
  const markdown = carregar(env, "PERFIL_MD", "perfil.example.md");
  const linha = markdown.match(/^\s*exclusao:\s*(.+)$/im);
  const termosExclusao = linha
    ? linha[1].split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  return { markdown, termosExclusao };
}

export function carregarCurriculo(env: NodeJS.ProcessEnv = process.env): string {
  return carregar(env, "CURRICULO_TXT", "curriculo.example.txt");
}
