export const CORTE = 60;
export const TETO_SEMANAL = 30;
export const FOLLOWUP_DIAS = 7;
export const MAX_PALAVRAS = 120;
export const TZ = "America/Belem";

export const CIDADES_OK: string[] = [
  "Belém",
  "Ananindeua",
  "Marituba",
  "Benevides",
  "Santa Bárbara do Pará",
];

export const PAISES_FORA: string[] = [
  "Portugal",
  "Estados Unidos",
  "USA",
  "Argentina",
  "México",
  "Espanha",
  "Canadá",
  "Alemanha",
  "Reino Unido",
  "UK",
  "Remote - US",
];

export const REPOS_VAGAS: string[] = [
  "frontendbr/vagas",
  "backend-br/vagas",
  "react-brasil/vagas",
];

export const MODELO_NOTA = "claude-haiku-5-5";
export const MODELO_TEXTO = "claude-sonnet-5-5";

export function envioDireto(): boolean {
  return process.env.ENVIO_DIRETO === "true";
}
