import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "../retry.js";

export type Esforco = "low" | "medium" | "high";

export interface LlmClient {
  gerar(r: {
    modelo: string;
    sistema: string;
    usuario: string;
    maxTokens: number;
    /** output_config.effort. Haiku 5.5 e Sonnet 5.5 pensam por padrão; o esforço controla quanto. */
    esforco?: Esforco;
  }): Promise<string>;
}

/** A parte do SDK que o cliente usa; os testes passam um falso. */
export type AnthropicMessages = {
  messages: { create(p: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
};

export function makeAnthropicClient(
  apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
  // maxRetries: 0 deixa o retry a cargo de withRetry (429 e >= 500).
  sdk: AnthropicMessages = new Anthropic({ apiKey, maxRetries: 0 }),
): LlmClient {
  return {
    async gerar({ modelo, sistema, usuario, maxTokens, esforco }) {
      const resposta = await withRetry(() =>
        sdk.messages.create({
          model: modelo,
          max_tokens: maxTokens,
          system: sistema,
          messages: [{ role: "user", content: usuario }],
          ...(esforco ? { output_config: { effort: esforco } } : {}),
        }),
      );
      // O pensamento conta no max_tokens: resposta cortada vira erro com a causa, não texto pela metade.
      if (resposta.stop_reason === "max_tokens") {
        throw new Error(`${modelo}: resposta cortada (stop_reason max_tokens, limite ${maxTokens})`);
      }
      if (resposta.stop_reason === "refusal") {
        const categoria = resposta.stop_details?.category ?? "sem categoria";
        throw new Error(`${modelo}: o modelo recusou o pedido (stop_reason refusal, categoria ${categoria})`);
      }
      return resposta.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
    },
  };
}
