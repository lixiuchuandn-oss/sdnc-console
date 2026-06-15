import { normalizeRegistryHost, probeRegistryConnection } from './registryClient';

describe('probeRegistryConnection', () => {
  it('accepts /v2/ success without requiring catalog', async () => {
    const http = require('http');
    const server = http.createServer((req: any, res: any) => {
      if (req.url === '/v2/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end('{"errors":[{"code":"UNKNOWN","message":"unknown error"}]}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    await expect(probeRegistryConnection(`127.0.0.1:${port}`, { insecure: true })).resolves.toBeUndefined();
    server.close();
  });
});

describe('normalizeRegistryHost', () => {
  it('extracts host:port from plain address', () => {
    expect(normalizeRegistryHost('172.16.3.79:30500')).toBe('172.16.3.79:30500');
  });

  it('strips protocol prefix', () => {
    expect(normalizeRegistryHost('http://172.16.3.79:30500')).toBe('172.16.3.79:30500');
  });
});
