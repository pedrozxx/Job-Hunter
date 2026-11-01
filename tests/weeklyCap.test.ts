import { describe, expect, test } from "vitest";
import { semanaDe, vagasRestantesNaSemana } from "../src/weeklyCap.js";
import type { CandidaturaRow } from "../src/types.js";

function cand(data: string, i = 0): CandidaturaRow {
  return {
    id: `c${i}`,
    data,
    empresa: "Acme",
    titulo: "Estagiario",
    canal: "email",
    status: "rascunho criado",
    idRascunho: "",
    idThread: "",
    followupEm: "",
    idRascunhoFollowup: "",
  };
}

function varias(n: number, data: string): CandidaturaRow[] {
  return Array.from({ length: n }, (_, i) => cand(data, i));
}

const agora = new Date("2026-11-04T12:00:00-03:00"); // quarta

describe("semanaDe", () => {
  test("domingo 22h30 em Belem ainda pertence a semana que comecou na segunda anterior", () => {
    expect(semanaDe(new Date("2026-11-08T22:30:00-03:00"))).toBe("2026-11-02");
  });
  test("segunda 00h10 em Belem abre nova semana", () => {
    expect(semanaDe(new Date("2026-11-09T00:10:00-03:00"))).toBe("2026-11-09");
  });
  test("segunda e meio de semana", () => {
    expect(semanaDe(new Date("2026-11-02T00:00:00-03:00"))).toBe("2026-11-02");
    expect(semanaDe(new Date("2026-11-04T12:00:00-03:00"))).toBe("2026-11-02");
  });
  test("virada de mes", () => {
    expect(semanaDe(new Date("2026-12-02T10:00:00-03:00"))).toBe("2026-11-30");
  });
});

describe("vagasRestantesNaSemana", () => {
  test("sem candidaturas restam 30", () => {
    expect(vagasRestantesNaSemana([], agora)).toBe(30);
  });
  test("30 na semana atual restam 0", () => {
    expect(vagasRestantesNaSemana(varias(30, "2026-11-03T13:00:00.000Z"), agora)).toBe(0);
  });
  test("29 na semana atual e 5 da semana passada restam 1", () => {
    const c = [...varias(29, "2026-11-03T13:00:00.000Z"), ...varias(5, "2026-10-28T13:00:00.000Z")];
    expect(vagasRestantesNaSemana(c, agora)).toBe(1);
  });
  test("nunca abaixo de zero", () => {
    expect(vagasRestantesNaSemana(varias(35, "2026-11-03T13:00:00.000Z"), agora)).toBe(0);
  });
  test("data vazia ou invalida nao conta e nao lanca", () => {
    const c = [cand(""), cand("nao e data"), cand("2026-11-03T13:00:00.000Z")];
    expect(vagasRestantesNaSemana(c, agora)).toBe(29);
  });
  test("limite da semana em horario de Belem", () => {
    // 2026-11-09T02:00Z = domingo 23h em Belem (ainda semana atual); 03:10Z = segunda 00h10 (proxima)
    const a = new Date("2026-11-08T12:00:00-03:00");
    const c = [cand("2026-11-09T02:00:00.000Z"), cand("2026-11-09T03:10:00.000Z")];
    expect(vagasRestantesNaSemana(c, a)).toBe(29);
  });
});
