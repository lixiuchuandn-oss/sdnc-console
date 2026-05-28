import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { GuacamoleInstance } from '../../../entities/GuacamoleInstance';
import { isPoolGatewayEnabled, readPoolGatewayConfig } from './resolveVmDesktop';

export async function resolveGatewayInstanceForCloud(cloud: Cloud): Promise<GuacamoleInstance | null> {
  const repo = AppDataSource.getRepository(GuacamoleInstance);
  const poolCfg = readPoolGatewayConfig(cloud);
  if (poolCfg.instanceId) {
    const inst = await repo.findOne({ where: { id: poolCfg.instanceId } });
    if (inst) return inst;
  }
  const defaultInst = await repo.findOne({ where: { isDefault: true } });
  if (defaultInst) return defaultInst;
  const all = await repo.find({ order: { createdAt: 'ASC' }, take: 1 });
  return all[0] || null;
}

export async function getPoolGatewayAccess(cloudId: string): Promise<{
  registered: boolean;
  poolEnabled: boolean;
  ready: boolean;
  instanceId?: string;
  message?: string;
}> {
  const cloud = await AppDataSource.getRepository(Cloud).findOne({ where: { id: cloudId } });
  if (!cloud) {
    return { registered: false, poolEnabled: false, ready: false, message: '资源池不存在' };
  }
  const poolEnabled = isPoolGatewayEnabled(cloud);
  const instance = await resolveGatewayInstanceForCloud(cloud);
  const registered = !!instance;
  const ready = registered && poolEnabled;
  let message: string | undefined;
  if (!registered) message = '请先在系统设置注册云桌面网关';
  else if (!poolEnabled) message = '请为本资源池启用云桌面网关接入';
  return {
    registered,
    poolEnabled,
    ready,
    instanceId: instance?.id,
    message,
  };
}
