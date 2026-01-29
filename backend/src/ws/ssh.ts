import http from 'http';
import jwt from 'jsonwebtoken';
import { UserRole } from '../entities/User';
import { WebSocketServer, WebSocket, RawData } from 'ws';
import { Client as SSHClient, ClientChannel } from 'ssh2';

interface ConnectPayload {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  cols?: number;
  rows?: number;
}

interface WsMessage {
  type: 'connect' | 'input' | 'resize' | 'close' | 'ping';
  data?: any;
}

export function initSshWsServer(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws/ssh', perMessageDeflate: false });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    console.log('WS SSH connect', {
      origin: req.headers.origin,
      ua: req.headers['user-agent'],
      ext: req.headers['sec-websocket-extensions'],
    });

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
          throw new Error('缺少 clouds.console:write 权限，无法建立SSH连接');
        }
      }
    } catch (err: any) {
      ws.send(JSON.stringify({ type: 'error', message: err?.message || '鉴权失败' }));
      ws.close();
      return;
    }

    const ssh = new SSHClient();
    let shellStream: any = null;

    const safeSend = (payload: any) => {
      try {
        ws.send(JSON.stringify(payload), { compress: false });
      } catch {}
    };

    ws.on('message', (raw: RawData) => {
      let msg: WsMessage | null = null;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        msg = null;
      }
      if (!msg) return;

      switch (msg.type) {
        case 'connect': {
          const p: ConnectPayload = msg.data || {};
          const {
            host,
            port = 22,
            username,
            password,
            privateKey,
            passphrase,
            cols = 120,
            rows = 30,
          } = p;
          if (!host || !username || (!password && !privateKey)) {
            safeSend({ type: 'error', message: '缺少连接参数（host/username/密码或私钥）' });
            return;
          }

          ssh
            .on('ready', () => {
              console.log('SSH连接已建立，准备打开shell');
              ssh.shell(
                {
                  cols,
                  rows,
                  term: 'xterm-256color',
                },
                (err: any, stream: ClientChannel) => {
                  if (err) {
                    console.error('打开Shell失败:', err.message);
                    safeSend({ type: 'error', message: `打开Shell失败: ${err.message}` });
                    ws.close();
                    ssh.end();
                    return;
                  }
                  shellStream = stream;
                  console.log('Shell流已创建，发送ready信号');
                  safeSend({ type: 'ready' });
                  try {
                    shellStream.write('\r');
                  } catch {}
                  setTimeout(() => {
                    try {
                      shellStream.write('\x03');
                    } catch {}
                  }, 120);
                  setTimeout(() => {
                    try {
                      shellStream.write('\r');
                    } catch {}
                  }, 250);
                  setTimeout(() => {
                    try {
                      shellStream.write('export PS1="\\u@\\h:\\w\\$ "\n');
                    } catch {}
                  }, 350);
                  setTimeout(() => {
                    try {
                      shellStream.write('printf "\\n"\n');
                    } catch {}
                  }, 450);

                  let receivedOnce = false;
                  const fallbackTimer = setTimeout(() => {
                    if (receivedOnce) return;
                    try {
                      console.log('Shell无输出，尝试使用 bash -li 作为回退');
                      ssh.exec(
                        'bash -li',
                        { pty: { rows, cols, term: 'xterm-256color' } },
                        (execErr: any, execStream: ClientChannel) => {
                          if (execErr) {
                            console.error('回退到 bash 失败:', execErr?.message || execErr);
                            return;
                          }
                          try {
                            shellStream?.removeAllListeners();
                          } catch {}
                          shellStream = execStream;
                          try {
                            shellStream.write('\r');
                          } catch {}
                          setTimeout(() => {
                            try {
                              shellStream.write('\x03');
                            } catch {}
                          }, 120);
                          setTimeout(() => {
                            try {
                              shellStream.write('\r');
                            } catch {}
                          }, 250);
                          setTimeout(() => {
                            try {
                              shellStream.write('export PS1="\\u@\\h:\\w\\$ "\n');
                            } catch {}
                          }, 350);
                          setTimeout(() => {
                            try {
                              shellStream.write('printf "\\n"\n');
                            } catch {}
                          }, 450);
                          shellStream.on('data', (data: Buffer) => {
                            const dataStr = data.toString('utf8');
                            safeSend({ type: 'data', data: dataStr });
                          });
                          shellStream.on('close', () => {
                            safeSend({ type: 'close' });
                            try {
                              ws.close();
                            } catch {}
                            try {
                              ssh.end();
                            } catch {}
                          });
                        },
                      );
                    } catch {}
                  }, 1000);
                  stream.on('data', (data: Buffer) => {
                    const dataStr = data.toString('utf8');
                    console.log('Shell输出数据:', JSON.stringify(dataStr));
                    safeSend({ type: 'data', data: dataStr });
                    receivedOnce = true;
                  });
                  stream.on('close', () => {
                    console.log('Shell流已关闭');
                    safeSend({ type: 'close' });
                    ws.close();
                    ssh.end();
                    try {
                      clearTimeout(fallbackTimer);
                    } catch {}
                  });
                  stream.stderr?.on('data', (data: Buffer) => {
                    const errorStr = data.toString('utf8');
                    console.log('Shell错误输出:', JSON.stringify(errorStr));
                    safeSend({ type: 'data', data: errorStr });
                  });
                },
              );
            })
            .on('error', (err: Error) => {
              safeSend({ type: 'error', message: `SSH错误: ${err.message}` });
              ws.close();
            })
            .on('end', () => {
              safeSend({ type: 'close' });
            })
            .connect({
              host,
              port,
              username,
              // 认证方式：优先私钥
              ...(privateKey ? { privateKey, passphrase } : { password }),
              // 超时与保活，避免无响应长期挂起
              readyTimeout: 15000,
              keepaliveInterval: 10000,
              keepaliveCountMax: 3,
            });
          break;
        }
        case 'input': {
          if (shellStream) {
            shellStream.write(String(msg.data || ''));
          }
          break;
        }
        case 'resize': {
          const { cols = 120, rows = 30 } = msg.data || {};
          try {
            shellStream?.setWindow(rows, cols, 0, 0);
          } catch {
            /* ignore */
          }
          break;
        }
        case 'close': {
          try {
            shellStream?.end();
          } catch {}
          try {
            ssh.end();
          } catch {}
          ws.close();
          break;
        }
        case 'ping': {
          safeSend({ type: 'pong' });
          break;
        }
      }
    });

    ws.on('close', () => {
      try {
        shellStream?.end();
      } catch {}
      try {
        ssh.end();
      } catch {}
    });
  });

  return wss;
}
