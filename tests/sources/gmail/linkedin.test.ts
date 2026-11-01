import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseLinkedinAlert } from "../../../src/sources/gmail/linkedin.js";
import type { EmailBruto } from "../../../src/clients/gmail.js";

const lerHtml = (n: number) => readFileSync(new URL(`../../fixtures/email/linkedin-${n}.html`, import.meta.url), "utf8");
const email = (html: string): EmailBruto => ({
  id: "m1",
  threadId: "t1",
  from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
  subject: "alerta",
  date: new Date("2026-10-30T22:50:00Z"),
  html,
  text: "",
});

describe("parseLinkedinAlert", () => {
  it("extrai as 6 vagas do alerta 1", () => {
    const vagas = parseLinkedinAlert(email(lerHtml(1)));
    expect(vagas).toHaveLength(6);
    expect(vagas.every((v) => v.fonte === "gmail-linkedin")).toBe(true);
    expect(vagas[0]).toMatchObject({
      titulo: "Programa de Estágio - GenAI",
      empresa: "iFood",
      local: "Brasil (Remoto)",
      link: "https://linkedin.com/jobs/view/4484217195",
      nivel: "estagio",
      modalidade: "remoto",
      emailContato: null,
    });
    expect(vagas[0]?.descricao).toContain("Brasil (Remoto)");
    expect(vagas[5]).toMatchObject({ empresa: "Vambora Coders", local: "Nova Friburgo, RJ (Híbrido)", modalidade: "hibrido" });
  });

  it("extrai as 9 vagas distintas do alerta 2 (lista secundaria incluida, repetida uma vez)", () => {
    const vagas = parseLinkedinAlert(email(lerHtml(2)));
    expect(vagas).toHaveLength(9);
    expect(new Set(vagas.map((v) => v.id)).size).toBe(9);
    expect(vagas[0]).toMatchObject({
      titulo: "Analista de Sistemas Júnior (Remoto)",
      empresa: "Vitru Educação",
      link: "https://linkedin.com/jobs/view/4483083818",
      nivel: "junior",
    });
  });

  it("link sem /comm nem parametros de rastreio", () => {
    for (const n of [1, 2]) {
      for (const v of parseLinkedinAlert(email(lerHtml(n)))) {
        expect(v.link).toMatch(/^https:\/\/linkedin\.com\/jobs\/view\/\d+$/);
      }
    }
  });

  it("item malformado e pulado e reportado sem abortar o e-mail", () => {
    const html = `<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/abc/?x=1"> Vaga quebrada </a></td></tr>
      <tr><td><p>Acme · Belém</p></td></tr></table>
      <table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/123456/?trk=1"> Dev Jr </a></td></tr>
      <tr><td><p>Acme · Belém (Presencial)</p></td></tr></table>`;
    const onErro = vi.fn();
    const vagas = parseLinkedinAlert(email(html), onErro);
    expect(vagas).toHaveLength(1);
    expect(vagas[0]).toMatchObject({ titulo: "Dev Jr", empresa: "Acme", local: "Belém (Presencial)", modalidade: "presencial" });
    expect(onErro).toHaveBeenCalledTimes(1);
  });
});
