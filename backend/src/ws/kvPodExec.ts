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
        console.log(`[PodExec] clusterId 获取成功: ${clusterId} (共 ${items.length} 个集群)`);
      } catch (e: any) {
        console.warn(`[PodExec] 获取 clusterId 失败:`, e?.message || e);
        // 继续尝试，可能使用直接路径
      }

      // 预检查 Pod 状态（帮助诊断 503 错误）
      try {
        const podPath = clusterId
          ? `/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}`
          : `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}`;
        const podUrl = `${origin}${podPath}`;
        
        const podData = await getJsonOnce(podUrl, cloud.secretKey || '', insecure, true);
        const podStatus = podData?.status?.phase;
        const containerStatuses = podData?.status?.containerStatuses || [];
        
        console.log(`[PodExec] Pod 状态: ${podStatus}`);
        
        if (podStatus !== 'Running') {
          console.warn(`[PodExec] ⚠️ Pod 状态非 Running: ${podStatus}`);
          // 发送警告到前端（但不阻止连接尝试）
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(Buffer.from(`\x1b[33m⚠️ Pod 状态: ${podStatus}\x1b[0m\r\n`));
          }
        }
        
        // 检查指定容器是否存在
        if (container) {
          const targetContainer = containerStatuses.find((cs: any) => cs?.name === container);
          if (!targetContainer) {
            console.warn(`[PodExec] ⚠️ 容器 "${container}" 不存在于 Pod 中`);
            console.warn(`[PodExec] 可用容器: ${containerStatuses.map((cs: any) => cs?.name).join(', ')}`);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(Buffer.from(`\x1b[33m⚠️ 容器 "${container}" 不存在，可用: ${containerStatuses.map((cs: any) => cs?.name).join(', ')}\x1b[0m\r\n`));
            }
          } else if (!targetContainer?.ready) {
            console.warn(`[PodExec] ⚠️ 容器 "${container}" 未就绪`);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(Buffer.from(`\x1b[33m⚠️ 容器 "${container}" 未就绪\x1b[0m\r\n`));
            }
          }
        }
      } catch (e: any) {
        // 预检查失败不阻止连接尝试
        console.warn(`[PodExec] Pod 状态预检查失败:`, e?.message || e);
      }

      // 构建多个候选 URL（参考 kvVnc.ts 的健壮性）
      const scheme = origin.startsWith('https') ? 'wss' : 'ws';
      const host = origin.replace(/^https?:\/\//, '');
      
      // 基础查询参数
      const baseQueryParams = new URLSearchParams({
        stdin: 'true',
        stdout: 'true',
        stderr: 'true',
        tty: 'true',
        command: command,
      });
      if (container) {
        baseQueryParams.set('container', container);
      }
      
      // 环境变量：使用单个 env 参数，多个环境变量用逗号分隔（K8s exec API 支持）
      // 或者使用数组形式：env=TERM=xterm-256color&env=LANG=en_US.UTF-8
      // 这里使用多个 env 参数的形式
      const envParams = [
        'TERM=xterm-256color',
        'LANG=en_US.UTF-8',
        'LC_ALL=en_US.UTF-8',
      ];
      
      // 构建完整查询字符串（包含多个 env 参数）
      let queryString = baseQueryParams.toString();
      envParams.forEach(env => {
        queryString += `&env=${encodeURIComponent(env)}`;
      });
      
      // 构建多个候选 URL
      const candidates: string[] = [];
      
      // 1. Rancher Steve API 路径（带 clusterId）
      if (clusterId) {
        candidates.push(
          `${scheme}://${host}/k8s/clusters/${encodeURIComponent(clusterId)}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/exec?${queryString}`
        );
      }
      
      // 2. 直接 K8s API 路径（无 clusterId）
      candidates.push(
        `${scheme}://${host}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/exec?${queryString}`
      );
      
      // 3. Rancher v1 proxy 路径（备选）
      if (clusterId) {
        candidates.push(
          `${scheme}://${host}/k8s/clusters/${clusterId}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}/exec?${queryString}`
        );
      }

      console.log(`[PodExec] 候选 URL 数量: ${candidates.length}`);
      console.log(`[PodExec] 主候选 URL: ${candidates[0]}`);

      const rawToken = String(cloud.secretKey || '').trim();
      const authValue = rawToken ? (rawToken.toLowerCase().startsWith('bearer ') ? rawToken : `Bearer ${rawToken}`) : '';

      // 连接到 K8s exec WebSocket
      // Rancher/Steve API 支持的子协议（按优先级排序）：
      // 1. v4.channel.k8s.io - Rancher Steve API 主要使用的格式（JSON 消息）
      // 2. v5.channel.k8s.io - Rancher 较新版本格式（JSON 消息，字段名不同）
      // 3. v2.websocket.k8s.io / v1.websocket.k8s.io - K8s 1.31+ 原生 WebSocket 格式（二进制）
      // 4. 无子协议 - 某些配置可能不需要子协议
      const protocolSets: string[][] = [
        ['v4.channel.k8s.io'],           // Rancher Steve 主要格式
        ['v5.channel.k8s.io'],           // Rancher 较新格式
        ['v4.channel.k8s.io', 'v5.channel.k8s.io'], // 同时声明两个
        [],                               // 无子协议
        ['v2.websocket.k8s.io'],         // K8s 1.31+ 原生
        ['v1.websocket.k8s.io'],         // K8s 1.31+ 原生（旧）
      ];
      
      // Header 组合（参考 kvVnc.ts）
      const headerSets: Record<string, string>[] = [
        { 
          ...(authValue ? { Authorization: authValue } : {}), 
          Origin: origin,
          'User-Agent': 'ComputeTower/1.0',
        },
        {
          ...(authValue ? { Authorization: authValue } : {}),
          Origin: origin,
          ...(rawToken ? { Cookie: `token=${rawToken}` } : {}),
          'User-Agent': 'ComputeTower/1.0',
        },
      ];

      // WebSocket 连接选项
      const wsOptions: any = {
        rejectUnauthorized: !insecure,
        perMessageDeflate: false,
        handshakeTimeout: 10000, // 10 秒超时
      };

      let lastError: Error | null = null;
      let lastErrorCode: number | null = null;
      let lastErrorReason: string = '';
      let chosenUrl: string | null = null;
      
      // 尝试所有候选 URL 和协议组合
      for (const wsUrl of candidates) {
        if (targetWs) break; // 已成功连接
        
        for (const protocols of protocolSets) {
          if (targetWs) break;
          
          for (const headers of headerSets) {
            if (targetWs) break;
            
            try {
              console.log(`[PodExec] 尝试连接: ${wsUrl}, 协议: ${protocols.join(',') || '(none)'}`);
              
              const connectResult = await new Promise<{
                success: boolean;
                ws?: WebSocket;
                error?: Error;
                code?: number;
                reason?: string;
              }>((resolve) => {
                const options = { ...wsOptions, headers };
                const testWs = new WebSocket(
                  wsUrl, 
                  protocols.length > 0 ? protocols : undefined, 
                  options
                );
                let resolved = false;
                
                testWs.on('open', () => {
                  if (resolved) return;
                  resolved = true;
                  console.log(`[PodExec] WebSocket 连接成功`);
                  resolve({ success: true, ws: testWs });
                });
                
                testWs.on('error', (err: Error) => {
                  if (resolved) return;
                  resolved = true;
                  try { testWs.close(); } catch {}
                  console.log(`[PodExec] WebSocket 错误: ${err.message}`);
                  resolve({ success: false, error: err });
                });
                
                testWs.on('close', (code: number, reason: Buffer) => {
                  if (resolved) return;
                  resolved = true;
                  const reasonStr = reason.toString();
                  console.log(`[PodExec] WebSocket 关闭: code=${code}, reason=${reasonStr}`);
                  resolve({ 
                    success: false, 
                    error: new Error(`Connection closed: ${code} ${reasonStr}`),
                    code,
                    reason: reasonStr,
                  });
                });
                
                // 10秒超时
                setTimeout(() => {
                  if (resolved) return;
                  resolved = true;
                  try { testWs.close(); } catch {}
                  resolve({ success: false, error: new Error('Connection timeout (10s)') });
                }, 10000);
              });
              
              if (connectResult.success && connectResult.ws) {
                targetWs = connectResult.ws;
                chosenUrl = wsUrl;
                selectedProtocol = protocols.length > 0 ? protocols[0] : undefined;
                console.log(`[PodExec] ✓ 连接成功: ${protocols.join(',') || '(none)'}`);
                break;
              } else {
                lastError = connectResult.error || new Error('Unknown error');
                lastErrorCode = connectResult.code || null;
                lastErrorReason = connectResult.reason || '';
                
                // 503 错误特殊处理：记录更多信息
                if (connectResult.code === 503 || lastError?.message?.includes('503')) {
                  console.warn(`[PodExec] ⚠️ 503 Service Unavailable - 可能原因：`);
                  console.warn(`[PodExec]   1. K8s API Server 不可用或过载`);
                  console.warn(`[PodExec]   2. Pod "${podName}" 状态异常（非 Running）`);
                  console.warn(`[PodExec]   3. Container "${container}" 不存在或未就绪`);
                  console.warn(`[PodExec]   4. Kubelet 与 API Server 通信异常`);
                  console.warn(`[PodExec]   5. 集群资源不足（CPU/内存）`);
                }
              }
            } catch (err: any) {
              lastError = err;
              console.log(`[PodExec] 异常: ${err.message}`);
            }
          }
        }
      }
      
      if (!targetWs) {
        // 构建详细的错误信息
        let errorMsg = `所有连接尝试失败`;
        if (lastError) {
          errorMsg += `: ${lastError.message}`;
        }
        if (lastErrorCode === 503) {
          errorMsg += `\n\n503 错误通常表示：`;
          errorMsg += `\n• Pod 状态不是 Running（当前 Pod: ${podName}）`;
          errorMsg += `\n• Container "${container}" 不存在或未就绪`;
          errorMsg += `\n• K8s API Server 过载或不可用`;
          errorMsg += `\n• 请检查 Pod 状态和日志`;
        }
        throw new Error(errorMsg);
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