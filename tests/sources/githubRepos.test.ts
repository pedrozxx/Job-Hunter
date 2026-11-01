import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fetchGithubVagas } from "../../src/sources/githubRepos.js";
import { REPOS_VAGAS } from "../../src/config.js";

const fixture = readFileSync(new URL("../fixtures/github-issues.json", import.meta.url), "utf8");
const ok = () => new Response(fixture, { status: 200, headers: { "content-type": "application/json" } });
const falha = (status: number) => new Response("{}", { status });
const desde = new Date("2026-10-01");

describe("fetchGithubVagas", () => {
  it("mapeia issues em vagas", async () => {
    const mockFetch = vi.fn(async () => ok()) as unknown as typeof fetch;
    const vagas = await fetchGithubVagas(desde, mockFetch);
    expect(vagas.every((v) => v.fonte === "github-repo")).toBe(true);
    expect(vagas.find((v) => v.titulo.includes("Júnior"))).toMatchObject({
      nivel: "junior",
      modalidade: "remoto",
      emailContato: "rh@empresa-ficticia.com",
      empresa: "Empresa Ficticia",
    });
    expect(vagas.some((v) => v.link.includes("/pull/"))).toBe(false);
    const presencial = vagas.find((v) => v.titulo === "Analista de Sistemas");
    expect(presencial).toMatchObject({ modalidade: "presencial", nivel: "pleno", local: "São Paulo", empresa: "desconhecida" });
    expect(vagas.find((v) => v.titulo.includes("Backend"))?.emailContato).toBe("joao@outra-ficticia.com");
  });

  it("consulta cada repo com since e per_page", async () => {
    const urls: string[] = [];
    const mockFetch = vi.fn(async (u: RequestInfo | URL) => {
      urls.push(String(u));
      return ok();
    }) as unknown as typeof fetch;
    await fetchGithubVagas(desde, mockFetch);
    expect(urls).toHaveLength(REPOS_VAGAS.length);
    expect(urls[0]).toContain(`/repos/${REPOS_VAGAS[0]}/issues?state=open&since=${encodeURIComponent(desde.toISOString())}&per_page=100`);
  });

  it("repo com 500 duas vezes e depois 200 ainda produz vagas", async () => {
    const chamadas: Record<string, number> = {};
    const mockFetch = vi.fn(async (u: RequestInfo | URL) => {
      const repo = String(u).includes(REPOS_VAGAS[0]!) ? "a" : "b";
      chamadas[repo] = (chamadas[repo] ?? 0) + 1;
      if (repo === "a" && chamadas[repo]! <= 2) return falha(500);
      return ok();
    }) as unknown as typeof fetch;
    const onErro = vi.fn();
    const vagas = await fetchGithubVagas(desde, mockFetch, onErro);
    expect(chamadas.a).toBe(3);
    expect(vagas.length).toBeGreaterThan(0);
    expect(onErro).not.toHaveBeenCalled();
  });

  it("404 em um repo nao derruba os outros", async () => {
    const mockFetch = vi.fn(async (u: RequestInfo | URL) =>
      String(u).includes(REPOS_VAGAS[0]!) ? falha(404) : ok(),
    ) as unknown as typeof fetch;
    const onErro = vi.fn();
    const vagas = await fetchGithubVagas(desde, mockFetch, onErro);
    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro.mock.calls[0]![0]).toBe(REPOS_VAGAS[0]);
    expect(vagas.length).toBe(3 * (REPOS_VAGAS.length - 1));
  });

  it("issue com link invalido e pulada e reportada", async () => {
    const corpo = JSON.stringify([
      { number: 1, title: "x", html_url: "nao-e-url", body: "", labels: [] },
      { number: 2, title: "y", html_url: "https://github.com/a/b/issues/2", body: "", labels: [] },
    ]);
    const mockFetch = vi.fn(async () => new Response(corpo, { status: 200 })) as unknown as typeof fetch;
    const onErro = vi.fn();
    const vagas = await fetchGithubVagas(desde, mockFetch, onErro);
    expect(vagas).toHaveLength(REPOS_VAGAS.length);
    expect(onErro).toHaveBeenCalledTimes(REPOS_VAGAS.length);
  });
});
