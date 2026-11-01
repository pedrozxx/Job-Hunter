import { describe, it, expect } from "vitest";
import { passaFiltro, filtrar } from "../src/filter.js";
import { carregarPerfil } from "../src/secrets.js";
import type { Vaga } from "../src/types.js";

const perfil = carregarPerfil({});
const base: Vaga = {
  id: "abc",
  fonte: "github-repo",
  titulo: "Desenvolvedor Node Júnior",
  empresa: "Acme",
  local: "Brasil",
  modalidade: "remoto",
  nivel: "junior",
  descricao: "",
  link: "https://example.com/vaga/1",
  emailContato: null,
  coletadaEm: "2026-11-01T00:00:00.000Z",
};

describe("passaFiltro", () => {
  it("aceita remoto junior no Brasil", () => {
    expect(passaFiltro(base, perfil).ok).toBe(true);
  });
  it("rejeita presencial fora de Belém", () => {
    expect(passaFiltro({ ...base, modalidade: "presencial", local: "São Paulo, SP" }, perfil).ok).toBe(false);
  });
  it("aceita hibrido na região de Belém", () => {
    expect(passaFiltro({ ...base, modalidade: "hibrido", local: "Ananindeua - PA" }, perfil).ok).toBe(true);
  });
  it("casa cidade sem acento", () => {
    expect(passaFiltro({ ...base, modalidade: "presencial", local: "Santa Barbara do Para" }, perfil).ok).toBe(true);
  });
  it("exige palavra inteira na cidade", () => {
    expect(passaFiltro({ ...base, modalidade: "presencial", local: "Belémzinho" }, perfil).ok).toBe(false);
  });
  it("rejeita presencial ou hibrido sem local", () => {
    expect(passaFiltro({ ...base, modalidade: "presencial", local: null }, perfil).ok).toBe(false);
    expect(passaFiltro({ ...base, modalidade: "hibrido", local: null }, perfil).ok).toBe(false);
  });
  it("rejeita pleno e aceita nível desconhecido", () => {
    expect(passaFiltro({ ...base, nivel: "pleno" }, perfil).ok).toBe(false);
    expect(passaFiltro({ ...base, nivel: "desconhecido" }, perfil).ok).toBe(true);
  });
  it("aplica termosExclusao no título", () => {
    expect(passaFiltro({ ...base, titulo: "Tech Lead Node" }, perfil).ok).toBe(false);
    expect(passaFiltro({ ...base, titulo: "Sênior Node" }, perfil).ok).toBe(false);
  });
  it("termosExclusao não olha a descrição nem casa parte de palavra", () => {
    expect(passaFiltro({ ...base, descricao: "trabalhe com um tech lead" }, perfil).ok).toBe(true);
    expect(passaFiltro({ ...base, titulo: "Estagiário de Principalidades" }, perfil).ok).toBe(true);
  });
  it("rejeita fora do Brasil", () => {
    expect(passaFiltro({ ...base, local: "Lisboa, Portugal" }, perfil).ok).toBe(false);
    expect(passaFiltro({ ...base, local: "Remote - US" }, perfil).ok).toBe(false);
  });
  it("deixa o Claude decidir quando modalidade e local são desconhecidos", () => {
    expect(passaFiltro({ ...base, modalidade: "desconhecido", local: null }, perfil).ok).toBe(true);
  });
});

describe("filtrar", () => {
  it("deduplica dentro do lote", () => {
    const r = filtrar([base, { ...base }], new Set(), perfil);
    expect(r.aprovadas).toHaveLength(1);
    expect(r.descartadas).toBe(1);
  });
  it("descarta ids já vistos", () => {
    expect(filtrar([base], new Set([base.id]), perfil).aprovadas).toHaveLength(0);
  });
});
