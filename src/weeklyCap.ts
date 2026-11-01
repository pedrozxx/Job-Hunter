import { formatInTimeZone } from "date-fns-tz";
import { TETO_SEMANAL, TZ } from "./config.js";
import type { CandidaturaRow } from "./types.js";

/** Segunda-feira da semana de `d` em America/Belem, no formato yyyy-MM-dd. */
export function semanaDe(d: Date): string {
  const dia = formatInTimeZone(d, TZ, "yyyy-MM-dd");
  const isoDow = Number(formatInTimeZone(d, TZ, "i")); // 1 = segunda ... 7 = domingo
  const [a, m, dd] = dia.split("-").map(Number);
  const segunda = new Date(Date.UTC(a, m - 1, dd - (isoDow - 1)));
  return segunda.toISOString().slice(0, 10);
}

export function vagasRestantesNaSemana(cands: CandidaturaRow[], agora: Date): number {
  const semana = semanaDe(agora);
  let usadas = 0;
  for (const c of cands) {
    const t = new Date(c.data);
    if (Number.isNaN(t.getTime())) continue;
    if (semanaDe(t) === semana) usadas++;
  }
  return Math.max(0, TETO_SEMANAL - usadas);
}
