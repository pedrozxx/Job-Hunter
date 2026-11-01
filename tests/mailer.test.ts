import { afterEach, describe, expect, test, vi } from "vitest";
import type { GmailClient, NovoRascunho } from "../src/clients/gmail.js";
import { criarRascunhoCandidatura, criarRascunhoFollowup } from "../src/mailer.js";
import type { CandidaturaRow, FilaRow } from "../src/types.js";

class GmailFalso implements GmailClient {
  rascunhos: NovoRascunho[] = [];
  enviados: string[] = [];
  async buscar() {
    return [];
  }
  async criarRascunho(r: NovoRascunho) {
    this.rascunhos.push(r);
    return { draftId: `d${this.rascunhos.length}`, threadId: r.threadId ?? "t1" };
  }
  async rascunhoExiste() {
    return true;
  }
  async enviarRascunho(id: string) {
    this.enviados.push(id);
  }
  async mensagensDaThread() {
    return [];
  }
}

const row = {
  id: "abc",
  titulo: "Estagiario Full Stack",
  empresa: "Acme",
  emailContato: "rh@exemplo.com",
  mensagem: "Ola, pessoal da Acme,\n\nCorpo.",
} as FilaRow;

const cand: CandidaturaRow = {
  id: "abc",
  data: "2026-10-20T13:00:00.000Z",
  empresa: "Acme",
  titulo: "Estagiario Full Stack",
  canal: "email",
  status: "enviada",
  idRascunho: "d1",
  idThread: "t9",
  followupEm: "",
  idRascunhoFollowup: "",
};

afterEach(() => vi.unstubAllEnvs());

describe("criarRascunhoCandidatura", () => {
  test("assunto, destinatario, corpo e anexo curriculo.pdf", async () => {
    vi.stubEnv("ENVIO_DIRETO", "false");
    const g = new GmailFalso();
    const pdf = Buffer.from("%PDF-1.4");
    const r = await criarRascunhoCandidatura(g, row, pdf);
    expect(r).toEqual({ draftId: "d1", threadId: "t1" });
    expect(g.rascunhos[0]).toEqual({
      para: "rh@exemplo.com",
      assunto: "Candidatura: Estagiario Full Stack",
      corpo: row.mensagem,
      anexo: { nome: "curriculo.pdf", pdf },
    });
  });
  test("envioDireto false nao envia", async () => {
    vi.stubEnv("ENVIO_DIRETO", "false");
    const g = new GmailFalso();
    await criarRascunhoCandidatura(g, row, Buffer.from("x"));
    expect(g.enviados).toEqual([]);
  });
  test("envioDireto true envia o rascunho criado", async () => {
    vi.stubEnv("ENVIO_DIRETO", "true");
    const g = new GmailFalso();
    await criarRascunhoCandidatura(g, row, Buffer.from("x"));
    expect(g.enviados).toEqual(["d1"]);
  });
  test("sem emailContato lanca e nao cria rascunho", async () => {
    const g = new GmailFalso();
    await expect(criarRascunhoCandidatura(g, { ...row, emailContato: null }, Buffer.from("x"))).rejects.toThrow();
    expect(g.rascunhos).toEqual([]);
  });
});

describe("criarRascunhoFollowup", () => {
  test("responde na thread com inReplyTo e corpo do template", async () => {
    vi.stubEnv("NOME_CANDIDATO", "Maria Teste");
    const g = new GmailFalso();
    const r = await criarRascunhoFollowup(g, cand, "<msg-1@mail>", "rh@exemplo.com");
    expect(r).toEqual({ draftId: "d1" });
    const d = g.rascunhos[0];
    expect(d.para).toBe("rh@exemplo.com");
    expect(d.assunto).toBe("Re: Candidatura: Estagiario Full Stack");
    expect(d.threadId).toBe("t9");
    expect(d.inReplyTo).toBe("<msg-1@mail>");
    expect(d.anexo).toBeUndefined();
    expect(d.corpo).toContain("Estagiario Full Stack");
    expect(d.corpo).toContain("Maria Teste");
    expect(d.corpo).not.toContain("{{");
    expect(d.corpo).not.toContain(String.fromCharCode(0x2014));
  });
  test("followup nunca envia diretamente", async () => {
    vi.stubEnv("ENVIO_DIRETO", "true");
    const g = new GmailFalso();
    await criarRascunhoFollowup(g, cand, "<m>", "rh@exemplo.com");
    expect(g.enviados).toEqual([]);
  });
});
