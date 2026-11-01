// Uso: tsx --env-file=.env scripts/probe-sources.ts
// Roda Gmail e GitHub dos ultimos 14 dias e imprime contagens (cole o resultado no PR).
import { makeGoogleClients } from "../src/clients/google.js";
import { makeGmailClient } from "../src/clients/gmail.js";
import { fetchGmailVagas } from "../src/sources/gmail/index.js";
import { fetchGithubVagas } from "../src/sources/githubRepos.js";
import type { Vaga } from "../src/types.js";

function contar(vagas: Vaga[], chave: (v: Vaga) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of vagas) out[chave(v)] = (out[chave(v)] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  const meuEmail = process.env.MEU_EMAIL;
  if (!meuEmail) throw new Error("Variavel de ambiente ausente: MEU_EMAIL");
  const desde = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const { gmail } = makeGoogleClients();
  const cliente = makeGmailClient(gmail, meuEmail);
  const erros: string[] = [];
  const onErro = (fonte: string, e: unknown) => erros.push(`${fonte}: ${e instanceof Error ? e.message : String(e)}`);

  const [doGmail, doGithub] = await Promise.all([fetchGmailVagas(cliente, desde, onErro), fetchGithubVagas(desde, fetch, onErro)]);
  const todas = [...doGmail, ...doGithub];
  console.log(`Desde ${desde.toISOString()}`);
  console.log("Por fonte:", contar(todas, (v) => v.fonte));
  console.log("Por nivel:", contar(todas, (v) => v.nivel));
  console.log("Por modalidade:", contar(todas, (v) => v.modalidade));
  console.log(`Total: ${todas.length}; erros: ${erros.length}`);
  for (const e of erros) console.log(`  - ${e}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
