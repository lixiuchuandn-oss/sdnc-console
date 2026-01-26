import https from 'https';

export const requestOnce = (target: string, token: string, insecure: boolean = false) => {
  return new Promise<{ ok: boolean; status?: number; code?: string; error?: string }>((resolve) => {
    const req = https.request(
      target,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        rejectUnauthorized: !insecure,
      },
      (res) => {
        resolve({
          ok: res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false,
          status: res.statusCode,
        });
      },
    );
    req.setTimeout(7000, () => {
      try {
        req.destroy(new Error('timeout'));
      } catch {}
    });
    req.on('error', (err: any) => resolve({ ok: false, error: err?.message, code: err?.code }));
    req.end();
  });
};

export const getJsonOnce = (target: string, token: string, insecure: boolean = false) => {
  return new Promise<any>((resolve, reject) => {
    const req = https.request(
      target,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        rejectUnauthorized: !insecure,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const status = res.statusCode || 0;
          const ct = String(res.headers['content-type'] || '');
          const text = Buffer.concat(chunks).toString('utf-8');
          let parsed: any = undefined;
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { text };
          }
          if (status >= 200 && status < 300) {
            resolve(parsed);
          } else {
            const snippet = typeof text === 'string' ? text.slice(0, 300) : '';
            const err = new Error(`HTTP ${status} ${ct ? '(' + ct + ')' : ''} ${snippet}`.trim());
            (err as any).status = status;
            (err as any).contentType = ct;
            (err as any).body = snippet;
            reject(err);
          }
        });
      },
    );
    req.setTimeout(8000, () => {
      try {
        req.destroy(new Error('timeout'));
      } catch {}
    });
    req.on('error', (err: any) => reject(err));
    req.end();
  });
};

export const requestJson = (
  method: string,
  target: string,
  token: string,
  insecure: boolean = false,
  body?: any,
) => {
  return new Promise<any>((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const req = https.request(
      target,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(data
            ? { 'Content-Type': 'application/json', 'Content-Length': String(data.length) }
            : {}),
        },
        rejectUnauthorized: !insecure,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json: any = undefined;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {}
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(typeof json !== 'undefined' ? json : {});
          } else {
            const err = new Error(text || `HTTP ${res.statusCode}`);
            (err as any).status = res.statusCode;
            reject(err);
          }
        });
      },
    );
    req.setTimeout(10000, () => {
      try {
        req.destroy(new Error('timeout'));
      } catch {}
    });
    req.on('error', (err: any) => reject(err));
    if (data) req.write(data);
    req.end();
  });
};
