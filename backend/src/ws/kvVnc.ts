import http from 'http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { getJsonOnce } from '../services/clouds/harvester/utils';
import { UserRole } from '../entities/User';

export function createKvVncWss() {
  console.log('[KvVnc] Creating Headless WebSocket Server');
  const wss = new WebSocketServer({ 
    noServer: true,
    perMessageDeflate: false,
    handleProtocols: (protocols, req) => {
      console.log('[KvVnc] handleProtocols:', [...protocols]);
      try {
        const protoList = Array.from(protocols);
        if (protocols.has('binary')) return 'binary';
        if (protocols.has('base64')) return 'base64';
        if (protocols.has('binary.kubevirt.io')) return 'binary.kubevirt.io';
        return protoList[0] || false;
      } catch (err) {
        console.error('[KvVnc] Error in handleProtocols:', err);
        return false;
      }
    }
  });

  wss.on('error', (err) => {
    console.error('[VNC-WSS-Error]', err);
  });

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    console.log('[KvVnc] Connection established');
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
      try {
        ws.close(1011, err?.message || '鉴权失败');
      } catch {}
      return;
    }

    if (!cloudId || !namespace || !name) {
      try {
        ws.close(1002, '缺少 cloudId、namespace 或 name');
      } catch {}
      return;
    }

    try {
      const repo = AppDataSource.getRepository(Cloud);
      const cloud = await repo.findOne({ where: { id: cloudId } });
      if (!cloud) throw new Error('云资源不存在');
      const pv = String((cloud as any)?.config?.provider || '')
        .toLowerCase()
        .trim();
      console.log(`[KvVnc] Cloud Provider Check: id=${cloudId}, provider=${(cloud as any)?.config?.provider}, parsed=${pv}`);
      const allowed = ['harvester', 'cloudmap.private', 'cloudmap.edge'];
      if (!allowed.includes(pv)) throw new Error(`仅支持 Harvester/Cloudmap (current: ${pv})`);
      const insecure = !!(cloud.config as any)?.ignoreTls;
      const base = String(cloud.endpoint || '').replace(/\/+$/, '');
      let origin = base;
      try {
        const u = new URL(base);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        origin = base.replace(/\/v[0-9].*$/, '');
      }
      const scheme = origin.startsWith('https') ? 'wss' : 'ws';
      const host = origin.replace(/^https?\:\/\//, '');
      let clusterId: string | null = null;
      try {
        const clusters = await getJsonOnce(
          `${origin}/v3/clusters`,
          cloud.secretKey || '',
          insecure,
        );
        const items: any[] = Array.isArray(clusters?.data)
          ? clusters?.data
          : Array.isArray(clusters?.items)
            ? clusters?.items
            : [];
        const local = items.find(
          (c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local',
        );
        const any = items[0];
        clusterId = String(local?.id || local?.Id || any?.id || any?.Id || '')?.trim() || null;
      } catch {}

      const directV1 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`;
      const directV1a3 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`;
      const directVmV1 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc`;
      const directVmV1a3 = `${scheme}://${host}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc`;
      const clusterV1 = clusterId
        ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`
        : '';
      const clusterV1a3 = clusterId
        ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachineinstances/${encodeURIComponent(name)}/vnc`
        : '';
      const clusterVmV1 = clusterId
        ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc`
        : '';
      const clusterVmV1a3 = clusterId
        ? `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/apis/subresources.kubevirt.io/v1alpha3/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}/vnc`
        : '';

      const candidates: string[] = [
        ...(clusterId ? [clusterV1, clusterV1a3, clusterVmV1, clusterVmV1a3] : []),
        directV1,
        directV1a3,
        directVmV1,
        directVmV1a3,
      ].filter(Boolean);

      let client: WebSocket | null = null;
      let chosenRemote: string | null = null;
      let lastErr: any = null;
      
      let closed = false;
      let pingTimer: any = null;
      let pongTs = Date.now();
      const closeBoth = (code: number, reason?: string) => {
        if (closed) return;
        closed = true;
        try {
          client?.close(code, reason);
        } catch {}
        try {
          ws.close(code, reason);
        } catch {}
        try {
          if (pingTimer) clearInterval(pingTimer);
        } catch {}
      };

      // Message buffer for data received from frontend before backend connects to upstream
      const messageBuffer: { data: RawData; isBinary: boolean }[] = [];
      let isUpstreamReady = false;

      // Handle frontend messages immediately to prevent data loss during upstream connection
      ws.on('message', (raw: RawData, isBinary: boolean) => {
        if (isUpstreamReady && client && client.readyState === WebSocket.OPEN) {
          try {
            client.send(raw, { binary: isBinary });
          } catch {
            closeBoth(1011, '转发失败');
          }
        } else {
          // Buffer message if upstream is not ready
          console.log(`[KvVnc] Buffering frontend message (${isBinary ? 'binary' : 'text'}, ${raw.toString().length} bytes)`);
          messageBuffer.push({ data: raw, isBinary });
        }
      });
      
      ws.on('pong', () => {
        pongTs = Date.now();
      });
      ws.on('close', () => closeBoth(1000, 'WS关闭'));
      ws.on('error', (err: Error) => closeBoth(1011, `WS错误: ${err?.message || err}`));
 
      const protocolSets: string[][] = [
        ['binary.kubevirt.io'],
        [], // Fallback: try without protocol negotiation
        ['binary.kubevirt.io', 'binary'],
        ['base64.binary.kubevirt.io'],
        ['binary.kubevirt'],
        ['binary.kubevirt', 'binary'],
        ['vnc'],
        ['binary'],
      ];
      const rawToken = String(cloud.secretKey || '').trim();
      const authValue = rawToken
        ? rawToken.toLowerCase().startsWith('bearer ')
          ? rawToken
          : rawToken.startsWith('token-')
            ? `Bearer ${rawToken}`
            : `Bearer ${rawToken}`
        : '';
      const headerSets: Record<string, string>[] = [
        { ...(authValue ? { Authorization: authValue } : {}), Origin: origin },
        {
          ...(authValue ? { Authorization: authValue } : {}),
          Origin: origin,
          ...(rawToken ? { Cookie: `token=${rawToken}` } : {}),
        },
      ];

      const tryConnect = (url: string, protocols: string[], headers: any): Promise<WebSocket> => {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(url, protocols && protocols.length > 0 ? protocols : undefined, {
            headers,
            rejectUnauthorized: !insecure,
            perMessageDeflate: false,
            handshakeTimeout: 5000,
          } as any);

          const onOpen = () => {
            cleanup();
            resolve(ws);
          };
          const onError = (err: Error) => {
            cleanup();
            // Silence error, just reject
            ws.on('error', () => {}); 
            reject(err);
          };
          const onClose = (code: number, reason: Buffer) => {
            cleanup();
            reject(new Error(`Closed during handshake: ${code} ${reason.toString()}`));
          };

          const cleanup = () => {
            ws.removeListener('open', onOpen);
            ws.removeListener('error', onError);
            ws.removeListener('close', onClose);
          };

          ws.once('open', onOpen);
          ws.once('error', onError);
          ws.once('close', onClose);
        });
      };

      let attempts = 0;
      const MAX_ATTEMPTS = 10;

      loop: for (const remote of candidates) {
        for (const protos of protocolSets) {
          for (const hdr of headerSets) {
            if (attempts >= MAX_ATTEMPTS) {
              console.log(`[VNC] Max connection attempts (${MAX_ATTEMPTS}) reached. Stopping retries.`);
              break loop;
            }
            attempts++;
            try {
              console.log(`[VNC] Trying: ${remote} [${protos}] ...`);
              client = await tryConnect(remote, protos, hdr);
              chosenRemote = remote;
              console.log(`[VNC] Connected: ${remote}`);
              break loop;
            } catch (e: any) {
              lastErr = e;
              console.log(`[VNC] Failed: ${remote} [${protos}] - ${e.message}`);
              client = null;
            }
          }
        }
      }

      if (!client) throw new Error(`初始化远程WS失败: ${lastErr?.message || '未知错误'} (Tried ${candidates.length} candidates)`);
      
      // Mark upstream as ready and flush buffer
      isUpstreamReady = true;
      console.log(`[KvVnc] Upstream ready. Flushing ${messageBuffer.length} buffered messages.`);
      for (const msg of messageBuffer) {
         try {
           client.send(msg.data, { binary: msg.isBinary });
         } catch (e) {
            console.error('[KvVnc] Failed to flush buffer message', e);
         }
      }
      messageBuffer.length = 0; // Clear buffer

      // Start Heartbeat manually
      try {
        ws.ping();
        client.ping();
      } catch {}
      
      pingTimer = setInterval(() => {
        try {
           ws.ping();
        } catch {}
        try {
           client.ping();
        } catch {}
        if (Date.now() - pongTs > 60000) {
           closeBoth(1011, '心跳超时');
        }
      }, 25000);

      client.on('error', (err) => {
        closeBoth(
          1011,
          `远程WS错误: ${err?.message || err}${chosenRemote ? ' @ ' + chosenRemote : ''}`,
        );
      });
      client.on('close', () => {
        closeBoth(1000, `远程WS关闭${chosenRemote ? ' @ ' + chosenRemote : ''}`);
      });
      client.on('message', (data: any, isBinary: boolean) => {
        try {
          if (data && data.length > 0) {
             // console.log(`[KvVnc] Rx ${data.length} bytes from remote`);
          }
          ws.send(data as any, { binary: isBinary, compress: false });
        } catch {
          closeBoth(1011, 'WS发送失败');
        }
      });
      client.on('pong', () => {
        pongTs = Date.now();
      });
      // ws.on listeners already bound above
    } catch (err: any) {
      try {
        ws.close(1011, err?.message || '初始化失败');
      } catch {}
      return;
    }
  });
  return wss;
}
