import { describe, it, expect, vi } from "vitest";
import type { gmail_v1 } from "googleapis";
import { makeGmailClient } from "../../src/clients/gmail.js";

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const decodeRaw = (raw: string) => Buffer.from(raw, "base64url").toString("utf8");

function fakeApi(over: Record<string, unknown> = {}) {
  const api = {
    users: {
      messages: { list: vi.fn(), get: vi.fn() },
      drafts: { create: vi.fn(), get: vi.fn(), send: vi.fn() },
      threads: { get: vi.fn() },
    },
  };
  Object.assign(api.users, over);
  return api;
}
const asGmail = (a: unknown) => a as gmail_v1.Gmail;

describe("GmailClient", () => {
  it("buscar decodifica base64url e separa html/text de multipart", async () => {
    const api = fakeApi();
    api.users.messages.list
      .mockResolvedValueOnce({ data: { messages: [{ id: "m1" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { messages: [{ id: "m2" }] } });
    const full = (id: string, payload: unknown) => ({
      data: {
        id,
        threadId: "t" + id,
        internalDate: "1700000000000",
        payload,
      },
    });
    api.users.messages.get
      .mockResolvedValueOnce(
        full("m1", {
          mimeType: "multipart/alternative",
          headers: [
            { name: "From", value: "Vagas <vagas@exemplo.com>" },
            { name: "Subject", value: "Nova vaga: Dev ção" },
            { name: "Date", value: "Tue, 14 Nov 2023 22:13:20 +0000" },
          ],
          parts: [
            { mimeType: "text/plain", body: { data: b64u("texto ação") } },
            { mimeType: "text/html", body: { data: b64u("<p>html ação</p>") } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        full("m2", {
          mimeType: "text/plain",
          headers: [{ name: "From", value: "a@b.com" }, { name: "Subject", value: "S" }],
          body: { data: b64u("so texto") },
        }),
      );
    const r = await makeGmailClient(asGmail(api), "eu@exemplo.com").buscar("label:vagas");
    expect(api.users.messages.list).toHaveBeenCalledTimes(2);
    expect(api.users.messages.list.mock.calls[0][0]).toMatchObject({ userId: "me", q: "label:vagas" });
    expect(api.users.messages.list.mock.calls[1][0]).toMatchObject({ pageToken: "p2" });
    expect(api.users.messages.get.mock.calls[0][0]).toMatchObject({ id: "m1", format: "full" });
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({
      id: "m1",
      threadId: "tm1",
      from: "Vagas <vagas@exemplo.com>",
      subject: "Nova vaga: Dev ção",
      text: "texto ação",
      html: "<p>html ação</p>",
    });
    expect(r[0].date.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(r[1]).toMatchObject({ text: "so texto", html: "" });
  });

  it("criarRascunho monta MIME com anexo PDF e assunto UTF-8", async () => {
    const api = fakeApi();
    api.users.drafts.create.mockResolvedValue({ data: { id: "d1", message: { threadId: "t9" } } });
    const pdf = Buffer.from("%PDF-1.4 fake");
    const out = await makeGmailClient(asGmail(api), "eu@exemplo.com").criarRascunho({
      para: "rh@empresa.com",
      assunto: "Candidatura: Desenvolvedor Pleno",
      corpo: "Olá, segue meu currículo.",
      anexo: { nome: "cv.pdf", pdf },
    });
    expect(out).toEqual({ draftId: "d1", threadId: "t9" });
    const arg = api.users.drafts.create.mock.calls[0][0];
    expect(arg.userId).toBe("me");
    expect(arg.requestBody.message.threadId).toBeUndefined();
    const mime = decodeRaw(arg.requestBody.message.raw);
    const subj = Buffer.from("Candidatura: Desenvolvedor Pleno", "utf8").toString("base64");
    expect(mime).toContain(`Subject: =?UTF-8?B?${subj}?=`);
    expect(api.users.drafts.create).toHaveBeenCalledTimes(1);
    expect(mime).toContain("To: rh@empresa.com");
    expect(mime).toContain("Content-Type: multipart/mixed; boundary=");
    expect(mime).toContain('Content-Type: application/pdf; name="cv.pdf"');
    expect(mime).toContain("Content-Disposition: attachment; filename=\"cv.pdf\"");
    expect(mime).toContain(pdf.toString("base64"));
    expect(mime).toContain(Buffer.from("Olá, segue meu currículo.", "utf8").toString("base64"));
  });

  it("criarRascunho quebra assunto longo com acentos em palavras codificadas validas", async () => {
    const api = fakeApi();
    api.users.drafts.create.mockResolvedValue({ data: { id: "d3", message: { threadId: "t3" } } });
    const assunto = "Candidatura à vaga de Desenvolvedor Pleno em Belém ção ção ção ção";
    await makeGmailClient(asGmail(api), "eu@exemplo.com").criarRascunho({ para: "a@b.com", assunto, corpo: "x" });
    const mime = decodeRaw(api.users.drafts.create.mock.calls[0][0].requestBody.message.raw);
    const linha = mime.split("\r\n\r\n")[0].split(/\r\n(?! )/).find((l) => l.startsWith("Subject:"))!;
    const palavras = [...linha.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => m[1]);
    expect(palavras.length).toBeGreaterThan(1);
    expect(palavras.every((w) => w.length <= 60)).toBe(true);
    expect(palavras.map((w) => Buffer.from(w, "base64").toString("utf8")).join("")).toBe(assunto);
  });

  it("criarRascunho com threadId envia In-Reply-To e References", async () => {
    const api = fakeApi();
    api.users.drafts.create.mockResolvedValue({ data: { id: "d2", message: { threadId: "t1" } } });
    await makeGmailClient(asGmail(api), "eu@exemplo.com").criarRascunho({
      para: "rh@empresa.com",
      assunto: "Re: vaga",
      corpo: "oi",
      threadId: "t1",
      inReplyTo: "<abc@mail.exemplo.com>",
    });
    const arg = api.users.drafts.create.mock.calls[0][0];
    expect(arg.requestBody.message.threadId).toBe("t1");
    const mime = decodeRaw(arg.requestBody.message.raw);
    expect(mime).toContain("In-Reply-To: <abc@mail.exemplo.com>");
    expect(mime).toContain("References: <abc@mail.exemplo.com>");
    expect(mime).not.toContain("multipart/mixed");
  });

  it("rascunhoExiste retorna false em 404 e true quando existe", async () => {
    const api = fakeApi();
    const c = makeGmailClient(asGmail(api), "eu@exemplo.com");
    api.users.drafts.get.mockResolvedValueOnce({ data: { id: "d1" } });
    await expect(c.rascunhoExiste("d1")).resolves.toBe(true);
    api.users.drafts.get.mockRejectedValueOnce(Object.assign(new Error("nf"), { code: 404 }));
    await expect(c.rascunhoExiste("d2")).resolves.toBe(false);
    api.users.drafts.get.mockRejectedValueOnce(Object.assign(new Error("bad"), { code: 400 }));
    await expect(c.rascunhoExiste("d3")).rejects.toThrow("bad");
  });

  it("mensagensDaThread marca deMim pelo header From", async () => {
    const api = fakeApi();
    api.users.threads.get.mockResolvedValue({
      data: {
        messages: [
          {
            id: "a",
            internalDate: "1700000000000",
            payload: { headers: [{ name: "From", value: "Eu <EU@Exemplo.com>" }, { name: "Message-ID", value: "<1@x>" }] },
          },
          {
            id: "b",
            internalDate: "1700086400000",
            payload: { headers: [{ name: "From", value: "rh@empresa.com" }, { name: "Message-Id", value: "<2@x>" }] },
          },
        ],
      },
    });
    const r = await makeGmailClient(asGmail(api), "eu@exemplo.com").mensagensDaThread("t1");
    expect(r.map((m) => m.deMim)).toEqual([true, false]);
    expect(r.map((m) => m.messageId)).toEqual(["<1@x>", "<2@x>"]);
    expect(r[1].data.toISOString()).toBe("2023-11-15T22:13:20.000Z");
  });

  it("enviarRascunho chama drafts.send com o id", async () => {
    const api = fakeApi();
    api.users.drafts.send.mockResolvedValue({ data: {} });
    await makeGmailClient(asGmail(api), "eu@exemplo.com").enviarRascunho("d1");
    expect(api.users.drafts.send).toHaveBeenCalledWith({ userId: "me", requestBody: { id: "d1" } });
  });

  it("enviarRascunho nao repete em 503", async () => {
    const api = fakeApi();
    api.users.drafts.send.mockRejectedValue(Object.assign(new Error("down"), { code: 503 }));
    const c = makeGmailClient(asGmail(api), "eu@exemplo.com", { baseMs: 1 });
    await expect(c.enviarRascunho("d1")).rejects.toThrow("down");
    expect(api.users.drafts.send).toHaveBeenCalledTimes(1);
  });

  it("criarRascunho rejeita destinatario com CR/LF ou varios enderecos", async () => {
    const api = fakeApi();
    const c = makeGmailClient(asGmail(api), "eu@exemplo.com");
    for (const para of ["a@b.com\r\nBcc: x@y.com", "a@b.com\nBcc: x@y.com", "a@b.com, c@d.com", "sem-arroba", "A <a@b.com>"]) {
      await expect(c.criarRascunho({ para, assunto: "s", corpo: "c" })).rejects.toThrow("Destinatario invalido");
    }
    expect(api.users.drafts.create).not.toHaveBeenCalled();
  });

  it("criarRascunho sanitiza nome do anexo", async () => {
    const api = fakeApi();
    api.users.drafts.create.mockResolvedValue({ data: { id: "d", message: { threadId: "t" } } });
    await makeGmailClient(asGmail(api), "eu@exemplo.com").criarRascunho({
      para: "a@b.com",
      assunto: "s",
      corpo: "c",
      anexo: { nome: 'cv"\r\nBcc: x@y.com.pdf', pdf: Buffer.from("x") },
    });
    const mime = decodeRaw(api.users.drafts.create.mock.calls[0][0].requestBody.message.raw);
    expect(mime).toContain('filename="cv\\"Bcc: x@y.com.pdf"');
    expect(mime).not.toMatch(/\r\nBcc:/);
  });

  it("repete chamadas em erro 503 mapeado de code", async () => {
    const api = fakeApi();
    api.users.drafts.get
      .mockRejectedValueOnce(Object.assign(new Error("down"), { code: 503 }))
      .mockResolvedValue({ data: { id: "d1" } });
    const c = makeGmailClient(asGmail(api), "eu@exemplo.com", { baseMs: 1 });
    await expect(c.rascunhoExiste("d1")).resolves.toBe(true);
    expect(api.users.drafts.get).toHaveBeenCalledTimes(2);
  });
});
