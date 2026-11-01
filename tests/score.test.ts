import { describe, expect, test } from "vitest";
import { ErroPontuacao, pontuar } from "../src/score.js";
import type { LlmClient } from "../src/clients/llm.js";
import type { Vaga } from "../src/types.js";
import type { Perfil } from "../src/secrets.js";

class LlmFalso implements LlmClient {
  respostas: string[] = [];
  chamadas: Parameters<LlmClient["gerar"]>[0][] = [];
  async gerar(r: Parameters<LlmClient["gerar"]>[0]): Promise<string> {
    this.chamadas.push(r);
    const resp = this.respostas.shift();
    if (resp === undefined) throw new Error("sem resposta");
    return resp;
  }
}

const vaga: Vaga = {
  id: "abc",
  fonte: "github-repo",
  titulo: "Estagiario Frontend",
  empresa: "Acme",
  local: "Belem",
  modalidade: "remoto",
  nivel: "estagio",
  descricao: "Trabalhar com React e TypeScript",
  link: "https://exemplo.com/vaga/1",
  emailContato: null,
  coletadaEm: "2026-11-01T00:00:00.000Z",
};
const perfil: Perfil = { markdown: "PERFIL_UNICO formatura: 12/2027", termosExclusao: [] };
const cv = "CURRICULO_UNICO React TypeScript";
const ok = { nota: 72, motivo: "Stack bate", atende: ["React"], falta: ["Docker"] };

describe("pontuar", () => {
  test("aceita JSON válido", async () => {
    const llm = new LlmFalso();
    llm.respostas = [JSON.stringify(ok)];
    expect(await pontuar(llm, vaga, perfil, cv)).toEqual(ok);
    expect(llm.chamadas[0].modelo).toBe("claude-haiku-5-5");
    expect(llm.chamadas[0].maxTokens).toBe(600);
  });

  test("aceita JSON dentro de bloco ```json", async () => {
    const llm = new LlmFalso();
    llm.respostas = ["```json\n" + JSON.stringify(ok) + "\n```"];
    expect(await pontuar(llm, vaga, perfil, cv)).toEqual(ok);
  });

  test("tolera texto ao redor do objeto JSON", async () => {
    const llm = new LlmFalso();
    llm.respostas = ["Aqui está: " + JSON.stringify(ok) + " Espero ajudar."];
    expect(await pontuar(llm, vaga, perfil, cv)).toEqual(ok);
  });

  test("repete uma vez e aceita a segunda resposta válida", async () => {
    const llm = new LlmFalso();
    llm.respostas = ["não é json", JSON.stringify(ok)];
    expect(await pontuar(llm, vaga, perfil, cv)).toEqual(ok);
    expect(llm.chamadas).toHaveLength(2);
  });

  test("nota fora de 0..100 ou string é inválida e repete uma vez", async () => {
    const llm = new LlmFalso();
    llm.respostas = ['{"nota":"alta"}', '{"nota":150,"motivo":"x","atende":[],"falta":[]}'];
    const erro = await pontuar(llm, vaga, perfil, cv).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroPontuacao);
    expect(erro.resposta).toContain("150");
    expect(llm.chamadas).toHaveLength(2);
  });

  test("nota não inteira é inválida", async () => {
    const llm = new LlmFalso();
    llm.respostas = [
      '{"nota":7.5,"motivo":"x","atende":[],"falta":[]}',
      '{"nota":7.5,"motivo":"x","atende":[],"falta":[]}',
    ];
    await expect(pontuar(llm, vaga, perfil, cv)).rejects.toThrow(ErroPontuacao);
  });

  test("prompt inclui currículo, perfil, vaga e a regra de descrição curta", async () => {
    const llm = new LlmFalso();
    llm.respostas = [JSON.stringify(ok)];
    await pontuar(llm, vaga, perfil, cv);
    const { usuario, sistema } = llm.chamadas[0];
    expect(usuario).toContain(cv);
    expect(usuario).toContain(perfil.markdown);
    expect(usuario).toContain(vaga.titulo);
    expect(usuario).toContain(vaga.descricao);
    expect(sistema).toContain("descrição curta");
    expect(sistema).toContain("JSON");
    expect(sistema).toContain("formatura");
  });
});
