import { CIDADES_OK, REPOS_VAGAS } from "../config.js";
import { inferModalidade, inferNivel, extractEmail, normalizeLink, vagaId } from "../normalize.js";
import { withRetry } from "../retry.js";
import type { Vaga } from "../types.js";

type Issue = {
  title?: string;
  html_url?: string;
  body?: string | null;
  labels?: Array<string | { name?: string }>;
  created_at?: string;
  pull_request?: unknown;
};

const CIDADES = [
  ...CIDADES_OK,
  "São Paulo",
  "Rio de Janeiro",
  "Belo Horizonte",
  "Curitiba",
  "Porto Alegre",
  "Recife",
  "Fortaleza",
  "Salvador",
  "Brasília",
  "Florianópolis",
  "Campinas",
];

function norm(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function nomesLabels(issue: Issue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean);
}

function nivelPorLabels(labels: string[]): Vaga["nivel"] {
  for (const l of labels) {
    const n = inferNivel(l);
    if (n !== "desconhecido") return n;
  }
  return "desconhecido";
}

function modalidadePorLabels(labels: string[]): Vaga["modalidade"] {
  for (const l of labels) {
    const m = inferModalidade(l);
    if (m !== "desconhecido") return m;
  }
  return "desconhecido";
}

function localDe(labels: string[], titulo: string): string | null {
  const alvos = [...labels.map(norm), norm(titulo)];
  for (const cidade of CIDADES) {
    const c = norm(cidade);
    if (alvos.some((a, i) => (i < labels.length ? a === c : a.includes(c)))) return cidade;
  }
  return null;
}

function empresaDe(titulo: string): string {
  const m = titulo.trim().match(/^\[([^\]]+)\]/);
  return m?.[1]?.trim() || "desconhecida";
}

function issueParaVaga(issue: Issue, coletadaEm: string): Vaga {
  const titulo = (issue.title ?? "").trim();
  const corpo = issue.body ?? "";
  const labels = nomesLabels(issue);
  const link = normalizeLink(issue.html_url ?? "");
  const modalidade = modalidadePorLabels(labels);
  const nivel = nivelPorLabels(labels);
  return {
    id: vagaId(link),
    fonte: "github-repo",
    titulo,
    empresa: empresaDe(titulo),
    local: localDe(labels, titulo),
    modalidade: modalidade !== "desconhecido" ? modalidade : inferModalidade(`${titulo}\n${corpo}`),
    nivel: nivel !== "desconhecido" ? nivel : inferNivel(`${titulo}\n${corpo}`),
    descricao: corpo,
    link,
    emailContato: extractEmail(corpo),
    coletadaEm,
  };
}

async function buscarRepo(repo: string, desde: Date, fetchFn: typeof fetch): Promise<Issue[]> {
  const url = `https://api.github.com/repos/${repo}/issues?state=open&since=${encodeURIComponent(desde.toISOString())}&per_page=100`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "job-hunter",
  };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return withRetry(async () => {
    const res = await fetchFn(url, { headers });
    if (!res.ok) throw Object.assign(new Error(`GitHub ${repo}: HTTP ${res.status}`), { status: res.status });
    return (await res.json()) as Issue[];
  });
}

export async function fetchGithubVagas(
  desde: Date,
  fetchFn: typeof fetch = fetch,
  onErro?: (fonte: string, e: unknown) => void,
): Promise<Vaga[]> {
  const coletadaEm = new Date().toISOString();
  const vagas: Vaga[] = [];
  for (const repo of REPOS_VAGAS) {
    let issues: Issue[];
    try {
      issues = await buscarRepo(repo, desde, fetchFn);
    } catch (e) {
      onErro?.(repo, e);
      continue;
    }
    for (const issue of issues) {
      if (issue.pull_request) continue;
      try {
        vagas.push(issueParaVaga(issue, coletadaEm));
      } catch (e) {
        onErro?.(repo, e);
      }
    }
  }
  return vagas;
}
