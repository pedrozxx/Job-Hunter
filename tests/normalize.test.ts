import { expect, test } from "vitest";
import { inferModalidade, inferNivel, normalizeLink, vagaId } from "../src/normalize.js";

test("remove tracking e normaliza", () => {
  const a = "https://www.linkedin.com/jobs/view/123456/?trackingId=abc&refId=x&utm_source=email";
  const b = "https://linkedin.com/jobs/view/123456";
  expect(normalizeLink(a)).toBe(normalizeLink(b));
  expect(vagaId(a)).toBe(vagaId(b));
});
test("mantém query que identifica a vaga", () => {
  expect(normalizeLink("https://empresa.gupy.io/jobs/999?jobBoardSource=gupy_public_page"))
    .toBe("https://empresa.gupy.io/jobs/999");
  expect(normalizeLink("https://site.com/vaga?id=7")).toBe("https://site.com/vaga?id=7");
});
test("inferNivel", () => {
  expect(inferNivel("Desenvolvedor Full Stack Júnior")).toBe("junior");
  expect(inferNivel("Estágio em Desenvolvimento")).toBe("estagio");
  expect(inferNivel("Dev Jr. React")).toBe("junior");
  expect(inferNivel("Senior Backend Engineer")).toBe("senior");
  expect(inferNivel("Pessoa Desenvolvedora Node")).toBe("desconhecido");
});
test("inferModalidade", () => {
  expect(inferModalidade("100% remoto")).toBe("remoto");
  expect(inferModalidade("Home office")).toBe("remoto");
  expect(inferModalidade("Híbrido - Belém/PA")).toBe("hibrido");
  expect(inferModalidade("Presencial em São Paulo")).toBe("presencial");
});
test("ordena query restante alfabeticamente", () => {
  expect(normalizeLink("https://site.com/vaga?z=1&a=2&utm_medium=x")).toBe("https://site.com/vaga?a=2&z=1");
});
