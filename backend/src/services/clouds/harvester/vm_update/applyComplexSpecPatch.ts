/**
 * Harvester VM 变配 — 全量 Patch（磁盘/网络/CloudInit/重装等）。
 */
import { requestJson } from '../utils';
import {
  createHarvesterSecret,
  createHarvesterPVCVolume,
  getHarvesterImage,
  updatePVCSpec,
} from '../storage';
import { syncVmVolumeSize } from '../vm';
import { supportCPUAndMemoryHotplug } from './hotplug';
import {
  collectPvcClaimNamesFromVolumes,
  resolvePvcClaimNameFromDataVolume,
  resolveReinstallRootBootDisk,
  deleteReinstallOldRootStorageClaims,
} from './reinstall.helpers';

export type ComplexSpecPatchParams = {
  endpoint: string;
  token: string;
  insecure: boolean;
  namespace: string;
  name: string;
  spec: any;
  current: any;
  origin: string;
};

export type ReinstallPendingStorage = {
  pendingReinstallOldClaims: string[];
  pendingReinstallOldDataVolumes: string[];
};

export const applyComplexHarvesterVMSpecPatch = async (
  p: ComplexSpecPatchParams,
  pending: ReinstallPendingStorage,
): Promise<any> => {
  const { endpoint, token, insecure, namespace, name, spec, current, origin } = p;

  // [复杂变更] 全量 Patch 策略
  // ---------------------------------------------------------
  // 当涉及复杂字段（如磁盘、网络、CloudInit）时，我们不能简单地 merge-patch。
  // 必须采用 "Read -> Clone -> Modify -> Patch" 的模式：
  // 1. 获取当前 VM 完整 Spec。
  // 2. 深拷贝以避免副作用。
  // 3. 在副本上应用复杂的业务逻辑（如 CloudInit Secret 生成）。
  // 4. 发送全量 Spec 更新。
  // ---------------------------------------------------------
  const newSpec = current.spec ? JSON.parse(JSON.stringify(current.spec)) : {};

  /** 与前端变配约定：在 interfaces/networks 等复杂变更时合并 VM 根 metadata.annotations（如 harvesterhci.io/custom-ip）。 */
  const vmMetadataAnnotationsRaw = spec?.vmMetadataAnnotations;
  if (vmMetadataAnnotationsRaw !== undefined) {
    delete spec.vmMetadataAnnotations;
  }
  /** VM 根 metadata.annotations 补丁（须写入 mergedRootMetadata，不可写 spec.template.metadata） */
  const rootVmAnnotationPatches: Record<string, string | null> = {};

  // Ensure structure exists
  if (!newSpec.template) newSpec.template = {};
  if (!newSpec.template.spec) newSpec.template.spec = {};
  if (!newSpec.template.spec.domain) newSpec.template.spec.domain = {};
  const domain = newSpec.template.spec.domain;

  const ensureResources = () => {
    if (!domain.resources) domain.resources = {};
    if (!domain.resources.requests) domain.resources.requests = {};
    if (!domain.resources.limits) domain.resources.limits = {};
  };
  const ensureCpu = () => {
    if (!domain.cpu) domain.cpu = {};
  };

  // --- 1. [业务逻辑] CloudInit (UserData / NetworkData) ---
  // ---------------------------------------------------------
  // 为了避免 VM Spec 过大，我们不建议将 CloudInit 数据内联在 Spec 中。
  // 最佳实践：
  // 1. [提取数据]: 将 userData 和 networkData 从 Spec 中剥离。
  // 2. [保留旧数据]: 尝试读取旧的 Secret，防止只更新 UserData 时丢失 NetworkData (反之亦然)。
  // 3. [创建 Secret]: 将合并后的数据封装为新的 K8s Secret。
  // 4. [引用 Secret]: 在 VM Spec 中通过 cloudInitNoCloud.secretRef 引用该新 Secret。
  // ---------------------------------------------------------
  // If the patch spec contains networkData or userData, we need to create/update the CloudInit Secret
  // and update the VM's volume reference.
  if (spec.networkData || spec.userData) {
    const vmName = name;
    const volumes = newSpec.template.spec.volumes || [];
    let ciVolIndex = volumes.findIndex((v: any) => v.cloudInitNoCloud);

    // If no CloudInit volume exists, create one
    if (ciVolIndex === -1) {
      ciVolIndex = volumes.length;
      volumes.push({
        name: 'cloudinitdisk',
        cloudInitNoCloud: {},
      });
      // Ensure disk exists for this volume
      if (!domain.devices) domain.devices = {};
      if (!domain.devices.disks) domain.devices.disks = [];
      const disks = domain.devices.disks;
      if (!disks.find((d: any) => d.name === 'cloudinitdisk')) {
        disks.push({
          name: 'cloudinitdisk',
          disk: { bus: 'virtio' },
        });
      }
    }

    const ciVol = volumes[ciVolIndex];
    // Generate new secret name to ensure update
    const secretName = `${vmName}-${Math.random().toString(36).substring(2, 7)}-cloudinit`;

    // Prepare Secret Data
    const data: any = {};

    // Inherit existing data if only one field is being updated
    // We need to fetch the existing secret if we want to preserve the *other* field (e.g. update IP but keep UserData)
    // For now, let's assume if the user provides one, they might provide both or we might overwrite.
    // BUT, safely, we should try to read the old secret if it exists.
    // However, reading secrets might require extra permissions or logic.
    // Strategy: If the user provides `networkData`, we use it. If `userData` is provided, use it.
    // If one is missing in the update, we ideally want to keep the old value.
    // To keep it simple and robust:
    // 1. If we have a secretRef, try to read the old secret content?
    //    That's expensive.
    //    Alternative: The frontend should send BOTH if it wants to preserve BOTH.
    //    Frontend `useVmReconfigure` currently doesn't fetch UserData.
    //    Harvester UI typically re-sends the whole CloudInit config or just updates what changed.
    //    Let's stick to: "Update what is provided". If `networkData` is provided, we write it.
    //    If `userData` is NOT provided, we might lose it if we create a NEW secret.
    //
    //    CRITICAL: If we replace the secretRef, we MUST ensure the new secret has all necessary data.
    //    If we can't read the old secret, we risk data loss (e.g. SSH keys in UserData).
    //
    //    Solution: The frontend should be responsible for providing the FULL CloudInit data if it wants to replace it.
    //    OR, we implement a "Fetch old secret" logic here.
    //    Given this is a backend service, we CAN fetch the secret.

    let oldUserData = '';
    let oldNetworkData = '';

    if (ciVol.cloudInitNoCloud?.secretRef?.name) {
      try {
        const oldSecretName = ciVol.cloudInitNoCloud.secretRef.name;
        // Fetch old secret
        const oldSecret = await requestJson(
          'GET',
          `${origin}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(oldSecretName)}`,
          token,
          insecure,
        );
        if (oldSecret && oldSecret.data) {
          if (oldSecret.data.userdata)
            oldUserData = Buffer.from(oldSecret.data.userdata, 'base64').toString();
          if (oldSecret.data.networkdata)
            oldNetworkData = Buffer.from(oldSecret.data.networkdata, 'base64').toString();
          // 保留 Secret 中其它键（如 meta-data、vendor-data），避免仅改 user/network 时丢失高级内容
          for (const [key, val] of Object.entries(oldSecret.data)) {
            const lk = String(key).toLowerCase();
            if (lk === 'userdata' || lk === 'networkdata') continue;
            if (typeof val === 'string' && val.length > 0) {
              data[key] = val;
            }
          }
        }
      } catch (e) {
        console.warn(`[UpdateVM] Failed to fetch old CloudInit secret: ${e}`);
      }
    } else if (ciVol.cloudInitNoCloud?.userData) {
      oldUserData = ciVol.cloudInitNoCloud.userData;
    } else if (ciVol.cloudInitNoCloud?.networkData) {
      oldNetworkData = ciVol.cloudInitNoCloud.networkData;
    }

    // Merge new data
    const finalUserData = spec.userData !== undefined ? spec.userData : oldUserData;
    const finalNetworkData = spec.networkData !== undefined ? spec.networkData : oldNetworkData;

    if (finalUserData) data.userdata = Buffer.from(finalUserData).toString('base64');
    if (finalNetworkData) data.networkdata = Buffer.from(finalNetworkData).toString('base64');

    const cloudInitSecret = {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: secretName,
        namespace,
        labels: { 'harvesterhci.io/cloud-init-template': 'harvester' },
      },
      type: 'Opaque',
      data,
    };

    // Create Secret
    await createHarvesterSecret({ endpoint, token, insecure }, namespace, cloudInitSecret);

    // Update VM Volume to point to new secret
    volumes[ciVolIndex] = {
      name: ciVol.name,
      cloudInitNoCloud: {
        secretRef: { name: secretName },
      },
    };

    newSpec.template.spec.volumes = volumes;

    // Cleanup spec
    delete spec.networkData;
    delete spec.userData;
  }

  // --- 0. [业务逻辑] 重装系统 (Reinstall System Disk) ---
  // ---------------------------------------------------------
  // 这是一个破坏性操作，流程非常严谨：
  // 1. [创建新 PVC]: 根据新的镜像 ID 创建全新的 PVC。
  // 2. [替换 Volume]: 修改 VM Spec 中的 Volumes 列表，将 rootdisk 指向新 PVC。
  // 3. [更新注解]: 更新 volumeClaimTemplates，确保 Harvester UI 显示正确的镜像信息。
  // 4. [清理旧数据]: VM PATCH 成功后再删除旧 PVC（见函数末尾 pending.pendingReinstallOldClaims）。
  // ---------------------------------------------------------
  if (spec.action === 'reinstall') {
    const imageInput = spec.image || spec.imageId;
    if (!imageInput) throw new Error('Reinstall requires target image');

    // 0. Resolve Image metadata (for canonical imageId + displayName)
    // Harvester UI expects:
    // - harvesterhci.io/imageId: "namespace/name"
    // - harvesterhci.io/image-name: displayName (or fallback)
    let imageId = String(imageInput);
    let imageName: string | undefined;
    let imageStorageClassName: string | undefined;
    try {
      const parts = imageId.split('/');
      const imgNs = parts.length === 2 ? parts[0] : namespace;
      const imgName = parts.length === 2 ? parts[1] : parts[0];
      // Try VM namespace first, then fallback to 'default' and 'harvester-public'
      const candidates = [
        { ns: imgNs, name: imgName },
        ...(imgNs === 'default' ? [] : [{ ns: 'default', name: imgName }]),
        ...(imgNs === 'harvester-public' ? [] : [{ ns: 'harvester-public', name: imgName }]),
      ];
      let resolved: any = null;
      for (const c of candidates) {
        resolved = await getHarvesterImage({ endpoint, token, insecure }, c.ns, c.name);
        if (resolved) break;
      }
      if (resolved) {
        imageId = `${resolved.namespace}/${resolved.name}`;
        const ann = resolved?.metadata?.annotations || {};
        imageName =
          ann['field.cattle.io/displayName'] ||
          ann['harvesterhci.io/image-name'] ||
          resolved?.displayName ||
          resolved?.spec?.displayName ||
          resolved?.name;
        imageStorageClassName =
          resolved?.spec?.storageClassName || resolved?.status?.storageClassName;
      }
    } catch (e) {
      console.warn('[Reinstall] Failed to resolve image metadata, fallback to raw imageId', e);
    }

    // Fallback: derive image storage class from image name (common pattern: image-xxxxx -> longhorn-image-xxxxx)
    if (!imageStorageClassName) {
      try {
        const parts = imageId.split('/');
        const imgName = parts.length === 2 ? parts[1] : parts[0];
        const suffix = imgName.startsWith('image-') ? imgName.replace(/^image-/, '') : imgName;
        if (suffix) imageStorageClassName = `longhorn-image-${suffix}`;
      } catch {}
    }

    // ============================================================================
    // [调试日志] 更换操作系统 (Reinstall) - 长期保留，用于功能调试
    // ============================================================================
    console.log('\n' + '='.repeat(80));
    console.log(`[${new Date().toISOString()}] 更换操作系统 - VM: ${namespace}/${name}`);
    console.log('='.repeat(80));

    console.log('\n📥 [重装系统请求参数]');
    console.log(`  镜像: ${imageId}${imageName ? ` (${imageName})` : ''}`);
    console.log(`  容量: ${spec.rootSize || '40Gi'}`);
    console.log(`  总线: ${spec.bus || 'virtio'}`);
    console.log(`  设备类型: ${spec.rootDeviceType || 'disk'}`);
    console.log(`  存储类: ${spec.storageClassName || 'undefined (使用默认)'}`);

    // 当前 VM 的根磁盘信息
    const disks = domain.devices?.disks || [];
    const volumes = newSpec.template.spec.volumes || [];
    const pvcClaimsBeforeReinstall = collectPvcClaimNamesFromVolumes(volumes);
    const bootDisk = resolveReinstallRootBootDisk(disks);
    const rootDiskName = String(bootDisk?.name || '').trim();
    const rootVolume = volumes.find((v: any) => v.name === rootDiskName);
    const oldPvcName = String(rootVolume?.persistentVolumeClaim?.claimName || '').trim();
    const oldDvName = String(rootVolume?.dataVolume?.name || '').trim();

    console.log('\n💾 [当前根磁盘信息]');
    console.log(`  磁盘名称: ${rootDiskName || '未找到'}`);
    console.log(`  当前 PVC: ${oldPvcName || '未找到'}`);
    console.log(`  当前 DataVolume: ${oldDvName || '未找到'}`);
    console.log(`  当前总线: ${bootDisk?.disk?.bus || bootDisk?.cdrom?.bus || 'virtio'}`);
    console.log(`  设备类型: ${bootDisk?.disk ? 'disk' : bootDisk?.cdrom ? 'cdrom' : 'unknown'}`);

    console.log('\n' + '-'.repeat(80));

    // 1. Identify Root Disk (first disk or bootOrder 1)
    if (!rootDiskName) throw new Error('Cannot identify root disk for reinstall');

    // 2. Create NEW PVC
    const newPvcName = `${name}-disk-0-${Math.random().toString(36).substring(2, 7)}`;

    console.log('\n🔨 [创建新 PVC]');
    console.log(`  展示名(注解 alias): ${newPvcName}`);
    console.log(`  命名空间: ${namespace}`);
    console.log(`  容量: ${spec.rootSize || '40Gi'}`);
    console.log(`  存储类: ${spec.storageClassName || 'undefined (使用默认)'}`);
    console.log(`  卷模式: Block`);
    console.log(`  镜像注解: harvesterhci.io/imageId=${imageId}`);

    const createdPvc = await createHarvesterPVCVolume(
      { endpoint, token, insecure },
      {
        namespace,
        name: newPvcName,
        size: spec.rootSize || '40Gi',
        // Root disk created from Harvester Image should use image storage class (longhorn-image-xxx)
        storageClassName: imageStorageClassName || spec.storageClassName,
        // Image volumes commonly use RWX
        accessModes: imageStorageClassName ? ['ReadWriteMany'] : undefined,
        volumeMode: 'Block',
        annotations: {
          'harvesterhci.io/imageId': imageId,
          ...(imageName ? { 'harvesterhci.io/image-name': imageName } : {}),
        },
      },
    );
    /** createHarvesterPVCVolume 实际使用生成的 metadata.name，与请求中的展示名可能不一致 */
    const actualPvcName = String(createdPvc?.metadata?.name || '').trim();
    if (!actualPvcName) {
      throw new Error('重装系统失败：已创建 PVC 但未返回 metadata.name，无法挂载到虚拟机');
    }

    console.log(`✅ [PVC 创建成功] ${actualPvcName}（展示/期望名: ${newPvcName}）`);

    // 3. Update VM Spec to point to new PVC
    const volIndex = volumes.findIndex((v: any) => v.name === rootDiskName);
    if (volIndex !== -1) {
      console.log('\n🔄 [更新 VM Volume 配置]');
      console.log(`  旧 PVC: ${oldPvcName || '未找到'}`);
      console.log(`  新 PVC claimName: ${actualPvcName}`);
      console.log(`  Volume 索引: ${volIndex}`);

      volumes[volIndex] = {
        name: rootDiskName,
        persistentVolumeClaim: {
          claimName: actualPvcName,
        },
      };
    } else {
      throw new Error(`Volume definition for disk ${rootDiskName} not found`);
    }

    // Update bus and device type if requested
    if (spec.bus || spec.rootDeviceType) {
      const dIndex = disks.findIndex((d: any) => d.name === rootDiskName);
      if (dIndex !== -1) {
        const currentBus = disks[dIndex].disk?.bus || disks[dIndex].cdrom?.bus || 'virtio';
        const newBus = spec.bus || currentBus;

        console.log('\n🔧 [更新磁盘设备配置]');
        console.log(`  当前总线: ${currentBus}`);
        console.log(`  新总线: ${newBus}`);
        console.log(`  设备类型: ${spec.rootDeviceType || '保持原样'}`);

        // Handle Device Type Switching (disk <-> cdrom)
        if (spec.rootDeviceType === 'cdrom') {
          disks[dIndex].cdrom = { bus: newBus };
          delete disks[dIndex].disk;
          console.log(`  ✅ 已切换为 CD-ROM 设备`);
        } else if (spec.rootDeviceType === 'disk') {
          disks[dIndex].disk = { bus: newBus };
          delete disks[dIndex].cdrom;
          console.log(`  ✅ 已切换为 Disk 设备`);
        } else {
          // Just update bus on existing type
          if (disks[dIndex].disk) {
            disks[dIndex].disk.bus = newBus;
            console.log(`  ✅ 已更新 Disk 总线为 ${newBus}`);
          }
          if (disks[dIndex].cdrom) {
            disks[dIndex].cdrom.bus = newBus;
            console.log(`  ✅ 已更新 CD-ROM 总线为 ${newBus}`);
          }
        }
      }
    }

    // 4. Update VM / Template annotations (列表与 UI 以 VM 根 metadata 上的 volumeClaimTemplates 为准)
    if (!newSpec.template.metadata) newSpec.template.metadata = {};
    if (!newSpec.template.metadata.annotations) newSpec.template.metadata.annotations = {};

    rootVmAnnotationPatches['harvesterhci.io/imageId'] = imageId;
    newSpec.template.metadata.annotations['harvesterhci.io/imageId'] = imageId;
    if (imageName) {
      rootVmAnnotationPatches['harvesterhci.io/image-name'] = imageName;
      newSpec.template.metadata.annotations['harvesterhci.io/image-name'] = imageName;
    }

    // Update volumeClaimTemplates to reflect new PVC config (Size, Image, StorageClass)
    try {
      const vctStr =
        current?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'] ||
        newSpec?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
      let vct = [];
      if (vctStr) {
        try {
          vct = JSON.parse(vctStr);
        } catch {}
      }

      console.log('\n📋 [更新 volumeClaimTemplates]');
      console.log(`  旧模板数量: ${Array.isArray(vct) ? vct.length : 0}`);

      // Construct new template for root disk
      const newRootTemplate: any = {
        metadata: {
          name: actualPvcName,
          annotations: {
            'harvesterhci.io/imageId': imageId,
            ...(imageName ? { 'harvesterhci.io/image-name': imageName } : {}),
          },
        },
        spec: {
          // Root disk created from image should match Harvester default (often RWX on longhorn-image-*)
          accessModes: imageStorageClassName ? ['ReadWriteMany'] : ['ReadWriteOnce'],
          resources: {
            requests: {
              storage: spec.rootSize || '40Gi',
            },
          },
          volumeMode: 'Block',
          ...(imageStorageClassName ? { storageClassName: imageStorageClassName } : {}),
        },
      };

      // 如果没有解析到镜像 storageClassName，则允许显式传入（兼容用户指定存储类的场景）
      if (!imageStorageClassName && spec.storageClassName) {
        newRootTemplate.spec.storageClassName = spec.storageClassName;
      }

      const effectiveSc = imageStorageClassName || spec.storageClassName;
      const effectiveAccess = imageStorageClassName ? 'ReadWriteMany' : 'ReadWriteOnce';
      console.log(`  新模板配置:`);
      console.log(`    - PVC 名称: ${actualPvcName}`);
      console.log(`    - 镜像: ${imageId}${imageName ? ` (${imageName})` : ''}`);
      console.log(`    - 容量: ${spec.rootSize || '40Gi'}`);
      console.log(`    - 存储类: ${effectiveSc || 'undefined'}`);
      console.log(`    - 访问模式: ${effectiveAccess}`);
      console.log(`    - 卷模式: Block`);

      if (Array.isArray(vct)) {
        // Remove old root disk template (identify by old PVC name or simply reset if it's the only one)
        // Strategy: Filter out the old PVC name if we found it, then append new one
        const oldTplNames = [oldPvcName, oldDvName].filter(Boolean);
        if (oldTplNames.length) {
          const beforeCount = vct.length;
          vct = vct.filter(
            (t: any) => !oldTplNames.includes(String(t?.metadata?.name || '').trim()),
          );
          console.log(
            `  已移除旧模板 (${oldTplNames.join(', ')}): ${beforeCount} -> ${vct.length}`,
          );
        }
        // Also filter out any template that looks like a root disk (has imageId) to be safe?
        // No, user might have multiple disks with images. Better stick to PVC name replacement.

        // Add new template
        vct.push(newRootTemplate);
        console.log(`  已添加新模板: ${vct.length} 个模板`);

        rootVmAnnotationPatches['harvesterhci.io/volumeClaimTemplates'] = JSON.stringify(vct);
      } else {
        rootVmAnnotationPatches['harvesterhci.io/volumeClaimTemplates'] = JSON.stringify([
          newRootTemplate,
        ]);
        console.log(`  初始化新模板数组: 1 个模板`);
      }
    } catch (e) {
      console.warn('Failed to update volumeClaimTemplates annotation during reinstall', e);
    }

    // 根盘曾走 DataVolume 时，移除对应 dataVolumeTemplates，避免与直挂 PVC 的根卷冲突（KubeVirt 报 PVC/DV 异常）
    if (oldDvName && Array.isArray(newSpec.dataVolumeTemplates)) {
      const beforeDvt = newSpec.dataVolumeTemplates.length;
      newSpec.dataVolumeTemplates = newSpec.dataVolumeTemplates.filter(
        (t: any) => String(t?.metadata?.name || '').trim() !== oldDvName,
      );
      if (newSpec.dataVolumeTemplates.length !== beforeDvt) {
        console.log(`[Reinstall] 已从 dataVolumeTemplates 移除根盘条目: ${oldDvName}`);
      }
    }

    const oldClaims: string[] = [];
    const pushClaim = (n: string) => {
      const s = String(n || '').trim();
      if (s && s !== actualPvcName && !oldClaims.includes(s)) oldClaims.push(s);
    };
    pushClaim(oldPvcName);
    if (oldDvName) {
      pending.pendingReinstallOldDataVolumes.push(oldDvName);
      const pvcFromDv = await resolvePvcClaimNameFromDataVolume(
        { endpoint, token, insecure },
        namespace,
        oldDvName,
        origin,
      );
      pushClaim(pvcFromDv || '');
    }
    const pvcClaimsAfterReinstall = collectPvcClaimNamesFromVolumes(volumes);
    for (const claim of pvcClaimsBeforeReinstall) {
      if (!pvcClaimsAfterReinstall.includes(claim)) pushClaim(claim);
    }
    pending.pendingReinstallOldClaims = oldClaims;
    if (oldClaims.length || pending.pendingReinstallOldDataVolumes.length) {
      console.log(
        `[Reinstall] Old root storage will be deleted after VM patch (post-restart): PVC=[${oldClaims.join(', ')}] DV=[${pending.pendingReinstallOldDataVolumes.join(', ')}]`,
      );
    }
  }
  // --- 0.1 [业务逻辑] 扩容系统盘 (Resize Root Disk) ---
  // ---------------------------------------------------------
  // 注意：Harvester 不支持直接通过修改 VM Spec 来扩容磁盘。
  // 必须直接操作底层的 PVC (PersistentVolumeClaim)。
  // 流程：
  // 1. [Resize PVC]: 调用 K8s API 修改 PVC.spec.resources.requests.storage。
  // 2. [Sync Annotation]: 更新 VM 上的 volumeClaimTemplates 注解，
  //    确保 Harvester UI 的“配置”页签显示的磁盘大小与实际 PVC 一致。
  // ---------------------------------------------------------
  else if (spec.rootSize && spec.action !== 'reinstall') {
    const disks = domain.devices?.disks || [];
    const volumes = newSpec.template.spec.volumes || [];
    let rootDiskName = '';

    // Identify root disk
    // [约束] 系统盘扩容仅支持 disk 类型（不处理 cdrom/containerDisk 等）
    const validDisks = disks.filter((d: any) => d && d.disk);
    if (!validDisks.length) {
      throw new Error('系统盘扩容仅支持 disk 类型的根磁盘：未找到可用的 disk 设备');
    }
    const bootDisk =
      validDisks.find((d: any) => d.bootOrder === 1) ||
      validDisks.find((d: any) => d.name === 'disk-0') ||
      validDisks[0];
    if (bootDisk) {
      rootDiskName = bootDisk.name;
    }

    if (rootDiskName) {
      const volIndex = volumes.findIndex((v: any) => v.name === rootDiskName);
      if (volIndex !== -1) {
        const pvcName = volumes[volIndex].persistentVolumeClaim?.claimName;
        if (pvcName) {
          console.log(
            `[Resize] Resizing root PVC: ${pvcName} for VM ${namespace}/${name} to ${spec.rootSize}`,
          );
          // 1. Resize PVC
          await updatePVCSpec({ endpoint, token, insecure }, namespace, pvcName, {
            size: spec.rootSize,
          });

          // 2. Sync VM Annotation (volumeClaimTemplates)
          await syncVmVolumeSize(
            { endpoint, token, insecure },
            namespace,
            name,
            pvcName,
            spec.rootSize,
          );
        }
      }
    }
  }

  // --- 1. [基础变更] CPU / 内存调整 ---
  // ---------------------------------------------------------
  // [关键修复] 在复杂变更路径中，也需要检查热扩容状态，避免错误修改 resources
  // 导致 KubeVirt 触发迁移或重启。
  // ---------------------------------------------------------
  // [Harvester 兼容] 检查当前虚拟机是否已启用热扩容
  // 复刻 Harvester 逻辑：通过 Annotation harvesterhci.io/enableCPUAndMemoryHotplug 判断
  const isHotPlugByAnnotation = supportCPUAndMemoryHotplug(current);
  const currentCpu = current?.spec?.template?.spec?.domain?.cpu || {};
  const _currentSockets = currentCpu.sockets || 1;

  // CPU热扩容判断：
  // 1. 如果明确传递 enableHotPlug=true，说明要开启热扩容
  // 2. 如果明确传递 enableHotPlug=false，说明要关闭热扩容（不使用热扩容模式）
  // 3. 如果未传递 enableHotPlug，但当前VM已通过 Annotation 启用了热扩容，使用热扩容模式
  const isCpuHotPlug =
    spec.enableHotPlug === true || (spec.enableHotPlug !== false && isHotPlugByAnnotation);

  const currentMemory = current?.spec?.template?.spec?.domain?.memory || {};
  const currentMaxGuest = currentMemory.maxGuest;
  const _currentGuest = currentMemory.guest;

  // 内存热扩容判断：
  // [Harvester 兼容] 复刻 Harvester 逻辑：通过 Annotation 判断
  const isMemHotPlug = isHotPlugByAnnotation;

  if (spec.cpu !== undefined) {
    ensureCpu();

    if (isCpuHotPlug) {
      // [策略分支 A] 热扩容模式 (Hot Plug Mode)
      // ---------------------------------------------------------
      // [关键修正]: 在热扩容模式下，禁止修改 domain.resources (requests/limits)。
      // KubeVirt 仅通过监控 sockets 的数值变化来触发后端 Pod 的资源热更。
      // 如果 Patch 包中包含了 resources.requests.cpu 字段，KubeVirt 会认为
      // 用户试图修改 Pod 的 Template Spec（非热更字段），从而触发 RestartRequired 或迁移。
      // ---------------------------------------------------------
      if (currentCpu.cores !== 1 || currentCpu.threads !== 1) {
        throw new Error(
          '热扩容失败：当前 CPU 拓扑必须为 cores=1, threads=1。请先锁定拓扑（cores=1, threads=1）后再进行 CPU 热扩容。',
        );
      }

      const targetSockets = Number(spec.cpu);
      if (currentCpu.sockets !== targetSockets) {
        domain.cpu.sockets = targetSockets;
      }

      // 强制锁定拓扑为 1 Core, 1 Thread
      if (currentCpu.cores !== 1) domain.cpu.cores = 1;
      if (currentCpu.threads !== 1) domain.cpu.threads = 1;
    } else {
      // [策略分支 B] 标准模式 (Standard Mode)
      // ---------------------------------------------------------
      // KubeVirt：DedicatedCPUPlacement 为 true 时不得同时提供 resources 的 CPU request/limit
      // 与 domain.cpu.cores（及拓扑）；仅允许改拓扑，不写 resources.cpu。
      // ---------------------------------------------------------
      const dedicatedPlacement = currentCpu.dedicatedCpuPlacement === true;
      if (!dedicatedPlacement) {
        ensureResources();
        domain.resources.requests.cpu = String(spec.cpu);
        domain.resources.limits.cpu = String(spec.cpu);
      }

      if (spec.cpuSockets && spec.cpuCores && spec.cpuThreads) {
        domain.cpu.sockets = Number(spec.cpuSockets);
        domain.cpu.cores = Number(spec.cpuCores);
        domain.cpu.threads = Number(spec.cpuThreads);
      } else {
        // Default topology for simple mode to avoid mismatch
        domain.cpu.sockets = 1;
        domain.cpu.cores = Number(spec.cpu);
        domain.cpu.threads = 1;
      }
    }
  }

  // --- 1.1 HotPlug Configuration ---
  // [Harvester 兼容] 复刻 Harvester 逻辑：通过 Annotation 控制热扩容
  if (spec.enableHotPlug !== undefined) {
    // [Harvester 兼容] 设置/移除 Annotation
    if (!newSpec.metadata) newSpec.metadata = {};
    if (!newSpec.metadata.annotations) newSpec.metadata.annotations = {};

    ensureCpu();
    if (spec.enableHotPlug) {
      // [Strict Validation]
      // Enable HotPlug requires explicit maxSockets and maxMemory
      if (!spec.maxSockets) {
        throw new Error('maxSockets is required when enabling hot plug');
      }

      const currentCpuObj = current?.spec?.template?.spec?.domain?.cpu || {};

      // [关键修复] 在启用热扩容时，如果同时传入了拓扑参数，需要基于调整后的 sockets 进行验证
      // 因为启用热扩容时，如果当前拓扑不是 cores=1, threads=1，需要先调整为单核模式
      // 调整后：sockets = 总CPU数，cores = 1，threads = 1
      let targetSockets: number;
      if (spec.cpuSockets !== undefined) {
        // 如果传入了 cpuSockets，说明前端同时调整了拓扑，使用传入的值
        targetSockets = Number(spec.cpuSockets);
      } else {
        // 如果没有传入拓扑参数，检查当前拓扑是否需要调整
        const currentSockets = currentCpuObj.sockets || 1;
        const currentCores = currentCpuObj.cores || 1;
        const currentThreads = currentCpuObj.threads || 1;

        // 如果当前不是单核模式，启用热扩容时需要调整为单核模式
        // 调整后 sockets = 总CPU数 = sockets * cores * threads
        if (currentCores !== 1 || currentThreads !== 1) {
          targetSockets = currentSockets * currentCores * currentThreads;
        } else {
          targetSockets = currentSockets;
        }
      }

      const targetMaxSockets = Number(spec.maxSockets);

      // [关键验证] KubeVirt 要求：调整后的 sockets 必须 <= maxSockets
      // 如果调整后的 sockets 大于 maxSockets，会导致验证失败
      if (targetSockets > targetMaxSockets) {
        throw new Error(
          `启用热扩容失败：调整后的 CPU sockets=${targetSockets} 大于目标 maxSockets=${targetMaxSockets}。请先降低当前 CPU 数量或提高 maxSockets 上限。`,
        );
      }

      // [关键修复] 在启用热扩容时，如果当前拓扑不是单核模式，需要同时调整拓扑
      // 因为 KubeVirt 要求在热扩容模式下，拓扑必须是 cores=1, threads=1
      // [优先级] 如果传入了拓扑参数，优先使用传入的值（前端已经调整过拓扑）
      if (spec.cpuSockets !== undefined) {
        // 如果传入了拓扑参数，使用传入的值（前端已经调整过拓扑）
        domain.cpu.sockets = Number(spec.cpuSockets);
        if (spec.cpuCores !== undefined) {
          domain.cpu.cores = Number(spec.cpuCores);
        } else {
          domain.cpu.cores = 1; // 热扩容模式默认 cores=1
        }
        if (spec.cpuThreads !== undefined) {
          domain.cpu.threads = Number(spec.cpuThreads);
        } else {
          domain.cpu.threads = 1; // 热扩容模式默认 threads=1
        }
      } else {
        // 如果没有传入拓扑参数，检查当前拓扑是否需要调整
        const currentSockets = currentCpuObj.sockets || 1;
        const currentCores = currentCpuObj.cores || 1;
        const currentThreads = currentCpuObj.threads || 1;

        // 如果当前不是单核模式，需要调整为单核模式
        // 调整后：sockets = 总CPU数，cores = 1，threads = 1
        if (currentCores !== 1 || currentThreads !== 1) {
          const totalCpu = currentSockets * currentCores * currentThreads;
          domain.cpu.sockets = totalCpu;
          domain.cpu.cores = 1;
          domain.cpu.threads = 1;
        }
      }

      // [Harvester 兼容] 设置 Annotation
      newSpec.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'] = 'true';

      // [防止 RestartRequired]: 仅在 maxSockets 确实变更时才修改。
      const currentMaxSockets = currentCpuObj.maxSockets;
      if (currentMaxSockets !== targetMaxSockets) {
        domain.cpu.maxSockets = targetMaxSockets;
      }

      if (!spec.maxMemory) {
        throw new Error('maxMemory is required when enabling hot plug');
      }
      // 同步 resources.limits：CPU 上限（非 CPU 绑定时）；内存上限。DedicatedCPUPlacement 时不得写 resources.cpu。
      {
        ensureResources();
        const dedicatedPlacement =
          current?.spec?.template?.spec?.domain?.cpu?.dedicatedCpuPlacement === true;
        if (dedicatedPlacement) {
          (domain.resources.requests as any).cpu = null;
          (domain.resources.limits as any).cpu = null;
        } else {
          const maxCpuTotal =
            targetMaxSockets * (domain.cpu.cores ?? 1) * (domain.cpu.threads ?? 1);
          (domain.resources.limits as any).cpu = String(maxCpuTotal);
        }
        (domain.resources.limits as any).memory = spec.maxMemory;
      }
    } else {
      // 关闭热扩容：仅移除热扩容注解，不修改 maxSockets/maxGuest/limits，避免 admission 报错
      delete newSpec.metadata.annotations['harvesterhci.io/enableCPUAndMemoryHotplug'];
    }
  }

  // --- 1.2 Max Memory (HotPlug) ---
  if (spec.maxMemory) {
    if (!domain.memory) domain.memory = {};
    // [防止 RestartRequired]: 仅在 maxGuest 确实变更时才修改。
    if (currentMaxGuest !== spec.maxMemory) {
      domain.memory.maxGuest = spec.maxMemory;
    }
  }

  if (spec.memory !== undefined) {
    if (isMemHotPlug) {
      // [策略分支 A] 内存热扩容模式 (Hot Plug Mode)
      // ---------------------------------------------------------
      // [Harvester 兼容] 复刻 Harvester mutator.go 第373-374行的逻辑：
      // 如果启用了热扩容，mutator 不会修改 domain.memory.guest
      // 因此，我们只在用户明确修改内存时才更新 guest memory
      //
      // [关键修正]: 禁止修改 domain.resources.requests/limits。
      // KubeVirt 的内存热插拔控制器会根据 guest 内存自动调整 Pod 资源。
      // 如果手动修改 resources，会被视为非热更字段变更，导致 RestartRequired 或迁移。
      // ---------------------------------------------------------
      if (!domain.memory) domain.memory = {};

      // [Harvester 兼容] 仅在用户明确修改内存时才更新 guest memory
      // 如果用户没有修改内存（spec.memory 与当前 guest memory 相同），则不修改
      const currentGuest = currentMemory.guest;
      if (currentGuest !== spec.memory) {
        domain.memory.guest = spec.memory;
      }
    } else {
      // [策略分支 B] 标准模式 (Standard Mode)
      // ---------------------------------------------------------
      // 通过标准的 Kubernetes Resource Requests/Limits 调整内存。
      // 这种变更通常需要重启虚拟机生效。
      // ---------------------------------------------------------
      ensureResources();
      domain.resources.requests.memory = spec.memory;
      domain.resources.limits.memory = spec.memory;
    }
  }

  // --- 3. [高级配置] CPU 拓扑与绑定 (Topology & Pinning) ---
  // ---------------------------------------------------------
  // 处理 CPU 拓扑结构 (Sockets/Cores/Threads) 和专用 CPU 绑定。
  // 注意：如果启用了热扩容，这些设置可能会受到限制或调整。
  // ---------------------------------------------------------
  if (spec.cpuSockets || spec.cpuCores || spec.cpuThreads) {
    ensureCpu();
    if (spec.cpuSockets) domain.cpu.sockets = Number(spec.cpuSockets);
    if (spec.cpuCores) domain.cpu.cores = Number(spec.cpuCores);
    if (spec.cpuThreads) domain.cpu.threads = Number(spec.cpuThreads);
  }

  // [CPU 绑定] Dedicated CPU Placement
  if (spec.dedicatedCPUPlacement !== undefined) {
    ensureCpu();
    if (spec.dedicatedCPUPlacement) {
      domain.cpu.dedicatedCpuPlacement = true;
      ensureResources();
      (domain.resources.requests as any).cpu = null;
      (domain.resources.limits as any).cpu = null;
    } else {
      // merge-patch 语义：显式置 null 才能清空现有 true 值
      (domain.cpu as any).dedicatedCpuPlacement = null;
      // KubeVirt：isolateEmulatorThread 仅允许与 dedicatedCpuPlacement 同时存在
      (domain.cpu as any).isolateEmulatorThread = null;
    }
  }

  // [CPU 隔离] Isolate Emulator Thread
  // 将前端传入的 isolateEmulatorThread 映射到 KubeVirt 的 domain.cpu.isolateEmulatorThread
  // true: 显式开启隔离；false/undefined: 删除该字段，恢复默认行为。
  if (spec.isolateEmulatorThread !== undefined) {
    ensureCpu();
    if (spec.isolateEmulatorThread) {
      domain.cpu.dedicatedCpuPlacement = true;
      ensureResources();
      (domain.resources.requests as any).cpu = null;
      (domain.resources.limits as any).cpu = null;
      (domain.cpu as any).isolateEmulatorThread = true;
    } else {
      // merge-patch 语义：显式置 null 才能清空现有 true 值
      (domain.cpu as any).isolateEmulatorThread = null;
    }
  }

  // [资源限制] CPU Requests / Limits
  if (spec.cpuRequest !== undefined) {
    ensureResources();
    (domain.resources.requests as any).cpu =
      spec.cpuRequest === null ? null : String(spec.cpuRequest);
  }

  if (spec.cpuLimit !== undefined) {
    ensureResources();
    (domain.resources.limits as any).cpu = spec.cpuLimit === null ? null : String(spec.cpuLimit);
  }

  // --- 4. [高级配置] 内存限制 (Memory Limits) ---
  if (spec.memoryRequestGi !== undefined) {
    const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
    const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;
    if (!isMemHotPlug) {
      ensureResources();
      if (spec.memoryRequestGi === null) {
        (domain.resources.requests as any).memory = null;
      } else {
        const n = Number(spec.memoryRequestGi);
        if (Number.isFinite(n) && n > 0) {
          domain.resources.requests.memory = `${n}Gi`;
        }
      }
    }
  }

  if (spec.memoryLimitGi !== undefined) {
    const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
    const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;
    if (!isMemHotPlug) {
      ensureResources();
      if (spec.memoryLimitGi === null) {
        (domain.resources.limits as any).memory = null;
      } else {
        const n = Number(spec.memoryLimitGi);
        if (Number.isFinite(n) && n > 0) {
          domain.resources.limits.memory = `${n}Gi`;
        }
      }
    }
  }

  if (spec.memoryLimit !== undefined) {
    // [Hot Plug Fix] 内存热扩容模式下，忽略 memoryLimit
    // 在热扩容模式下，KubeVirt 的内存热插拔控制器会根据 guest 内存自动调整 Pod 资源。
    // 如果手动修改 resources.limits.memory，可能导致 requests > limits 的错误。
    const currentMaxGuest = current?.spec?.template?.spec?.domain?.memory?.maxGuest;
    const isMemHotPlug = !!spec.maxMemory || !!currentMaxGuest;

    if (!isMemHotPlug) {
      ensureResources();
      domain.resources.limits.memory = spec.memoryLimit;
    }
  }

  const currentHostDevices = Array.isArray(
    current?.spec?.template?.spec?.domain?.devices?.hostDevices,
  )
    ? current.spec.template.spec.domain.devices.hostDevices
    : [];
  const isUsbHostDevice = (d: any) => {
    const dn = String(d?.deviceName || '').toLowerCase();
    const n = String(d?.name || '').toLowerCase();
    return n.startsWith('usb') || dn.includes('usb');
  };
  const isGpuLikeHostDevice = (d: any) => {
    if (isUsbHostDevice(d)) return false;
    const dn = String(d?.deviceName || '').toLowerCase();
    const n = String(d?.name || '').toLowerCase();
    if (n.startsWith('gpu')) return true;
    if (dn.startsWith('nvidia.com/')) return true;
    return false;
  };
  const hostDevicesOther = currentHostDevices.filter(
    (d: any) => !isGpuLikeHostDevice(d) && !isUsbHostDevice(d),
  );
  let nextGpuHostDevices = currentHostDevices.filter((d: any) => isGpuLikeHostDevice(d));
  let nextUsbHostDevices = currentHostDevices.filter((d: any) => isUsbHostDevice(d));
  let shouldUpdateHostDevices = false;

  // --- 5. [硬件设备] GPU 配置 ---
  // ---------------------------------------------------------
  // Harvester 支持将物理 GPU 透传 (hostDevices) 或 vGPU (gpus) 给虚拟机。
  // ---------------------------------------------------------
  if (spec.gpuResourceNames !== undefined || spec.gpuResourceName !== undefined) {
    if (!domain.devices) domain.devices = {};
    shouldUpdateHostDevices = true;
    const rawList =
      spec.gpuResourceNames !== undefined
        ? Array.isArray(spec.gpuResourceNames)
          ? spec.gpuResourceNames
          : []
        : !spec.gpuResourceName
          ? []
          : [spec.gpuResourceName];
    const names: string[] = Array.from(
      new Set<string>(rawList.map((x: any) => String(x || '').trim()).filter(Boolean)),
    );
    const mode = String(spec.gpuMode || '').toLowerCase();
    const useGpus = mode === 'vgpu';
    const allocationProvided =
      (spec as any).gpuDeviceNames !== undefined || (spec as any).gpuDeviceName !== undefined;
    const rawDeviceNames =
      (spec as any).gpuDeviceNames !== undefined
        ? Array.isArray((spec as any).gpuDeviceNames)
          ? (spec as any).gpuDeviceNames
          : []
        : !(spec as any).gpuDeviceName
          ? []
          : [(spec as any).gpuDeviceName];
    const deviceNames = rawDeviceNames.map((x: any) => String(x || '').trim());
    const hasAllocation =
      deviceNames.length === names.length &&
      deviceNames.every((x: any) => !!String(x || '').trim());

    if (names.length === 0) {
      domain.devices.gpus = [];
      nextGpuHostDevices = [];
    } else if (useGpus) {
      domain.devices.gpus = names.map((n: string, idx: number) => ({
        name: `gpu-${idx + 1}`,
        deviceName: n,
      }));
      nextGpuHostDevices = [];
    } else {
      domain.devices.gpus = [];
      nextGpuHostDevices = names.map((n: string, idx: number) => ({
        name: hasAllocation ? deviceNames[idx] : `gpu-${idx + 1}`,
        deviceName: n,
      }));
    }
    if (allocationProvided) {
      if (!newSpec.metadata) newSpec.metadata = {};
      if (!newSpec.metadata.annotations) newSpec.metadata.annotations = {};
      if (useGpus || names.length === 0 || !hasAllocation) {
        (newSpec.metadata.annotations as any)['harvesterhci.io/deviceAllocationDetails'] = null;
      } else {
        const hostdevices: any = {};
        names.forEach((rn: string, idx: number) => {
          const dn = deviceNames[idx];
          if (!dn) return;
          if (!hostdevices[rn]) hostdevices[rn] = [];
          hostdevices[rn].push(dn);
        });
        newSpec.metadata.annotations['harvesterhci.io/deviceAllocationDetails'] = JSON.stringify({
          hostdevices,
        });
      }
    }
  }

  // --- 4.5 [节点调度] 节点选择器配置 ---
  // ---------------------------------------------------------
  // 处理节点调度逻辑（独立于 GPU 配置）
  // 支持：指定主机模式、标签选择模式、自动调度模式
  // ---------------------------------------------------------
  const gpuNodeName = spec.gpuNodeName;
  const nodeSelectorOverride = spec.nodeSelector; // 节点调度功能的 nodeSelector

  // [重要] 使用 nodeSelector 而不是 nodeAffinity 来固定节点
  // 原因：Harvester 的 mutator 会清除 nodeAffinity 中的 kubernetes.io/hostname
  // 但 nodeSelector 不会被清除，所以应该使用 nodeSelector

  // 处理节点调度逻辑
  // 优先级：nodeSelectorOverride > gpuNodeName
  // 如果 nodeSelectorOverride 为 null，表示要清空所有 nodeSelector
  if (nodeSelectorOverride !== undefined) {
    // 节点调度功能：直接使用提供的 nodeSelector（指定主机或标签选择模式）
    console.log(`🔧 [节点调度] nodeSelectorOverride:`, JSON.stringify(nodeSelectorOverride));
    console.log(
      `🔧 [节点调度] 当前 newSpec.template.spec.nodeSelector:`,
      JSON.stringify(newSpec.template.spec.nodeSelector),
    );

    if (
      nodeSelectorOverride &&
      typeof nodeSelectorOverride === 'object' &&
      Object.keys(nodeSelectorOverride).length > 0
    ) {
      // 设置 nodeSelector - 确保完全覆盖原有值
      // 先删除原有的 nodeSelector，再设置新的值，避免对象引用问题
      if (newSpec.template.spec.nodeSelector) {
        delete newSpec.template.spec.nodeSelector;
      }
      newSpec.template.spec.nodeSelector = JSON.parse(JSON.stringify(nodeSelectorOverride));
      console.log(
        `✅ [节点调度] 已设置 nodeSelector:`,
        JSON.stringify(newSpec.template.spec.nodeSelector),
      );
    } else {
      // 清空 nodeSelector（自动调度模式）
      // [重要] 在 merge-patch 中，要删除字段必须设置为 null，而不是 undefined
      // undefined 在 JSON 序列化时会被忽略，不会发送到服务器，因此不会删除字段
      newSpec.template.spec.nodeSelector = null;
      console.log(`✅ [节点调度] 已清空 nodeSelector (设置为 null)`);
    }
  } else if (gpuNodeName !== undefined) {
    // GPU 功能专用：GPU 节点固定逻辑
    if (gpuNodeName === null || gpuNodeName === undefined) {
      // 清除节点固定：移除 nodeSelector 中的 hostname
      // 注意：null 和 undefined 都表示不需要固定节点
      if (newSpec.template.spec.nodeSelector?.['kubernetes.io/hostname']) {
        if (!newSpec.template.spec.nodeSelector) {
          newSpec.template.spec.nodeSelector = {};
        }
        delete newSpec.template.spec.nodeSelector['kubernetes.io/hostname'];
        // 如果 nodeSelector 为空，设置为 undefined
        if (Object.keys(newSpec.template.spec.nodeSelector).length === 0) {
          newSpec.template.spec.nodeSelector = undefined;
        }
      }
    } else {
      // 设置节点固定：使用 nodeSelector
      const n = String(gpuNodeName || '').trim();
      if (n) {
        if (!newSpec.template.spec.nodeSelector) {
          newSpec.template.spec.nodeSelector = {};
        }
        newSpec.template.spec.nodeSelector['kubernetes.io/hostname'] = n;
      }
    }
  }

  // --- 5.1 [硬件设备] USB 配置 ---
  if (spec.usbResourceNames !== undefined || spec.usbResourceName !== undefined) {
    if (!domain.devices) domain.devices = {};
    shouldUpdateHostDevices = true;
    const rawList =
      spec.usbResourceNames !== undefined
        ? Array.isArray(spec.usbResourceNames)
          ? spec.usbResourceNames
          : []
        : !spec.usbResourceName
          ? []
          : [spec.usbResourceName];
    const names: string[] = Array.from(
      new Set<string>(rawList.map((x: any) => String(x || '').trim()).filter(Boolean)),
    );
    nextUsbHostDevices = names.map((n: string, idx: number) => ({
      name: `usb-${idx + 1}`,
      deviceName: n,
    }));
  }

  if (shouldUpdateHostDevices) {
    if (!domain.devices) domain.devices = {};
    domain.devices.hostDevices = [
      ...hostDevicesOther,
      ...nextGpuHostDevices,
      ...nextUsbHostDevices,
    ];
  }

  // --- 6.0 [直通 PCI 网卡] 替换非 GPU/USB 的 hostDevices（与前端变配 pciNicHostDevices 约定）
  if ((spec as any).pciNicHostDevices !== undefined) {
    const raw = Array.isArray((spec as any).pciNicHostDevices)
      ? (spec as any).pciNicHostDevices
      : [];
    const nextPciNicHost: { name: string; deviceName: string }[] = [];
    for (const h of raw) {
      const name = String(h?.name ?? '').trim();
      const deviceName = String(h?.deviceName ?? '').trim();
      if (!name || !deviceName) continue;
      nextPciNicHost.push({ name, deviceName });
    }
    if (!domain.devices) domain.devices = {};
    const curHost = Array.isArray(domain.devices.hostDevices)
      ? domain.devices.hostDevices
      : shouldUpdateHostDevices
        ? [...hostDevicesOther, ...nextGpuHostDevices, ...nextUsbHostDevices]
        : currentHostDevices;
    const keptGpuUsb = (Array.isArray(curHost) ? curHost : []).filter(
      (d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d),
    );
    domain.devices.hostDevices = [...nextPciNicHost, ...keptGpuUsb];

    const gpuHostCrNames = new Set(
      currentHostDevices
        .filter((d: any) => isGpuLikeHostDevice(d))
        .map((d: any) => String(d?.name || '').trim())
        .filter(Boolean),
    );
    const prevPciNicCrSet = new Set<string>();
    for (const d of currentHostDevices) {
      if (isGpuLikeHostDevice(d) || isUsbHostDevice(d)) continue;
      const n = String(d?.name || '').trim();
      if (n) prevPciNicCrSet.add(n);
    }
    try {
      const rawAnn = current?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
      if (rawAnn) {
        const p = typeof rawAnn === 'string' ? JSON.parse(rawAnn) : rawAnn;
        const hd = p?.hostdevices;
        if (hd && typeof hd === 'object') {
          for (const arr of Object.values(hd)) {
            if (!Array.isArray(arr)) continue;
            for (const cr of arr) {
              const s = String(cr).trim();
              if (s && !gpuHostCrNames.has(s)) prevPciNicCrSet.add(s);
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    let hostdevicesAlloc: Record<string, string[]> = {};
    try {
      const rawAnn = current?.metadata?.annotations?.['harvesterhci.io/deviceAllocationDetails'];
      if (rawAnn) {
        const p = typeof rawAnn === 'string' ? JSON.parse(rawAnn) : rawAnn;
        if (p?.hostdevices && typeof p.hostdevices === 'object') {
          hostdevicesAlloc = JSON.parse(JSON.stringify(p.hostdevices));
        }
      }
    } catch {
      /* ignore */
    }
    for (const [rn, arr] of Object.entries(hostdevicesAlloc)) {
      if (!Array.isArray(arr)) continue;
      const filtered = arr.filter((cr: unknown) => !prevPciNicCrSet.has(String(cr).trim()));
      if (filtered.length > 0) hostdevicesAlloc[rn] = filtered;
      else delete hostdevicesAlloc[rn];
    }
    for (const h of nextPciNicHost) {
      if (!hostdevicesAlloc[h.deviceName]) hostdevicesAlloc[h.deviceName] = [];
      if (!hostdevicesAlloc[h.deviceName].includes(h.name)) {
        hostdevicesAlloc[h.deviceName].push(h.name);
      }
    }
    if (Object.keys(hostdevicesAlloc).length === 0) {
      rootVmAnnotationPatches['harvesterhci.io/deviceAllocationDetails'] = null;
    } else {
      rootVmAnnotationPatches['harvesterhci.io/deviceAllocationDetails'] = JSON.stringify({
        hostdevices: hostdevicesAlloc,
      });
    }
  }
  delete (spec as any).pciNicHostDevices;

  // --- 6. [网络配置] 多网卡 (Multus Networks) ---
  // ---------------------------------------------------------
  // 支持 Multus CNI 多网卡配置。
  // 直接替换 networks 数组，实现网卡的添加/删除/修改。
  // ---------------------------------------------------------
  if (spec.networks !== undefined) {
    newSpec.template.spec.networks = spec.networks;
  }
  if (spec.interfaces !== undefined) {
    if (!domain.devices) domain.devices = {};
    domain.devices.interfaces = spec.interfaces;
  }

  // --- 6.1 [直通 PCI 辅网卡] 追加 hostDevices（与前端变配 appendHostDevices 约定；不替换 GPU/USB 逻辑已合并后的列表）
  if (
    Array.isArray((spec as any).appendHostDevices) &&
    (spec as any).appendHostDevices.length > 0
  ) {
    if (!domain.devices) domain.devices = {};
    const cur = Array.isArray(domain.devices.hostDevices) ? [...domain.devices.hostDevices] : [];
    for (const h of (spec as any).appendHostDevices as any[]) {
      const hn = String(h?.name ?? '').trim();
      const deviceName = String(h?.deviceName ?? '').trim();
      if (!hn || !deviceName) continue;
      const dup = cur.some(
        (x: any) => String(x?.deviceName || '') === deviceName && String(x?.name || '') === hn,
      );
      if (!dup) cur.push({ name: hn, deviceName });
    }
    domain.devices.hostDevices = cur;
  }
  delete (spec as any).appendHostDevices;

  // --- 7. [运行策略] RunStrategy 和 EvictionStrategy ---
  // [重要] runStrategy 和 running 字段是互斥的，不能同时设置
  // 如果设置了 runStrategy，需要移除 running 字段（如果存在）
  if (spec.runStrategy !== undefined) {
    newSpec.runStrategy = spec.runStrategy;
    // 如果当前 VM 有 running 字段，需要移除它（因为 runStrategy 和 running 互斥）
    if (current?.spec?.running !== undefined) {
      newSpec.running = undefined; // 设置为 undefined，merge-patch 会删除该字段
    }
  }

  if (spec.evictionStrategy !== undefined) {
    if (!newSpec.template.spec) newSpec.template.spec = {};
    newSpec.template.spec.evictionStrategy = spec.evictionStrategy;
  }

  // --- 8. [节点亲和性] Affinity 配置 ---
  // ---------------------------------------------------------
  // 处理节点亲和性（nodeAffinity）配置
  // 注意：nodeAffinity 和 nodeSelector 可以同时存在
  // nodeAffinity 通常用于更复杂的调度规则（如网络标签要求）
  // ---------------------------------------------------------
  if (spec.affinity !== undefined) {
    if (!newSpec.template.spec) newSpec.template.spec = {};

    if (spec.affinity === null || spec.affinity === undefined) {
      // 清空 affinity
      newSpec.template.spec.affinity = undefined;
    } else if (spec.affinity && typeof spec.affinity === 'object') {
      // 设置 affinity
      if (!newSpec.template.spec.affinity) {
        newSpec.template.spec.affinity = {};
      }
      // 合并 nodeAffinity（保留其他 affinity 配置如 podAffinity）
      if (spec.affinity.nodeAffinity) {
        newSpec.template.spec.affinity.nodeAffinity = JSON.parse(
          JSON.stringify(spec.affinity.nodeAffinity),
        );
      } else {
        // 如果没有 nodeAffinity，清空它
        if (newSpec.template.spec.affinity.nodeAffinity) {
          delete newSpec.template.spec.affinity.nodeAffinity;
        }
        // 如果 affinity 为空，设置为 undefined
        if (Object.keys(newSpec.template.spec.affinity).length === 0) {
          newSpec.template.spec.affinity = undefined;
        }
      }
    }
  }

  // 在构建 body 前，再次确认 nodeSelector 的值
  console.log(
    `🔍 [构建 body 前] newSpec.template.spec.nodeSelector:`,
    JSON.stringify(newSpec.template.spec.nodeSelector),
  );

  const mergedRootMetadata = current?.metadata ? JSON.parse(JSON.stringify(current.metadata)) : {};
  if (!mergedRootMetadata.annotations) mergedRootMetadata.annotations = {};
  if (vmMetadataAnnotationsRaw && typeof vmMetadataAnnotationsRaw === 'object') {
    for (const [k, v] of Object.entries(vmMetadataAnnotationsRaw)) {
      if (v === null || v === undefined || v === '') {
        delete mergedRootMetadata.annotations[k];
      } else {
        mergedRootMetadata.annotations[k] = String(v);
      }
    }
  }
  for (const [k, v] of Object.entries(rootVmAnnotationPatches)) {
    if (v === null || v === undefined || v === '') {
      delete mergedRootMetadata.annotations[k];
    } else {
      mergedRootMetadata.annotations[k] = String(v);
    }
  }

  const body = {
    metadata: mergedRootMetadata,
    spec: newSpec,
  };
  // ============================================================================
  // [调试日志] 最终发送的 Patch (复杂路径) - 长期保留，用于热扩容功能调试
  // ============================================================================
  const complexPatchCpu = body?.spec?.template?.spec?.domain?.cpu || {};
  const complexPatchMemory = body?.spec?.template?.spec?.domain?.memory || {};
  const complexPatchResources = body?.spec?.template?.spec?.domain?.resources || {};
  const complexPatchAnnotations = body?.metadata?.annotations || {};

  console.log('\n📤 [最终发送的 Patch - 复杂路径]');

  // 检查是否是重装系统操作
  const isReinstall = spec.action === 'reinstall';
  if (isReinstall) {
    console.log('\n🔄 [重装系统相关变更]');
    const patchVolumes = body?.spec?.template?.spec?.volumes || [];
    const patchDisks = body?.spec?.template?.spec?.domain?.devices?.disks || [];
    const rootVolume = patchVolumes.find(
      (v: any) => v.name === 'disk-0' || v.persistentVolumeClaim,
    );
    if (rootVolume) {
      console.log(`  根磁盘 Volume:`);
      console.log(`    - 名称: ${rootVolume.name}`);
      console.log(`    - PVC: ${rootVolume.persistentVolumeClaim?.claimName || '未找到'}`);
    }
    const rootDisk = patchDisks.find((d: any) => d.name === 'disk-0' || d.bootOrder === 1);
    if (rootDisk) {
      console.log(`  根磁盘设备:`);
      console.log(`    - 名称: ${rootDisk.name}`);
      console.log(`    - 总线: ${rootDisk.disk?.bus || rootDisk.cdrom?.bus || 'unknown'}`);
      console.log(`    - 类型: ${rootDisk.disk ? 'disk' : rootDisk.cdrom ? 'cdrom' : 'unknown'}`);
    }
  }

  console.log('\n🔧 [CPU 配置变更]');
  if (complexPatchCpu.sockets !== undefined) console.log(`  sockets: ${complexPatchCpu.sockets}`);
  if (complexPatchCpu.cores !== undefined) console.log(`  cores: ${complexPatchCpu.cores}`);
  if (complexPatchCpu.threads !== undefined) console.log(`  threads: ${complexPatchCpu.threads}`);
  if (complexPatchCpu.maxSockets !== undefined)
    console.log(`  maxSockets: ${complexPatchCpu.maxSockets}`);

  console.log('\n💾 [内存配置变更]');
  if (complexPatchMemory.guest !== undefined)
    console.log(`  memory.guest: ${complexPatchMemory.guest}`);
  if (complexPatchMemory.maxGuest !== undefined)
    console.log(`  memory.maxGuest: ${complexPatchMemory.maxGuest}`);
  if (complexPatchResources.requests?.memory !== undefined)
    console.log(`  resources.requests.memory: ${complexPatchResources.requests.memory}`);
  if (complexPatchResources.limits?.memory !== undefined)
    console.log(`  resources.limits.memory: ${complexPatchResources.limits.memory}`);

  // 磁盘和 Volume 变更
  const patchVolumes = body?.spec?.template?.spec?.volumes || [];
  const patchDisks = body?.spec?.template?.spec?.domain?.devices?.disks || [];
  if (patchVolumes.length > 0 || patchDisks.length > 0) {
    console.log('\n💿 [磁盘和 Volume 变更]');
    patchVolumes.forEach((v: any, idx: number) => {
      if (v.persistentVolumeClaim) {
        console.log(`  Volume[${idx}]: ${v.name} -> PVC: ${v.persistentVolumeClaim.claimName}`);
      }
    });
    patchDisks.forEach((d: any, idx: number) => {
      console.log(
        `  Disk[${idx}]: ${d.name}, 总线: ${d.disk?.bus || d.cdrom?.bus || 'unknown'}, 类型: ${d.disk ? 'disk' : d.cdrom ? 'cdrom' : 'unknown'}`,
      );
    });
  }

  console.log('\n🏷️  [Annotation 变更]');
  Object.keys(complexPatchAnnotations).forEach((key) => {
    const value = complexPatchAnnotations[key];
    if (key === 'harvesterhci.io/volumeClaimTemplates') {
      console.log(`  ${key}: ${value ? '(已更新，内容较长，见完整 JSON)' : '(删除)'}`);
    } else {
      console.log(`  ${key}: ${value === null ? '(删除)' : value}`);
    }
  });

  // 节点调度变更
  const patchNodeSelector = body?.spec?.template?.spec?.nodeSelector;
  if (patchNodeSelector !== undefined) {
    console.log('\n🔧 [节点调度变更]');
    if (patchNodeSelector === null) {
      console.log(`  nodeSelector: (删除 - 自动调度模式)`);
    } else {
      console.log(`  nodeSelector:`, JSON.stringify(patchNodeSelector));
    }
  }

  console.log('\n📋 [完整 Patch JSON]');
  console.log(JSON.stringify(body, null, 2));

  console.log('\n' + '='.repeat(80) + '\n');

  const url = `${origin}/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/virtualmachines/${encodeURIComponent(name)}`;
  const patched = await requestJson('PATCH', url, token, insecure, body, {
    'Content-Type': 'application/merge-patch+json',
  });

  if (
    pending.pendingReinstallOldClaims.length > 0 ||
    pending.pendingReinstallOldDataVolumes.length > 0
  ) {
    const claims = [...pending.pendingReinstallOldClaims];
    const dvs = [...pending.pendingReinstallOldDataVolumes];
    deleteReinstallOldRootStorageClaims(
      { endpoint, token, insecure },
      namespace,
      name,
      claims,
      dvs,
      origin,
    ).catch((err: any) =>
      console.warn('[Reinstall] Background old root storage cleanup failed:', err?.message || err),
    );
  }

  return patched;
};
