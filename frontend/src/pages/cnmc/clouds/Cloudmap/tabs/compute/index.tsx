import React from 'react';
import { Tabs, message } from 'antd';
import VmSection from '../../../Harvester/ecs/sections/VmSection';
import VmReconfigureModal from '../../../Harvester/ecs/modals/VmReconfigureModal';
import ImagesSection from '../../../Harvester/ecs/sections/ImagesSection';
import TemplatesSection from '../../../Harvester/ecs/sections/TemplatesSection';
import SshKeysSection from '../../../Harvester/ecs/sections/SshKeysSection';
import CloudInitsSection from '../../../Harvester/ecs/sections/CloudInitsSection';
import RecycleBinSection from '../../../Harvester/ecs/sections/RecycleBinSection';
import MigrationsSection from '../../../Harvester/ecs/sections/MigrationsSection';
import {
  apiPost,
  deleteCloudProviderEcs,
  fetchHarvesterImages,
  fetchHarvesterNamespaces,
  fetchHarvesterVolumes,
  fetchKubeOvnSubnets,
  pauseCloudProviderEcs,
  rebootCloudProviderEcs,
  softRebootCloudProviderEcs,
  startCloudProviderEcs,
  stopCloudProviderEcs,
  unpauseCloudProviderEcs,
} from '../../runtime/api';

const DebugJSON: React.FC<{ data: any; show: boolean }> = ({ data, show }) => {
  if (!show) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <pre
        style={{
          background: '#f7f7f7',
          padding: 12,
          borderRadius: 8,
          maxHeight: 300,
          overflow: 'auto',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

export type CloudmapComputeGroupTabsProps = {
  cloudId: string;
  mode: 'standard' | 'ops';
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadFlatSubnets: boolean;
  canReadVpcSubnets: boolean;
  handleTabChange: (key: string) => void;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  resourceLoading: Record<string, boolean>;
  ecs: any[];
  rawEcs: any;
  namespacesOptions: string[];
  nodesOptions: string[];
  nsFilter: string;
  setNsFilter: (v: string) => void;
  nodeFilter: string;
  setNodeFilter: (v: string) => void;
  harvesterStorageClasses: any[];
  kubeOvnSubnets: any[];
  harvesterNads: any[];
  capabilities: any;
  setKubeOvnSubnets: (v: any[]) => void;
  setHarvesterImages: (v: any[]) => void;
  setHarvesterVolumes: (v: any[]) => void;
  setHarvesterNamespaces: (v: any[]) => void;
  refreshVms: (force?: boolean) => void | Promise<void>;
  harvesterImages: any[];
  harvesterNamespaces: any[];
  harvesterVolumes: any[];
  harvesterTemplates: any[];
  harvesterSshKeys: any[];
  harvesterCloudInits: any[];
  harvesterGpuResources: any[];
  rawImages: any;
  rawTemplates: any;
  rawSshKeys: any;
  rawCloudInits: any;
  vmReconfOpen: boolean;
  vmReconfTarget: any;
  onOpenVmReconfigure: (r: any) => void;
  onVmReconfigureModalClose: () => void;
  onVmReconfigureModalOk: () => void;
};

const CloudmapComputeGroupTabs: React.FC<CloudmapComputeGroupTabsProps> = (
  props,
) => {
  const {
    cloudId,
    mode,
    isTenant,
    showLog,
    checkPerm,
    canReadFlatSubnets,
    canReadVpcSubnets,
    handleTabChange,
    loadResource,
    loadTabResource,
    resourceLoading,
    ecs,
    rawEcs,
    namespacesOptions,
    nodesOptions,
    nsFilter,
    setNsFilter,
    nodeFilter,
    setNodeFilter,
    harvesterStorageClasses,
    kubeOvnSubnets,
    harvesterNads,
    capabilities,
    setKubeOvnSubnets,
    setHarvesterImages,
    setHarvesterVolumes,
    setHarvesterNamespaces,
    refreshVms,
    harvesterImages,
    harvesterNamespaces,
    harvesterVolumes,
    harvesterTemplates,
    harvesterSshKeys,
    harvesterCloudInits,
    harvesterGpuResources,
    rawImages,
    rawTemplates,
    rawSshKeys,
    rawCloudInits,
    vmReconfOpen,
    vmReconfTarget,
    onOpenVmReconfigure,
    onVmReconfigureModalClose,
    onVmReconfigureModalOk,
  } = props;

  return (
    <Tabs
      type="line"
      destroyOnHidden
      defaultActiveKey="ecs"
      onChange={handleTabChange}
      items={[
        {
          key: 'ecs',
          label: '云主机实例',
          children: (
            <>
              <VmSection
                vms={ecs}
                loading={resourceLoading.ecs}
                mode={mode}
                namespacesOptions={namespacesOptions}
                nodesOptions={nodesOptions}
                cloudId={cloudId}
                nsValue={nsFilter || undefined}
                nodeValue={nodeFilter || undefined}
                storageClasses={harvesterStorageClasses}
                kubeSubnets={kubeOvnSubnets}
                harvesterNads={harvesterNads}
                capabilities={capabilities}
                onReloadQuickCreateSubnets={
                  canReadFlatSubnets ||
                  canReadVpcSubnets ||
                  checkPerm('clouds:read')
                    ? () =>
                        loadResource(
                          'subnets',
                          () => fetchKubeOvnSubnets(cloudId, true),
                          (json) => {
                            setKubeOvnSubnets(json?.data?.items || []);
                          },
                          true,
                        )
                    : undefined
                }
                onReloadQuickCreateImages={
                  checkPerm('clouds.images:read')
                    ? () =>
                        loadResource(
                          'images',
                          () => fetchHarvesterImages(cloudId, true),
                          (json) => {
                            setHarvesterImages(json?.data?.items || []);
                          },
                          true,
                        )
                    : undefined
                }
                onNsChange={(v) => setNsFilter(v || '')}
                onNodeChange={(v) => setNodeFilter(v || '')}
                onRefresh={() => {
                  apiPost(`/api/clouds/${cloudId}/sync`)
                    .catch(console.warn)
                    .finally(() => {
                      void refreshVms();
                      if (checkPerm('clouds.images:read')) {
                        loadResource(
                          'images',
                          () => fetchHarvesterImages(cloudId, true),
                          (json) => {
                            setHarvesterImages(json?.data?.items || []);
                          },
                          true,
                        );
                      }
                      if (checkPerm('clouds.disks:read')) {
                        loadResource(
                          'volumes',
                          () => fetchHarvesterVolumes(cloudId, true),
                          (json) => {
                            setHarvesterVolumes(json?.data?.items || []);
                          },
                          true,
                        );
                      }
                      loadResource(
                        'namespaces',
                        () =>
                          fetchHarvesterNamespaces(cloudId, true, true),
                        (json) => {
                          setHarvesterNamespaces(json?.data?.items || []);
                        },
                        true,
                      );
                    });
                }}
                onOpenReconfigure={onOpenVmReconfigure}
                onStart={async (iid: string) => {
                  try {
                    const vm = ecs.find((v: any) => {
                      const vId =
                        v?.metadata?.name && v?.metadata?.namespace
                          ? `${v.metadata.namespace}/${v.metadata.name}`
                          : v?.InstanceId || v?.id;
                      return vId === iid;
                    });

                    if (vm && harvesterVolumes.length > 0) {
                      const vmVolumes =
                        vm?.spec?.template?.spec?.volumes || [];
                      const pvcNames = vmVolumes
                        .map(
                          (vol: any) =>
                            vol?.persistentVolumeClaim?.claimName,
                        )
                        .filter(Boolean);

                      if (pvcNames.length > 0) {
                        const vmNamespace =
                          vm?.metadata?.namespace || vm?.namespace;
                        const resizingPvc = harvesterVolumes.find(
                          (pvc: any) => {
                            const pvcName = pvc?.metadata?.name;
                            const pvcNs = pvc?.metadata?.namespace;
                            if (
                              pvcNs !== vmNamespace ||
                              !pvcNames.includes(pvcName)
                            )
                              return false;

                            const conditions =
                              pvc?.status?.conditions || [];
                            return conditions.some(
                              (c: any) =>
                                c.type === 'Resizing' &&
                                c.status === 'True',
                            );
                          },
                        );

                        if (resizingPvc) {
                          message.error(
                            `暂不可启动：云盘「${resizingPvc.metadata.name}」处于 Resizing 扩容中，请稍后再试。`,
                          );
                          return;
                        }
                      }
                    }

                    await startCloudProviderEcs(cloudId, iid);
                    message.success('启动成功');
                    apiPost(`/api/clouds/${cloudId}/sync`)
                      .catch(console.warn)
                      .finally(() => void refreshVms());
                  } catch (e: any) {
                    const errMsg = e?.message || String(e);
                    if (
                      errMsg.includes('resizing volume') ||
                      errMsg.includes('Resizing')
                    ) {
                      message.warning(
                        '启动被拒绝: 关联磁盘正在进行扩容操作，请等待扩容完成后再试。',
                      );
                    } else {
                      message.error(errMsg || '启动失败');
                    }
                  }
                }}
                onStop={async (iid: string) => {
                  try {
                    let force = false;
                    let realId = iid;
                    if (iid.endsWith('::force')) {
                      force = true;
                      realId = iid.replace(/::force$/, '');
                    }
                    await stopCloudProviderEcs(cloudId, realId, force);
                    message.success(
                      force ? '强制停止指令已下发' : '停止成功',
                    );
                    apiPost(`/api/clouds/${cloudId}/sync`)
                      .catch(console.warn)
                      .finally(() => void refreshVms());
                  } catch (e: any) {
                    message.error(e?.message || '停止失败');
                  }
                }}
                onReboot={async (iid: string) => {
                  try {
                    await rebootCloudProviderEcs(cloudId, iid, false);
                    message.success('重启成功');
                    apiPost(`/api/clouds/${cloudId}/sync`)
                      .catch(console.warn)
                      .finally(() => void refreshVms());
                  } catch (e: any) {
                    message.error(e?.message || '重启失败');
                  }
                }}
                onSoftReboot={async (iid: string) => {
                  try {
                    await softRebootCloudProviderEcs(cloudId, iid);
                    message.success('软重启成功');
                    apiPost(`/api/clouds/${cloudId}/sync`)
                      .catch(console.warn)
                      .finally(() => void refreshVms());
                  } catch (e: any) {
                    message.error(e?.message || '软重启失败');
                  }
                }}
                onPause={async (iid: string) => {
                  try {
                    await pauseCloudProviderEcs(cloudId, iid);
                    message.success('暂停成功');
                    apiPost(`/api/clouds/${cloudId}/sync`)
                      .catch(console.warn)
                      .finally(() => void refreshVms());
                  } catch (e: any) {
                    message.error(e?.message || '暂停失败');
                  }
                }}
                onUnpause={async (iid: string) => {
                  try {
                    await unpauseCloudProviderEcs(cloudId, iid);
                    message.success('恢复成功');
                    apiPost(`/api/clouds/${cloudId}/sync`)
                      .catch(console.warn)
                      .finally(() => void refreshVms());
                  } catch (e: any) {
                    message.error(e?.message || '恢复失败');
                  }
                }}
                onDelete={async (iid: string, deleteVolumes?: boolean) => {
                  try {
                    const [namespace, name] = iid.split('/');
                    if (!namespace || !name) {
                      throw new Error('无效的实例ID格式');
                    }

                    const vm = ecs.find((v: any) => {
                      const vmNs =
                        v?.metadata?.namespace || v?.namespace || '';
                      const vmName =
                        v?.metadata?.name ||
                        v?.InstanceId?.split('/')[1] ||
                        '';
                      return vmNs === namespace && vmName === name;
                    });

                    if (vm) {
                      let status = '';
                      if (typeof vm?.status === 'string') {
                        status = vm.status;
                      } else {
                        status =
                          vm?.status?.printableStatus ||
                          vm?.status?.phase ||
                          vm?.Status ||
                          'Unknown';
                      }
                      const statusLower = String(status).toLowerCase();
                      if (
                        statusLower === 'running' ||
                        statusLower === 'starting'
                      ) {
                        message.loading('虚拟机正在运行，正在停止...', 0);
                        try {
                          await stopCloudProviderEcs(
                            cloudId,
                            `${namespace}/${name}`,
                            true,
                          );
                          await new Promise((resolve) =>
                            setTimeout(resolve, 3000),
                          );
                          message.destroy();
                        } catch (stopError: any) {
                          message.destroy();
                          throw new Error(
                            `停止虚拟机失败: ${stopError?.message || stopError}`,
                          );
                        }
                      }
                    }

                    await deleteCloudProviderEcs(
                      cloudId,
                      iid,
                      deleteVolumes,
                    );
                    message.success('虚拟机已移入回收站，到期后自动删除');
                    apiPost(`/api/clouds/${cloudId}/sync`)
                      .catch(console.warn)
                      .finally(() => void refreshVms());
                  } catch (e: any) {
                    message.error(e?.message || '移入回收站失败');
                  }
                }}
                images={harvesterImages}
                namespaces={harvesterNamespaces}
                volumes={harvesterVolumes}
              />
              <VmReconfigureModal
                open={vmReconfOpen}
                cloudId={cloudId}
                record={vmReconfTarget}
                onClose={onVmReconfigureModalClose}
                onOk={onVmReconfigureModalOk}
                storageClasses={harvesterStorageClasses}
                images={harvesterImages}
                gpuResources={harvesterGpuResources}
              />
              <DebugJSON data={rawEcs} show={showLog} />
            </>
          ),
        },
        {
          key: 'images',
          label: '云主机镜像',
          children: (
            <>
              <ImagesSection
                cloudId={cloudId}
                images={harvesterImages}
                loading={resourceLoading.images}
                onRefresh={() =>
                  loadResource(
                    'images',
                    () => fetchHarvesterImages(cloudId, true),
                    (json) => setHarvesterImages(json?.data?.items || []),
                    true,
                  )
                }
                mode={mode}
                isTenant={isTenant}
              />
              <DebugJSON data={rawImages} show={showLog} />
            </>
          ),
        },
        {
          key: 'templates',
          label: '云主机模板',
          children: (
            <>
              <TemplatesSection
                cloudId={cloudId}
                templates={harvesterTemplates}
                loading={resourceLoading.templates}
                onRefresh={() => loadTabResource('templates', true)}
                mode={mode}
              />
              <DebugJSON data={rawTemplates} show={showLog} />
            </>
          ),
        },
        {
          key: 'ssh_keys',
          label: 'SSH 密钥',
          children: (
            <>
              <SshKeysSection
                cloudId={cloudId}
                sshKeys={harvesterSshKeys}
                loading={resourceLoading.sshKeys}
                onRefresh={() => loadTabResource('ssh_keys', true)}
                mode={mode}
              />
              <DebugJSON data={rawSshKeys} show={showLog} />
            </>
          ),
        },
        {
          key: 'cloud_inits',
          label: 'Cloud Init',
          children: (
            <>
              <CloudInitsSection
                cloudId={cloudId}
                cloudInits={harvesterCloudInits}
                loading={resourceLoading.cloudInits}
                onRefresh={() => loadTabResource('cloud_inits', true)}
                mode={mode}
              />
              <DebugJSON data={rawCloudInits} show={showLog} />
            </>
          ),
        },
        {
          key: 'recycle_bin',
          label: '回收站',
          children: (
            <>
              <RecycleBinSection
                vms={ecs}
                loading={resourceLoading.ecs}
                cloudId={cloudId}
                mode={mode}
                onRefresh={() => {
                  apiPost(`/api/clouds/${cloudId}/sync`)
                    .catch(console.warn)
                    .finally(() => void refreshVms());
                }}
                namespaces={harvesterNamespaces}
                volumes={harvesterVolumes}
                images={harvesterImages}
              />
              {showLog && (
                <div style={{ marginTop: 12 }}>
                  <pre
                    style={{
                      background: '#f7f7f7',
                      padding: 12,
                      borderRadius: 8,
                      maxHeight: 300,
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(
                      ecs.filter((vm: any) => {
                        const finalizers = vm?.metadata?.finalizers || [];
                        const labels = vm?.metadata?.labels || {};
                        return (
                          finalizers.includes('tower.io/recycle-bin') ||
                          labels['tower.io/recycle-bin'] === 'true'
                        );
                      }),
                      null,
                      2,
                    )}
                  </pre>
                </div>
              )}
            </>
          ),
        },
        {
          key: 'migrations',
          label: '迁移记录',
          children: <MigrationsSection cloudId={cloudId} mode={mode} />,
        },
      ].filter((i: any) => {
        if (i.key === 'ecs') return checkPerm('clouds.ecs:read');
        if (i.key === 'templates')
          return checkPerm('clouds.templates:read');
        if (i.key === 'images') return checkPerm('clouds.images:read');
        if (i.key === 'ssh_keys') return checkPerm('clouds.sshkeys:read');
        if (i.key === 'cloud_inits')
          return checkPerm('clouds.cloudinits:read');
        if (i.key === 'recycle_bin')
          return (
            checkPerm('clouds.recycle-bin:read') ||
            checkPerm('clouds.ecs:read')
          );
        if (i.key === 'migrations')
          return (
            checkPerm('clouds.migrations:read') ||
            checkPerm('clouds.ecs:read')
          );
        return true;
      })}
    />
  );
};

export default CloudmapComputeGroupTabs;
