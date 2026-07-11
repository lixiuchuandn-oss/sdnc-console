import http from 'http';
import jwt from 'jsonwebtoken';
import { assertConsoleWsAccess } from './wsConsoleAccess';
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
  /** linux：兼容 bash 回退；none：网络设备 CLI，不注入 bash/PS1 */
  bootstrap?: 'linux' | 'none';
}

interface WsMessage {
  type: 'connect' | 'input' | 'resize' | 'close' | 'ping';
  data?: unknown;
}

function formatSshError(err: Error, host: string, username: string): string {
  const raw = String(err?.message || err || '').trim();
  const lower = raw.toLowerCase();
  if (
    lower.includes('all configured authentication methods failed') ||
    lower.includes('authentication failed') ||
    lower.includes('permission denied')
  ) {
    return `SSH 认证失败：请核对设备 ${username}@${host} 的用户名与密码（非 SDNC 控制台登录密码）`;
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return `SSH 连接超时：无法访问 ${host}:22，请确认 SDNC 与设备管理口网络可达`;
  }
  if (lower.includes('econnrefused') || lower.includes('connect econnrefused')) {
    return `SSH 连接被拒绝：${host}:22 未开放或端口不正确`;
  }
  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
    return `SSH 无法解析主机：${host}`;
  }
  return raw ? `SSH 错误：${raw}` : 'SSH 连接失败';
}

function openShellSession(params: {
  ssh: SSHClient;
  ws: WebSocket;
  cols: number;
  rows: number;
  networkCli: boolean;
  safeSend: (payload: Record<string, unknown>) => void;
  onStream: (stream: ClientChannel | null) => void;
}) {
  const { ssh, ws, cols, rows, networkCli, safeSend, onStream } = params;

  ssh.shell(
    {
      cols,
      rows,
      term: 'xterm-256color',
    },
    (err: Error | undefined, stream: ClientChannel) => {
      if (err) {
        safeSend({ type: 'error', message: `打开 Shell 失败: ${err.message}` });
        ws.close();
        ssh.end();
        return;
      }

      onStream(stream);
      safeSend({ type: 'ready' });

      if (!networkCli) {
        try {
          stream.write('\r');
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          try {
            stream.write('\x03');
          } catch {
            /* ignore */
          }
        }, 120);
        setTimeout(() => {
          try {
            stream.write('\r');
          } catch {
            /* ignore */
          }
        }, 250);
        setTimeout(() => {
          try {
            stream.write('export PS1="\\u@\\h:\\w\\$ "\n');
          } catch {
            /* ignore */
          }
        }, 350);
        setTimeout(() => {
          try {
            stream.write('printf "\\n"\n');
          } catch {
            /* ignore */
          }
        }, 450);
      } else {
        try {
          stream.write('\r');
        } catch {
          /* ignore */
        }
      }

      let receivedOnce = false;
      const fallbackTimer = networkCli
        ? null
        : setTimeout(() => {
            if (receivedOnce) return;
            ssh.exec(
              'bash -li',
              { pty: { rows, cols, term: 'xterm-256color' } },
              (execErr: Error | undefined, execStream: ClientChannel) => {
                if (execErr) return;
                try {
                  stream.removeAllListeners();
                } catch {
                  /* ignore */
                }
                onStream(execStream);
                try {
                  execStream.write('\r');
                } catch {
                  /* ignore */
                }
                execStream.on('data', (data: Buffer) => {
                  safeSend({ type: 'data', data: data.toString('utf8') });
                });
                execStream.on('close', () => {
                  safeSend({ type: 'close' });
                  try {
                    ws.close();
                  } catch {
                    /* ignore */
                  }
                  try {
                    ssh.end();
                  } catch {
                    /* ignore */
                  }
                });
              },
            );
          }, 1000);

      stream.on('data', (data: Buffer) => {
        safeSend({ type: 'data', data: data.toString('utf8') });
        receivedOnce = true;
      });
      stream.on('close', () => {
        safeSend({ type: 'close' });
        ws.close();
        ssh.end();
        if (fallbackTimer) {
          try {
            clearTimeout(fallbackTimer);
          } catch {
            /* ignore */
          }
        }
      });
      stream.stderr?.on('data', (data: Buffer) => {
        safeSend({ type: 'data', data: data.toString('utf8') });
      });
    },
  );
}

export function createSshWsServer() {
  const wss = new WebSocketServer({ noServer: true, path: '/ws/ssh', perMessageDeflate: false });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    try {
      if (!token) throw new Error('缺少 token');
      const decoded: jwt.JwtPayload & { role?: string; permissions?: string[] } = jwt.verify(
        token,
        process.env.JWT_SECRET || 'your-secret-key',
      ) as jwt.JwtPayload & { role?: string; permissions?: string[] };
      if (!decoded || !decoded.role) throw new Error('无效令牌');
      assertConsoleWsAccess(decoded);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '鉴权失败';
      ws.send(JSON.stringify({ type: 'error', message }));
      ws.close();
      return;
    }

    let activeSsh: SSHClient | null = null;
    let shellStream: ClientChannel | null = null;

    const safeSend = (payload: Record<string, unknown>) => {
      try {
        ws.send(JSON.stringify(payload), { compress: false });
      } catch {
        /* ignore */
      }
    };

    const teardownSsh = () => {
      try {
        shellStream?.end();
      } catch {
        /* ignore */
      }
      shellStream = null;
      try {
        activeSsh?.end();
      } catch {
        /* ignore */
      }
      activeSsh = null;
    };

    ws.on('message', (raw: RawData) => {
      let msg: WsMessage | null = null;
      try {
        msg = JSON.parse(String(raw)) as WsMessage;
      } catch {
        msg = null;
      }
      if (!msg) return;

      switch (msg.type) {
        case 'connect': {
          const p = (msg.data || {}) as ConnectPayload;
          const {
            host,
            port = 22,
            username,
            password,
            privateKey,
            passphrase,
            cols = 120,
            rows = 30,
            bootstrap = 'linux',
          } = p;
          const networkCli = bootstrap === 'none';
          const authPassword = password != null ? String(password) : '';

          if (!host || !username || (!authPassword && !privateKey)) {
            safeSend({ type: 'error', message: '缺少连接参数（host/username/密码或私钥）' });
            return;
          }

          teardownSsh();

          const ssh = new SSHClient();
          activeSsh = ssh;

          if (authPassword && !privateKey) {
            ssh.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
              finish(prompts.map(() => authPassword));
            });
          }

          ssh.on('ready', () => {
            openShellSession({
              ssh,
              ws,
              cols,
              rows,
              networkCli,
              safeSend,
              onStream: (stream) => {
                shellStream = stream;
              },
            });
          });

          ssh.on('error', (err: Error) => {
            safeSend({
              type: 'error',
              message: formatSshError(err, host, username),
            });
          });

          ssh.on('end', () => {
            safeSend({ type: 'close' });
          });

          ssh.connect({
            host,
            port,
            username,
            tryKeyboard: Boolean(authPassword && !privateKey),
            ...(privateKey ? { privateKey, passphrase } : { password: authPassword }),
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
          const size = (msg.data || {}) as { cols?: number; rows?: number };
          const cols = size.cols ?? 120;
          const rows = size.rows ?? 30;
          try {
            shellStream?.setWindow(rows, cols, 0, 0);
          } catch {
            /* ignore */
          }
          break;
        }
        case 'close': {
          teardownSsh();
          ws.close();
          break;
        }
        case 'ping': {
          safeSend({ type: 'pong' });
          break;
        }
        default:
          break;
      }
    });

    ws.on('close', () => {
      teardownSsh();
    });
  });

  return wss;
}
