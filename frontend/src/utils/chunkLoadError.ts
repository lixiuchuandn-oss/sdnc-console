/** Webpack / React.lazy 分片加载失败（发版后旧 hash 404、网络瞬断等） */
export function isChunkLoadError(error: unknown): boolean {
  const msg = String((error as Error)?.message || error || '');
  return (
    /Loading chunk [\d]+ failed/i.test(msg) ||
    /ChunkLoadError/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

const CHUNK_RELOAD_FLAG = 'tower-chunk-auto-reload';

/** 分片失败时自动整页刷新一次，避免用户必须手动强刷 */
export function tryAutoReloadOnChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return false;
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export function clearChunkAutoReloadFlag(): void {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
  } catch {
    /* ignore */
  }
}
