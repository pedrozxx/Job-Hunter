import type { drive_v3 } from "googleapis";
import type { RetryOpts } from "../retry.js";
import { chamar } from "./googleErrors.js";

export async function downloadPdf(drive: drive_v3.Drive, fileId: string, opts: RetryOpts = {}): Promise<Buffer> {
  const res = await chamar(
    () => drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }),
    opts,
  );
  const data = res.data as unknown;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Buffer.isBuffer(data)) return data;
  throw new Error("Resposta inesperada do Drive ao baixar o PDF");
}
