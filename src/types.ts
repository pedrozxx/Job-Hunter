export type Vaga = {
  id: string; // sha1 do link normalizado
  fonte: "gmail-linkedin" | "gmail-gupy" | "gmail-manual" | "github-repo";
  titulo: string;
  empresa: string;
  local: string | null;
  modalidade: "remoto" | "hibrido" | "presencial" | "desconhecido";
  nivel: "estagio" | "junior" | "pleno" | "senior" | "desconhecido";
  descricao: string;
  link: string;
  emailContato: string | null;
  coletadaEm: string; // ISO
};

export type Fonte = Vaga["fonte"];

export type Pontuacao = {
  nota: number; // 0 a 100
  motivo: string; // uma frase
  atende: string[];
  falta: string[];
};
