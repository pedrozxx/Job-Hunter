import { withRetry, type RetryOpts } from "../retry.js";

/** googleapis errors expose the HTTP status as `code` (sometimes a string); `status` may be missing. */
export function statusDe(e: unknown): number | undefined {
  const x = e as { status?: unknown; code?: unknown } | null;
  const v = x?.status ?? x?.code;
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

/** Copies the status onto `error.status` so withRetry can see it. */
export function anotarStatus(e: unknown): void {
  const status = statusDe(e);
  if (e instanceof Error && status !== undefined && (e as { status?: unknown }).status !== status) {
    (e as { status?: number }).status = status;
  }
}

export async function chamar<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  return withRetry(async () => {
    try {
      return await fn();
    } catch (e) {
      anotarStatus(e);
      throw e;
    }
  }, opts);
}
