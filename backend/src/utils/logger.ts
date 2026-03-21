/**
 * 统一日志：按环境变量控制粒度，避免开发时刷屏。
 *
 * 环境变量：
 * - LOG_LEVEL：silent | error | warn | info | debug（默认 info）
 *   - info：常规启动与业务提示；不输出 K8s Watch 连接细节（见 debug）
 *   - debug：输出 Watch 建立/断开、SSE 良性中断等排障信息
 * - HTTP_LOG：off | tiny | dev | combined（默认 tiny）
 *   - off：不打印每条 HTTP 请求
 *   - tiny：单行简短访问日志（推荐）
 *   - combined：完整访问日志（很吵，仅排查时需要）
 */

type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function parseLogLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || 'info').toLowerCase();
  if (
    raw === 'silent' ||
    raw === 'error' ||
    raw === 'warn' ||
    raw === 'info' ||
    raw === 'debug'
  ) {
    return raw;
  }
  return 'info';
}

const activeLevel = parseLogLevel();

function should(level: Exclude<LogLevel, 'silent'>): boolean {
  if (activeLevel === 'silent') return false;
  return LEVEL_RANK[activeLevel] >= LEVEL_RANK[level];
}

function bindPrefix(prefix: string) {
  return {
    error: (...args: unknown[]) => {
      if (should('error')) console.error(prefix, ...args);
    },
    warn: (...args: unknown[]) => {
      if (should('warn')) console.warn(prefix, ...args);
    },
    info: (...args: unknown[]) => {
      if (should('info')) console.log(prefix, ...args);
    },
    debug: (...args: unknown[]) => {
      if (should('debug')) console.log(prefix, ...args);
    },
  };
}

const root = bindPrefix('[tower]');

export const logger = {
  ...root,
  /** 子模块前缀，如 logger.child('watch') -> [tower][watch] */
  child(scope: string) {
    return bindPrefix(`[tower][${scope}]`);
  },
};

/** 当前 LOG_LEVEL，供其它模块做条件分支（尽量少用） */
export const logLevel = activeLevel;

/** HTTP 访问日志格式名，供 index 挂载 morgan；无效时回退 tiny */
export function resolveMorganFormat(): 'off' | 'tiny' | 'dev' | 'combined' {
  const raw = (process.env.HTTP_LOG || 'tiny').toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return 'off';
  if (raw === 'dev') return 'dev';
  if (raw === 'combined' || raw === 'common') return 'combined';
  return 'tiny';
}
