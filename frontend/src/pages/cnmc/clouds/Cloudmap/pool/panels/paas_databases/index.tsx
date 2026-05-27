/**
 * Cloudmap 详情 — 云数据库：侧栏路径驱动（当前仅 `rds` 实例列表）。
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Empty } from 'antd';
import { PaasSection } from '../../../../Harvester/database';
import { createPaasDatabasesTabOnRefresh } from '../../loaders/paasDatabasesRefresh';
import {
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterStorageClasses,
  fetchKubeOvnSubnets,
} from '../../api';

export type CloudmapCloudDatabaseRoutePanelProps = {
  cloudId: string;
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
  checkPerm: (act: string) => boolean;
  canReadFlatSubnets: boolean;
  canReadVpcSubnets: boolean;

  ecs: any[];
  ecsLoading: boolean;

  harvesterImages: any[];
  harvesterStorageClasses: any[];
  kubeOvnSubnets: any[];
  harvesterNads: any[];
  setHarvesterImages: (v: any[]) => void;
  setKubeOvnSubnets: (v: any[]) => void;
  setHarvesterNads: (v: any[]) => void;
  setHarvesterStorageClasses: (v: any[]) => void;

  isTenant: boolean;
  namespacesOptions?: string[];
  capabilities?: any;
};

const CloudmapCloudDatabaseRoutePanel: React.FC<
  CloudmapCloudDatabaseRoutePanelProps
> = ({
  cloudId,
  innerActiveKey,
  loadTabResource,
  loadResource,
  checkPerm,
  canReadFlatSubnets,
  canReadVpcSubnets,
  ecs,
  ecsLoading,
  harvesterImages,
  harvesterStorageClasses,
  kubeOvnSubnets,
  harvesterNads,
  setHarvesterImages,
  setKubeOvnSubnets,
  setHarvesterNads,
  setHarvesterStorageClasses,
  isTenant,
  namespacesOptions = [],
  capabilities,
}) => {
  useEffect(() => {
    if (innerActiveKey !== 'rds') return;
    void loadTabResource('rds', false);
  }, [innerActiveKey, cloudId, loadTabResource]);

  const refreshVmSectionAuxiliaries = useCallback(() => {
    if (checkPerm('clouds.images:read') || checkPerm('clouds.ecs:read')) {
      void loadTabResource('images', true);
    }
    if (
      canReadFlatSubnets ||
      canReadVpcSubnets ||
      checkPerm('clouds.networks:read')
    ) {
      void loadResource(
        'subnets',
        () => fetchKubeOvnSubnets(cloudId, true),
        (json) => setKubeOvnSubnets((json as any)?.data?.items || []),
        true,
      );
    }
    if (checkPerm('clouds.nads:read')) {
      void loadTabResource('nads', true);
    }
    if (
      checkPerm('clouds.storage-classes:read') ||
      checkPerm('clouds.disks:read') ||
      checkPerm('clouds.ecs:read')
    ) {
      void loadTabResource('storage_classes', true);
    }
  }, [
    checkPerm,
    canReadFlatSubnets,
    canReadVpcSubnets,
    cloudId,
    loadResource,
    loadTabResource,
    setKubeOvnSubnets,
  ]);

  const paasDatabasesTabOnRefresh = useMemo(() => {
    const deps = { loadTabResource, refreshVmSectionAuxiliaries };
    return {
      rds: createPaasDatabasesTabOnRefresh('rds', deps),
    };
  }, [loadTabResource, refreshVmSectionAuxiliaries]);

  const onReloadImages = useCallback(() => {
    if (!checkPerm('clouds.images:read') && !checkPerm('clouds.ecs:read')) {
      return;
    }
    void loadResource(
      'images',
      () => fetchHarvesterImages(cloudId, true),
      (json: any) => setHarvesterImages((json as any)?.data?.items || []),
      true,
    );
  }, [checkPerm, cloudId, loadResource, setHarvesterImages]);

  const onReloadSubnets = useCallback(() => {
    if (
      !canReadFlatSubnets &&
      !canReadVpcSubnets &&
      !checkPerm('clouds.networks:read')
    ) {
      return;
    }
    void loadResource(
      'subnets',
      () => fetchKubeOvnSubnets(cloudId, true),
      (json) => setKubeOvnSubnets((json as any)?.data?.items || []),
      true,
    );
  }, [
    canReadFlatSubnets,
    canReadVpcSubnets,
    checkPerm,
    cloudId,
    loadResource,
    setKubeOvnSubnets,
  ]);

  const onReloadNads = useCallback(() => {
    if (!checkPerm('clouds.nads:read')) return;
    void loadResource(
      'nads',
      () => fetchHarvesterNads(cloudId, true),
      (json: any) => setHarvesterNads((json as any)?.data?.items || []),
      true,
    );
  }, [checkPerm, cloudId, loadResource, setHarvesterNads]);

  const onReloadStorageClasses = useCallback(() => {
    if (
      !checkPerm('clouds.disks:read') &&
      !checkPerm('clouds.ecs:read') &&
      !checkPerm('clouds.storage-classes:read')
    ) {
      return;
    }
    void loadResource(
      'storageClasses',
      () => fetchHarvesterStorageClasses(cloudId, true),
      (json: any) =>
        setHarvesterStorageClasses((json as any)?.data?.items || []),
      true,
    );
  }, [checkPerm, cloudId, loadResource, setHarvesterStorageClasses]);

  if (innerActiveKey === 'rds') {
    return (
      <PaasSection
        vms={ecs}
        loading={ecsLoading}
        cloudId={cloudId}
        onRefresh={paasDatabasesTabOnRefresh.rds}
        images={harvesterImages}
        storageClasses={harvesterStorageClasses}
        kubeSubnets={kubeOvnSubnets}
        harvesterNads={harvesterNads}
        onReloadImages={onReloadImages}
        onReloadSubnets={onReloadSubnets}
        onReloadNads={onReloadNads}
        onReloadStorageClasses={onReloadStorageClasses}
        isTenant={isTenant}
        namespacesOptions={namespacesOptions}
        clusterCapabilities={capabilities}
      />
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapCloudDatabaseRoutePanel;
