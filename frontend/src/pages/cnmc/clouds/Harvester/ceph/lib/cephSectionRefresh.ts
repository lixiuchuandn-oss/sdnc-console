import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';

export {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
};

/** Section 自拉列表时：本地 load + 可选池层 onRefresh */
export function mergeCephSectionOnRefresh(
  localLoad: (force?: boolean) => void | Promise<void>,
  poolOnRefresh?: HarvesterSectionOnRefresh,
): HarvesterSectionOnRefresh {
  return (force?: boolean, silent?: boolean) => {
    const shouldForce = force !== false;
    const local = Promise.resolve(localLoad(shouldForce));
    if (!poolOnRefresh) return local.then(() => undefined);
    return Promise.all([
      local,
      Promise.resolve(poolOnRefresh(force, silent)),
    ]).then(() => undefined);
  };
}
