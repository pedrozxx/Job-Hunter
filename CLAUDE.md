# Contexto para o Claude Code

Este arquivo existe para quem continuar o trabalho no job-hunter, inclusive o Claude Code rodando na máquina do Pedro (Windows, PowerShell). Leia isto antes de mexer no projeto.

## O que é

Pipeline em TypeScript (Node 22) que roda no GitHub Actions e ajuda o Pedro, estagiário full stack em Belém (PA), a se candidatar a vagas de estágio e júnior no Brasil, remoto ou na região de Belém. Ele coleta vagas, filtra, pontua com Claude, escreve a mensagem e põe numa planilha para aprovação manual. As aprovadas viram rascunho no Gmail. Nada é enviado sem o Pedro clicar em enviar, a não ser que `ENVIO_DIRETO` seja ligado (vem desligado e não está no workflow).

Documentos de referência:
- Spec: `docs/superpowers/specs/2026-11-01-job-hunter-design.md`
- Plano de implementação: `docs/superpowers/plans/2026-11-01-job-hunter.md`
- Passo a passo de configuração: `README.md`

## Estado em 2026-11-03

- A v1 está pronta e mergeada na `main` (PR #1). São 169 testes passando e o typecheck está limpo.
- Ainda não rodou contra serviços reais. Gmail, Sheets, Drive e a API da Anthropic nunca foram chamados de verdade.
- Metas combinadas: 30 candidaturas por semana, corte de nota 60, follow-up depois de 7 dias.
- Fontes que funcionam: alertas do LinkedIn no Gmail, e-mails com assunto começando com `[vaga]` e issues de frontendbr/vagas, backend-br/vagas e react-brasil/vagas.
- Pendente: o parser de alertas da Gupy. Não existia nenhum alerta real da Gupy para usar como fixture.

## Próximos passos, em ordem

1. Configurar seguindo o README, seções 1 a 5:
   - credencial OAuth, com o app publicado como "Em produção" (em "Testando" o token expira em 7 dias);
   - `scripts/google-auth.ts`;
   - `scripts/setup-sheet.ts`;
   - secrets no GitHub.
2. Rodar `scripts/probe-sources.ts` e ver se as fontes trazem umas 60 vagas por semana passando no filtro. Se não trouxerem, rever as fontes antes de qualquer outra coisa.
3. Rodar `collect` com `--dry-run` e ler as primeiras mensagens geradas. Ajustar `templates/base.md` e o perfil se alguma soar artificial.
4. Ativar os workflows e, depois de duas semanas, medir a taxa de resposta na aba Candidaturas. Abaixo de uns 5%, o problema provavelmente está no currículo ou na mira, não no volume.
5. Revisar o currículo do Pedro com olhar crítico. Isso ainda não foi feito, e é o maior risco do projeto.

## Diferenças para o README no Windows (PowerShell)

O README mostra comandos de Linux e macOS. No PowerShell:

```powershell
# base64 de um arquivo, sem quebra de linha (equivale a base64 -w0)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\perfil.md"))
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\curriculo.txt"))

# copiar direto para a área de transferência
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\perfil.md")) | Set-Clipboard

# variável de ambiente só para o comando atual
$env:NODE_ENV = "test"; npm test

# rodar scripts com .env (funciona igual no Windows)
npx tsx --env-file=.env scripts/probe-sources.ts
npx tsx --env-file=.env src/jobs/collect.ts --dry-run
```

Salve `perfil.md` e `curriculo.txt` em UTF-8 (o padrão do VS Code). O `.env`, o perfil e o currículo reais nunca entram no git: o repositório é público. Confira `.gitignore` antes de criar arquivos pessoais na raiz.

## Decisões já tomadas (não reabrir sem motivo)

- **Node 22.** As dependências do googleapis exigem.
- **Vaga presencial ou híbrida sem cidade informada é descartada.** Só modalidade "desconhecido" fica para o Claude decidir.
- **Antes de cada escrita no Gmail, o `send` grava um marcador.** É o status "enviando" na Fila, ou o "pendente" no follow-up. Linha travada nesse estado não é recriada: o Pedro confere Rascunhos e Enviados e libera à mão. Duplicar e-mail para recrutador é pior que uma linha travada.
- **Resposta do recrutador é detectada a partir da primeira mensagem do Pedro na thread.**
- **Chamadas ao Claude usam esforço "low" e max_tokens 16000.** Consulte a skill `claude-api` antes de mudar parâmetros da API.
- **Os workflows têm `concurrency`, e falha sistêmica deixa o job vermelho.** Falha isolada só vai para a aba Log.

Melhorias conhecidas que ficaram para depois:
- Vaga aprovada sem mensagem gera aviso no Log a cada execução.
- O follow-up vai para o e-mail da Fila, não para o destinatário real do e-mail enviado.
- Auto-resposta e bounce contam como "respondeu".

## Como escrever para o Pedro

Português, direto, como uma pessoa falando com um amigo inteligente:
- Sem travessão, sem emoji e sem jargão corporativo (alavancar, otimizar, robusto, fluido, transformador, sinergia).
- Resposta primeiro, raciocínio depois.
- Sem negrito espalhado e sem bullet onde duas frases resolvem.
- Ele pediu para ser desafiado, não validado. Se uma premissa estiver errada, diga antes de seguir.

Isso vale também para todo texto que o sistema gera (`templates/`).

## Regras de código

- Testes primeiro (Vitest). Rode `npm test` e `npm run typecheck` antes de cada commit.
- Nenhum dado pessoal real em código, testes ou fixtures. Fixtures de e-mail reais passam por `scripts/anonymize-fixture.ts`.
- Nenhum caractere travessão (U+2014) em código ou texto. Use o escape `\u2014` quando precisar referenciá-lo.
