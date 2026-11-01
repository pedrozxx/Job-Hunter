import type { Vaga } from "./types.js";
import { CIDADES_OK, PAISES_FORA } from "./config.js";
import { semAcento } from "./normalize.js";
import type { Perfil } from "./secrets.js";

function contemTermo(texto: string, termo: string): boolean {
  const t = semAcento(termo).trim();
  if (!t) return false;
  const escapado = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escapado}(?![a-z0-9])`).test(semAcento(texto));
}

function contemAlgum(texto: string, termos: string[]): boolean {
  return termos.some((t) => contemTermo(texto, t));
}

export function passaFiltro(
  v: Vaga,
  perfil: Perfil,
): { ok: true } | { ok: false; motivo: string } {
  if (v.local && contemAlgum(v.local, PAISES_FORA)) {
    return { ok: false, motivo: "fora do Brasil" };
  }
  if (v.nivel === "pleno" || v.nivel === "senior") {
    return { ok: false, motivo: `nível ${v.nivel}` };
  }
  if (contemAlgum(v.titulo, perfil.termosExclusao)) {
    return { ok: false, motivo: "termo de exclusão no título" };
  }
  if (v.modalidade === "presencial" || v.modalidade === "hibrido") {
    if (v.local && !contemAlgum(v.local, CIDADES_OK)) {
      return { ok: false, motivo: `${v.modalidade} fora da região de Belém` };
    }
  }
  return { ok: true };
}

export function filtrar(
  vagas: Vaga[],
  idsVistos: Set<string>,
  perfil: Perfil,
): { aprovadas: Vaga[]; descartadas: number } {
  const vistos = new Set(idsVistos);
  const aprovadas: Vaga[] = [];
  let descartadas = 0;
  for (const v of vagas) {
    if (vistos.has(v.id) || !passaFiltro(v, perfil).ok) {
      descartadas++;
      continue;
    }
    vistos.add(v.id);
    aprovadas.push(v);
  }
  return { aprovadas, descartadas };
}
