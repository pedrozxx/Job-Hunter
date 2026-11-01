import { describe, it, expect } from "vitest";
import { carregarPerfil, carregarCurriculo } from "../src/secrets.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

describe("carregarPerfil", () => {
  it("decodifica PERFIL_MD e extrai termosExclusao", () => {
    const md = "# Perfil\nexclusao: senior,  Tech Lead , staff\n";
    const p = carregarPerfil({ PERFIL_MD: b64(md) });
    expect(p.markdown).toBe(md);
    expect(p.termosExclusao).toEqual(["senior", "Tech Lead", "staff"]);
  });
  it("sem linha de exclusão, lista vazia", () => {
    expect(carregarPerfil({ PERFIL_MD: b64("# x") }).termosExclusao).toEqual([]);
  });
  it("usa o exemplo em NODE_ENV=test", () => {
    const p = carregarPerfil({});
    expect(p.markdown).toContain("Maria Exemplo");
    expect(p.termosExclusao).toContain("tech lead");
  });
  it("lança erro fora de test/dry-run sem a variável", () => {
    const antigo = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => carregarPerfil({})).toThrow(/PERFIL_MD/);
      expect(() => carregarCurriculo({})).toThrow(/CURRICULO_TXT/);
    } finally {
      if (antigo === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = antigo;
    }
  });
});

describe("carregarCurriculo", () => {
  it("decodifica CURRICULO_TXT", () => {
    expect(carregarCurriculo({ CURRICULO_TXT: b64("meu cv") })).toBe("meu cv");
  });
  it("usa o exemplo em test", () => {
    expect(carregarCurriculo({})).toContain("MARIA EXEMPLO");
  });
});
