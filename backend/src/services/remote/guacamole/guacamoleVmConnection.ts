import { AppDataSource } from '../../../config/database';
import { Cloud } from '../../../entities/Cloud';
import { GuacamoleConnectionMap } from '../../../entities/GuacamoleConnectionMap';
import type { GuacamoleInstance } from '../../../entities/GuacamoleInstance';
import { getHarvesterVMAggregated } from '../../clouds/harvester/vm_aggregated';
import { upsertGuacamoleConnection } from './guacamoleConnection';
import {
  buildVmConnectionName,
  buildVmResourceKey,
  defaultDesktopUsername,
  extractVmAlias,
  extractVmIpFromAggregated,
  extractVmOsHint,
  isPoolGatewayEnabled,
  isVmRunning,
  resolveDesktopProtocol,
} from './resolveVmDesktop';
import { resolveGatewayInstanceForCloud } from './guacamoleSession';

export type VmConnectionTarget = {
  cloudId: string;
  namespace: string;
  vmName: string;
  protocol?: string;
  guestUsername?: string;
  guestPassword?: string;
};

export type VmConnectionResult = {
  instance: GuacamoleInstance;
  connectionId: string;
  connectionName: string;
  resourceKey: string;
  protocol: string;
  hostname: string;
  port: number;
  mapId: string;
};

export async function ensureVmGuacamoleConnection(
  input: VmConnectionTarget,
): Promise<VmConnectionResult> {
  const cloudRepo = AppDataSource.getRepository(Cloud);
  const cloud = await cloudRepo.findOne({ where: { id: input.cloudId } });
  if (!cloud) {
    throw Object.assign(new Error('云资源不存在'), { status: 404 });
  }
  if (!isPoolGatewayEnabled(cloud)) {
    throw Object.assign(new Error('本资源池未启用云桌面网关'), { status: 400 });
  }
  const instance = await resolveGatewayInstanceForCloud(cloud);
  if (!instance) {
    throw Object.assign(new Error('请先在系统设置注册云桌面网关'), { status: 400 });
  }

  const namespace = String(input.namespace || '').trim();
  const vmName = String(input.vmName || '').trim();
  if (!namespace || !vmName) {
    throw Object.assign(new Error('缺少 namespace 或 vmName'), { status: 400 });
  }

  const insecure = !!(cloud.config as any)?.ignoreTls;
  const agg = await getHarvesterVMAggregated(
    { endpoint: cloud.endpoint, token: cloud.secretKey || '', insecure } as any,
    namespace,
    vmName,
  );
  const vm = agg?.vm;
  if (!vm) {
    throw Object.assign(new Error('虚拟机不存在'), { status: 404 });
  }
  if (!isVmRunning(vm)) {
    throw Object.assign(new Error('请先启动云主机'), { status: 400 });
  }

  const ip = extractVmIpFromAggregated(vm);
  if (!ip) {
    throw Object.assign(new Error('暂无可用 IP，请确认 Guest Agent 与网络配置'), { status: 400 });
  }

  const relatedImage = agg?.related?.images?.[0];
  const osHint = extractVmOsHint(vm, relatedImage);
  const { protocol, port } = resolveDesktopProtocol(osHint, input.protocol);
  const guestUsername =
    String(input.guestUsername || '').trim() || defaultDesktopUsername(protocol);
  const guestPassword = String(input.guestPassword || '');

  const mapRepo = AppDataSource.getRepository(GuacamoleConnectionMap);
  const resourceKey = buildVmResourceKey(namespace, vmName);
  let map = await mapRepo.findOne({
    where: { cloudId: cloud.id, resourceType: 'vm', resourceKey },
  });

  if (!guestPassword && !map) {
    throw Object.assign(new Error('缺少 Guest 登录密码'), { status: 400 });
  }

  const cloudLabel = String(cloud.name || '').trim() || cloud.id;
  const connectionName = buildVmConnectionName({
    cloudName: cloudLabel,
    namespace,
    vmName,
    alias: extractVmAlias(vm),
    ip,
  });
  const connectionId = await upsertGuacamoleConnection(instance, {
    name: connectionName,
    protocol,
    hostname: ip,
    port,
    username: guestUsername,
    ...(guestPassword ? { password: guestPassword } : {}),
    connectionId: map?.guacConnectionId,
  });
  if (!map) {
    map = mapRepo.create({
      instanceId: instance.id,
      cloudId: cloud.id,
      resourceType: 'vm',
      resourceKey,
      connectionName,
      guacConnectionId: connectionId,
    });
  } else {
    map.instanceId = instance.id;
    map.connectionName = connectionName;
    map.guacConnectionId = connectionId;
  }
  const saved = await mapRepo.save(map);

  return {
    instance,
    connectionId,
    connectionName,
    resourceKey,
    protocol,
    hostname: ip,
    port,
    mapId: saved.id,
  };
}
