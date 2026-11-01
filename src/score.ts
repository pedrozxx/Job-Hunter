import { z } from "zod";
import type { LlmClient } from "./clients/llm.js";
import { MODELO_NOTA } from "./config.js";
import type { Perfil } from "./secrets.js";
import type { Pontuacao, Vaga } from "./types.js";

export class ErroPontuacao extends Error {
  constructor(
    message: string,
    readonly resposta: string,
  ) {
    super(message);
    this.name = "ErroPontuacao";
  }
}

const SISTEMA = `Você avalia o quanto uma vaga de emprego combina com o candidato descrito no perfil e no currículo.

Responda SOMENTE com um objeto JSON, sem texto antes ou depois, neste formato:
{"nota": <inteiro de 0 a 100>, "motivo": "<uma frase>", "atende": ["<requisito que o candidato atende>"], "falta": ["<requisito que falta>"]}

Regras:
- Se a descrição da vaga for curta (apenas título e local), pontue pelo título e pelo nível e escreva no campo "motivo" a expressão "descrição curta".
- Penalize estágio cuja duração prevista ultrapasse a data de formatura informada no perfil.
- Penalize vagas que exigem requisitos de pleno ou sênior (anos de experiência, liderança técnica, etc.).
- Use apenas informações do perfil e do currículo; não invente experiências.`;

const Schema = z.object({
  nota: z.number().int().min(0).max(100),
  motivo: z.string(),
  atende: z.array(z.string()),
  falta: z.array(z.string()),
});

function candidatos(texto: string): string[] {
  const out: string[] = [texto.trim()];
  const cerca = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) out.push(cerca[1].trim());
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (ini !== -1 && fim > ini) out.push(texto.slice(ini, fim + 1));
  return out;
}

function interpretar(texto: string): Pontuacao | null {
  for (const c of candidatos(texto)) {
    try {
      const r = Schema.safeParse(JSON.parse(c));
      if (r.success) return r.data;
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}

function montarUsuario(v: Vaga, perfil: Perfil, curriculo: string): string {
  return `## Perfil do candidato
${perfil.markdown}

## Currículo
${curriculo}

## Vaga
Título: ${v.titulo}
Empresa: ${v.empresa}
Local: ${v.local ?? "não informado"}
Modalidade: ${v.modalidade}
Nível: ${v.nivel}
Descrição:
${v.descricao}`;
}

export async function pontuar(
  llm: LlmClient,
  v: Vaga,
  perfil: Perfil,
  curriculo: string,
): Promise<Pontuacao> {
  const usuario = montarUsuario(v, perfil, curriculo);
  let ultima = "";
  for (let i = 0; i < 2; i++) {
    ultima = await llm.gerar({
      modelo: MODELO_NOTA,
      sistema: SISTEMA,
      usuario,
      maxTokens: 600,
    });
    const p = interpretar(ultima);
    if (p) return p;
  }
  throw new ErroPontuacao("Resposta de pontuação inválida após 2 tentativas", ultima);
}
