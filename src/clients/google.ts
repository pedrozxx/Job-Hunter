import { google, type gmail_v1, type sheets_v4, type drive_v3 } from "googleapis";

export type GoogleClients = { gmail: gmail_v1.Gmail; sheets: sheets_v4.Sheets; drive: drive_v3.Drive };

function exigir(env: NodeJS.ProcessEnv, nome: string): string {
  const v = env[nome];
  if (!v) throw new Error(`Variavel de ambiente ausente: ${nome}`);
  return v;
}

export function makeGoogleClients(env: NodeJS.ProcessEnv = process.env): GoogleClients {
  const clientId = exigir(env, "GOOGLE_CLIENT_ID");
  const clientSecret = exigir(env, "GOOGLE_CLIENT_SECRET");
  const refreshToken = exigir(env, "GOOGLE_REFRESH_TOKEN");
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return {
    gmail: google.gmail({ version: "v1", auth }),
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}
