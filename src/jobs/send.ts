import { pathToFileURL } from "node:url";
import { downloadPdf } from "../clients/drive.js";
import type { GmailClient } from "../clients/gmail.js";
import { makeGmailClient } from "../clients/gmail.js";
import { makeGoogleClients } from "../clients/google.js";
import { makeSheetsRepo, type SheetsRepo } from "../clients/sheets.js";
import { envioDireto, FOLLOWUP_DIAS } from "../config.js";
import { criarRascunhoCandidatura, criarRascunhoFollowup } from "../mailer.js";
import type { CandidaturaRow, FilaRow } from "../types.js";
import { vagasRestantesNaSemana } from "../weeklyCap.js";

export type SendDeps = {
  gmail: GmailClient;
  repo: SheetsRepo;
  pdf: () => Promise<Buffer>;
  agora: Date;
};

type Mensagem = { deMim: boolean; data: Date; messageId: string };

const DIA_MS = 24 * 3600 * 1000;

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function maisDias(d: Date, dias: number): string {
  return new Date(d.getTime() + dias * DIA_MS).toISOString();
}

/** Gmail wrapper for --dry-run: reads go through, writes are recorded and never reach Gmail. */
export function gmailDryRun(real: GmailClient): GmailClient & { simulados: string[] } {
  const simulados: string[] = [];
  return {
    simulados,
    buscar: (q) => real.buscar(q),
    rascunhoExiste: (id) => real.rascunhoExiste(id),
    mensagensDaThread: (t) => real.mensagensDaThread(t),
    async criarRascunho(r) {
      simulados.push(`criarRascunho:${r.para}`);
      return { draftId: `dry-draft-${simulados.length}`, threadId: r.threadId ?? `dry-thread-${simulados.length}` };
    },
    async enviarRascunho(id) {
      simulados.push(`enviarRascunho:${id}`);
    },
  };
}

export async function runSend(deps: SendDeps): Promise<{ rascunhos: number; manuais: number; followups: number }> {
  const { gmail, repo, agora } = deps;
  const data = agora.toISOString();
  const contagem = { rascunhos: 0, manuais: 0, followups: 0 };

  async function registrarErro(erro: string): Promise<void> {
    try {
      await repo.log({ data, job: "send", fonte: "send", coletadas: 0, passaramFiltro: 0, acimaCorte: 0, erro });
    } catch (e) {
      console.error(`falha ao gravar o Log: ${msg(e)}`);
    }
  }

  // PDF is downloaded lazily, at most once per run.
  let pdfPromise: Promise<Buffer> | undefined;
  const pdf = () => (pdfPromise ??= deps.pdf());

  const threads = new Map<string, Mensagem[]>();
  async function thread(id: string): Promise<Mensagem[]> {
    let m = threads.get(id);
    if (!m) {
      m = await gmail.mensagensDaThread(id);
      threads.set(id, m);
    }
    return m;
  }
  const ultimaDeMim = (ms: Mensagem[]) =>
    ms.filter((m) => m.deMim).sort((a, b) => a.data.getTime() - b.data.getTime()).at(-1);

  const [fila, cands] = await Promise.all([repo.lerFila(), repo.lerCandidaturas()]);

  // (1) Status updates. Only rows in "rascunho criado" or "enviada" are touched; statuses the owner
  // set by hand (respondeu/entrevista/recusada/"") are never changed.
  for (const c of cands) {
    try {
      if (c.status === "rascunho criado") {
        if (!c.idRascunho || !c.idThread) continue;
        if (await gmail.rascunhoExiste(c.idRascunho)) continue;
        const enviada = ultimaDeMim(await thread(c.idThread));
        // Draft gone and no message from me in the thread: the owner deleted the draft. Leave as is.
        if (!enviada) continue;
        const p = { status: "enviada" as const, followupEm: maisDias(enviada.data, FOLLOWUP_DIAS) };
        await repo.atualizarCandidatura(c.id, p);
        Object.assign(c, p);
      } else if (c.status === "enviada") {
        if (!c.idThread) continue;
        const ms = await thread(c.idThread);
        const minha = ultimaDeMim(ms);
        if (minha && ms.some((m) => !m.deMim && m.data.getTime() > minha.data.getTime())) {
          await repo.atualizarCandidatura(c.id, { status: "respondeu" });
          c.status = "respondeu";
        }
      }
    } catch (e) {
      await registrarErro(`status ${c.id}: ${msg(e)}`);
    }
  }

  // (2) Follow-ups: "enviada", due, no follow-up draft yet, no reply (step 1 already flipped replies).
  const filaPorId = new Map(fila.map((r) => [r.id, r]));
  for (const c of cands) {
    try {
      if (c.status !== "enviada" || c.idRascunhoFollowup || !c.idThread) continue;
      const devido = new Date(c.followupEm);
      if (!c.followupEm || Number.isNaN(devido.getTime()) || devido.getTime() > agora.getTime()) continue;
      const ms = await thread(c.idThread);
      const minha = ultimaDeMim(ms);
      if (!minha) continue;
      if (ms.some((m) => !m.deMim && m.data.getTime() > minha.data.getTime())) continue;
      const para = filaPorId.get(c.id)?.emailContato?.trim();
      if (!para) {
        await registrarErro(`followup ${c.id}: linha da Fila ou e-mail de contato nao encontrado, follow-up ignorado`);
        continue;
      }
      const { draftId } = await criarRascunhoFollowup(gmail, c, minha.messageId, para);
      await repo.atualizarCandidatura(c.id, { idRascunhoFollowup: draftId });
      c.idRascunhoFollowup = draftId;
      contagem.followups++;
    } catch (e) {
      await registrarErro(`followup ${c.id}: ${msg(e)}`);
    }
  }

  // (3) New approvals, best score first, up to the weekly cap.
  const jaCandidatadas = new Set(cands.map((c) => c.id));
  const aprovadas = fila
    .filter((r) => r.decisao === "aprovar" && r.status !== "processada")
    .sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1));
  let restantes = vagasRestantesNaSemana(cands, agora);

  for (const row of aprovadas) {
    try {
      // A crash between adicionarCandidatura and atualizarFila leaves the id in Candidaturas: just close the Fila row.
      if (jaCandidatadas.has(row.id)) {
        await repo.atualizarFila(row.id, { status: "processada" });
        continue;
      }
      const comEmail = Boolean(row.emailContato?.trim());
      if (comEmail && !row.mensagem.trim()) {
        await registrarErro(`${row.id}: aprovada com e-mail mas mensagem vazia, ignorada`);
        continue;
      }
      if (restantes <= 0) {
        if (row.status !== "aguardando semana") await repo.atualizarFila(row.id, { status: "aguardando semana" });
        continue;
      }

      let cand: CandidaturaRow;
      if (comEmail) {
        const r = await criarRascunhoCandidatura(gmail, row, await pdf());
        const enviada = envioDireto();
        cand = {
          id: row.id, data, empresa: row.empresa, titulo: row.titulo, canal: "email",
          status: enviada ? "enviada" : "rascunho criado",
          idRascunho: r.draftId, idThread: r.threadId,
          followupEm: enviada ? maisDias(agora, FOLLOWUP_DIAS) : "",
          idRascunhoFollowup: "",
        };
      } else {
        cand = {
          id: row.id, data, empresa: row.empresa, titulo: row.titulo, canal: "formulario",
          status: "aplicar manualmente", idRascunho: "", idThread: "", followupEm: "", idRascunhoFollowup: "",
        };
      }
      await repo.adicionarCandidatura(cand);
      jaCandidatadas.add(row.id);
      restantes--;
      if (comEmail) contagem.rascunhos++;
      else contagem.manuais++;
      await repo.atualizarFila(row.id, { status: "processada" });
    } catch (e) {
      await registrarErro(`${row.id}: ${msg(e)}`);
    }
  }

  return contagem;
}

function env(nome: string): string {
  const v = process.env[nome]?.trim();
  if (!v) throw new Error(`Variável ${nome} ausente`);
  return v;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const google = makeGoogleClients();
  const real = makeGmailClient(google.gmail, env("MEU_EMAIL"));
  const gmail = dryRun ? gmailDryRun(real) : real;
  const resultado = await runSend({
    gmail,
    repo: makeSheetsRepo(google.sheets, env(dryRun ? "SHEET_ID_TEST" : "SHEET_ID")),
    pdf: () => downloadPdf(google.drive, env("CURRICULO_PDF_DRIVE_ID")),
    agora: new Date(),
  });
  console.log(
    `send: ${resultado.rascunhos} rascunhos, ${resultado.manuais} manuais, ${resultado.followups} follow-ups${dryRun ? " (dry-run)" : ""}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
