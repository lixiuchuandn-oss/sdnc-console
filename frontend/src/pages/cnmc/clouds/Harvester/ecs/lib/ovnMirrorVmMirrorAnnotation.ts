import { Modal, message } from 'antd';
import { rebootCloudProviderEcs } from '../../../../../../services/api';
import { fetchHarvesterVMAggregated, updateHarvesterVmSpec } from '../../../../../../services/harvester/vm';
import { translateKnownApiErrorMessage } from '../../../../../../utils/k8sErrorMessages';
import { isVmStopped } from './vmInstanceStatus';
import {
  flattenOvnMirrorFormNicEntries,
  vmRowKey,
  type OvnMirrorFormValues,
} from './ovnMirrorSectionUtils';

const OVN_MIRROR_ANNOTATION_SUFFIX = 'ovn.kubernetes.io/mirror';
const OVN_MIRROR_ANNOTATION_VALUE = 'true';

/** 读取 Pod 模板 metadata.annotations（mirror 注解写入位置，与 update-spec 一致） */
export function readVmTemplateMetadataAnnotations(vm: unknown): Record<string, string> {
  const r = vm as {
    spec?: { template?: { metadata?: { annotations?: Record<string, string> } } };
    rawData?: { spec?: { template?: { metadata?: { annotations?: Record<string, string> } } } };
  };
  return {
    ...(r?.rawData?.spec?.template?.metadata?.annotations || {}),
    ...(r?.spec?.template?.metadata?.annotations || {}),
  };
}

/** 指定网卡是否已存在 mirror 注解 */
export function hasOvnMirrorNicAnnotation(vm: unknown, networkNad: string): boolean {
  if (!vm) return false;
  const key = ovnMirrorNicAnnotationKey(networkNad);
  const val = String(readVmTemplateMetadataAnnotations(vm)[key] || '')
    .trim()
    .toLowerCase();
  return val === OVN_MIRROR_ANNOTATION_VALUE;
}

/** 由 OvnMirror rules[].networkNad 生成 Pod 模板注解键，如 id-sn-xxx.default.ovn.kubernetes.io/mirror */
export function ovnMirrorNicAnnotationKey(networkNad: string): string {
  const nad = String(networkNad || '').trim();
  if (!nad || nad === 'Management Network') {
    return `Management Network.default.${OVN_MIRROR_ANNOTATION_SUFFIX}`;
  }
  if (nad.includes('/')) {
    const slash = nad.indexOf('/');
    const nadNs = nad.slice(0, slash).trim() || 'default';
    const nadName = nad.slice(slash + 1).trim();
    if (!nadName) {
      return `${nadNs}.default.${OVN_MIRROR_ANNOTATION_SUFFIX}`;
    }
    return `${nadName}.${nadNs}.${OVN_MIRROR_ANNOTATION_SUFFIX}`;
  }
  return `${nad}.default.${OVN_MIRROR_ANNOTATION_SUFFIX}`;
}

export type OvnMirrorSourceAnnotationTarget = {
  namespace: string;
  vmName: string;
  networkNad: string;
  vm?: unknown;
  /** 提交前该网卡是否已有 mirror 注解（已有则无需重启提示） */
  mirrorAnnotationAlreadySet?: boolean;
};

export function collectOvnMirrorSourceAnnotationTargets(
  values: OvnMirrorFormValues,
  vms: unknown[],
): OvnMirrorSourceAnnotationTarget[] {
  const list: OvnMirrorSourceAnnotationTarget[] = [];
  for (const entry of flattenOvnMirrorFormNicEntries(values)) {
    const vmKey = String(entry.sourceVmKey || '').trim();
    const [nsFromKey, nameFromKey] = vmKey.split('/').map((s) => s.trim());
    const namespace = String(entry.sourceNamespace || nsFromKey || '').trim();
    const vmName = String(nameFromKey || '').trim();
    const networkNad = String(entry.networkNad || '').trim();
    if (!namespace || !vmName || !networkNad) continue;
    const vm = (Array.isArray(vms) ? vms : []).find((item) => vmRowKey(item) === vmKey);
    list.push({
      namespace,
      vmName,
      networkNad,
      vm,
      mirrorAnnotationAlreadySet: hasOvnMirrorNicAnnotation(vm, networkNad),
    });
  }
  return list;
}

function unwrapAggregatedVmResponse(res: unknown): unknown | undefined {
  const r = res as { data?: { vm?: unknown; related?: unknown } & Record<string, unknown> };
  const data = r?.data?.vm ? r.data : (r?.data ?? res);
  const payload = data as { vm?: unknown; related?: unknown } | undefined;
  const vm = payload?.vm ?? data;
  if (!vm || typeof vm !== 'object') return undefined;
  const out = { ...(vm as object) } as Record<string, unknown>;
  if (payload?.related) out.related = payload.related;
  return out;
}

/** 提交前从集群拉取最新 VM，准确判断 mirror 注解是否已存在 */
export async function refreshOvnMirrorSourceAnnotationTargets(
  cloudId: string,
  targets: OvnMirrorSourceAnnotationTarget[],
): Promise<OvnMirrorSourceAnnotationTarget[]> {
  const vmCache = new Map<string, unknown>();

  return Promise.all(
    targets.map(async (t) => {
      const vmKey = `${t.namespace}/${t.vmName}`;
      let cached = vmCache.get(vmKey);
      if (cached === undefined) {
        let freshVm: unknown | undefined;
        try {
          const res = await fetchHarvesterVMAggregated(cloudId, t.namespace, t.vmName);
          freshVm = unwrapAggregatedVmResponse(res);
        } catch {
          freshVm = undefined;
        }
        cached = { vm: freshVm ?? t.vm, fetchedFromCluster: freshVm != null };
        vmCache.set(vmKey, cached);
      }
      const { vm, fetchedFromCluster } = cached as {
        vm?: unknown;
        fetchedFromCluster: boolean;
      };
      return {
        ...t,
        vm,
        // 拉取失败时不误判为「已有注解」，避免跳过写入与重启提示
        mirrorAnnotationAlreadySet:
          fetchedFromCluster && vm
            ? hasOvnMirrorNicAnnotation(vm, t.networkNad)
            : false,
      };
    }),
  );
}

/** 为源虚拟机 Pod 模板写入 mirror 注解（同一 VM 多网卡合并一次 update-spec） */
export async function applyOvnMirrorSourceVmAnnotations(
  cloudId: string,
  targets: OvnMirrorSourceAnnotationTarget[],
): Promise<void> {
  const byVm = new Map<string, Record<string, string>>();
  for (const t of targets) {
    if (t.mirrorAnnotationAlreadySet) continue;
    const vmKey = `${t.namespace}/${t.vmName}`;
    const annKey = ovnMirrorNicAnnotationKey(t.networkNad);
    const merged = byVm.get(vmKey) || {};
    merged[annKey] = OVN_MIRROR_ANNOTATION_VALUE;
    byVm.set(vmKey, merged);
  }

  const failures: string[] = [];
  await Promise.all(
    Array.from(byVm.entries()).map(async ([vmKey, templateMetadataAnnotations]) => {
      const [namespace, vmName] = vmKey.split('/');
      try {
        await updateHarvesterVmSpec(cloudId, namespace, vmName, {
          templateMetadataAnnotations,
        });
      } catch (e: unknown) {
        const err = e as { message?: string };
        failures.push(
          `${vmKey}: ${translateKnownApiErrorMessage(String(err?.message || e || '写入注解失败'))}`,
        );
      }
    }),
  );

  if (failures.length > 0) {
    throw new Error(`部分虚拟机 mirror 注解写入失败：${failures.join('；')}`);
  }
}

/** 运行中的源虚拟机提示重启；已关机则仅打注解、不弹窗 */
export function showOvnMirrorSourceRestartConfirm(opts: {
  cloudId: string;
  /** 本次新写入 mirror 注解的源条目（已有机内注解的不在此列） */
  targets: OvnMirrorSourceAnnotationTarget[];
}): void {
  const { cloudId, targets } = opts;
  const running = targets.filter((t) => {
    if (t.mirrorAnnotationAlreadySet) return false;
    if (!t.vm) return true;
    return !isVmStopped(t.vm);
  });
  if (running.length === 0) return;

  Modal.confirm({
    getContainer: () => document.body,
    title: '是否立即重启源虚拟机？',
    okText: '立即重启',
    cancelText: '稍后手动重启',
    onOk: async () => {
      const results = await Promise.allSettled(
        running.map((t) =>
          rebootCloudProviderEcs(cloudId, `${t.namespace}/${t.vmName}`, false),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length === 0) {
        message.success(
          running.length > 1 ? `已向 ${running.length} 台虚拟机下发重启指令` : '重启指令已下发',
        );
        return;
      }
      if (failed.length < running.length) {
        message.warning(`部分重启失败：${running.length - failed.length}/${running.length}`);
        return;
      }
      const reason = (failed[0] as PromiseRejectedResult).reason as { message?: string };
      message.error(
        translateKnownApiErrorMessage(String(reason?.message || reason || '重启失败')),
      );
      throw reason;
    },
  });
}
