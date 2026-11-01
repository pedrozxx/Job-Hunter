import { describe, it, expect } from "vitest";
import { extractEmail } from "../src/normalize.js";

describe("extractEmail", () => {
  it("devolve o primeiro e-mail", () => {
    expect(extractEmail("Envie CV para rh@empresa.com.br ou vagas@empresa.com.br")).toBe("rh@empresa.com.br");
  });
  it("desofusca [at] e [dot]", () => {
    expect(extractEmail("contato: joao [at] empresa [dot] com")).toBe("joao@empresa.com");
  });
  it("ignora enderecos do github", () => {
    expect(extractEmail("noreply@github.com e notifications@github.com")).toBeNull();
    expect(extractEmail("123+user@users.noreply.github.com")).toBeNull();
  });
  it("ignora noreply e no-reply", () => {
    expect(extractEmail("noreply@empresa.com e no-reply@empresa.com, rh@empresa.com")).toBe("rh@empresa.com");
  });
  it("sem e-mail", () => {
    expect(extractEmail("sem email aqui")).toBeNull();
  });
  it("ignora os enderecos pedidos, sem diferenciar maiusculas", () => {
    expect(extractEmail("eu@exemplo.com e rh@empresa.com", ["EU@exemplo.com"])).toBe("rh@empresa.com");
  });
});
