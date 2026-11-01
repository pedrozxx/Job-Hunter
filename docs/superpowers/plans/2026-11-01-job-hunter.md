# job-hunter: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline agendado no GitHub Actions que coleta vagas (alertas no Gmail e repositórios de vagas no GitHub), filtra, pontua com Claude, escreve mensagem e põe numa planilha para aprovação; depois cria rascunhos no Gmail e follow-ups.

**Architecture:** Funções puras (normalize, filter, messageCheck, weeklyCap, parsers) testadas com fixtures; clientes externos (Gmail, Sheets, Drive, Claude, GitHub) atrás de interfaces pequenas, mockadas nos testes; dois entrypoints (`jobs/collect`, `jobs/send`) orquestram tudo. Estado só na planilha.

**Tech Stack:** Node 20, TypeScript (ESM, `strict`), `tsx` para rodar, Vitest, `@anthropic-ai/sdk`, `googleapis`, `cheerio` (parse de HTML de e-mail), `zod` (validar JSON do Claude), `date-fns-tz`.

**Spec:** `docs/superpowers/specs/2026-11-01-job-hunter-design.md`

## Global Constraints

- Repositório público: nenhum dado real do Pedro em código, testes ou fixtures. Fixtures reais passam por `scripts/anonymize-fixture.ts` antes do commit.
- Fuso de todas as regras de data: `America/Belem`.
- Corte de nota: `60`. Teto semanal: `30` candidaturas, semana de segunda a domingo. Follow-up após `7` dias. Mensagem final até `120` palavras.
- Modelos: pontuação `claude-haiku-5-5`; trecho sob medida `claude-sonnet-5-5`. Ao escrever o cliente, carregar a skill `claude-api`.
- Cidades aceitas para presencial/híbrido: Belém, Ananindeua, Marituba, Benevides, Santa Bárbara do Pará.
- Repositórios de vagas: `frontendbr/vagas`, `backend-br/vagas`, `react-brasil/vagas`.
- `ENVIO_DIRETO` padrão `false`: sempre rascunho.
- Escopos OAuth: `gmail.readonly`, `gmail.compose`, `spreadsheets`, `drive.readonly`.
- Todo texto gerado pelo sistema em português, sem o caractere travessão (U+2014).
- Commits terminam com as linhas de atribuição da sessão.

## Review Focus

1. Mesma vaga chegando com links diferentes (parâmetros `trackingId`, `refId`, `utm_*`, barra final, `www.`) deve gerar o mesmo `id` e não duplicar. Teste na Task 1.
2. Pedro reordena, filtra ou ordena as linhas da planilha: leitura e escrita devem achar a linha pelo `id`, nunca pelo índice. Teste na Task 7.
3. Pedro edita a mensagem na Fila antes de aprovar: o `send` usa o texto editado, não gera outro. Teste na Task 10.
4. Virada de semana: domingo 22h em Belém já é segunda em UTC; o teto deve contar pela semana de Belém. Teste na Task 9.
5. Corpo de vaga com vários e-mails, e-mail ofuscado ("nome [at] empresa.com") ou e-mail de domínio genérico de plataforma (`noreply@`, `@github.com`): pegar o primeiro e-mail válido de pessoa/empresa; nenhum válido vira `formulario`. Teste na Task 2.

---

## Estrutura de arquivos

```
src/
  types.ts            tipos Vaga, Pontuacao, FilaRow, CandidaturaRow, LogRow
  config.ts           constantes da spec e leitura de env
  secrets.ts          decodifica PERFIL_MD e CURRICULO_TXT (base64)
  retry.ts            withRetry para 429/5xx
  normalize.ts        normalizeLink, vagaId, extractEmail, inferNivel, inferModalidade
  filter.ts           passaFiltro, filtrar
  messageCheck.ts     checkMessage
  weeklyCap.ts        semanaDe, contarNaSemana
  sources/
    githubRepos.ts    fetchGithubVagas
    gmail/linkedin.ts parseLinkedinAlert
    gmail/gupy.ts     parseGupyAlert
    gmail/freeText.ts parseVagaManual
    gmail/index.ts    fetchGmailVagas
  clients/
    google.ts         makeGoogleClients (auth OAuth)
    gmail.ts          interface GmailClient + implementação
    sheets.ts         interface SheetsRepo + implementação
    drive.ts          downloadPdf
    llm.ts            interface LlmClient + implementação Anthropic
  score.ts            pontuar
  compose.ts          comporMensagem
  mailer.ts           criarRascunhoCandidatura, criarRascunhoFollowup
  jobs/collect.ts     runCollect
  jobs/send.ts        runSend
scripts/ google-auth.ts, probe-sources.ts, anonymize-fixture.ts, setup-sheet.ts
templates/ base.md, proibidas.txt, followup.md
examples/ perfil.example.md, curriculo.example.txt
tests/ espelha src/, fixtures em tests/fixtures/
.github/workflows/ ci.yml, collect.yml, send.yml
```

---

### Task 1: Projeto base, tipos e normalização

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.github/workflows/ci.yml`, `src/types.ts`, `src/config.ts`, `src/normalize.ts`
- Test: `tests/normalize.test.ts`

**Interfaces:**
- Produces:
  - `src/types.ts`: `Vaga`, `Pontuacao` como na spec, com a fonte ampliada para `"gmail-linkedin" | "gmail-gupy" | "gmail-manual" | "github-repo"` (a spec prevê vaga mandada pelo próprio e-mail); `Fonte = Vaga["fonte"]`.
  - `src/config.ts`: `CORTE = 60`, `TETO_SEMANAL = 30`, `FOLLOWUP_DIAS = 7`, `MAX_PALAVRAS = 120`, `TZ = "America/Belem"`, `CIDADES_OK: string[]`, `REPOS_VAGAS: string[]`, `MODELO_NOTA = "claude-haiku-5-5"`, `MODELO_TEXTO = "claude-sonnet-5-5"`, `envioDireto(): boolean` (lê `ENVIO_DIRETO`).
  - `src/normalize.ts`: `normalizeLink(url: string): string`, `vagaId(url: string): string` (sha1 hex de `normalizeLink`), `inferNivel(texto: string): Vaga["nivel"]`, `inferModalidade(texto: string): Vaga["modalidade"]`.

- [ ] **Step 1: Scaffold.** `package.json` com `"type": "module"`, scripts `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `collect` (`tsx src/jobs/collect.ts`), `send` (`tsx src/jobs/send.ts`). `ci.yml` roda `npm ci`, `typecheck`, `test` em push e PR, Node 20. `.gitignore` inclui `.env`, `*.local.*`, `tests/fixtures/raw/`.

- [ ] **Step 2: Testes que falham** em `tests/normalize.test.ts`:

```ts
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
```

- [ ] **Step 3: Rodar** `npx vitest run tests/normalize.test.ts`. Esperado: FAIL (módulo não existe).
- [ ] **Step 4: Implementar** `types.ts`, `config.ts`, `normalize.ts`. `normalizeLink`: minúsculas no host, remove `www.`, remove barra final, remove parâmetros `utm_*`, `trackingId`, `refId`, `trk`, `jobBoardSource`, `lipi`, `eBP`; mantém os demais em ordem alfabética. Regex de nível e modalidade sem acento-sensibilidade (normalizar NFD antes).
- [ ] **Step 5: Rodar** `npm test && npm run typecheck`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat: base do projeto, tipos e normalização`.

---

### Task 2: Fonte GitHub (repositórios de vagas) e extração de e-mail

**Files:**
- Create: `src/sources/githubRepos.ts`, `src/retry.ts`; Modify: `src/normalize.ts` (adiciona `extractEmail`)
- Test: `tests/sources/githubRepos.test.ts`, `tests/normalize.email.test.ts`, `tests/retry.test.ts`, `tests/fixtures/github-issues.json`

**Interfaces:**
- Consumes: `Vaga`, `vagaId`, `inferNivel`, `inferModalidade`, `REPOS_VAGAS`.
- Produces:
  - `extractEmail(texto: string): string | null`
  - `withRetry<T>(fn: () => Promise<T>, opts?: { tentativas?: number; baseMs?: number }): Promise<T>` (padrão 3 tentativas, repete só se o erro tem `status` 429 ou >= 500).
  - `fetchGithubVagas(desde: Date, fetchFn?: typeof fetch, onErro?: (fonte: string, e: unknown) => void): Promise<Vaga[]>` com `fonte: "github-repo"`. Usa `GET /repos/{repo}/issues?state=open&since=...&per_page=100`, ignora itens com `pull_request`, token opcional `GITHUB_TOKEN`.

- [ ] **Step 1: Fixture.** `tests/fixtures/github-issues.json` com 4 issues fictícias: uma com labels `Remoto` e `Júnior` e e-mail no corpo; uma `Presencial` em São Paulo; uma com `pull_request`; uma com e-mail ofuscado.
- [ ] **Step 2: Testes que falham:**

```ts
// normalize.email.test.ts
expect(extractEmail("Envie CV para rh@empresa.com.br ou vagas@empresa.com.br")).toBe("rh@empresa.com.br");
expect(extractEmail("contato: joao [at] empresa [dot] com")).toBe("joao@empresa.com");
expect(extractEmail("noreply@github.com e notifications@github.com")).toBeNull();
expect(extractEmail("sem email aqui")).toBeNull();

// githubRepos.test.ts (fetchFn mockado devolvendo a fixture para cada repo)
const vagas = await fetchGithubVagas(new Date("2026-10-01"), mockFetch);
expect(vagas.every(v => v.fonte === "github-repo")).toBe(true);
expect(vagas.find(v => v.titulo.includes("Júnior"))).toMatchObject({ nivel: "junior", modalidade: "remoto", emailContato: "rh@empresa-ficticia.com" });
expect(vagas.some(v => v.link.includes("/pull/"))).toBe(false);
// um repo retornando 500 duas vezes e depois 200 ainda produz vagas (withRetry)
// um repo retornando 404 não derruba os outros: a função retorna as vagas dos demais e lança nada

// retry.test.ts
// repete em 429 e 503, não repete em 400, desiste após 3
```

- [ ] **Step 3: Rodar** os testes. Esperado: FAIL.
- [ ] **Step 4: Implementar.** Labels mapeiam nível/modalidade primeiro; se ausentes, `inferNivel`/`inferModalidade` sobre título + corpo. `empresa`: texto entre `[` `]` no início do título, senão `"desconhecida"`. Erro de um repo (depois do `withRetry`) chama `onErro(repo, e)` e segue para o próximo.
- [ ] **Step 5: Rodar** `npm test`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat: fonte de vagas dos repositórios do GitHub`.

---

### Task 3: Autenticação Google e cliente Gmail

**Files:**
- Create: `scripts/google-auth.ts`, `src/clients/google.ts`, `src/clients/gmail.ts`
- Test: `tests/clients/gmail.test.ts`

**Interfaces:**
- Produces:
  - `makeGoogleClients(env = process.env): { gmail: gmail_v1.Gmail; sheets: sheets_v4.Sheets; drive: drive_v3.Drive }` a partir de `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`; lança erro com nome da variável faltando.
  - `type EmailBruto = { id: string; threadId: string; from: string; subject: string; date: Date; html: string; text: string }`
  - `interface GmailClient { buscar(query: string): Promise<EmailBruto[]>; criarRascunho(r: { para: string; assunto: string; corpo: string; anexo?: { nome: string; pdf: Buffer }; threadId?: string; inReplyTo?: string }): Promise<{ draftId: string; threadId: string }>; rascunhoExiste(draftId: string): Promise<boolean>; mensagensDaThread(threadId: string): Promise<{ deMim: boolean; data: Date; messageId: string }[]> }`
  - `makeGmailClient(api: gmail_v1.Gmail, meuEmail: string): GmailClient`

- [ ] **Step 1: `scripts/google-auth.ts`.** Fluxo OAuth local (loopback em `http://localhost:53682`), escopos da Global Constraints, imprime o refresh token. Sem teste; verificação manual pelo Pedro.
- [ ] **Step 2: Testes que falham** com `gmail_v1.Gmail` falso:

```ts
test("buscar decodifica base64url e separa html/text de multipart", ...)
test("criarRascunho monta MIME com anexo PDF e assunto UTF-8 (=?UTF-8?B?...?=)", ...)
test("criarRascunho com threadId envia In-Reply-To e References", ...)
test("rascunhoExiste retorna false em 404", ...)
test("mensagensDaThread marca deMim pelo header From", ...)
```

- [ ] **Step 3: Rodar.** Esperado: FAIL.
- [ ] **Step 4: Implementar.** MIME montado à mão (`multipart/mixed`, boundary aleatório), `raw` em base64url. Chamadas envolvidas em `withRetry`.
- [ ] **Step 5: Rodar** `npm test`. Esperado: PASS.
- [ ] **Step 6: Commit** `feat: auth Google e cliente Gmail`.

---

### Task 4: Parsers de alertas por e-mail e probe das fontes

**Files:**
- Create: `scripts/anonymize-fixture.ts`, `src/sources/gmail/linkedin.ts`, `src/sources/gmail/gupy.ts`, `src/sources/gmail/freeText.ts`, `src/sources/gmail/index.ts`, `scripts/probe-sources.ts`
- Test: `tests/sources/gmail/*.test.ts`, `tests/fixtures/email/linkedin-*.html`, `tests/fixtures/email/gupy-*.html`

**Interfaces:**
- Consumes: `EmailBruto`, `GmailClient.buscar`, `Vaga`, `vagaId`, `infer*`, `extractEmail`, `fetchGithubVagas`.
- Produces:
  - `parseLinkedinAlert(e: EmailBruto): Vaga[]` (`fonte: "gmail-linkedin"`)
  - `parseGupyAlert(e: EmailBruto): Vaga[]` (`fonte: "gmail-gupy"`)
  - `parseVagaManual(e: EmailBruto): Vaga[]` para assunto começando com `[vaga]`, sempre `fonte: "gmail-manual"`; título vem do assunto sem o prefixo, link é o primeiro URL do corpo.
  - `fetchGmailVagas(gmail: GmailClient, desde: Date, onErro?): Promise<Vaga[]>` roteia por remetente: `jobalerts-noreply@linkedin.com` e `jobs-noreply@linkedin.com` para LinkedIn; remetentes terminados em `@gupy.io` ou `@gupy.com.br` para Gupy; assunto `[vaga]` para manual. Query: `after:<epoch> (from:linkedin.com OR from:gupy.io OR from:gupy.com.br OR subject:"[vaga]")`.

- [ ] **Step 1: Coletar fixtures reais.** Usar o conector Gmail desta sessão (ou `.eml` exportado pelo Pedro) para pegar 2 alertas do LinkedIn e 2 da Gupy, salvar em `tests/fixtures/raw/` (ignorado pelo git), rodar `scripts/anonymize-fixture.ts` (troca nome, e-mail e telefone do Pedro por fictícios, remove parâmetros de rastreio, troca tokens longos por `X`) e salvar o resultado em `tests/fixtures/email/`. Conferir com `grep -i pedro tests/fixtures/email` que nada vazou. Se ainda não houver alertas na caixa, parar a task e avisar o Pedro.
- [ ] **Step 2: Testes que falham.** Para cada fixture: número exato de vagas extraídas (contado à mão na fixture), título, empresa e link da primeira vaga com valores literais tirados da fixture, `link` sem parâmetro de rastreio. Para `parseVagaManual`: e-mail com assunto `[vaga] Dev Jr` e corpo contendo um link e texto gera 1 vaga com `descricao` igual ao corpo. Para `fetchGmailVagas`: um e-mail de parser que lança erro chama `onErro` e não impede os outros.
- [ ] **Step 3: Rodar.** Esperado: FAIL.
- [ ] **Step 4: Implementar** com `cheerio`. Alertas trazem só título, empresa, local e link; `descricao` fica com o que o e-mail tiver (local + snippet). A pontuação lida com descrição curta (ver Task 6).
- [ ] **Step 5: `scripts/probe-sources.ts`.** Roda as duas fontes dos últimos 14 dias e imprime contagem por fonte e por nível/modalidade. Pedro roda localmente com `.env` e cola o resultado no PR.
- [ ] **Step 6: Rodar** `npm test`. Esperado: PASS.
- [ ] **Step 7: Commit** `feat: parsers de alertas do Gmail e probe das fontes`.

---

### Task 5: Filtro por regras fixas

**Files:**
- Create: `src/filter.ts`, `src/secrets.ts`, `examples/perfil.example.md`, `examples/curriculo.example.txt`
- Test: `tests/filter.test.ts`, `tests/secrets.test.ts`

**Interfaces:**
- Consumes: `Vaga`, `CIDADES_OK`.
- Produces:
  - `type Perfil = { markdown: string; termosExclusao: string[] }`
  - `carregarPerfil(env = process.env): Perfil` decodifica `PERFIL_MD` (base64); `termosExclusao` vem da linha `exclusao: a, b, c` dentro do markdown. `carregarCurriculo(env): string` decodifica `CURRICULO_TXT`. Sem as variáveis, usa os arquivos de `examples/` só se `NODE_ENV === "test"` ou `--dry-run`; senão lança erro.
  - `passaFiltro(v: Vaga, perfil: Perfil): { ok: true } | { ok: false; motivo: string }`
  - `filtrar(vagas: Vaga[], idsVistos: Set<string>, perfil: Perfil): { aprovadas: Vaga[]; descartadas: number }` (também deduplica dentro do próprio lote).

- [ ] **Step 1: Testes que falham:**

```ts
const base: Vaga = { /* remoto, junior, Brasil */ };
expect(passaFiltro(base, perfil).ok).toBe(true);
expect(passaFiltro({ ...base, modalidade: "presencial", local: "São Paulo, SP" }, perfil).ok).toBe(false);
expect(passaFiltro({ ...base, modalidade: "hibrido", local: "Ananindeua - PA" }, perfil).ok).toBe(true);
expect(passaFiltro({ ...base, modalidade: "presencial", local: "Santa Barbara do Para" }, perfil).ok).toBe(true); // sem acento
expect(passaFiltro({ ...base, nivel: "pleno" }, perfil).ok).toBe(false);
expect(passaFiltro({ ...base, nivel: "desconhecido" }, perfil).ok).toBe(true);
expect(passaFiltro({ ...base, titulo: "Tech Lead Node" }, perfil).ok).toBe(false); // termosExclusao
expect(passaFiltro({ ...base, local: "Lisboa, Portugal" }, perfil).ok).toBe(false);
expect(passaFiltro({ ...base, modalidade: "desconhecido", local: null }, perfil).ok).toBe(true); // deixa o Claude decidir
const r = filtrar([base, { ...base }], new Set(), perfil); expect(r.aprovadas).toHaveLength(1);
expect(filtrar([base], new Set([base.id]), perfil).aprovadas).toHaveLength(0);
```

"Fora do Brasil": `local` contém algum nome da lista `PAISES_FORA` em `config.ts` (`PAISES_FORA`: Portugal, Estados Unidos, USA, Argentina, México, Espanha, Canadá, Alemanha, Reino Unido, UK, Remote - US).

- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar** comparando sem acento e em minúsculas.
- [ ] **Step 4: Rodar** `npm test`. PASS.
- [ ] **Step 5: Commit** `feat: filtro por regras fixas e carregamento do perfil`.

---

### Task 6: Cliente Claude e pontuação

**Files:**
- Create: `src/clients/llm.ts`, `src/score.ts`
- Test: `tests/score.test.ts`

**Interfaces:**
- Consumes: `Vaga`, `Pontuacao`, `Perfil`, `MODELO_NOTA`, `withRetry`.
- Produces:
  - `interface LlmClient { gerar(r: { modelo: string; sistema: string; usuario: string; maxTokens: number }): Promise<string> }`
  - `makeAnthropicClient(apiKey = process.env.ANTHROPIC_API_KEY): LlmClient` (carregar a skill `claude-api` antes de escrever)
  - `pontuar(llm: LlmClient, v: Vaga, perfil: Perfil, curriculo: string): Promise<Pontuacao>`; lança `ErroPontuacao` após 2 respostas inválidas.

- [ ] **Step 1: Testes que falham** com `LlmClient` falso:

```ts
test("aceita JSON válido", async () => {
  llm.respostas = ['{"nota":72,"motivo":"Stack bate","atende":["React"],"falta":["Docker"]}'];
  expect(await pontuar(llm, vaga, perfil, cv)).toEqual({ nota: 72, motivo: "Stack bate", atende: ["React"], falta: ["Docker"] });
  expect(llm.chamadas[0].modelo).toBe("claude-haiku-5-5");
});
test("aceita JSON dentro de bloco ```json", ...);
test("nota fora de 0..100 ou string é inválida e repete uma vez", async () => {
  llm.respostas = ['{"nota":"alta"}', '{"nota":150,"motivo":"x","atende":[],"falta":[]}'];
  await expect(pontuar(...)).rejects.toThrow(ErroPontuacao); expect(llm.chamadas).toHaveLength(2);
});
test("prompt inclui currículo, perfil e a regra de descrição curta", ...); // usuario contém cv e perfil.markdown
```

- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** Validar com `zod` (`nota: z.number().int().min(0).max(100)`). O prompt de sistema diz: responder só JSON; se a descrição for curta (só título e local), pontuar pelo título e nível e escrever no `motivo` "descrição curta"; penalizar estágio cuja duração prevista ultrapasse a formatura informada no perfil; penalizar requisitos de pleno/sênior.
- [ ] **Step 4: Rodar** `npm test`. PASS.
- [ ] **Step 5: Commit** `feat: pontuação de vagas com Claude`.

---

### Task 7: Repositório da planilha

**Files:**
- Create: `src/clients/sheets.ts`, `scripts/setup-sheet.ts`
- Test: `tests/clients/sheets.test.ts`

**Interfaces:**
- Consumes: `Vaga`, `Pontuacao`.
- Produces (em `src/types.ts`):
  - `type Decisao = "aprovar" | "descartar" | ""`
  - `type StatusFila = "novo" | "semana cheia" | "aguardando semana" | "escrever manualmente" | "processada"`
  - `type FilaRow = Vaga & Partial<Pontuacao> & { mensagem: string; decisao: Decisao; status: StatusFila }`
  - `type StatusCand = "rascunho criado" | "aplicar manualmente" | "enviada" | "respondeu" | "entrevista" | "recusada" | "sem resposta"`
  - `type CandidaturaRow = { id: string; data: string; empresa: string; titulo: string; canal: "email" | "formulario"; status: StatusCand; idRascunho: string; idThread: string; followupEm: string; idRascunhoFollowup: string }`
  - `type LogRow = { data: string; job: "collect" | "send"; fonte: string; coletadas: number; passaramFiltro: number; acimaCorte: number; erro: string }`
- Produces (em `src/clients/sheets.ts`):
  - `interface SheetsRepo { lerFila(): Promise<FilaRow[]>; adicionarFila(r: FilaRow[]): Promise<void>; atualizarFila(id: string, p: Partial<FilaRow>): Promise<void>; lerCandidaturas(): Promise<CandidaturaRow[]>; adicionarCandidatura(r: CandidaturaRow): Promise<void>; atualizarCandidatura(id: string, p: Partial<CandidaturaRow>): Promise<void>; log(r: LogRow): Promise<void>; idsVistos(): Promise<Set<string>> }`
  - `makeSheetsRepo(api: sheets_v4.Sheets, sheetId: string): SheetsRepo`

- [ ] **Step 1: Testes que falham** com `sheets_v4.Sheets` falso em memória:

```ts
test("cabeçalho define a coluna: colunas reordenadas pelo Pedro continuam funcionando", ...);
test("atualizarFila acha a linha pelo id mesmo com linhas ordenadas por nota", ...);
test("atualizarFila com id inexistente lança erro", ...);
test("idsVistos junta Fila e Candidaturas", ...);
test("falta/atende são gravados como texto separado por '; ' e lidos de volta como array", ...);
test("célula de decisão com 'Aprovar ' (maiúscula/espaço) é lida como 'aprovar'", ...);
```

- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** Ler a linha 1 de cada aba para mapear nome de coluna para índice; atualizar só as células alteradas com `values.batchUpdate`. `scripts/setup-sheet.ts` cria as abas Fila, Candidaturas, Log com os cabeçalhos da spec e validação de dados (lista suspensa) na coluna `decisao`.
- [ ] **Step 4: Rodar** `npm test`. PASS.
- [ ] **Step 5: Commit** `feat: repositório da planilha`.

---

### Task 8: Checagem de mensagem e composição

**Files:**
- Create: `src/messageCheck.ts`, `src/compose.ts`, `templates/base.md`, `templates/proibidas.txt`
- Test: `tests/messageCheck.test.ts`, `tests/compose.test.ts`

**Interfaces:**
- Consumes: `LlmClient`, `Vaga`, `Pontuacao`, `Perfil`, `MODELO_TEXTO`, `MAX_PALAVRAS`.
- Produces:
  - `checkMessage(msg: string, proibidas: string[]): { ok: true } | { ok: false; motivo: string }`
  - `carregarProibidas(): string[]` (lê `templates/proibidas.txt`, uma por linha, `#` é comentário)
  - `comporMensagem(llm: LlmClient, v: Vaga, p: Pontuacao, perfil: Perfil, curriculo: string): Promise<{ mensagem: string } | { mensagem: ""; status: "escrever manualmente" }>`

`templates/base.md` tem os marcadores `{{saudacao}}`, `{{vaga}}`, `{{empresa}}`, `{{trecho}}`, `{{disponibilidade}}`, `{{portfolio}}`. `{{disponibilidade}}` vira "Posso começar em poucas semanas." para júnior e "" para estágio. O texto base é um rascunho do implementador e vai para aprovação do Pedro no PR. `proibidas.txt` começa com: apaixonado, alavancar, sinergia, transformador, fluido, robusto, otimizar, faço a diferença, U+2014.

- [ ] **Step 1: Testes que falham:**

```ts
expect(checkMessage("palavra ".repeat(121), []).ok).toBe(false);
expect(checkMessage("palavra ".repeat(120), []).ok).toBe(true);
expect(checkMessage("Sou Apaixonado por código", ["apaixonado"]).ok).toBe(false); // case-insensitive
expect(checkMessage("trabalho com React — e Node", ["—"]).ok).toBe(false);
// compose
test("usa claude-sonnet-5-5 e preenche o template", ...);       // mensagem contém empresa, título e trecho
test("júnior inclui disponibilidade, estágio não", ...);
test("trecho reprovado gera de novo uma vez", ...);              // 2 chamadas, segunda ok
test("reprovado duas vezes retorna escrever manualmente", ...);
```

- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** O prompt do Sonnet pede 2 a 3 frases ligando um projeto ou experiência concreta do currículo a um item de `p.atende`, sem elogio à empresa, sem as palavras proibidas (lista enviada no prompt). A checagem roda na mensagem final montada, não só no trecho.
- [ ] **Step 4: Rodar** `npm test`. PASS.
- [ ] **Step 5: Commit** `feat: composição e checagem da mensagem`.

---

### Task 9: Teto semanal, Drive e mailer

**Files:**
- Create: `src/weeklyCap.ts`, `src/clients/drive.ts`, `src/mailer.ts`, `templates/followup.md`
- Test: `tests/weeklyCap.test.ts`, `tests/mailer.test.ts`

**Interfaces:**
- Consumes: `GmailClient`, `CandidaturaRow`, `FilaRow`, `TZ`, `TETO_SEMANAL`, `envioDireto`.
- Produces:
  - `semanaDe(d: Date): string` (segunda da semana em Belém, `yyyy-MM-dd`)
  - `vagasRestantesNaSemana(cands: CandidaturaRow[], agora: Date): number`
  - `downloadPdf(drive: drive_v3.Drive, fileId: string): Promise<Buffer>`
  - `criarRascunhoCandidatura(gmail: GmailClient, row: FilaRow, pdf: Buffer): Promise<{ draftId: string; threadId: string }>` (assunto: `Candidatura: {titulo}`; anexo `curriculo.pdf`)
  - `criarRascunhoFollowup(gmail: GmailClient, c: CandidaturaRow, ultimaMsgId: string): Promise<{ draftId: string }>`

Com `envioDireto()` verdadeiro, `criarRascunhoCandidatura` cria o rascunho e em seguida chama `gmail.enviarRascunho(draftId)`; adicionar `enviarRascunho(draftId: string): Promise<void>` à interface `GmailClient` (Task 3) e a implementação com `users.drafts.send`. Padrão continua `false`.

- [ ] **Step 1: Testes que falham:**

```ts
expect(semanaDe(new Date("2026-11-08T22:30:00-03:00"))).toBe("2026-11-02"); // domingo 22h30 Belém = segunda UTC
expect(semanaDe(new Date("2026-11-09T00:10:00-03:00"))).toBe("2026-11-09");
// 30 candidaturas na semana atual -> 0 restantes; 29 + 5 da semana passada -> 1
// mailer: assunto, destinatário e anexo; follow-up responde na thread (threadId e inReplyTo preenchidos)
// envioDireto false: enviarRascunho não é chamado; true: é chamado com o draftId
```

- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar** com `date-fns-tz`. Só conta para o teto candidatura com `data` na semana e canal qualquer.
- [ ] **Step 4: Rodar** `npm test`. PASS.
- [ ] **Step 5: Commit** `feat: teto semanal e criação de rascunhos`.

---

### Task 10: Job collect e workflow

**Files:**
- Create: `src/jobs/collect.ts`, `.github/workflows/collect.yml`
- Test: `tests/jobs/collect.test.ts`

**Interfaces:**
- Consumes: tudo acima.
- Produces: `runCollect(deps: { gmail: GmailClient; repo: SheetsRepo; llm: LlmClient; fetchFn: typeof fetch; perfil: Perfil; curriculo: string; agora: Date; desde: Date }): Promise<{ coletadas: number; filaNova: number }>`; entrypoint no fim do arquivo monta as dependências reais quando executado direto, com `--dry-run` usando `SHEET_ID_TEST`. `desde` = 26 horas antes de `agora` (sobreposição; a deduplicação resolve).

- [ ] **Step 1: Testes que falham** com todos os clientes falsos:

```ts
test("vagas abaixo de 60 não entram na Fila, mas entram na contagem do Log", ...);
test("vaga já vista não chama o Claude", ...);
test("semana cheia: grava status 'semana cheia' sem chamar o Sonnet", ...); // 30 aprovações pendentes + candidaturas da semana >= 30
test("erro numa fonte vai para o Log e a outra fonte segue", ...);
test("ErroPontuacao numa vaga vai para o Log e as outras seguem", ...);
test("Log tem uma linha por fonte com coletadas, passaramFiltro e acimaCorte", ...);
```

"Semana cheia" = `vagasRestantesNaSemana(cands) - linhas da Fila com decisao 'aprovar' e status != 'processada' <= 0`.

- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: `collect.yml`.** `schedule: cron "40 10 * * *"` e `workflow_dispatch`; Node 20; `npm ci`; `npm run collect`; secrets da spec como env.
- [ ] **Step 5: Rodar** `npm test && npm run typecheck`. PASS.
- [ ] **Step 6: Commit** `feat: job de coleta`.

---

### Task 11: Job send e workflow

**Files:**
- Create: `src/jobs/send.ts`, `.github/workflows/send.yml`
- Test: `tests/jobs/send.test.ts`

**Interfaces:**
- Consumes: `SheetsRepo`, `GmailClient`, `mailer`, `weeklyCap`, `downloadPdf`.
- Produces: `runSend(deps: { gmail: GmailClient; repo: SheetsRepo; pdf: () => Promise<Buffer>; agora: Date }): Promise<{ rascunhos: number; manuais: number; followups: number }>`; entrypoint como no collect.

- [ ] **Step 1: Testes que falham:**

```ts
test("aprovada com e-mail vira rascunho com a mensagem editada da Fila, sem chamar LLM", ...); // deps não têm llm
test("aprovada sem e-mail vira 'aplicar manualmente'", ...);
test("respeita o teto: excedente fica 'aguardando semana' na Fila", ...);
test("rodar duas vezes não cria rascunho duplicado", ...); // segunda execução: 0 rascunhos
test("rascunho que sumiu e thread com mensagem deMim vira 'enviada'", ...);
test("enviada há 7 dias sem resposta de terceiro e sem followup cria rascunho de follow-up", ...);
test("enviada há 7 dias com resposta de terceiro vira 'respondeu' e não cria follow-up", ...);
test("linha com decisao 'aprovar' e mensagem vazia em e-mail é pulada e logada", ...);
test("PDF só é baixado se houver ao menos um rascunho a criar", ...);
```

- [ ] **Step 2: Rodar.** FAIL.
- [ ] **Step 3: Implementar.** Ordem: (1) atualizar status de candidaturas existentes (enviada/respondeu); (2) follow-ups; (3) novas aprovadas, até o teto, em ordem de nota decrescente. Marcar a linha da Fila como `processada` depois de gravar em Candidaturas.
- [ ] **Step 4: `send.yml`.** `schedule: cron "17 11-23/3 * * *"` e `workflow_dispatch`.
- [ ] **Step 5: Rodar** `npm test && npm run typecheck`. PASS.
- [ ] **Step 6: Commit** `feat: job de envio e follow-up`.

---

### Task 12: README de configuração

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** README com: o que o projeto faz (um parágrafo, com o diagrama da spec), como gerar credencial OAuth no Google Cloud (tipo "App para computador", tela de consentimento em modo teste com o próprio e-mail), rodar `scripts/google-auth.ts`, rodar `scripts/setup-sheet.ts`, lista de secrets com como gerar o base64 (`base64 -w0 perfil.md`), como rodar `probe-sources` e `--dry-run`, e a nota de que o projeto não faz scraping nem preenche formulários.
- [ ] **Step 2: Verificação.** `npm test && npm run typecheck` passando; `grep -rn $'—' src templates README.md` sem resultado.
- [ ] **Step 3: Commit** `docs: README de configuração`.

---

## Ordem e dependências

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. A Task 4 depende de haver alertas reais no Gmail do Pedro; se não houver, as Tasks 5 a 9 podem andar antes dela, e o Step 1 da Task 4 volta depois.
