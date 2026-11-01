# job-hunter: design

Data: 2026-11-01
Autor: Pedro (pedrozxx)

## Objetivo

Automatizar a parte repetitiva da busca de emprego: achar vagas, filtrar, pontuar a compatibilidade, preparar a mensagem de candidatura e acompanhar o follow-up. Toda candidatura passa pela aprovação manual do Pedro antes de sair.

Critério de sucesso: chegar a 30 candidaturas aprovadas por semana, gastando no máximo uns 15 minutos por dia na revisão, e medir a taxa de resposta para ajustar currículo, corte e fontes.

Fica fora do escopo: automatizar formulários (Gupy, LinkedIn Easy Apply, ATS em geral), fazer scraping do LinkedIn ou de qualquer site de vagas e enviar candidatura sem aprovação.

## Contexto do candidato

- Hoje é estagiário full stack, com estágio até junho de 2027.
- Mira vagas de estágio e de júnior. Para júnior, aceita sair do estágio antes do fim, então a mensagem informa disponibilidade para começar em poucas semanas.
- Só Brasil. Prioriza remoto. Presencial ou híbrido só na região metropolitana de Belém (PA).
- O portfólio citado nas mensagens é o do repositório `pedrozxx/portfolio-dev`.

## Arquitetura

O repositório `pedrozxx/job-hunter` é público e escrito em TypeScript com Node 20. Ele roda no GitHub Actions, sem servidor e sem banco. Todo o estado fica numa planilha Google.

```
fontes ──> normalização ──> regras fixas ──> pontuação (Haiku) ──> corte >= 60
                                                                       │
                                                       trecho sob medida (Sonnet)
                                                                       │
                                                             aba "Fila" (revisão)
                                                                       │
                                                         aprovado pelo Pedro
                                                       ┌───────────────┴──────────────┐
                                                 tem e-mail                       formulário
                                          rascunho no Gmail                 "aplicar manualmente"
                                                       │
                                          7 dias sem resposta ──> rascunho de follow-up
```

### Módulos

Cada módulo tem uma responsabilidade e uma interface pequena.

| Módulo | Responsabilidade | Entrada | Saída |
|---|---|---|---|
| `sources/gmailAlerts` | Ler e-mails de alerta (LinkedIn e Gupy na v1) e extrair vagas | Gmail API, query por remetente e data | `Vaga[]` |
| `sources/githubRepos` | Ler issues abertas de frontendbr/vagas, backend-br/vagas e react-brasil/vagas | API REST do GitHub | `Vaga[]` |
| `normalize` | Converter tudo para o tipo `Vaga` e gerar o `id` (hash do link normalizado) | dados brutos | `Vaga` |
| `filter` | Aplicar as regras fixas e remover duplicatas | `Vaga[]` e ids já vistos | `Vaga[]` |
| `score` | Pontuar a vaga com o Claude Haiku | `Vaga`, perfil, currículo | `Pontuacao` |
| `compose` | Gerar o trecho sob medida com o Claude Sonnet e montar a mensagem | `Vaga`, `Pontuacao`, texto base | `Mensagem` |
| `messageCheck` | Validar tamanho e palavras proibidas | `Mensagem` | ok ou motivo |
| `sheets` | Ler e escrever as abas Fila, Candidaturas e Log | Sheets API | |
| `mailer` | Criar o rascunho de candidatura e o de follow-up | Gmail API, PDF do Drive | id do rascunho |
| `jobs/collect` | Orquestrar fontes, filtro, pontuação, composição e escrita na Fila | | |
| `jobs/send` | Processar as aprovadas, aplicar o teto semanal e criar os follow-ups | | |

### Tipos principais

```ts
type Vaga = {
  id: string;            // sha1 do link normalizado
  fonte: "gmail-linkedin" | "gmail-gupy" | "github-repo";
  titulo: string;
  empresa: string;
  local: string | null;
  modalidade: "remoto" | "hibrido" | "presencial" | "desconhecido";
  nivel: "estagio" | "junior" | "pleno" | "senior" | "desconhecido";
  descricao: string;
  link: string;
  emailContato: string | null;
  coletadaEm: string;    // ISO
};

type Pontuacao = {
  nota: number;          // 0 a 100
  motivo: string;        // uma frase
  atende: string[];
  falta: string[];
};
```

## Fontes (v1)

1. **Alertas no Gmail.** O Pedro configura alertas de vaga no LinkedIn e na Gupy, que chegam no Gmail dele. Cada remetente tem um parser próprio, porque os formatos de e-mail são diferentes. O parser só lê o e-mail. Ele não abre a página do LinkedIn. Uma vaga achada fora dos alertas pode ser mandada para o próprio e-mail com o assunto começando por `[vaga]` e entra por um parser de texto livre.
2. **Repositórios de vagas no GitHub.** As issues abertas criadas desde a última coleta são lidas, e as labels viram `nivel` e `modalidade`. O e-mail de contato é extraído do corpo da issue quando existir.

Cada fonte roda isolada. Quando uma falha, o erro vai para a aba Log e as outras seguem.

A primeira tarefa da implementação é um script `scripts/probe-sources.ts`, que mostra quantas vagas cada fonte retorna nos últimos 14 dias. Ele serve para validar o volume antes de construir o resto. Se depois de duas semanas de uso as duas fontes não somarem umas 60 vagas por semana acima do corte, a lista de fontes é revista. A Gupy direta é a próxima candidata.

## Filtro por regras fixas

Uma vaga passa se:
- for do Brasil;
- a modalidade for `remoto`, ou se o local for Belém, Ananindeua, Marituba, Benevides ou Santa Bárbara do Pará;
- o nível for `estagio`, `junior` ou `desconhecido` (no caso de `desconhecido`, quem decide é o Claude);
- o título não tiver termos de exclusão definidos no perfil (por exemplo "sênior", "pleno", "tech lead");
- o `id` ainda não aparecer em nenhuma aba.

## Pontuação e mensagem

**Pontuação (Claude Haiku).** O prompt leva o currículo em texto, o `perfil.md` (stack, preferências, faixa salarial, motivos de descarte) e a lista de projetos com uma linha cada. A resposta é um JSON que segue o tipo `Pontuacao`. Se o JSON vier inválido, a chamada é repetida uma vez e, se falhar de novo, a vaga vai para o Log como erro.

**Corte.** Só vagas com nota de 60 para cima chegam à Fila. O valor fica em `config.ts`.

**Mensagem.** É montada com o texto base aprovado pelo Pedro (`templates/base.md`), mais um trecho de 2 a 3 frases gerado pelo Claude Sonnet, mais a assinatura com o link do portfólio. O trecho precisa ligar um projeto ou experiência concreta a um requisito da vaga. Para júnior, inclui a disponibilidade para começar em poucas semanas.

**Checagem (`messageCheck`).**
- Até 120 palavras no total.
- Nenhuma palavra ou expressão da lista proibida (`templates/proibidas.txt`, que começa com: apaixonado, alavancar, sinergia, transformador, fluido, robusto, otimizar, "faço a diferença" e o caractere travessão, U+2014).
- Se a mensagem reprovar, o trecho é gerado de novo uma vez. Se reprovar outra vez, a linha entra na Fila com a mensagem em branco e o status `escrever manualmente`.

## Planilha

**Aba Fila:** id, coletada_em, fonte, empresa, título, nível, modalidade, local, link, e-mail de contato, nota, motivo, falta, mensagem (editável), decisão (`aprovar` / `descartar` / vazio) e status.

**Aba Candidaturas:** id, data, empresa, título, canal (`email` / `formulario`), status (`rascunho criado` / `aplicar manualmente` / `enviada` / `respondeu` / `entrevista` / `recusada` / `sem resposta`), id_rascunho, id_thread, followup_em e id_rascunho_followup.

**Aba Log:** data, job, fonte, coletadas, passaram_filtro, acima_corte e erro.

O Pedro atualiza à mão os status `respondeu`, `entrevista` e `recusada`. O status `enviada` é marcado automaticamente pelo job `send` quando o rascunho deixa de existir e aparece uma mensagem enviada na thread.

## Jobs e agendamento

- **collect:** roda uma vez por dia às 7h40 no horário de Belém (`40 10 * * *` em UTC). Também pode ser disparado manualmente (`workflow_dispatch`).
- **send:** roda a cada 3 horas entre 8h e 20h no horário de Belém (`17 11-23/3 * * *` em UTC, ou seja 8h17, 11h17, 14h17, 17h17 e 20h17), e também pode ser disparado manualmente. O que ele faz:
  1. pega as linhas da Fila com decisão `aprovar` que ainda não estão em Candidaturas;
  2. respeita o teto de 30 candidaturas por semana (de segunda a domingo, contando a aba Candidaturas), deixando o excedente na Fila como `aguardando semana`;
  3. quando a vaga tem e-mail, cria o rascunho no Gmail com o currículo em PDF em anexo; quando não tem, registra como `aplicar manualmente`;
  4. para candidaturas `enviada` com 7 dias sem resposta na thread e sem follow-up criado, cria um rascunho de follow-up curto respondendo na mesma thread.

Quando a Fila tem 30 aprovações pendentes na semana, o `collect` continua coletando, mas marca as vagas novas como `semana cheia` e não chama o Sonnet. Assim nenhum token é gasto com mensagem que não vai sair.

Os rascunhos ficam ativos por padrão. A flag `ENVIO_DIRETO=true` envia direto, sem passar por rascunho, e começa desligada.

## Segredos e privacidade

O repositório é público e só guarda código, testes e exemplos com dados fictícios (`examples/perfil.example.md`, `examples/curriculo.example.txt`).

Os GitHub Secrets são estes:
- `ANTHROPIC_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (OAuth com escopos `gmail.readonly`, `gmail.compose`, `spreadsheets` e `drive.readonly`)
- `SHEET_ID`
- `CURRICULO_PDF_DRIVE_ID`
- `PERFIL_MD` e `CURRICULO_TXT`, em base64

O refresh token é gerado uma única vez com `scripts/google-auth.ts`, rodando localmente. Como o Gmail é pessoal, não dá para usar conta de serviço.

As fixtures de teste com e-mails reais passam por `scripts/anonymize-fixture.ts` antes do commit, para trocar nomes, e-mails e links de rastreio.

## Tratamento de erros

- Cada fonte, cada chamada ao Claude e cada escrita no Google tem um `try/catch` próprio, com o erro registrado no Log. Uma falha isolada não derruba o job.
- O processo é idempotente. A vaga é identificada pelo `id`, e o rascunho só é criado quando `id_rascunho` está vazio. Rodar um job duas vezes não gera duplicata.
- Para erros 429 ou 5xx do Claude e do Google, há até 3 tentativas com espera exponencial.
- Se o job inteiro falhar, o GitHub Actions avisa por e-mail.

## Testes

Os testes usam o Vitest.
- **Parsers de e-mail:** fixtures anonimizadas de alertas reais do LinkedIn e da Gupy, comparadas com o `Vaga[]` esperado.
- **Parser das issues do GitHub:** fixtures com respostas da API.
- **filter, normalize (normalização de link e hash), messageCheck e teto semanal:** testes unitários.
- **score e compose:** cliente do Claude mockado. Cobrem JSON inválido, nova tentativa e mensagem reprovada duas vezes.
- **sheets e mailer:** cliente do Google mockado. Cobrem a idempotência do rascunho.
- **Modo `--dry-run`:** usa uma planilha de teste (`SHEET_ID_TEST`) e nunca cria rascunho.

O CI roda `typecheck` e `test` em todo push.

## Decisões em aberto, com responsável

- Volume real das fontes: confirmado pelo `probe-sources.ts` (implementação).
- Data de conclusão da faculdade do Pedro, porque vaga de estágio exige matrícula ativa. Se a formatura for perto de junho de 2027, o filtro passa a descartar estágios que comecem depois dessa data (Pedro).
- Texto base da mensagem: o Pedro aprova o rascunho de `templates/base.md` antes do primeiro `send` real.

## Tarefas do Pedro antes da implementação

1. Criar o repositório público `pedrozxx/job-hunter`, vazio.
2. Criar alertas de vaga no LinkedIn e na Gupy (estágio e júnior; desenvolvedor, full stack, front-end e back-end; remoto e Belém), todos chegando no Gmail.
3. Ter o currículo atualizado em PDF no Drive e uma versão em texto.
