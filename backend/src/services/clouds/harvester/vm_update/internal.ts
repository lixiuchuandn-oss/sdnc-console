import { HarvesterTestParams } from '../types';
import { supportCPUAndMemoryHotplug } from './hotplug';
import { hasOnlySimpleVmSpecFields } from './specFields';
import { applySimpleHarvesterVMSpecPatch } from './applySimpleSpecPatch';
import { applyComplexHarvesterVMSpecPatch } from './applyComplexSpecPatch';
import { validateHugepagesSpec } from './validateHugepages';
import { validateNumaSpec } from './validateNuma';

export const updateHarvesterVMSpecInternal = async (
  { endpoint, token, insecure = false }: HarvesterTestParams,
  namespace: string,
  name: string,
  spec: any,
  current: any,
  origin: string,
): Promise<any> => {
  // ============================================================================
  // [调试日志] updateHarvesterVMSpec - 长期保留，用于热扩容功能调试
  // ============================================================================
  const timestamp = new Date().toISOString();
  const vmName = `${namespace}/${name}`;

  console.log('\n' + '='.repeat(80));
  console.log(`[${timestamp}] updateHarvesterVMSpec - VM: ${vmName}`);
  console.log('='.repeat(80));

  const resourceVersion = current?.metadata?.resourceVersion;
  console.log('\n📌 [资源版本]');
  console.log(`  resourceVersion: ${resourceVersion ?? 'undefined'}`);

  console.log('\n📥 [请求参数]');
  console.log(JSON.stringify(spec, null, 2));

  const currentCpuForLog = current?.spec?.template?.spec?.domain?.cpu || {};
  const currentTotalCpu =
    (currentCpuForLog.sockets || 1) *
    (currentCpuForLog.cores || 1) *
    (currentCpuForLog.threads || 1);
  console.log('\n💻 [当前 VM CPU 状态]');
  console.log(
    `  拓扑: ${currentCpuForLog.sockets || 1} sockets × ${currentCpuForLog.cores || 1} cores × ${currentCpuForLog.threads || 1} threads = ${currentTotalCpu} 核`,
  );
  console.log(`  maxSockets: ${currentCpuForLog.maxSockets ?? 'undefined'}`);

  const hotPlugAnnotation =
    current?.metadata?.annotations?.['harvesterhci.io/enableCPUAndMemoryHotplug'];
  const isHotPlugEnabled = supportCPUAndMemoryHotplug(current);
  console.log('\n🔥 [当前 VM 热扩容状态]');
  console.log(`  Annotation: ${hotPlugAnnotation ?? 'undefined'}`);
  console.log(`  是否启用: ${isHotPlugEnabled ? '✅ 是' : '❌ 否'}`);

  const currentMemoryForLog = current?.spec?.template?.spec?.domain?.memory || {};
  console.log('\n💾 [当前 VM 内存状态]');
  console.log(`  guest: ${currentMemoryForLog.guest ?? 'undefined'}`);
  console.log(
    `  requests.memory: ${current?.spec?.template?.spec?.domain?.resources?.requests?.memory ?? 'undefined'}`,
  );
  console.log(`  maxGuest: ${currentMemoryForLog.maxGuest ?? 'undefined'}`);

  console.log('\n' + '-'.repeat(80));

  validateHugepagesSpec(spec, current);
  validateNumaSpec(spec, current);

  if (hasOnlySimpleVmSpecFields(spec)) {
    return applySimpleHarvesterVMSpecPatch({
      endpoint,
      token,
      insecure,
      namespace,
      name,
      spec,
      current,
      origin,
    });
  }

  const pendingReinstallOldClaims: string[] = [];
  const pendingReinstallOldDataVolumes: string[] = [];
  return applyComplexHarvesterVMSpecPatch(
    { endpoint, token, insecure, namespace, name, spec, current, origin },
    { pendingReinstallOldClaims, pendingReinstallOldDataVolumes },
  );
};
