// Gera o refresh token do Google (executar uma vez, localmente):
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npx tsx scripts/google-auth.ts
import http from "node:http";
import { google } from "googleapis";

const PORTA = 53682;
const REDIRECT = `http://localhost:${PORTA}`;
const ESCOPOS = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.readonly",
];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET antes de rodar.");
  process.exit(1);
}

const oauth = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const url = oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ESCOPOS });

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url ?? "/", REDIRECT).searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("Sem codigo de autorizacao.");
    return;
  }
  try {
    const { tokens } = await oauth.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Pronto. Pode fechar esta aba.");
    if (!tokens.refresh_token) {
      console.error("O Google nao devolveu refresh token. Revogue o acesso do app na conta e rode de novo.");
      process.exitCode = 1;
    } else {
      console.log("\nGOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
    }
  } catch (e) {
    res.writeHead(500).end("Falha ao trocar o codigo.");
    console.error(e);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORTA, () => {
  console.log("Abra este endereco no navegador e autorize:\n\n" + url + "\n");
});
