import { randomBytes } from "node:crypto";
import type { gmail_v1 } from "googleapis";
import { withRetry, type RetryOpts } from "../retry.js";

export type EmailBruto = {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: Date;
  html: string;
  text: string;
};

export type NovoRascunho = {
  para: string;
  assunto: string;
  corpo: string;
  anexo?: { nome: string; pdf: Buffer };
  threadId?: string;
  inReplyTo?: string;
};

export interface GmailClient {
  buscar(query: string): Promise<EmailBruto[]>;
  criarRascunho(r: NovoRascunho): Promise<{ draftId: string; threadId: string }>;
  rascunhoExiste(draftId: string): Promise<boolean>;
  enviarRascunho(draftId: string): Promise<void>;
  mensagensDaThread(threadId: string): Promise<{ deMim: boolean; data: Date; messageId: string }[]>;
}

type Part = gmail_v1.Schema$MessagePart;

function statusDe(e: unknown): number | undefined {
  const x = e as { status?: unknown; code?: unknown } | null;
  const v = x?.status ?? x?.code;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

async function chamar<T>(fn: () => Promise<T>, opts: RetryOpts): Promise<T> {
  return withRetry(async () => {
    try {
      return await fn();
    } catch (e) {
      const status = statusDe(e);
      if (e instanceof Error && status !== undefined && (e as { status?: unknown }).status !== status) {
        (e as { status?: number }).status = status;
      }
      throw e;
    }
  }, opts);
}

function header(p: Part | undefined, nome: string): string {
  const h = p?.headers?.find((x) => x.name?.toLowerCase() === nome.toLowerCase());
  return h?.value ?? "";
}

function decodificar(data: string | null | undefined): string {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function coletar(p: Part | undefined, acc: { html: string; text: string }): void {
  if (!p) return;
  if (p.mimeType === "text/html" && !acc.html) acc.html = decodificar(p.body?.data);
  else if (p.mimeType === "text/plain" && !acc.text) acc.text = decodificar(p.body?.data);
  for (const sub of p.parts ?? []) coletar(sub, acc);
}

function enderecoDe(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function dataDe(m: gmail_v1.Schema$Message): Date {
  if (m.internalDate) return new Date(Number(m.internalDate));
  const d = header(m.payload ?? undefined, "Date");
  return d ? new Date(d) : new Date(0);
}

function quebrar(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function assuntoMime(s: string): string {
  // Palavras codificadas (RFC 2047) com no maximo 45 bytes UTF-8 cada, sem partir caracteres.
  const palavras: string[] = [];
  let atual = "";
  for (const ch of s) {
    if (atual && Buffer.byteLength(atual + ch, "utf8") > 45) {
      palavras.push(atual);
      atual = "";
    }
    atual += ch;
  }
  palavras.push(atual);
  return palavras.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

const ENDERECO = /^[^\s<>,;:"()[\]\\]+@[^\s<>,;:"()[\]\\]+$/;

function nomeArquivoSeguro(nome: string): string {
  return nome.replace(/[\r\n]/g, "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function montarMime(r: NovoRascunho, de: string): string {
  if (!ENDERECO.test(r.para)) throw new Error("Destinatario invalido: precisa ser um unico endereco de e-mail");
  const cab = [`From: ${de}`, `To: ${r.para}`, `Subject: ${assuntoMime(r.assunto)}`, "MIME-Version: 1.0"];
  if (r.inReplyTo) cab.push(`In-Reply-To: ${r.inReplyTo}`, `References: ${r.inReplyTo}`);
  const corpo = quebrar(Buffer.from(r.corpo, "utf8").toString("base64"));
  const textoHdr = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"];
  if (!r.anexo) return [...cab, ...textoHdr, "", corpo].join("\r\n");
  const nome = nomeArquivoSeguro(r.anexo.nome);
  const b = `=_${randomBytes(12).toString("hex")}`;
  return [
    ...cab,
    `Content-Type: multipart/mixed; boundary="${b}"`,
    "",
    `--${b}`,
    ...textoHdr,
    "",
    corpo,
    `--${b}`,
    `Content-Type: application/pdf; name="${nome}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${nome}"`,
    "",
    quebrar(r.anexo.pdf.toString("base64")),
    `--${b}--`,
    "",
  ].join("\r\n");
}

export function makeGmailClient(api: gmail_v1.Gmail, meuEmail: string, opts: RetryOpts = {}): GmailClient {
  const eu = meuEmail.trim().toLowerCase();
  return {
    async buscar(query) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const res = await chamar(() => api.users.messages.list({ userId: "me", q: query, pageToken }), opts);
        for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      const out: EmailBruto[] = [];
      for (const id of ids) {
        const { data: m } = await chamar(() => api.users.messages.get({ userId: "me", id, format: "full" }), opts);
        const acc = { html: "", text: "" };
        coletar(m.payload ?? undefined, acc);
        out.push({
          id: m.id ?? id,
          threadId: m.threadId ?? "",
          from: header(m.payload ?? undefined, "From"),
          subject: header(m.payload ?? undefined, "Subject"),
          date: dataDe(m),
          html: acc.html,
          text: acc.text,
        });
      }
      return out;
    },

    async criarRascunho(r) {
      const raw = Buffer.from(montarMime(r, meuEmail), "utf8").toString("base64url");
      const message: gmail_v1.Schema$Message = { raw };
      if (r.threadId) message.threadId = r.threadId;
      const res = await chamar(() => api.users.drafts.create({ userId: "me", requestBody: { message } }), opts);
      return { draftId: res.data.id ?? "", threadId: res.data.message?.threadId ?? r.threadId ?? "" };
    },

    async rascunhoExiste(draftId) {
      try {
        await chamar(() => api.users.drafts.get({ userId: "me", id: draftId }), opts);
        return true;
      } catch (e) {
        if (statusDe(e) === 404) return false;
        throw e;
      }
    },

    async enviarRascunho(draftId) {
      // Sem retry: um 5xx apos o servidor ter enviado causaria envio duplicado.
      try {
        await api.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
      } catch (e) {
        const status = statusDe(e);
        if (e instanceof Error && status !== undefined) (e as { status?: number }).status = status;
        throw e;
      }
    },

    async mensagensDaThread(threadId) {
      const res = await chamar(() => api.users.threads.get({ userId: "me", id: threadId, format: "metadata" }), opts);
      return (res.data.messages ?? []).map((m) => ({
        deMim: enderecoDe(header(m.payload ?? undefined, "From")) === eu,
        data: dataDe(m),
        messageId: header(m.payload ?? undefined, "Message-ID"),
      }));
    },
  };
}
