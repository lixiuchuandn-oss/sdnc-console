import { HarvesterTestParams } from '../types';
import { getHarvesterVM } from '../vm';
import { updateHarvesterVMSpecInternal } from './internal';

/**
 * ==============================================================================
 * 服务名称: Harvester 虚拟机规格变更服务 (Harvester VM Spec Update Service)
 * 文件路径: backend/src/services/clouds/harvester/vm_update/
 * ==============================================================================
 *
 * [功能描述]
 * 处理虚拟机配置变更请求，支持 CPU/内存调整、磁盘管理、网络配置、CloudInit 更新、
 * 热扩容配置、重装系统等复杂的规格变更操作。
 *
 * [模块划分]
 * - update.ts: 对外入口与 409 重试
 * - internal.ts: 简单/复杂 Patch 分流与业务逻辑
 * - hotplug.ts: 热扩容 Annotation 判定
 * - reinstall.helpers.ts: 重装系统盘相关辅助函数
 * ==============================================================================
 */

/**
 * 更新虚拟机规格（外部接口）
 */
export const updateHarvesterVMSpec = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  spec: any,
  maxRetries: number = 3,
): Promise<any> => {
  const base = (endpoint || '').replace(/\/+$/, '');
  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  let retryCount = 0;
  let current = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);

  while (retryCount < maxRetries) {
    try {
      return await updateHarvesterVMSpecInternal(
        { endpoint, token, insecure },
        namespace,
        name,
        spec,
        current,
        origin,
      );
    } catch (error: any) {
      if (error?.status === 409) {
        retryCount++;
        if (retryCount >= maxRetries) {
          throw {
            status: 409,
            message: `操作无法完成：虚拟机 "${name}" 对象有更新；请更新到最新的版本后重试`,
            body: error.body,
          };
        }

        console.log(
          `\n⚠️  [资源版本冲突] 检测到 409 Conflict，重新获取最新版本 (重试 ${retryCount}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        current = await getHarvesterVM({ endpoint, token, insecure }, namespace, name);
        console.log(
          `✅ [重试] 已获取最新版本，resourceVersion: ${current?.metadata?.resourceVersion ?? 'N/A'}\n`,
        );
        continue;
      }
      throw error;
    }
  }

  throw new Error('更新失败：达到最大重试次数');
};
