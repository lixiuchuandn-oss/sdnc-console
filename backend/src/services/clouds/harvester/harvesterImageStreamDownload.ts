import fs from 'fs';
import http from 'http';
import https from 'https';
import { once } from 'events';

export type HarvesterStreamDownloadOpts = {
  url: string;
  token: string;
  insecure: boolean;
  destPath: string;
  signal?: AbortSignal;
  onProgress?: (received: number, totalHint?: number) => void;
};

/**
 * GET 流式下载 Harvester 资源到本地文件（镜像 download 等）。
 */
export async function streamHarvesterGetToFile(
  opts: HarvesterStreamDownloadOpts,
): Promise<{ bytesWritten: number; contentLength?: number }> {
  const u = new URL(opts.url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  const agent = isHttps
    ? new https.Agent({
        keepAlive: false,
        maxSockets: 1,
        rejectUnauthorized: !opts.insecure,
      })
    : new http.Agent({ keepAlive: false, maxSockets: 1 });

  return new Promise((resolve, reject) => {
    let settled = false;
    let bytesWritten = 0;
    let contentLength: number | undefined;
    let fileHandle: fs.promises.FileHandle | null = null;
    let writeChain = Promise.resolve();

    const finish = (err?: Error, result?: { bytesWritten: number; contentLength?: number }) => {
      if (settled) return;
      settled = true;
      const close = async () => {
        if (fileHandle) {
          try {
            await fileHandle.close();
          } catch {
            /* ignore */
          }
        }
      };
      void close().then(() => {
        if (err) reject(err);
        else resolve(result ?? { bytesWritten, contentLength });
      });
    };

    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: '*/*',
        },
        agent,
      },
      (res) => {
        const code = res.statusCode || 0;
        if (code < 200 || code >= 300) {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => {
            if (chunks.length < 8) chunks.push(c);
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            finish(new Error(`Harvester download failed HTTP ${code}: ${body.slice(0, 800)}`));
          });
          return;
        }

        const cl = Number(res.headers['content-length']);
        if (Number.isFinite(cl) && cl > 0) contentLength = cl;

        fs.promises
          .open(opts.destPath, 'w')
          .then((fh) => {
            fileHandle = fh;
            res.on('data', (chunk: Buffer) => {
              if (opts.signal?.aborted) {
                res.destroy();
                finish(new Error('CANCELLED'));
                return;
              }
              bytesWritten += chunk.length;
              writeChain = writeChain.then(async () => {
                await fh.write(chunk);
              });
              opts.onProgress?.(bytesWritten, contentLength);
            });
            res.on('end', () => {
              writeChain
                .then(() => finish(undefined, { bytesWritten, contentLength }))
                .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
            });
            res.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
          })
          .catch((e) => finish(e instanceof Error ? e : new Error(String(e))));
      },
    );

    req.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));

    const onAbort = () => {
      req.destroy();
      finish(new Error('CANCELLED'));
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    req.end();
  });
}
