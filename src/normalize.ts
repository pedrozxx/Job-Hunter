import { createHash } from "node:crypto";
import type { Vaga } from "./types.js";

const PARAMS_IGNORADOS = new Set(["trackingid", "refid", "trk", "jobboardsource", "lipi", "ebp"]);

export function normalizeLink(url: string): string {
  const u = new URL(url.trim());
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.hash = "";
  const mantidos = [...u.searchParams.entries()]
    .filter(([k]) => {
      const chave = k.toLowerCase();
      return !chave.startsWith("utm_") && !PARAMS_IGNORADOS.has(chave);
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = "";
  for (const [k, v] of mantidos) u.searchParams.append(k, v);
  const path = u.pathname.replace(/\/+$/, "");
  const query = u.search;
  return `${u.protocol}//${u.host}${path}${query}`;
}

export function vagaId(url: string): string {
  return createHash("sha1").update(normalizeLink(url)).digest("hex");
}

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function inferNivel(texto: string): Vaga["nivel"] {
  const t = semAcento(texto);
  if (/\b(estagi\w*|intern(ship)?|trainee)\b/.test(t)) return "estagio";
  if (/\b(junior|jr)\b/.test(t)) return "junior";
  if (/\b(pleno|mid-level)\b/.test(t)) return "pleno";
  if (/\b(senior|sr)\b/.test(t)) return "senior";
  return "desconhecido";
}

export function inferModalidade(texto: string): Vaga["modalidade"] {
  const t = semAcento(texto);
  if (/\bhibrid\w*|\bhybrid\b/.test(t)) return "hibrido";
  if (/\b(remot\w*|home\s*office|work from home|anywhere)\b/.test(t)) return "remoto";
  if (/\b(presencial\w*|on-?site)\b/.test(t)) return "presencial";
  return "desconhecido";
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;

function ignorarEmail(email: string): boolean {
  const [local = "", dominio = ""] = email.toLowerCase().split("@");
  if (dominio === "github.com" || dominio.endsWith(".github.com")) return true;
  return local.startsWith("noreply") || local.startsWith("no-reply");
}

export function extractEmail(texto: string): string | null {
  const limpo = texto
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  for (const m of limpo.matchAll(EMAIL_RE)) {
    const email = m[0].replace(/[.]+$/, "");
    if (!ignorarEmail(email)) return email;
  }
  return null;
}
