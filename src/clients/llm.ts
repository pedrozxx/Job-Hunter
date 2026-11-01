import Anthropic from "@anthropic-ai/sdk";
import { withRetry } from "../retry.js";

export interface LlmClient {
  gerar(r: {
    modelo: string;
    sistema: string;
    usuario: string;
    maxTokens: number;
  }): Promise<string>;
}

export function makeAnthropicClient(
  apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
): LlmClient {
  // maxRetries: 0 deixa o retry a cargo de withRetry (429 e >= 500).
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  return {
    async gerar({ modelo, sistema, usuario, maxTokens }) {
      const resposta = await withRetry(() =>
        client.messages.create({
          model: modelo,
          max_tokens: maxTokens,
          system: sistema,
          messages: [{ role: "user", content: usuario }],
        }),
      );
      return resposta.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("");
    },
  };
}
