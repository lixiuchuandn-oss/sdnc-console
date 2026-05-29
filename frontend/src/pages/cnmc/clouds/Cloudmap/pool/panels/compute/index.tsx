import React, { useCallback, useMemo } from 'react';
import { createComputeTabOnRefresh } from '../../loaders/computeRefresh';
import { Empty, message } from 'antd';
import VmSection from '../../../../Harvester/ecs/sections/VmSection';
import ImagesSection from '../../../../Harvester/ecs/sections/ImagesSection';
import TemplatesSection from '../../../../Harvester/ecs/sections/TemplatesSection';
import SshKeysSection from '../../../../Harvester/ecs/sections/SshKeysSection';
import CloudInitsSection from '../../../../Harvester/ecs/sections/CloudInitsSection';
import RecycleBinSection from '../../../../Harvester/ecs/sections/RecycleBinSection';
import MigrationsSection from '../../../../Harvester/ecs/sections/MigrationsSection';
import {
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
} from '../../api';

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

export type CloudmapComputeRoutePanelProps = {
  cloudId: string;
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  canReadFlatSubnets: boolean;
  canReadVpcSubnets: boolean;
  innerActiveKey: string;
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
  refreshVms: (force?: boolean, skipSync?: boolean) => void | Promise<void>;
  harvesterMigrations: any[];
  rawMigrations: any;
  harvesterImages: any[];
  harvesterNamespaces: any[];
  harvesterVolumes: any[];
  harvesterTemplates: any[];
  harvesterSshKeys: any[];
  harvesterCloudInits: any[];
  harvesterGpuResources: any[];
  harvesterUsbDevices: any[];
  rawImages: any;
  rawTemplates: any;
  rawSshKeys: any;
  rawCloudInits: any;
};

function canViewComputeInner(
  key: string,
  checkPerm: (a: string) => boolean,
): boolean {
  if (key === 'ecs') return checkPerm('clouds.ecs:read');
  if (key === 'templates') return checkPerm('clouds.templates:read');
  if (key === 'images') return checkPerm('clouds.images:read');
  if (key === 'ssh_keys') return checkPerm('clouds.sshkeys:read');
  if (key === 'cloud_inits') return checkPerm('clouds.cloudinits:read');
  if (key === 'recycle_bin')
    return (
      checkPerm('clouds.recycle-bin:read') || checkPerm('clouds.ecs:read')
    );
  if (key === 'migrations')
    return (
      checkPerm('clouds.migrations:read') || checkPerm('clouds.ecs:read')
    );
  return false;
}

const CloudmapComputeRoutePanel: React.FC<CloudmapComputeRoutePanelProps> = (
  props,
) => {
  const {
    cloudId,
    isTenant,
    showLog,
    checkPerm,
    canReadFlatSubnets,
    canReadVpcSubnets,
    innerActiveKey,
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
    rawImages,
    rawTemplates,
    rawSshKeys,
    rawCloudInits,
    harvesterMigrations,
    rawMigrations,
  } = props;

  const reloadVmListAfterMutation = useCallback(() => {
    void refreshVms(true);
  }, [refreshVms]);

  const reloadBackupsInventory = useCallback(
    (force?: boolean, skipSync?: boolean) =>
      loadTabResource('backups', force !== false, skipSync ?? true),
    [loadTabResource],
  );

  const refreshVmSectionAuxiliaries = useCallback(() => {
    if (checkPerm('clouds.images:read')) {
      void loadResource(
        'images',
        () => fetchHarvesterImages(cloudId, true),
        (json) => setHarvesterImages(json?.data?.items || []),
        true,
      );
    }
    if (checkPerm('clouds.disks:read')) {
      void loadResource(
        'volumes',
        () => fetchHarvesterVolumes(cloudId, true),
        (json) => setHarvesterVolumes(json?.data?.items || []),
        true,
      );
    }
    void loadResource(
      'namespaces',
      () => fetchHarvesterNamespaces(cloudId, true, true),
      (json) => setHarvesterNamespaces(json?.data?.items || []),
      true,
    );
  }, [
    checkPerm,
    loadResource,
    cloudId,
    setHarvesterImages,
    setHarvesterVolumes,
    setHarvesterNamespaces,
  ]);

  const computeTabOnRefresh = useMemo(() => {
    const deps = {
      loadTabResource,
      refreshVmSectionAuxiliaries,
    };
    return {
      ecs: createComputeTabOnRefresh('ecs', deps),
      images: createComputeTabOnRefresh('images', deps),
      templates: createComputeTabOnRefresh('templates', deps),
      ssh_keys: createComputeTabOnRefresh('ssh_keys', deps),
      cloud_inits: createComputeTabOnRefresh('cloud_inits', deps),
      recycle_bin: createComputeTabOnRefresh('recycle_bin', deps),
      migrations: createComputeTabOnRefresh('migrations', deps),
    };
  }, [loadTabResource, refreshVmSectionAuxiliaries]);

  if (!canViewComputeInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  if (innerActiveKey === 'ecs') {
    return (
      <>
        <VmSection
                vms={ecs}
                loading={resourceLoading.ecs}
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
                onRefresh={computeTabOnRefresh.ecs}
                onBackupsInventoryChanged={reloadBackupsInventory}
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
                    reloadVmListAfterMutation();
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
                    reloadVmListAfterMutation();
                  } catch (e: any) {
                    message.error(e?.message || '停止失败');
                  }
                }}
                onReboot={async (iid: string) => {
                  try {
                    await rebootCloudProviderEcs(cloudId, iid, false);
                    message.success('重启成功');
                    reloadVmListAfterMutation();
                  } catch (e: any) {
                    message.error(e?.message || '重启失败');
                  }
                }}
                onSoftReboot={async (iid: string) => {
                  try {
                    await softRebootCloudProviderEcs(cloudId, iid);
                    message.success('软重启成功');
                    reloadVmListAfterMutation();
                  } catch (e: any) {
                    message.error(e?.message || '软重启失败');
                  }
                }}
                onPause={async (iid: string) => {
                  try {
                    await pauseCloudProviderEcs(cloudId, iid);
                    message.success('暂停成功');
                    reloadVmListAfterMutation();
                  } catch (e: any) {
                    message.error(e?.message || '暂停失败');
                  }
                }}
                onUnpause={async (iid: string) => {
                  try {
                    await unpauseCloudProviderEcs(cloudId, iid);
                    message.success('恢复成功');
                    reloadVmListAfterMutation();
                  } catch (e: any) {
                    message.error(e?.message || '恢复失败');
                  }
                }}
                onDelete={async (iid: string, deleteVolumes?: boolean, isBatch?: boolean) => {
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
                    if (!isBatch) {
                      message.success('虚拟机已移入回收站，到期后自动删除');
                    }
                    reloadVmListAfterMutation();
                  } catch (e: any) {
                    message.error(e?.message || '移入回收站失败');
                  }
                }}
                images={harvesterImages}
                namespaces={harvesterNamespaces}
                volumes={harvesterVolumes}
              />
        <DebugJSON data={rawEcs} show={showLog} />
      </>
    );
  }

  if (innerActiveKey === 'images') {
    return (
      <>
        <ImagesSection
          cloudId={cloudId}
          images={harvesterImages}
          loading={resourceLoading.images}
          vms={ecs}
          onRefresh={computeTabOnRefresh.images}
          isTenant={isTenant}
        />
        <DebugJSON data={rawImages} show={showLog} />
      </>
    );
  }

  if (innerActiveKey === 'templates') {
    return (
      <>
        <TemplatesSection
          cloudId={cloudId}
          templates={harvesterTemplates}
          loading={resourceLoading.templates}
          onRefresh={computeTabOnRefresh.templates}
          isTenant={isTenant}
          workspaceVmNamespace={isTenant ? (nsFilter || undefined) : undefined}
        />
        <DebugJSON data={rawTemplates} show={showLog} />
      </>
    );
  }

  if (innerActiveKey === 'ssh_keys') {
    return (
      <>
        <SshKeysSection
          cloudId={cloudId}
          sshKeys={harvesterSshKeys}
          loading={resourceLoading.sshKeys}
          onRefresh={computeTabOnRefresh.ssh_keys}
        />
        <DebugJSON data={rawSshKeys} show={showLog} />
      </>
    );
  }

  if (innerActiveKey === 'cloud_inits') {
    return (
      <>
        <CloudInitsSection
          cloudId={cloudId}
          cloudInits={harvesterCloudInits}
          loading={resourceLoading.cloudInits}
          onRefresh={computeTabOnRefresh.cloud_inits}
        />
        <DebugJSON data={rawCloudInits} show={showLog} />
      </>
    );
  }

  if (innerActiveKey === 'recycle_bin') {
    return (
      <>
        <RecycleBinSection
          vms={ecs}
          loading={resourceLoading.ecs}
          cloudId={cloudId}
          isTenant={isTenant}
          onRefresh={computeTabOnRefresh.recycle_bin}
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
    );
  }

  if (innerActiveKey === 'migrations') {
    return (
      <>
        <MigrationsSection
          cloudId={cloudId}
          vms={ecs}
          migrations={harvesterMigrations}
          loading={resourceLoading.migrations}
          onRefresh={computeTabOnRefresh.migrations}
          isTenant={isTenant}
        />
        <DebugJSON data={rawMigrations} show={showLog} />
      </>
    );
  }

  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapComputeRoutePanel;
