/**
 * RBD live-migration 三步（prepare → execute → commit）。
 */
import { runToolboxRbdShell } from './sdrsRbdExec';

function rbdId(pool: string, image: string): string {
  return `${String(pool).trim()}/${String(image).trim()}`;
}

export async function runRbdLiveMigration(
  cloud: { endpoint?: string; secretKey?: string; config?: any },
  srcPool: string,
  srcImage: string,
  dstPool: string,
  dstImage: string,
  onStep?: (step: 'prepare' | 'execute' | 'commit', detail: string) => void,
): Promise<void> {
  const src = rbdId(srcPool, srcImage);
  const dst = rbdId(dstPool, dstImage);
  const steps: Array<{ key: 'prepare' | 'execute' | 'commit'; cmd: string }> = [
    { key: 'prepare', cmd: `rbd migration prepare ${src} ${dst}` },
    { key: 'execute', cmd: `rbd migration execute ${dst}` },
    { key: 'commit', cmd: `rbd migration commit ${dst}` },
  ];
  for (const step of steps) {
    const result = await runToolboxRbdShell(cloud, step.cmd);
    onStep?.(step.key, result.stdout);
  }
}
