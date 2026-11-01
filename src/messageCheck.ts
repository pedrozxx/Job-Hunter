import { readFileSync } from "node:fs";
import { MAX_PALAVRAS } from "./config.js";

const ARQUIVO = new URL("../templates/proibidas.txt", import.meta.url);

export function contarPalavras(texto: string): number {
  const t = texto.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

export function carregarProibidas(): string[] {
  return readFileSync(ARQUIVO, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
}

export function checkMessage(
  msg: string,
  proibidas: string[],
): { ok: true } | { ok: false; motivo: string } {
  const palavras = contarPalavras(msg);
  if (palavras > MAX_PALAVRAS) {
    return { ok: false, motivo: `mensagem com ${palavras} palavras (máximo ${MAX_PALAVRAS})` };
  }
  const minuscula = msg.toLowerCase();
  for (const p of proibidas) {
    if (p !== "" && minuscula.includes(p.toLowerCase())) {
      return { ok: false, motivo: `contém expressão proibida: ${JSON.stringify(p)}` };
    }
  }
  return { ok: true };
}
