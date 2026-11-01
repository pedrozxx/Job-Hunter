import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/retry.js";

const erro = (status: number) => Object.assign(new Error(`http ${status}`), { status });

describe("withRetry", () => {
  it("repete em 429 e 503 ate ter sucesso", async () => {
    const fn = vi.fn().mockRejectedValueOnce(erro(429)).mockRejectedValueOnce(erro(503)).mockResolvedValue("ok");
    await expect(withRetry(fn, { baseMs: 1 })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it("nao repete em 400", async () => {
    const fn = vi.fn().mockRejectedValue(erro(400));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toThrow("http 400");
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("desiste apos 3 tentativas", async () => {
    const fn = vi.fn().mockRejectedValue(erro(500));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toThrow("http 500");
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it("nao repete erro sem status", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(withRetry(fn, { baseMs: 1 })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
