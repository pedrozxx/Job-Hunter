import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchGmailVagas } from "../../../src/sources/gmail/index.js";
import type { EmailBruto, GmailClient } from "../../../src/clients/gmail.js";

const html1 = readFileSync(new URL("../../fixtures/email/linkedin-1.html", import.meta.url), "utf8");
const mk = (p: Partial<EmailBruto>): EmailBruto => ({
  id: "x", threadId: "t", from: "", subject: "", date: new Date(), html: "", text: "", ...p,
});
const clienteCom = (emails: EmailBruto[], queries: string[] = []): GmailClient => ({
  buscar: async (q: string) => { queries.push(q); return emails; },
} as unknown as GmailClient);

describe("fetchGmailVagas", () => {
  it("monta a query e roteia por remetente e assunto", async () => {
    const queries: string[] = [];
    const desde = new Date("2026-10-01T00:00:00Z");
    const vagas = await fetchGmailVagas(
      clienteCom(
        [
          mk({ id: "a", from: "LinkedIn <jobalerts-noreply@linkedin.com>", html: html1 }),
          mk({ id: "b", from: "Eu <eu@example.com>", subject: "[vaga] Dev Jr", text: "https://e.example.com/v" }),
          mk({ id: "c", from: "Outro <no-reply@gupy.com.br>", subject: "Sua candidatura", text: "https://gupy.example.com" }),
        ],
        queries,
      ),
      desde,
    );
    expect(queries).toEqual([
      `after:${Math.floor(desde.getTime() / 1000)} (from:jobalerts-noreply@linkedin.com OR from:jobs-noreply@linkedin.com OR subject:"[vaga]")`,
    ]);
    expect(vagas.filter((v) => v.fonte === "gmail-linkedin")).toHaveLength(6);
    expect(vagas.filter((v) => v.fonte === "gmail-manual")).toHaveLength(1);
    expect(vagas).toHaveLength(7);
  });

  it("um e-mail que lanca erro chama onErro e nao impede os outros", async () => {
    const onErro = vi.fn();
    const ruim = mk({ id: "bad", from: "jobs-noreply@linkedin.com" });
    Object.defineProperty(ruim, "html", { get() { throw new Error("boom"); } });
    const vagas = await fetchGmailVagas(
      clienteCom([ruim, mk({ id: "ok", from: "x@y.com", subject: "[vaga] QA", text: "https://e.example.com/qa" })]),
      new Date(),
      onErro,
    );
    expect(vagas).toHaveLength(1);
    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro.mock.calls[0]?.[0]).toBe("gmail:bad");
  });
});
