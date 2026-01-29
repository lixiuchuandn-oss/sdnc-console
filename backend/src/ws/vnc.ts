import http from 'http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { UserRole } from '../entities/User';
import net from 'net';

// 该服务充当 WebSockify：将浏览器的 WebSocket 二进制数据原样转发到后端 TCP（VNC/RFB 端口），并将 TCP 数据原样回传至浏览器。
// 鉴权沿用 JWT（仅管理员允许使用）。连接目标通过查询参数传递：/ws/vnc?token=...&host=...&port=5900

export function initVncWsServer(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws/vnc', perMessageDeflate: false });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const host = url.searchParams.get('host') || '';
    const portStr = url.searchParams.get('port') || '5900';
    const port = Number(portStr) || 5900;

    // 简单鉴权：要求有效 JWT 且为管理员角色
    try {
      if (!token) throw new Error('缺少 token');
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      if (!decoded || !decoded.role) throw new Error('无效令牌');
      
      const isSuper = decoded.role === UserRole.SUPER_ADMIN;
      // 如果不是超级管理员，必须拥有 clouds.console:write 权限
      if (!isSuper) {
        const perms: string[] = Array.isArray(decoded.permissions) ? decoded.permissions : [];
        if (!perms.includes('clouds.console:write')) {
          throw new Error('权限不足: 缺少 clouds.console:write');
        }
      }
    } catch (err: any) {
      // 由于 noVNC 期待纯二进制流，这里仅关闭连接并设置关闭原因，避免发送 JSON 文本
      try {
        ws.close(1011, err?.message || '鉴权失败');
      } catch {}
      return;
    }

    if (!host || !port) {
      try {
        ws.close(1002, '缺少 host 或 port');
      } catch {}
      return;
    }

    const socket = new net.Socket();
    let closed = false;

    const closeBoth = (code: number, reason?: string) => {
      if (closed) return;
      closed = true;
      try {
        socket.destroy();
      } catch {}
      try {
        ws.close(code, reason);
      } catch {}
    };

    // 建立到 VNC 服务器的 TCP 连接
    socket.setTimeout(15000); // 连接/握手超时 15s
    socket.connect({ host, port }, () => {
      // 连接建立后，开始双向转发
    });

    socket.on('timeout', () => {
      closeBoth(1011, 'VNC 连接超时');
    });
    socket.on('error', (err) => {
      closeBoth(1011, `VNC 连接错误: ${err?.message || err}`);
    });
    socket.on('end', () => {
      closeBoth(1000, 'VNC TCP 端关闭');
    });
    socket.on('close', () => {
      closeBoth(1000, 'VNC 连接关闭');
    });
    socket.on('data', (data: Buffer) => {
      try {
        ws.send(data, { binary: true, compress: false });
      } catch {
        // 如果发送失败，关闭连接
        closeBoth(1011, 'WS 发送失败');
      }
    });

    // WebSocket → TCP：原样写入二进制
    ws.on('message', (raw: RawData) => {
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as any);
      try {
        socket.write(buf);
      } catch {
        closeBoth(1011, 'TCP 写入失败');
      }
    });

    ws.on('close', () => {
      closeBoth(1000, 'WS 关闭');
    });
    ws.on('error', (err: Error) => {
      closeBoth(1011, `WS 错误: ${err?.message || err}`);
    });
  });

  return wss;
}
