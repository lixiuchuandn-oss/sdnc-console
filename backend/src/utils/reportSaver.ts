import fs from 'fs';
import path from 'path';
import type { Response } from 'express';

async function downloadWithAuth(url: string, difyKey?: string): Promise<ArrayBuffer | undefined> {
  const maxRedirects = 3;
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const headers: Record<string, string> = {};
    if (difyKey) headers['Authorization'] = `Bearer ${difyKey}`;
    const resp = await fetch(currentUrl, { method: 'GET', headers, redirect: 'manual' as any });
    const status = resp.status;
    if (status >= 200 && status < 300) {
      return await resp.arrayBuffer();
    }
    if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308)) {
      const loc = resp.headers.get('location');
      if (!loc) break;
      try {
        const u = new URL(loc, currentUrl);
        currentUrl = u.toString();
        continue;
      } catch {
        break;
      }
    }
    break;
  }
  return undefined;
}

export async function saveRemoteReport(remoteUrl: string, reportsDir: string, folderId: string, safeName: string, difyKey?: string, fileName?: string): Promise<string | undefined> {
  const baseName = String(fileName || `${safeName}-安全报告.docx`).replace(/[<>:"/\\|?*]+/g, '_');
  let ab = await downloadWithAuth(remoteUrl, difyKey);
  if (!ab) ab = await downloadWithAuth(remoteUrl);
  if (!ab) return undefined;
  const folderPath = path.join(reportsDir, folderId);
  await fs.promises.mkdir(folderPath, { recursive: true }).catch(() => {});
  const savePath = path.join(folderPath, baseName);
  await fs.promises.writeFile(savePath, Buffer.from(ab));
  return savePath;
}

export async function streamSavedDocx(savePath: string, res: Response, safeName: string, filename: string): Promise<void> {
  const st = await fs.promises.stat(savePath);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Length', String(st.size));
  const asciiName = `${safeName.replace(/[^\x20-\x7E]+/g, '_')}-security-report.docx`;
  res.setHeader('Content-Disposition', `attachment; filename=${asciiName}; filename*=UTF-8''${encodeURIComponent(filename)}`);
  const s = fs.createReadStream(savePath);
  s.pipe(res);
}