import { pathToFileURL } from "node:url";
import type { GmailClient } from "../clients/gmail.js";
import { makeGmailClient } from "../clients/gmail.js";
import { makeGoogleClients } from "../clients/google.js";
import { makeAnthropicClient, type LlmClient } from "../clients/llm.js";
import { makeSheetsRepo, type SheetsRepo } from "../clients/sheets.js";
import { comporMensagem } from "../compose.js";
import { CORTE } from "../config.js";
import { filtrar } from "../filter.js";
import { pontuar } from "../score.js";
import { carregarCurriculo, carregarPerfil, type Perfil } from "../secrets.js";
import { fetchGithubVagas } from "../sources/githubRepos.js";
import { fetchGmailVagas } from "../sources/gmail/index.js";
import type { FilaRow, LogRow, Vaga } from "../types.js";
import { vagasRestantesNaSemana } from "../weeklyCap.js";

export type CollectDeps = {
  gmail: GmailClient;
  repo: SheetsRepo;
  llm: LlmClient;
  fetchFn: typeof fetch;
  perfil: Perfil;
  curriculo: string;
  agora: Date;
  desde: Date;
};

const HORAS_SOBREPOSICAO = 26;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Contagem = { coletadas: number; passaramFiltro: number; acimaCorte: number; erros: string[] };

export async function runCollect(
  deps: CollectDeps,
): Promise<{ coletadas: number; filaNova: number; falhaSistemica: boolean }> {
  const { gmail, repo, llm, fetchFn, perfil, curriculo, agora, desde } = deps;
  const data = agora.toISOString();
  const contagem: Record<"github-repo" | "gmail", Contagem> = {
    "github-repo": { coletadas: 0, passaramFiltro: 0, acimaCorte: 0, erros: [] },
    gmail: { coletadas: 0, passaramFiltro: 0, acimaCorte: 0, erros: [] },
  };
  const errosScore: string[] = [];
  // Falha sistêmica: uma fonte inteira fora do ar, ou todas as vagas falhando no Claude.
  let fonteFora = false;
  let tentativasLlm = 0;

  const [fila, cands, idsVistos] = await Promise.all([repo.lerFila(), repo.lerCandidaturas(), repo.idsVistos()]);

  // Semana cheia is computed once, here, at the start of the run: weekly cap minus approvals still
  // pending in the Fila. It is not decremented as "novo" rows are added during this run.
  const pendentes = fila.filter((r) => r.decisao === "aprovar" && r.status !== "processada").length;
  const semanaCheia = vagasRestantesNaSemana(cands, agora) - pendentes <= 0;

  const porFonte: Record<"github-repo" | "gmail", Vaga[]> = { "github-repo": [], gmail: [] };
  try {
    porFonte["github-repo"] = await fetchGithubVagas(desde, fetchFn, (f, e) =>
      contagem["github-repo"].erros.push(`${f}: ${msg(e)}`),
    );
  } catch (e) {
    contagem["github-repo"].erros.push(msg(e));
    fonteFora = true;
  }
  try {
    porFonte.gmail = await fetchGmailVagas(gmail, desde, (f, e) => contagem.gmail.erros.push(`${f}: ${msg(e)}`));
  } catch (e) {
    contagem.gmail.erros.push(msg(e));
    fonteFora = true;
  }

  const novas: FilaRow[] = [];
  const vistos = new Set(idsVistos);
  for (const fonte of ["github-repo", "gmail"] as const) {
    const c = contagem[fonte];
    c.coletadas = porFonte[fonte].length;
    const { aprovadas } = filtrar(porFonte[fonte], vistos, perfil);
    c.passaramFiltro = aprovadas.length;
    for (const v of aprovadas) vistos.add(v.id);

    for (const v of aprovadas) {
      tentativasLlm++;
      try {
        const p = await pontuar(llm, v, perfil, curriculo);
        if (p.nota < CORTE) continue;
        c.acimaCorte++;
        if (semanaCheia) {
          novas.push({ ...v, ...p, mensagem: "", decisao: "", status: "semana cheia" });
          continue;
        }
        const comp = await comporMensagem(llm, v, p, perfil, curriculo);
        novas.push({
          ...v,
          ...p,
          mensagem: comp.mensagem,
          decisao: "",
          status: "status" in comp ? comp.status : "novo",
        });
      } catch (e) {
        errosScore.push(`${v.id}: ${msg(e)}`);
      }
    }
  }

  const linhas: LogRow[] = [
    ...(["github-repo", "gmail"] as const).map((fonte) => ({
      data,
      job: "collect" as const,
      fonte,
      coletadas: contagem[fonte].coletadas,
      passaramFiltro: contagem[fonte].passaramFiltro,
      acimaCorte: contagem[fonte].acimaCorte,
      erro: contagem[fonte].erros.join(" | "),
    })),
    ...errosScore.map((erro) => ({
      data, job: "collect" as const, fonte: "score", coletadas: 0, passaramFiltro: 0, acimaCorte: 0, erro,
    })),
  ];

  let falhaAoGravar: unknown;
  try {
    await repo.adicionarFila(novas);
  } catch (e) {
    falhaAoGravar = e;
    linhas.push({
      data, job: "collect", fonte: "fila", coletadas: 0, passaramFiltro: 0, acimaCorte: 0,
      erro: `falha ao gravar a Fila: ${msg(e)}`,
    });
  }
  for (const l of linhas) {
    try {
      await repo.log(l);
    } catch (e) {
      console.error(`falha ao gravar o Log (${l.fonte}): ${msg(e)}`);
    }
  }
  if (falhaAoGravar) throw falhaAoGravar;

  return {
    coletadas: contagem["github-repo"].coletadas + contagem.gmail.coletadas,
    filaNova: novas.length,
    falhaSistemica: fonteFora || (tentativasLlm > 0 && errosScore.length === tentativasLlm),
  };
}

function env(nome: string): string {
  const v = process.env[nome]?.trim();
  if (!v) throw new Error(`Variável ${nome} ausente`);
  return v;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const google = makeGoogleClients();
  const agora = new Date();
  const resultado = await runCollect({
    gmail: makeGmailClient(google.gmail, env("MEU_EMAIL")),
    repo: makeSheetsRepo(google.sheets, env(dryRun ? "SHEET_ID_TEST" : "SHEET_ID")),
    llm: makeAnthropicClient(),
    fetchFn: fetch,
    perfil: carregarPerfil(),
    curriculo: carregarCurriculo(),
    agora,
    desde: new Date(agora.getTime() - HORAS_SOBREPOSICAO * 3600 * 1000),
  });
  console.log(`collect: ${resultado.coletadas} coletadas, ${resultado.filaNova} novas na Fila${dryRun ? " (dry-run)" : ""}`);
  if (resultado.falhaSistemica) {
    console.error("collect: falha sistemica (fonte inteira fora do ar ou todas as vagas falharam no Claude), veja a aba Log");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
