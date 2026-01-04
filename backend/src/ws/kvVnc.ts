import http from 'http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { getJsonOnce } from '../services/clouds/harvester/utils';
import { UserRole } from '../entities/User';

export function initKvVncWsServer(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws/kv-vnc', perMessageDeflate: false });

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const cloudId = url.searchParams.get('cloudId') || '';
    const namespace = url.searchParams.get('namespace') || '';
    const name = url.searchParams.get('name') || '';

    try {
      if (!token) throw new Error('缺少 token');
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      if (!decoded || !decoded.role) throw new Error('无效令牌');
      if (!(decoded.role === UserRole.SUPER_ADMIN || decoded.role === 'admin')) {
        throw new Error('权限不足');
      }
    } catch (err: any) {
      try { ws.close(1011, err?.message || '鉴权失败'); } catch {}
      return;
    }

    if (!cloudId || !namespace || !name) {
      try { ws.close(1002, '缺少 cloudId、namespace 或 name'); } catch {}
      return;
    }

    try {
      const repo = AppDataSource.getRepository(Cloud);
      const cloud = await repo.findOne({ where: { id: cloudId } });
      if (!cloud) throw new Error('云资源不存在');
      const pv = String((cloud as any)?.config?.provider || '').toLowerCase().trim();
      if (pv !== 'harvester') throw new Error('仅支持 Harvester');
      const insecure = !!(cloud.config as any)?.ignoreTls;
      const base = String(cloud.endpoint || '').replace(/\/+$/, '');
      let origin = base;
      try { const u = new URL(base); origin = `${u.protocol}//${u.host}`; } catch { origin = base.replace(/\/v[0-9].*$/, ''); }
      const scheme = origin.startsWith('https') ? 'wss' : 'ws';
      const host = origin.replace(/^https?\:\/\//, '');
      let clusterId: string | null = null;
      try {
        const clusters = await getJsonOnce(`${origin}/v3/clusters`, cloud.secretKey || '', insecure);
        const items: any[] = Array.isArray(clusters?.data) ? clusters?.data : Array.isArray(clusters?.items) ? clusters?.items : [];
        const local = items.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
        const any = items[0];
        clusterId = String((local?.id || local?.Id || any?.id || any?.Id || ''))?.trim() || null;
      } catch {}

      const directV1 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`;
      const directV1a3 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`;
      const directVmV1 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc`;
      const directVmV1a3 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc`;
      const clusterV1 = clusterId ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc` : '';
      const clusterV1a3 = clusterId ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc` : '';
      const clusterVmV1 = clusterId ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc` : '';
      const clusterVmV1a3 = clusterId ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc` : '';

      const candidates: string[] = [
        ...(clusterId ? [clusterV1, clusterV1a3, clusterVmV1, clusterVmV1a3] : []),
        directV1, directV1a3, directVmV1, directVmV1a3
      ].filter(Boolean);

      let client: WebSocket | null = null;
      let chosenRemote: string | null = null;
      let lastErr: any = null;
      const protocolSets: string[][] = [
        ['binary.kubevirt'],
        ['binary.kubevirt', 'binary'],
        ['vnc'],
        ['binary']
      ];
      const rawToken = String(cloud.secretKey || '').trim();
      const authValue = rawToken ? (rawToken.toLowerCase().startsWith('bearer ') ? rawToken : (rawToken.startsWith('token-') ? `Bearer ${rawToken}` : `Bearer ${rawToken}`)) : '';
      const headerSets: Record<string, string>[] = [
        { ...(authValue ? { Authorization: authValue } : {}), Origin: origin },
        { ...(authValue ? { Authorization: authValue } : {}), Origin: origin, ...(rawToken ? { Cookie: `token=${rawToken}` } : {}) }
      ];
      for (const remote of candidates) {
        for (const protos of protocolSets) {
          for (const hdr of headerSets) {
            try {
              client = new WebSocket(remote, protos, {
                headers: hdr,
                rejectUnauthorized: !insecure,
                perMessageDeflate: false
              } as any);
              chosenRemote = remote;
              break;
            } catch (e: any) {
              lastErr = e;
              client = null;
            }
          }
          }
        if (client) break;
      }
      if (!client) throw new Error(`初始化远程WS失败: ${lastErr?.message || '未知错误'}`);

      let closed = false;
      let pingTimer: any = null;
      let pongTs = Date.now();
      const closeBoth = (code: number, reason?: string) => {
        if (closed) return;
        closed = true;
        try { client?.close(code, reason); } catch {}
        try { ws.close(code, reason); } catch {}
        try { if (pingTimer) clearInterval(pingTimer); } catch {}
      };

      client.on('open', () => {
        try { ws.ping(); } catch {}
        try { client.ping(); } catch {}
        try {
          if (pingTimer) clearInterval(pingTimer);
        } catch {}
        pingTimer = setInterval(() => {
          try { ws.ping(); } catch {}
          try { client.ping(); } catch {}
          if (Date.now() - pongTs > 60000) {
            closeBoth(1011, '心跳超时');
          }
        }, 25000);
      });
      client.on('error', (err) => {
        closeBoth(1011, `远程WS错误: ${err?.message || err}${chosenRemote ? ' @ ' + chosenRemote : ''}`);
      });
      client.on('close', () => {
        closeBoth(1000, `远程WS关闭${chosenRemote ? ' @ ' + chosenRemote : ''}`);
      });
      client.on('message', (data: any, isBinary: boolean) => {
        try { ws.send(data as any, { binary: isBinary, compress: false }); } catch { closeBoth(1011, 'WS发送失败'); }
      });
      client.on('pong', () => { pongTs = Date.now(); });

      ws.on('message', (raw: RawData, isBinary: boolean) => {
        try { client?.send(raw, { binary: isBinary }); } catch { closeBoth(1011, '转发失败'); }
      });
      ws.on('pong', () => { pongTs = Date.now(); });
      ws.on('close', () => closeBoth(1000, 'WS关闭'));
      ws.on('error', (err: Error) => closeBoth(1011, `WS错误: ${err?.message || err}`));
    } catch (err: any) {
      try { ws.close(1011, err?.message || '初始化失败'); } catch {}
      return;
    }
  });

  return wss;
}
