import type { GmailClient, EmailBruto } from "../../clients/gmail.js";
import type { Vaga } from "../../types.js";
import { parseLinkedinAlert } from "./linkedin.js";
import { parseVagaManual } from "./freeText.js";

// Alertas da Gupy: pendentes de um fixture real (a caixa so tem e-mails de candidatura, nao de alerta).
const REMETENTES_LINKEDIN = ["jobalerts-noreply@linkedin.com", "jobs-noreply@linkedin.com"];

function endereco(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m?.[1] ?? from).trim().toLowerCase();
}

function rotear(e: EmailBruto, onErro?: (fonte: string, err: unknown) => void): Vaga[] {
  if (REMETENTES_LINKEDIN.includes(endereco(e.from))) return parseLinkedinAlert(e, onErro);
  if (/^\s*\[vaga\]/i.test(e.subject)) return parseVagaManual(e);
  return [];
}

export async function fetchGmailVagas(
  gmail: GmailClient,
  desde: Date,
  onErro?: (fonte: string, err: unknown) => void,
): Promise<Vaga[]> {
  const epoch = Math.floor(desde.getTime() / 1000);
  const emails = await gmail.buscar(
    `after:${epoch} (from:jobalerts-noreply@linkedin.com OR from:jobs-noreply@linkedin.com OR subject:"[vaga]")`,
  );
  const vagas: Vaga[] = [];
  for (const e of emails) {
    try {
      vagas.push(...rotear(e, onErro));
    } catch (err) {
      onErro?.(`gmail:${e.id}`, err);
    }
  }
  return vagas;
}
