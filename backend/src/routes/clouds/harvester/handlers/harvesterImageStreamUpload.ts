import http from 'http';
import https from 'https';
import { once } from 'events';

export type HarvesterNativeStreamUploadOpts = {
  method: 'POST' | 'PUT';
  url: string;
  headers: Record<string, string | number>;
  insecure: boolean;
  signal: AbortSignal;
  /** 逐块写入请求体；禁止在内存中拼接整文件 */
  pump: (write: (chunk: Buffer) => Promise<void>) => Promise<void>;
};

async function writeChunk(req: http.ClientRequest, chunk: Buffer): Promise<void> {
  if (!chunk.length) return;
  if (!req.write(chunk)) {
    await once(req, 'drain');
  }
}

/**
 * 使用 Node 原生 http(s).request 流式上传，避免 axios 对大 body 的缓冲导致 OOM。
 */
export async function harvesterNativeStreamUpload(
  opts: HarvesterNativeStreamUploadOpts,
): Promise<void> {
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
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: opts.method,
        headers: opts.headers,
        agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          if (chunks.length < 16) chunks.push(c);
        });
        res.on('end', () => {
          const code = res.statusCode || 0;
          if (code >= 200 && code < 300) {
            finish();
            return;
          }
          const body = Buffer.concat(chunks).toString('utf8');
          finish(
            new Error(`Harvester upload failed HTTP ${code}: ${body.slice(0, 800)}`),
          );
        });
      },
    );

    req.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));

    const onAbort = () => {
      req.destroy();
      finish(new Error('CANCELLED'));
    };
    if (opts.signal.aborted) {
      onAbort();
      return;
    }
    opts.signal.addEventListener('abort', onAbort, { once: true });

    void (async () => {
      try {
        await opts.pump(async (chunk) => {
          if (opts.signal.aborted) throw new Error('CANCELLED');
          await writeChunk(req, chunk);
        });
        req.end();
      } catch (e) {
        req.destroy();
        finish(e instanceof Error ? e : new Error(String(e)));
      } finally {
        opts.signal.removeEventListener('abort', onAbort);
        agent.destroy();
      }
    })();
  });
}
