import { describe, it, expect } from "vitest";
import { parseVagaManual } from "../../../src/sources/gmail/freeText.js";
import type { EmailBruto } from "../../../src/clients/gmail.js";

const base: EmailBruto = {
  id: "m2",
  threadId: "t2",
  from: "Eu <eu@example.com>",
  subject: "[vaga] Dev Jr",
  date: new Date("2026-10-30T10:00:00Z"),
  html: "",
  text: "Olha essa: https://empresa.example.com/vagas/dev-jr?utm_source=x\nRemoto, contato rh@empresa.example.com",
};

describe("parseVagaManual", () => {
  it("gera 1 vaga com titulo do assunto, link do corpo e descricao igual ao corpo", () => {
    const vagas = parseVagaManual(base);
    expect(vagas).toHaveLength(1);
    expect(vagas[0]).toMatchObject({
      fonte: "gmail-manual",
      titulo: "Dev Jr",
      link: "https://empresa.example.com/vagas/dev-jr",
      descricao: base.text,
      emailContato: "rh@empresa.example.com",
      nivel: "junior",
      modalidade: "remoto",
    });
  });

  it("sem link no corpo nao gera vaga", () => {
    expect(parseVagaManual({ ...base, text: "sem link" })).toEqual([]);
  });

  it("usa o html quando nao ha texto", () => {
    const v = parseVagaManual({ ...base, text: "", html: '<p>Veja <a href="https://x.example.com/v/1">aqui</a></p>' });
    expect(v[0]?.link).toBe("https://x.example.com/v/1");
  });
});
