import { describe, expect, test } from "vitest";
import { carregarProibidas, checkMessage } from "../src/messageCheck.js";

describe("checkMessage", () => {
  test("limite de 120 palavras", () => {
    expect(checkMessage("palavra ".repeat(121), []).ok).toBe(false);
    expect(checkMessage("palavra ".repeat(120), []).ok).toBe(true);
  });

  test("palavra proibida sem diferenciar maiúsculas", () => {
    expect(checkMessage("Sou Apaixonado por código", ["apaixonado"]).ok).toBe(false);
  });

  test("travessão é proibido", () => {
    expect(checkMessage("trabalho com React \u2014 e Node", ["\u2014"]).ok).toBe(false);
  });

  test("texto limpo passa", () => {
    expect(checkMessage("Trabalho com React e Node.", ["apaixonado"])).toEqual({ ok: true });
  });
});

describe("carregarProibidas", () => {
  test("lê o arquivo, ignora comentários e decodifica \\u2014", () => {
    const l = carregarProibidas();
    expect(l).toContain("apaixonado");
    expect(l).toContain("faço a diferença");
    expect(l).toContain("\u2014");
    expect(l.some((x) => x.startsWith("#") || x === "")).toBe(false);
  });
});
