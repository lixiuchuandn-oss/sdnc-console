/**
 * 虚拟机 · 添加/挂载数据盘与光盘、解绑数据盘、聚合 VM 刷新与重启确认。
 * 供详情磁盘管理等入口复用，不依赖变配弹窗壳层。
 */
import { useState } from 'react';
import { message, Modal } from 'antd';
import type { FormInstance } from 'antd/es/form';
import {
  createHarvesterVolume,
  attachHarvesterVolumeToVm,
  patchHarvesterVm,
  fetchHarvesterVMAggregated,
  fetchHarvesterVmDetail,
  detachHarvesterVolumeFromVm,
} from '../../../../../../../../services/harvesterApi';
import { rebootCloudProviderEcs } from '../../../../../../../../services/api';
import { translateKnownApiErrorMessage } from '../../../../../../../../utils/k8sErrorMessages';
import {
  isHarvesterVmImageReady,
  resolveVmImageKind,
} from '../../../../../../../../utils/harvesterUtils';
import { harvesterCreatedPvcNameFromResponse } from '../../../lib/harvesterVolumeCreateResponse';
import { getMissingNadsFromNetworks } from '../../../lib/harvesterVmNetwork';
import { applyBootOrderCdromFirst } from '../../../lib/vmDiskBootOrder';
import { isRestartRequiredFromVm, isVmStopped } from '../../../lib/vmInstanceStatus';

export type VmDiskAttachEnsureNads = () => Promise<any[]>;

export interface UseVmDiskAttachActionsParams {
  cloudId: string;
  record: any;
  latestVm: any;
  setLatestVm: (v: any) => void;
  activeRecord: any;
  form: FormInstance<any>;
  images: any[];
  ensureNadsLoaded: VmDiskAttachEnsureNads;
  onOk?: (force?: boolean) => void;
  onClose?: () => void;
}

export function useVmDiskAttachActions(p: UseVmDiskAttachActionsParams) {
  const {
    cloudId,
    record,
    latestVm,
    setLatestVm,
    activeRecord,
    form,
    images,
    ensureNadsLoaded,
    onOk,
    onClose,
  } = p;

  const [diskCreating, setDiskCreating] = useState(false);
  const [diskAttaching, setDiskAttaching] = useState(false);
  const [cdromCreating, setCdromCreating] = useState(false);
  const [cdromAttaching, setCdromAttaching] = useState(false);
  const [diskDetaching, setDiskDetaching] = useState(false);

  /** 虚拟光驱（cdrom）在 Harvester 侧总线固定为 SCSI；挂载后必须重启（或关机态下启动后再重启）方可靠生效。 */
  const CDROM_BUS: 'scsi' = 'scsi';

  /**
   * 变更需重启生效时弹出确认：用户可选择立即重启（调用云 API）或稍后手动重启。
   * 若 VM 已停止则通常仅 toast「下次启动生效」；`options.cdrom` 时改为弹窗强调光盘必须走重启链路。
   */
  const openRestartConfirm = (
    namespace: string,
    vmName: string,
    force: boolean = false,
    options?: { cdrom?: boolean },
  ) => {
    const activeVm = latestVm || record;
    if (isVmStopped(activeVm)) {
      if (options?.cdrom) {
        Modal.info({
          title: '光盘配置已保存',
          content:
            '当前虚拟机已关机，规格已写入。添加/挂载光盘后必须重启才能生效：请先启动虚拟机，再执行一次重启（或关机再开），否则光驱可能不可用。',
          okText: '知道了',
        });
        return;
      }
      message.success('设置已保存，下次启动时将自动应用新配置');
      return;
    }

    Modal.confirm({
      title: options?.cdrom
        ? '光盘已挂入规格：必须重启虚拟机后生效，是否立即重启'
        : '规格变更已提交，需要重启实例生效，是否重启实例',
      okText: '立即重启',
      cancelText: '手动重启',
      onOk: async () => {
        try {
          await rebootCloudProviderEcs(cloudId, `${namespace}/${vmName}`, force);
          message.success('重启指令已下发');
        } catch (e: any) {
          message.error(translateKnownApiErrorMessage(String(e?.message || e || '重启失败')));
        }
      },
      onCancel: () => {},
    });
  };

  /** 拉取聚合 VM 数据并更新 `latestVm`，返回更新后的 VM 对象。 */
  const fetchAggregatedVm = async (namespace: string, vmName: string) => {
    const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
    const data = res?.data?.vm ? res.data : res;
    const updatedVm = data?.vm || data;
    if (updatedVm && data?.related) {
      updatedVm.related = data.related;
    }
    setLatestVm(updatedVm);
    return updatedVm;
  };

  /** 将已存在的 ISO PVC（卷名 / claimName 均为 `volName`）挂到 VM 模板为 SCSI cdrom（供挂载步骤复用）。 */
  const attachIsoPvcAsCdromToVm = async (volName: string, bootFromCdrom: boolean) => {
    const vmName = record?.metadata?.name;
    const namespace = record?.metadata?.namespace;
    if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

    const currentNetworks =
      activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
    const nadList = await ensureNadsLoaded();
    const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
    if (missing.length > 0) {
      throw new Error(`虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}`);
    }

    const vmSpecSource = latestVm || record;
    const vmSpec = vmSpecSource?.spec || {};
    const tplSpec = vmSpec?.template?.spec || {};
    const domain = tplSpec?.domain || {};
    const devices = domain?.devices || {};
    const volumes = Array.isArray(tplSpec?.volumes) ? [...tplSpec.volumes] : [];
    const disks = Array.isArray(devices?.disks) ? [...devices.disks] : [];

    const nameTaken =
      volumes.some((v: any) => v?.name === volName) || disks.some((d: any) => d?.name === volName);
    if (nameTaken) {
      throw new Error(`名称 ${volName} 与现有卷/磁盘冲突`);
    }

    volumes.push({
      name: volName,
      persistentVolumeClaim: { claimName: volName },
    });
    disks.push({
      name: volName,
      cdrom: { bus: CDROM_BUS },
    });
    if (bootFromCdrom) {
      applyBootOrderCdromFirst(disks, volName);
    }

    await patchHarvesterVm(cloudId, namespace, vmName, {
      spec: {
        template: {
          spec: {
            ...tplSpec,
            domain: {
              ...domain,
              devices: {
                ...devices,
                disks,
              },
            },
            volumes,
          },
        },
      },
    });

    try {
      const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
      const data = res?.data?.vm ? res.data : res;
      const updatedVm = data?.vm || data;
      if (updatedVm && data?.related) {
        updatedVm.related = data.related;
      }
      setLatestVm(updatedVm);
    } catch {
      /* ignore */
    }
  };

  /**
   * 提交成功后：可选延迟后重新拉取 VM；若仍运行且出现 RestartRequired，则弹重启确认。
   * `force` 为 true 时直接走 `openRestartConfirm`。
   */
  const maybePromptRestart = async (namespace: string, vmName: string, options?: { force?: boolean }) => {
    const force = !!options?.force;
    if (force) {
      openRestartConfirm(namespace, vmName, false);
      return;
    }

    try {
      await new Promise((r) => setTimeout(r, 300));
      const updatedVm = await fetchAggregatedVm(namespace, vmName);

      if (isVmStopped(updatedVm)) {
        message.success('设置已保存，下次启动时将自动应用新配置');
        return;
      }

      if (isRestartRequiredFromVm(updatedVm)) {
        openRestartConfirm(namespace, vmName, false);
      }
    } catch {
      message.info('设置已保存（请检查是否需要重启）');
    }
  };

  /** 「添加磁盘」：按表单创建 PVC（ISO 与普通盘均为仅创建，挂载用底部【挂载磁盘】或第二次提交）。 */
  const handleCreateDisk = async () => {
    if (diskCreating || diskAttaching) return;
    setDiskCreating(true);
    try {
      const src = String(form.getFieldValue('newDiskSource') || 'create');
      if (src === 'existing') {
        message.warning('已选择已有磁盘时，请直接点击【挂载磁盘】');
        return;
      }

      if (src === 'iso') {
        await form.validateFields(['newDiskIsoImage', 'newDiskName', 'newDiskSize', 'newDiskSc', 'newDiskAccessMode']);
      } else {
        await form.validateFields(['newDiskName', 'newDiskSize', 'newDiskSc', 'newDiskAccessMode']);
      }

      const values = form.getFieldsValue();
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const volName = values.newDiskName;
      const accessMode = values.newDiskAccessMode || 'ReadWriteMany';

      if (src === 'iso') {
        const imgVal = String(values.newDiskIsoImage || '').trim();
        const hit = (images || []).find((x: any) => {
          const name = x?.metadata?.name || x?.name;
          const ns = x?.metadata?.namespace || x?.namespace;
          const v = ns && name ? `${ns}/${name}` : name;
          return v === imgVal;
        });
        if (!hit || resolveVmImageKind(hit) !== 'iso' || !isHarvesterVmImageReady(hit)) {
          message.error('请选择有效的 ISO 镜像');
          return;
        }
        const createRes: any = await createHarvesterVolume(cloudId, {
          namespace,
          name: volName,
          size: values.newDiskSize,
          storageClassName: values.newDiskSc,
          accessModes: [accessMode],
          volumeMode: 'Block',
          annotations: { 'harvesterhci.io/imageId': imgVal },
        });
        const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
        form.setFieldsValue({ newDiskCreated: true, newDiskName: actualName });
        message.success('光盘卷已创建');
        return;
      }

      const createRes: any = await createHarvesterVolume(cloudId, {
        namespace,
        name: volName,
        size: values.newDiskSize,
        storageClassName: values.newDiskSc,
        accessModes: [accessMode],
        volumeMode: 'Block',
      });

      const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
      form.setFieldsValue({ newDiskCreated: true, newDiskName: actualName });
      message.success('磁盘卷已创建');
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建磁盘失败');
    } finally {
      setDiskCreating(false);
    }
  };

  /** 将已有 PVC/卷挂载为 VM 的数据盘。 */
  const handleAttachDisk = async () => {
    if (diskCreating || diskAttaching) return;
    setDiskAttaching(true);
    try {
      const diskSrc = String(form.getFieldValue('newDiskSource') || 'create');
      const values =
        diskSrc === 'iso'
          ? await form.validateFields(['newDiskName', 'newDiskCreated'])
          : await form.validateFields(['newDiskName', 'newDiskCreated', 'newDiskBus', 'newDiskMode']);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      {
        const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
        const nadList = await ensureNadsLoaded();
        const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
        if (missing.length > 0) {
          message.error(`挂载失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再挂载磁盘。`);
          return;
        }
      }

      const created = !!values.newDiskCreated;
      if (!created) {
        message.warning('请先创建磁盘或选择已有磁盘');
        return;
      }

      const volName = values.newDiskName;
      const mode = values.newDiskMode || 'spec';

      if (diskSrc === 'iso') {
        if (mode === 'hotplug') {
          message.warning('选择光盘（ISO）仅支持「配置添加」挂载至规格模板；须重启生效，请切换添加方式后重试。');
          return;
        }

        try {
          await attachIsoPvcAsCdromToVm(volName, !!form.getFieldValue('newDiskBootFromCdrom'));
        } catch (e: any) {
          message.error(e?.message || '挂载失败');
          return;
        }

        message.success(
          form.getFieldValue('newDiskBootFromCdrom')
            ? '光盘已挂载并将启动顺序设为优先光驱；须重启后生效（光驱总线固定 SCSI）'
            : '光盘已挂载到虚拟机规格；须重启后生效（光驱总线固定 SCSI）',
        );
        setTimeout(() => {
          openRestartConfirm(namespace, vmName, false, { cdrom: true });
        }, 300);

        form.setFieldsValue({ newDiskCreated: false, newDiskIsoImage: undefined, newDiskBootFromCdrom: false });
        try {
          onOk?.(true);
        } catch {}
        onClose?.();
        return;
      }

      if (mode === 'hotplug') {
        const vmStatus = (latestVm || record)?.status?.printableStatus;
        if (vmStatus !== 'Running') {
          message.warning('仅支持在【运行中】的虚拟机上执行在线热插拔，请先启动虚拟机。');
          return;
        }

        {
          const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
          const nadList = await ensureNadsLoaded();
          const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
          if (missing.length > 0) {
            message.error(`挂载失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再执行在线热插拔。`);
            return;
          }
        }

        await attachHarvesterVolumeToVm(cloudId, `${namespace}/${vmName}`, {
          name: volName,
          pvcName: volName,
          pvcNamespace: namespace,
        });

        try {
          const updated = await fetchAggregatedVm(namespace, vmName);
          setLatestVm(updated);
        } catch (e: any) {
          console.warn('在线热插拔后刷新 VM 数据失败:', e);
        }

        message.success('磁盘已在线热插拔成功（SCSI 总线）');
        try {
          onOk?.(true);
        } catch {}
        onClose?.();
        return;
      }

      {
        const vmSpecSource = latestVm || record;
        const vmSpec = vmSpecSource?.spec || {};
        const tplSpec = vmSpec?.template?.spec || {};
        const domain = tplSpec?.domain || {};
        const devices = domain?.devices || {};
        const volumes = Array.isArray(tplSpec?.volumes) ? [...tplSpec.volumes] : [];
        const disks = Array.isArray(devices?.disks) ? [...devices.disks] : [];

        const volExisting = volumes.find((v: any) => v?.name === volName);
        if (!volExisting) {
          volumes.push({
            name: volName,
            persistentVolumeClaim: { claimName: volName },
          });
        }

        const targetBus = values.newDiskBus || 'virtio';
        const diskExisting = disks.find((d: any) => d?.name === volName);
        if (diskExisting) {
          diskExisting.disk = diskExisting.disk || {};
          diskExisting.disk.bus = targetBus;
        } else {
          disks.push({
            name: volName,
            disk: { bus: targetBus },
          });
        }

        const patchPayload: any = {
          spec: {
            template: {
              spec: {
                ...tplSpec,
                domain: {
                  ...domain,
                  devices: {
                    ...devices,
                    disks,
                  },
                },
                volumes,
              },
            },
          },
        };

        await patchHarvesterVm(cloudId, namespace, vmName, patchPayload);
      }

      try {
        const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
        const data = res?.data?.vm ? res.data : res;
        const updatedVm = data?.vm || data;

        if (updatedVm && data?.related) {
          updatedVm.related = data.related;
        }

        setLatestVm(updatedVm);
      } catch (refreshErr: any) {
        console.warn('刷新VM数据失败:', refreshErr);
      }
      message.success('磁盘挂载成功，设置已保存，需要重启后生效');
      setTimeout(() => {
        openRestartConfirm(namespace, vmName, false);
      }, 300);

      form.setFieldsValue({ newDiskCreated: false });
      try {
        onOk?.(true);
      } catch {}
      onClose?.();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '挂载失败');
    } finally {
      setDiskAttaching(false);
    }
  };

  /** 添加光盘：创建带 ISO imageId 注解的 PVC（第二步用【挂载光盘】挂为 cdrom）。 */
  const handleCreateCdrom = async () => {
    if (cdromCreating || cdromAttaching) return;
    setCdromCreating(true);
    try {
      const values = await form.validateFields([
        'newCdromName',
        'newCdromSize',
        'newCdromImage',
        'newCdromAccessMode',
      ]);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const imgVal = String(values.newCdromImage || '').trim();
      const hit = (images || []).find((x: any) => {
        const name = x?.metadata?.name || x?.name;
        const ns = x?.metadata?.namespace || x?.namespace;
        const v = ns && name ? `${ns}/${name}` : name;
        return v === imgVal;
      });
      if (!hit || resolveVmImageKind(hit) !== 'iso') {
        message.error('请选择有效的 ISO 镜像');
        return;
      }

      const scRaw =
        (hit as any)?.storageClassName || (hit as any)?.spec?.storageClassName;
      const storageClassName =
        scRaw != null && String(scRaw).trim() ? String(scRaw).trim() : '';
      if (!storageClassName) {
        message.error('当前 ISO 未携带存储类信息，请更换镜像或检查镜像数据');
        return;
      }

      const volName = String(values.newCdromName ?? '').trim();
      const accessMode = values.newCdromAccessMode || 'ReadWriteMany';

      const createRes: any = await createHarvesterVolume(cloudId, {
        namespace,
        name: volName,
        size: values.newCdromSize,
        storageClassName,
        accessModes: [accessMode],
        volumeMode: 'Block',
        annotations: {
          'harvesterhci.io/imageId': imgVal,
        },
      });

      const actualName = harvesterCreatedPvcNameFromResponse(createRes, volName);
      form.setFieldsValue({ newCdromCreated: true, newCdromName: actualName });
      message.success('光盘卷已创建');
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建光盘卷失败');
    } finally {
      setCdromCreating(false);
    }
  };

  /** 将已创建的光盘 PVC 挂为虚拟光驱（cdrom，总线固定 SCSI）；须重启生效。 */
  const handleAttachCdrom = async () => {
    if (cdromCreating || cdromAttaching) return;
    setCdromAttaching(true);
    try {
      const values = await form.validateFields(['newCdromName', 'newCdromCreated']);
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      const created = !!values.newCdromCreated;
      if (!created) {
        message.warning('请先创建光盘卷');
        return;
      }

      const volName = values.newCdromName;

      try {
        await attachIsoPvcAsCdromToVm(volName, !!form.getFieldValue('newCdromBootFromCdrom'));
      } catch (e: any) {
        message.error(e?.message || '挂载光盘失败');
        return;
      }

      message.success(
        form.getFieldValue('newCdromBootFromCdrom')
          ? '光盘已挂载并将启动顺序设为优先光驱；须重启后生效（光驱总线固定 SCSI）'
          : '光盘已挂载到虚拟机规格；须重启后生效（光驱总线固定 SCSI）',
      );
      setTimeout(() => {
        openRestartConfirm(namespace, vmName, false, { cdrom: true });
      }, 300);

      form.setFieldsValue({ newCdromCreated: false, newCdromBootFromCdrom: false });
      try {
        onOk?.(true);
      } catch {}
      onClose?.();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '挂载光盘失败');
    } finally {
      setCdromAttaching(false);
    }
  };

  /**
   * 使用聚合接口刷新当前 VM（含 related.volumes）；失败时回退到普通详情接口。
   */
  const refreshVm = async () => {
    if (!cloudId || !record?.metadata?.name || !record?.metadata?.namespace) return;
    try {
      const res: any = await fetchHarvesterVMAggregated(cloudId, record.metadata.namespace, record.metadata.name);

      const data = res?.data?.vm ? res.data : res;

      const updatedVm = data?.vm || data;
      if (updatedVm && data?.related) {
        updatedVm.related = data.related;
      }

      setLatestVm(updatedVm);
    } catch (err: any) {
      console.error('刷新VM数据失败:', err);
      try {
        const res: any = await fetchHarvesterVmDetail(cloudId, record.metadata.namespace, record.metadata.name);
        setLatestVm(res?.data || res);
      } catch (fallbackErr: any) {
        console.error('回退刷新也失败:', fallbackErr);
        throw err;
      }
    }
  };

  /**
   * 解绑指定云硬盘（块设备）：提交前校验 VM 网卡引用的 NAD 仍存在，再调用 detach API 并刷新聚合 VM。
   */
  const handleDetachDisk = async (diskName: string) => {
    if (diskDetaching) return;
    setDiskDetaching(true);
    try {
      const vmName = record?.metadata?.name;
      const namespace = record?.metadata?.namespace;
      if (!vmName || !namespace) throw new Error('无法解析虚拟机信息');

      {
        const currentNetworks = activeRecord?.spec?.template?.spec?.networks || record?.spec?.template?.spec?.networks || [];
        const nadList = await ensureNadsLoaded();
        const missing = getMissingNadsFromNetworks(currentNetworks, String(namespace || 'default'), nadList);
        if (missing.length > 0) {
          message.error(`解绑失败：虚拟机网卡引用的 NAD 不存在：${missing.join(', ')}。请先在【变更网卡】中修复后再解绑磁盘。`);
          return;
        }
      }

      const disks = activeRecord?.spec?.template?.spec?.domain?.devices?.disks ||
        record?.spec?.template?.spec?.domain?.devices?.disks ||
        [];
      const diskEntry = (Array.isArray(disks) ? disks : []).find(
        (d: any) => String(d?.name || '') === String(diskName || ''),
      );
      const diskBus = String(diskEntry?.disk?.bus || diskEntry?.cdrom?.bus || '')
        .toLowerCase()
        .trim();

      const instanceId = `${namespace}/${vmName}`;
      await detachHarvesterVolumeFromVm(cloudId, instanceId, {
        name: diskName,
      });

      try {
        const res: any = await fetchHarvesterVMAggregated(cloudId, namespace, vmName);
        const data = res?.data?.vm ? res.data : res;
        const updatedVm = data?.vm || data;

        if (updatedVm && data?.related) {
          updatedVm.related = data.related;
        }

        setLatestVm(updatedVm);
      } catch (refreshErr: any) {
        console.warn('刷新VM数据失败:', refreshErr);
      }

      if (diskBus === 'scsi') {
        message.success('解绑成功，该卷已从虚拟机移除');
      } else {
        message.success('解绑成功，设置已保存，需要重启虚拟机后生效');
        setTimeout(() => {
          openRestartConfirm(namespace, vmName, false);
        }, 300);
      }

      try {
        onOk?.(true);
      } catch {}
    } catch (e: any) {
      const errorMessage = e?.message || e?.response?.data?.message || '解绑失败';
      message.error(errorMessage);
      throw e;
    } finally {
      setDiskDetaching(false);
    }
  };

  return {
    diskCreating,
    diskAttaching,
    cdromCreating,
    cdromAttaching,
    diskDetaching,
    openRestartConfirm,
    fetchAggregatedVm,
    maybePromptRestart,
    attachIsoPvcAsCdromToVm,
    handleCreateDisk,
    handleAttachDisk,
    handleCreateCdrom,
    handleAttachCdrom,
    refreshVm,
    handleDetachDisk,
  };
}

/** 与 `useVmDiskAttachActions` 相同；变配弹窗仅复用其中的重启确认与聚合刷新 */
export const useVmReconfigureVmDiskActions = useVmDiskAttachActions;
