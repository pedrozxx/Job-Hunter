# job-hunter

Um pipeline em TypeScript que roda no GitHub Actions e cuida da parte repetitiva da busca de emprego. Ele junta vagas de duas fontes (alertas de vaga que chegam no Gmail e issues dos repositórios de vagas do GitHub), tira o que não serve com regras fixas, pede para o Claude dar uma nota de compatibilidade e, para o que passa do corte, escreve uma mensagem curta de candidatura. Tudo cai numa planilha Google. Eu reviso, marco `aprovar` ou `descartar`, e só então o projeto cria um rascunho no Gmail com o currículo em PDF. Nada sai sem a minha aprovação.

Não tem servidor nem banco: o estado fica na planilha. Também não tem scraping de LinkedIn ou de qualquer site de vagas, e o projeto não preenche formulário (Gupy, Easy Apply, ATS em geral). Para vaga sem e-mail de contato, a linha só fica marcada como `aplicar manualmente`.

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

Dois workflows fazem o trabalho. O `collect` roda todo dia às 7h40 no horário de Belém. O `send` roda a cada 3 horas, das 8h17 às 20h17, cria os rascunhos das vagas aprovadas (até 30 por semana) e os follow-ups de 7 dias. Os dois também podem ser disparados na mão pela aba Actions. O CI roda `typecheck` e `test` a cada push.

## O que você precisa antes

- Node 22 ou mais novo (o `package.json` exige `>=22` e os workflows usam Node 22). Não use Node 20.
- Uma conta Gmail pessoal, uma chave da API da Anthropic e o currículo em PDF no Google Drive.
- Um fork ou cópia deste repositório no seu GitHub, para cadastrar os secrets.

```bash
npm ci
npm test
npm run typecheck
```

## 1. Credencial OAuth no Google Cloud

Como o Gmail é pessoal, não dá para usar conta de serviço. O caminho é OAuth.

1. No Google Cloud Console, crie um projeto e ative as APIs do Gmail, do Google Sheets e do Google Drive.
2. Em "Tela de consentimento OAuth", preencha o básico (nome do app e seu e-mail de contato) e clique em "Publicar app", até o status ficar "Em produção". Não precisa de verificação do Google para uso pessoal. Não deixe em "Testando", porque nesse modo o refresh token expira em 7 dias.
3. Em "Credenciais", crie um ID do cliente OAuth do tipo "App para computador". Guarde o client id e o client secret.

O token gerado vale para os escopos `gmail.readonly`, `gmail.compose`, `spreadsheets` e `drive.readonly`. Nenhum deles envia e-mail sozinho: o `gmail.compose` cria rascunhos.

## 2. Gerar o refresh token

Rode uma vez, na sua máquina:

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npx tsx scripts/google-auth.ts
```

O script abre um servidor local na porta 53682 e imprime uma URL de autorização. Abra no navegador. Na primeira autorização o Google mostra "app não verificado": clique em "Avançado" e continue, já que só você usa o app. Autorize, e o terminal mostra uma linha `GOOGLE_REFRESH_TOKEN=...`. Esse valor vai para os secrets. Se o Google não devolver o refresh token, revogue o acesso do app na sua conta Google e rode de novo.

O refresh token de um app em produção não tem a expiração de 7 dias. Se o app ficar em "Testando", o token expira e os jobs começam a falhar com `invalid_grant`. Nesse caso, publique o app, gere o token de novo e atualize o secret `GOOGLE_REFRESH_TOKEN`.

## 3. Criar a planilha

Crie uma planilha Google em branco e copie o id dela (o trecho grande da URL, entre `/d/` e `/edit`). Depois rode:

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... SHEET_ID=... npx tsx scripts/setup-sheet.ts
```

Isso cria as abas Fila, Candidaturas e Log com os cabeçalhos e o menu de `decisao` (`aprovar` / `descartar`). Pode rodar de novo sem medo, ele só cria o que falta.

Se quiser usar o `--dry-run` (veja mais abaixo), crie uma segunda planilha, rode o mesmo comando com o id dela e guarde esse id como `SHEET_ID_TEST`.

## 4. Perfil, currículo e mensagem base

Os arquivos pessoais não ficam no repositório, que é público. Eles vão como secrets em base64. Os exemplos em `examples/perfil.example.md` e `examples/curriculo.example.txt` mostram o formato.

O `perfil.md` tem a stack, as preferências, a formatura prevista e uma linha de exclusão, no formato `exclusao: senior, sênior, pleno, tech lead`. As vagas com algum desses termos no título são descartadas antes de chamar o Claude.

Gere o base64 assim (no macOS, use `base64 -i perfil.md`):

```bash
base64 -w0 perfil.md
base64 -w0 curriculo.txt
```

O currículo em PDF fica no Drive. O secret `CURRICULO_PDF_DRIVE_ID` é o id desse arquivo (o trecho da URL de compartilhamento entre `/d/` e `/view`).

Revise o `templates/base.md` antes do primeiro envio real. É o texto base de toda candidatura, ainda é um rascunho, e a ideia é você aprovar cada frase dele. O `templates/followup.md` é o texto do follow-up, e o `templates/proibidas.txt` lista as palavras que a checagem não deixa passar (uma por linha). A mensagem final tem no máximo 120 palavras.

## 5. Secrets e variáveis

Em Settings, Secrets and variables, Actions, cadastre estes secrets:

| Secret | O que é |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Da credencial OAuth do passo 1 |
| `GOOGLE_REFRESH_TOKEN` | Do passo 2 |
| `SHEET_ID` | Id da planilha do passo 3 |
| `CURRICULO_PDF_DRIVE_ID` | Id do currículo em PDF no Drive (usado pelo `send`) |
| `PERFIL_MD` | `perfil.md` em base64 |
| `CURRICULO_TXT` | Versão em texto do currículo, em base64 |
| `MEU_EMAIL` | Seu endereço do Gmail, para o projeto reconhecer o que é seu nas threads |
| `PORTFOLIO_URL` | Link do portfólio que aparece na assinatura da mensagem |
| `NOME_CANDIDATO` | Seu nome, usado na assinatura |

O `GITHUB_TOKEN` os workflows já recebem sozinhos, não precisa cadastrar. Ele só serve para a leitura das issues não esbarrar no limite da API.

Para rodar na sua máquina, coloque as mesmas variáveis num arquivo `.env` na raiz (ele já está no `.gitignore`). Além das de cima, o `--dry-run` usa `SHEET_ID_TEST`.

## 6. Conferir as fontes e testar sem risco

Antes de confiar no pipeline, veja quantas vagas cada fonte entrega nos últimos 14 dias:

```bash
npx tsx --env-file=.env scripts/probe-sources.ts
```

Ele imprime as contagens por fonte, nível e modalidade, mais os erros. Precisa de `MEU_EMAIL` e das três variáveis `GOOGLE_*` no `.env`.

Depois, um ensaio completo:

```bash
npx tsx --env-file=.env src/jobs/collect.ts --dry-run
npx tsx --env-file=.env src/jobs/send.ts --dry-run
```

No `--dry-run` os jobs gravam na planilha de teste (`SHEET_ID_TEST`), usam os arquivos de `examples/` quando `PERFIL_MD` e `CURRICULO_TXT` não existem, e o `send` nunca cria rascunho de verdade: ele só registra o que criaria. O `collect` ainda chama o Claude, então precisa da `ANTHROPIC_API_KEY`.

Os comandos normais são `npm run collect` e `npm run send`.

## Como usar no dia a dia

O `collect` coloca as vagas acima da nota 60 na aba Fila, já com a mensagem sugerida na coluna `mensagem`. Você lê, edita a mensagem se quiser e marca `aprovar` ou `descartar` na coluna `decisao`. No próximo `send`, as aprovadas viram rascunho no Gmail (com o PDF anexado) ou, sem e-mail de contato, ficam como `aplicar manualmente` na aba Candidaturas. Você abre o rascunho e envia.

Alguns status que aparecem na coluna `status` da Fila:

- `semana cheia`: já havia 30 aprovações na semana quando a vaga foi coletada, então o Sonnet nem foi chamado e a mensagem está em branco.
- `aguardando semana`: aprovada, mas o teto de 30 por semana (segunda a domingo) já foi atingido. Entra na semana seguinte.
- `escrever manualmente`: a mensagem reprovou duas vezes na checagem, então escreva você mesmo.
- `processada`: a candidatura já foi tratada.
- `enviando`: veja logo abaixo.

Na aba Candidaturas o `send` marca `enviada` sozinho quando o rascunho some e há uma mensagem sua na thread, e `respondeu` quando alguém responde. Depois de 7 dias sem resposta, ele cria um rascunho de follow-up na mesma thread. Os status `entrevista`, `recusada` e `sem resposta` você atualiza à mão.

### Linha presa em "enviando" ou "pendente"

Antes de mexer no Gmail, o `send` grava uma marca na planilha, para nunca duplicar um rascunho se algo falhar no meio do caminho. Quando falha mesmo, a marca fica e o job avisa na aba Log.

- `enviando` na Fila: a linha foi reservada, mas não chegou a ser registrada em Candidaturas. O `send` não tenta de novo. Abra o Gmail, olhe os Rascunhos e os Enviados e procure a mensagem daquela vaga. Se ela existe, crie a linha em Candidaturas à mão (ou só marque a Fila como `processada`). Se não existe, apague o `enviando` da coluna `status` e o próximo `send` tenta de novo.
- `pendente` em `id_rascunho_followup` (aba Candidaturas): o rascunho de follow-up pode ter sido criado sem o id ter sido gravado. Confira os Rascunhos. Se o follow-up está lá, cole o id do rascunho na célula ou deixe `pendente` mesmo, só para ele não ser recriado. Se não está, apague a célula e o `send` cria de novo.

## Envio direto

A variável `ENVIO_DIRETO` vem desligada. Com ela ligada (`ENVIO_DIRETO=true`), o projeto manda a candidatura direto em vez de deixar rascunho. Ela não está ligada no `.github/workflows/send.yml`. Para ativar, adicione uma linha no bloco `env` do passo `npm run send`:

```yaml
          ENVIO_DIRETO: "true"
```

Eu só ligaria depois de uns bons ciclos de rascunho revisados à mão, porque aí não existe mais a conferência no Gmail.

## Fontes de vaga hoje

- Alertas de vaga do LinkedIn, lidos no Gmail (remetentes `jobalerts-noreply@linkedin.com` e `jobs-noreply@linkedin.com`). Funciona hoje.
- E-mails com o assunto começando por `[vaga]`: uma vaga achada fora dos alertas, que você manda para o próprio e-mail com o texto dela. Funciona hoje.
- Issues abertas de `frontendbr/vagas`, `backend-br/vagas` e `react-brasil/vagas`. Funciona hoje.
- Alertas da Gupy: o parser ainda não existe. Ele depende de um e-mail de alerta real da Gupy para servir de modelo, e até agora a caixa só tinha e-mails de candidatura. Quando chegar um, o parser entra.

Cada fonte roda isolada: se uma falha, o erro vai para a aba Log e as outras seguem.

## Fixtures de teste

Os testes dos parsers usam e-mails reais, mas anonimizados, porque o repositório é público. Antes de commitar qualquer fixture, passe pelo script, com os seus dados no ambiente:

```bash
ANON_NOMES="seunome|sobrenome" ANON_EMAIL=voce@gmail.com npx tsx scripts/anonymize-fixture.ts entrada.html saida.html
```

`ANON_NOMES` é uma expressão regular com os nomes a trocar e `ANON_EMAIL` é o endereço exato. Os dados brutos ficam em `tests/fixtures/raw/`, que está no `.gitignore`. Confira a saída antes de commitar.

## Estrutura

- `src/jobs/collect.ts` e `src/jobs/send.ts`: os dois jobs.
- `src/sources/`: leitura dos alertas do Gmail e das issues do GitHub.
- `src/filter.ts`, `src/score.ts`, `src/compose.ts`, `src/messageCheck.ts`: filtro, nota, mensagem e checagem.
- `src/clients/`: Gmail, Sheets, Drive e Claude.
- `src/config.ts`: corte, teto semanal, cidades aceitas, modelos e demais constantes.
- `scripts/`: `google-auth`, `setup-sheet`, `probe-sources` e `anonymize-fixture`.
- `templates/` e `examples/`: textos base e exemplos com dados fictícios.
- `docs/superpowers/specs/`: o desenho completo do projeto.
