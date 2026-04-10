import http from 'http';
import https from 'https';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { UserSpace } from '../entities/UserSpace';
import { getJsonOnce } from '../services/clouds/harvester/utils';
import { UserRole } from '../entities/User';

/**
 * WebSocket 代理：Pod 终端 (kubectl exec)
 * 
 * Kubernetes exec WebSocket 协议：
 * - 使用子协议 v4.channel.k8s.io 或 v5.channel.k8s.io
 * - 消息格式：第一个字节是 stream type，后面是数据
 *   - 0 = stdin, 1 = stdout, 2 = stderr, 3 = error, 4 = resize
 */
export function createKvPodExecWss() {
  const wss = new WebSocketServer({ 
    noServer: true,
    // 配置心跳：每30秒ping一次，超时60秒
    clientTracking: true,
  });

  // 全局心跳检查
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const wsAny = ws as any;
      if (wsAny.isAlive === false) {
        console.log(`[PodExec] 心跳超时，关闭连接`);
        return ws.terminate();
      }
      wsAny.isAlive = false;
      ws.ping();
    });
  }, 30000); // 每30秒检查一次

  wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
    // 设置连接为活跃状态
    (ws as any).isAlive = true;
    
    // 监听 pong 响应
    ws.on('pong', () => {
      (ws as any).isAlive = true;
    });
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const cloudId = url.searchParams.get('cloudId') || '';
    const namespace = url.searchParams.get('namespace') || '';
    const podName = url.searchParams.get('podName') || '';
    const container = url.searchParams.get('container') || '';
    const command = url.searchParams.get('command') || '/bin/sh';
    const cols = parseInt(url.searchParams.get('cols') || '120', 10);
    const rows = parseInt(url.searchParams.get('rows') || '30', 10);

    console.log(`[PodExec] 连接请求: ns=${namespace}, pod=${podName}, container=${container}, command=${command}`);

    // JWT 鉴权
    let decoded: any = null;
    try {
      if (!token) throw new Error('缺少 token');
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      if (!decoded || !decoded.role) throw new Error('无效令牌');
      const allowedRoles = [UserRole.SUPER_ADMIN, 'admin', 'tenant'];
      if (!allowedRoles.includes(decoded.role)) {
        throw new Error('权限不足');
      }
    } catch (err: any) {
      try { ws.close(1011, err?.message || '鉴权失败'); } catch {}
      return;
    }

    if (!cloudId || !namespace || !podName) {
      try { ws.close(1002, '缺少必要参数'); } catch {}
      return;
    }

    // 租户权限检查
    try {
      if (decoded.role === 'tenant') {
        const userSpaceRepo = AppDataSource.getRepository(UserSpace);
        const whereClause: any = {
          tenantId: decoded.tenantId,
          cloudId,
          status: 'active',
        };
        if (decoded.organizationId) {
          whereClause.organizationId = decoded.organizationId;
        } else {
          whereClause.organizationId = null;
        }

        const spaces = await userSpaceRepo.find({ where: whereClause });
        const allowedNamespaces = new Set<string>();
        spaces.forEach(s => {
          if (s.namespace) {
            s.namespace.split(',').forEach(ns => allowedNamespaces.add(ns.trim()));
          }
        });

        if (!allowedNamespaces.has(namespace)) {
          throw new Error('无权访问该命名空间');
        }
      }
    } catch (err: any) {
      try { ws.close(1011, err?.message || '权限校验失败'); } catch {}
      return;
    }

    let targetWs: WebSocket | null = null;
    let isClosing = false;
    let selectedProtocol: string | undefined = undefined;

    try {
      // 获取云资源配置
      const repo = AppDataSource.getRepository(Cloud);
      const cloud = await repo.findOne({ where: { id: cloudId } });
      if (!cloud) throw new Error('云资源不存在');
      
      const pv = String((cloud as any)?.config?.provider || '').toLowerCase().trim();
      const allowed = ['harvester', 'cloudmap.private', 'cloudmap.edge'];
      if (!allowed.includes(pv)) throw new Error(`不支持的平台: ${pv}`);
      
      const insecure = !!(cloud.config as any)?.ignoreTls;
      const base = String(cloud.endpoint || '').replace(/\/+$/, '');
      
      let origin: string;
      try {
        const u = new URL(base);
        origin = `${u.protocol}//${u.host}`;
      } catch {
        origin = base.replace(/\/v[0-9].*$/, '');
      }

      // 获取 clusterId
      let clusterId: string | null = null;
      try {
        const clusters = await getJsonOnce(`${origin}/v3/clusters`, cloud.secretKey || '', insecure);
        const items: any[] = Array.isArray(clusters?.data) ? clusters?.data : Array.isArray(clusters?.items) ? clusters?.items : [];
        const local = items.find((c: any) => String(c?.id || c?.Id || '').toLowerCase() === 'local');
        clusterId = String(local?.id || local?.Id || items[0]?.id || items[0]?.Id || '')?.trim() || null;
      } catch (e) {
        console.warn(`[PodExec] 获取 clusterId 失败:`, (e as Error).message);
      }

      // 构建 exec WebSocket URL
      const basePath = clusterId
        ? `/k8s/clusters/${encodeURIComponent(clusterId)}`
        : '';
      
      const queryParams = new URLSearchParams({
        stdin: 'true',
        stdout: 'true',
        stderr: 'true',
        tty: 'true',
        command: command,
      });
      if (container) {
        queryParams.set('container', container);
      }
      
      // 添加环境变量以启用彩色终端体验
      // TERM=xterm-256color 启用颜色支持
      // LANG/LC_ALL 启用 UTF-8 支持（正确处理中文）
      // LS_COLORS 设置文件类型颜色
      // PS1 设置自定义提示符（显示用户名、主机名、当前路径）
      queryParams.set('env', 'TERM=xterm-256color');
      queryParams.set('env', 'LANG=en_US.UTF-8');
      queryParams.set('env', 'LC_ALL=en_US.UTF-8');
      queryParams.set('env', 'LS_COLORS=rs=0:di=01;34:ln=01;36:mh=00:pi=40;33:so=01;35:do=01;35:bd=40;33;01:cd=40;33;01:or=40;31;01:mi=00:su=37;41:sg=30;43:ca=30;41:tw=30;42:ow=34;42:st=37;44:ex=01;32');

      const wsPath = `${basePath}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/exec?${queryParams}`;
      const wsUrl = `${origin.replace(/^http/, 'ws')}${wsPath}`;

      console.log(`[PodExec] 连接到: ${wsUrl}`);

      const rawToken = String(cloud.secretKey || '').trim();
      const authValue = rawToken ? (rawToken.toLowerCase().startsWith('bearer ') ? rawToken : `Bearer ${rawToken}`) : '';

      // 连接到 K8s exec WebSocket
      // 尝试多种子协议：
      // - v5.channel.k8s.io, v4.channel.k8s.io: Rancher/Steve API 格式
      // - v2.websocket.k8s.io, v1.websocket.k8s.io: Kubernetes 原生 WebSocket 格式 (K8s 1.31+)
      // - 无子协议: 某些实现可能不需要
      const protocols = [
        'v5.channel.k8s.io', 
        'v4.channel.k8s.io',
        'v2.websocket.k8s.io', 
        'v1.websocket.k8s.io',
        ''  // 无子协议
      ];
      let lastError: Error | null = null;
      
      // 先找到成功的协议
      for (const protocol of protocols) {
        try {
          const wsOptions: any = {
            headers: {
              'Authorization': authValue,
              'Origin': origin,
            },
            rejectUnauthorized: !insecure,
            perMessageDeflate: false,
          };
          
          // 创建 Promise 来等待连接结果
          const connectResult = await new Promise<{
            success: boolean;
            ws?: WebSocket;
            error?: Error;
          }>((resolve) => {
            const testWs = new WebSocket(wsUrl, protocol || undefined, wsOptions);
            let resolved = false;
            
            testWs.on('open', () => {
              if (resolved) return;
              resolved = true;
              resolve({ success: true, ws: testWs });
            });
            
            testWs.on('error', (err) => {
              if (resolved) return;
              resolved = true;
              try { testWs.close(); } catch {}
              resolve({ success: false, error: err });
            });
            
            testWs.on('close', (code) => {
              if (resolved) return;
              resolved = true;
              resolve({ success: false, error: new Error(`Connection closed: ${code}`) });
            });
            
            // 5秒超时
            setTimeout(() => {
              if (resolved) return;
              resolved = true;
              try { testWs.close(); } catch {}
              resolve({ success: false, error: new Error('Connection timeout') });
            }, 5000);
          });
          
          if (connectResult.success && connectResult.ws) {
            targetWs = connectResult.ws;
            selectedProtocol = protocol || undefined;
            console.log(`[PodExec] 使用子协议: ${protocol || '(none)'} 连接成功`);
            break;
          } else {
            lastError = connectResult.error || new Error('Unknown error');
            console.log(`[PodExec] 子协议 ${protocol || '(none)'} 连接失败: ${lastError.message}`);
          }
        } catch (err: any) {
          lastError = err;
          console.log(`[PodExec] 子协议 ${protocol || '(none)'} 异常: ${err.message}`);
        }
      }
      
      if (!targetWs) {
        throw new Error(`所有子协议连接失败: ${lastError?.message || 'Unknown'}`);
      }

      // 设置目标 WebSocket 事件监听器（连接已经 open）
      targetWs.on('message', (data: RawData) => {
        if (isClosing) return;
        
        try {
          const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
          if (buffer.length === 0) return;
          
          console.log(`[PodExec] 收到 K8s 消息: length=${buffer.length}, firstByte=${buffer[0]}, data=${buffer.toString('utf8').slice(0, 100)}`);
          
          // 检查是否是 Rancher channel 协议的 JSON 格式消息
          // v4 格式: {"type": 1, "data": "base64..."}
          // v5 格式: {"N": 1, "d": "base64..."}
          if (buffer[0] === 0x7B || buffer[0] === 0x7D) { // 0x7B = '{', 0x7D = '}'
            try {
              const jsonStr = buffer.toString('utf8');
              const jsonMsg = JSON.parse(jsonStr);
              console.log(`[PodExec] 解析为 JSON 消息:`, jsonMsg);
              
              // Rancher channel 协议格式
              let streamType: number;
              let payload: Buffer;
              
              if (jsonMsg.type !== undefined && jsonMsg.data !== undefined) {
                // v4 格式: {"type": 1, "data": "base64..."}
                streamType = jsonMsg.type;
                const dataBase64 = jsonMsg.data;
                payload = Buffer.from(dataBase64, 'base64');
              } else if (jsonMsg.N !== undefined && jsonMsg.d !== undefined) {
                // v5 格式: {"N": 1, "d": "base64..."}
                streamType = jsonMsg.N;
                const dataBase64 = jsonMsg.d;
                payload = Buffer.from(dataBase64, 'base64');
              } else {
                // 无法识别的 JSON 格式，当作普通消息处理
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(buffer);
                }
                return;
              }
              
              console.log(`[PodExec] Rancher channel 消息: streamType=${streamType}, payload=${payload.toString('utf8').slice(0, 50)}`);
              
              // stream type: 1 = stdout, 2 = stderr, 3 = error
              if (streamType === 1 || streamType === 2) {
                // 过滤掉空消息
                if (payload.length > 0 && ws.readyState === WebSocket.OPEN) {
                  ws.send(payload);
                }
              } else if (streamType === 3) {
                let errorMsg = payload.toString();
                console.error(`[PodExec] K8s error message: ${errorMsg}`);
                try {
                  const errJson = JSON.parse(errorMsg);
                  errorMsg = errJson.message || errJson.error || errorMsg;
                } catch {}
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(Buffer.from(`\x1b[31m错误: ${errorMsg}\x1b[0m\r\n`));
                }
              } else {
                console.log(`[PodExec] 未知的 streamType: ${streamType}`);
              }
            } catch (parseErr) {
              // 不是 JSON，可能直接是二进制数据
              console.log(`[PodExec] 非 JSON 消息，直接转发`);
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(buffer);
              }
            }
          } else {
            // 标准 K8s WebSocket 协议格式: stream type + payload
            const streamType = buffer.readUInt8(0);
            const payload = buffer.slice(1);
            
            console.log(`[PodExec] 标准 K8s 消息: streamType=${streamType}, payload=${payload.toString('utf8').slice(0, 50)}`);
            
            // stream type: 1 = stdout, 2 = stderr, 3 = error
            if (streamType === 1 || streamType === 2) {
              // 过滤掉空消息
              if (payload.length > 0 && ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
              }
            } else if (streamType === 3) {
              let errorMsg = payload.toString();
              console.error(`[PodExec] K8s error message: ${errorMsg}`);
              try {
                const errJson = JSON.parse(errorMsg);
                errorMsg = errJson.message || errJson.error || errorMsg;
              } catch {}
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(Buffer.from(`\x1b[31m错误: ${errorMsg}\x1b[0m\r\n`));
              }
            } else {
              console.log(`[PodExec] 未知的 streamType: ${streamType}`);
            }
          }
        } catch (err) {
          console.error(`[PodExec] 处理消息错误:`, err);
        }
      });

      targetWs.on('close', (code: number, reason: Buffer) => {
        console.log(`[PodExec] K8s 连接关闭: code=${code}, reason=${reason.toString()}`);
        isClosing = true;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(Buffer.from(`\r\n\x1b[33m连接已关闭\x1b[0m\r\n`));
          setTimeout(() => { try { ws.close(code, reason); } catch {} }, 100);
        }
      });

      targetWs.on('error', (err: Error) => {
        console.error(`[PodExec] K8s 连接错误:`, err.message);
        isClosing = true;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(Buffer.from(`\r\n\x1b[31m连接错误: ${err.message}\x1b[0m\r\n`));
          try { ws.close(1011, err.message); } catch {}
        }
      });

      // 连接已建立，发送初始 resize 消息
      console.log(`[PodExec] 发送初始 resize: cols=${cols}, rows=${rows} (协议: ${selectedProtocol || 'standard'})`);
      const resizePayload = JSON.stringify({ Width: cols, Height: rows });
      
      if (selectedProtocol === 'v5.channel.k8s.io') {
        // v5 格式: {"N": 4, "d": "base64..."}
        const msg = JSON.stringify({ N: 4, d: Buffer.from(resizePayload).toString('base64') });
        targetWs.send(msg);
      } else if (selectedProtocol === 'v4.channel.k8s.io') {
        // v4 格式: {"type": 4, "data": "base64..."}
        const msg = JSON.stringify({ type: 4, data: Buffer.from(resizePayload).toString('base64') });
        targetWs.send(msg);
      } else {
        // 标准 K8s WebSocket 协议: stream type 4 + payload
        const resizeBuffer = Buffer.alloc(1 + Buffer.byteLength(resizePayload));
        resizeBuffer.writeUInt8(4, 0);
        resizeBuffer.write(resizePayload, 1);
        targetWs.send(resizeBuffer);
      }
      console.log(`[PodExec] resize 消息已发送`);

    } catch (err: any) {
      console.error(`[PodExec] 初始化失败:`, err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(Buffer.from(`\r\n\x1b[31m初始化失败: ${err.message}\x1b[0m\r\n`));
        try { ws.close(1011, err.message); } catch {}
      }
      return;
    }

    // 处理前端消息
    // 前端发送原始字符串数据，根据实际使用的子协议进行封装
    ws.on('message', (data: RawData) => {
      if (isClosing || !targetWs || targetWs.readyState !== WebSocket.OPEN) {
        console.log(`[PodExec] 前端消息被忽略: isClosing=${isClosing}, targetWs=${!!targetWs}, readyState=${targetWs?.readyState}`);
        return;
      }

      try {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        console.log(`[PodExec] 收到前端消息: length=${buffer.length}, data=${JSON.stringify(buffer.toString().slice(0, 50))}`);
        
        // 根据实际使用的子协议来封装消息
        // 注意：Rancher/Harvester 可能声明支持 v5 协议但实际使用二进制格式
        // 先尝试标准二进制格式，如果不行再用 JSON 格式
        const framedBuffer = Buffer.alloc(1 + buffer.length);
        framedBuffer.writeUInt8(0, 0); // stream type 0 = stdin
        buffer.copy(framedBuffer, 1);
        console.log(`[PodExec] 发送二进制消息: ${framedBuffer.toString('hex')}`);
        targetWs.send(framedBuffer);
        console.log(`[PodExec] 已转发到 K8s`);
      } catch (err) {
        console.error(`[PodExec] 发送错误:`, err);
      }
    });

    ws.on('close', () => {
      console.log(`[PodExec] 前端连接关闭`);
      isClosing = true;
      try { targetWs?.close(); } catch {}
    });

    ws.on('error', (err) => {
      console.error(`[PodExec] 前端 WebSocket 错误:`, err.message);
      isClosing = true;
      try { targetWs?.close(); } catch {}
    });
  });

  // 服务器关闭时清理心跳定时器
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}