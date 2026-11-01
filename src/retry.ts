export type RetryOpts = { tentativas?: number; baseMs?: number };

function deveRepetir(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && (status === 429 || status >= 500);
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const tentativas = opts.tentativas ?? 3;
  const baseMs = opts.baseMs ?? 500;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tentativas || !deveRepetir(e)) throw e;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** (i - 1)));
    }
  }
}
