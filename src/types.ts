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

export type Decisao = "aprovar" | "descartar" | "";

export type StatusFila = "novo" | "semana cheia" | "aguardando semana" | "escrever manualmente" | "processada";

export type FilaRow = Vaga & Partial<Pontuacao> & { mensagem: string; decisao: Decisao; status: StatusFila };

export type StatusCand =
  | "rascunho criado"
  | "aplicar manualmente"
  | "enviada"
  | "respondeu"
  | "entrevista"
  | "recusada"
  | "sem resposta";

export type CandidaturaRow = {
  id: string;
  data: string;
  empresa: string;
  titulo: string;
  // "" means an unrecognized hand-edited value in the sheet
  canal: "email" | "formulario" | "";
  status: StatusCand | "";
  idRascunho: string;
  idThread: string;
  followupEm: string;
  idRascunhoFollowup: string;
};

export type LogRow = {
  data: string;
  job: "collect" | "send";
  fonte: string;
  coletadas: number;
  passaramFiltro: number;
  acimaCorte: number;
  erro: string;
};
