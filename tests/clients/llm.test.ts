import { describe, expect, it, vi } from "vitest";
import { makeAnthropicClient, type AnthropicMessages } from "../../src/clients/llm.js";

function sdkFalso(resposta: unknown) {
  const create = vi.fn().mockResolvedValue(resposta);
  return { sdk: { messages: { create } } as unknown as AnthropicMessages, create };
}

const pedido = { modelo: "claude-haiku-5-5", sistema: "SIS", usuario: "USR", maxTokens: 16000, esforco: "low" as const };

describe("makeAnthropicClient", () => {
  it("junta só os blocos de texto, ignorando thinking", async () => {
    const { sdk, create } = sdkFalso({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "", signature: "x" },
        { type: "text", text: "ola " },
        { type: "text", text: "mundo" },
      ],
    });
    expect(await makeAnthropicClient("k", sdk).gerar(pedido)).toBe("ola mundo");
    expect(create).toHaveBeenCalledWith({
      model: "claude-haiku-5-5",
      max_tokens: 16000,
      system: "SIS",
      messages: [{ role: "user", content: "USR" }],
      output_config: { effort: "low" },
    });
  });

  it("sem esforco não manda output_config", async () => {
    const { sdk, create } = sdkFalso({ stop_reason: "end_turn", content: [{ type: "text", text: "a" }] });
    await makeAnthropicClient("k", sdk).gerar({ ...pedido, esforco: undefined });
    expect(create.mock.calls[0][0]).not.toHaveProperty("output_config");
  });

  it("falha com a causa quando a resposta é cortada por max_tokens", async () => {
    const { sdk } = sdkFalso({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"nota": 7' }] });
    await expect(makeAnthropicClient("k", sdk).gerar(pedido)).rejects.toThrow(
      /claude-haiku-5-5.*max_tokens.*16000/,
    );
  });

  it("falha com a categoria quando o modelo recusa", async () => {
    const { sdk } = sdkFalso({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "x" },
      content: [],
    });
    await expect(makeAnthropicClient("k", sdk).gerar(pedido)).rejects.toThrow(/recusou.*cyber/);
  });
});
