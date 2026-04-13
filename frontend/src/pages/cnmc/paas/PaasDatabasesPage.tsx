/**
 * PaaS · 数据库：跨资源池选择 Cloudmap 池后，复用云图内同款云数据库 Tab（实例 + 数据备份）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Select, Spin } from 'antd';
import { fetchClouds, fetchCloudProviderEcs, apiPost } from '../../../services/api';
import {
  fetchHarvesterImages,
  fetchHarvesterNads,
  fetchHarvesterStorageClasses,
  fetchKubeOvnSubnets,
  fetchHarvesterBackups,
  fetchHarvesterScheduleVmBackups,
} from '../../../services/harvesterApi';
import { useAuth } from '../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../utils/accessMapping';
import {
  CLOUD_PROVIDER_NETWORKS_READ,
  CLOUD_SUBNETS_FLAT_READ,
  CLOUD_SUBNETS_PUBLIC_READ,
  CLOUD_SUBNETS_VPC_READ,
} from '../../../constants/cloudPermissions';
import { useLicense } from '../../../contexts/LicenseContext';
import { runLoadEssentials } from '../clouds/Cloudmap/loadTabResource';
import CloudmapCloudDatabaseTabs from '../clouds/Cloudmap/tabs/rds_group';
import PageContainer from '../../../components/PageContainer';
import { HarvesterPublicNamespacesProvider } from '../clouds/Harvester/context/HarvesterPublicNamespacesContext';

const REQUEST_TIMEOUT = 30000;

const PaasDatabasesPage: React.FC = () => {
  const { user } = useAuth();
  const permissions = user?.permissions || [];
  const isTenant = user?.role === 'tenant' || !!(user as any)?.tenantId;
  const checkPerm = useCallback(
    (act: string) => hasPermissionForAction(permissions, act),
    [permissions],
  );
  const canReadVpcSubnets =
    checkPerm(CLOUD_SUBNETS_VPC_READ) || checkPerm('clouds.subnets:read');
  const canReadFlatSubnets =
    checkPerm(CLOUD_SUBNETS_FLAT_READ) || checkPerm('clouds.subnets:read');
  const canReadPublicSubnets =
    checkPerm(CLOUD_SUBNETS_PUBLIC_READ) || checkPerm('clouds.subnets:read');
  const canReadNetworkScopeBase =
    checkPerm('clouds.vpcs:read') ||
    canReadVpcSubnets ||
    canReadFlatSubnets ||
    canReadPublicSubnets ||
    checkPerm('clouds.security-groups.flat:read') ||
    checkPerm('clouds.security-groups.vpc:read') ||
    checkPerm('clouds.nads:read') ||
    checkPerm('clouds.networks:read') ||
    checkPerm('clouds:read');
  const canReadNetworkScope =
    canReadNetworkScopeBase ||
    checkPerm(CLOUD_PROVIDER_NETWORKS_READ) ||
    checkPerm('clouds.vlans:read');
  const canViewKubeOvnGroup =
    checkPerm('clouds:read') ||
    checkPerm('clouds.vpcs:read') ||
    canReadVpcSubnets ||
    checkPerm('clouds.security-groups.vpc:read') ||
    checkPerm('clouds.eips.vpc:read') ||
    checkPerm('clouds.fips.vpc:read') ||
    checkPerm('clouds.dnat.vpc:read') ||
    checkPerm('clouds.snat.vpc:read') ||
    checkPerm('clouds.traffic-mirroring.vpc:read');
  const canViewBackupsGroup =
    checkPerm('clouds.backups:read') ||
    checkPerm('clouds.restore-tasks:read') ||
    checkPerm('clouds:read');
  const { hasFeature } = useLicense();
  const ovnVpcEnabled = hasFeature('network.ovn.vpc');

  const [clouds, setClouds] = useState<any[]>([]);
  const [cloudsLoading, setCloudsLoading] = useState(true);
  const [cloudId, setCloudId] = useState<string | undefined>();

  const [, setCloud] = useState<any | null>(null);
  const [ecs, setEcs] = useState<any[]>([]);
  const [rawEcs, setRawEcs] = useState<any | null>(null);
  const [harvesterNads, setHarvesterNads] = useState<any[]>([]);
  const [rawNads, setRawNads] = useState<any | null>(null);
  const [kubeOvnVpcs, setKubeOvnVpcs] = useState<any[]>([]);
  const [rawVpcs, setRawVpcs] = useState<any | null>(null);
  const [kubeOvnSubnets, setKubeOvnSubnets] = useState<any[]>([]);
  const [rawSubnets, setRawSubnets] = useState<any | null>(null);
  const [harvesterImages, setHarvesterImages] = useState<any[]>([]);
  const [rawImages, setRawImages] = useState<any | null>(null);
  const [harvesterVolumes, setHarvesterVolumes] = useState<any[]>([]);
  const [rawVolumes, setRawVolumes] = useState<any | null>(null);
  const [harvesterStorageClasses, setHarvesterStorageClasses] = useState<any[]>([]);
  const [harvesterNodes, setHarvesterNodes] = useState<any[]>([]);
  const [rawNodes, setRawNodes] = useState<any | null>(null);
  const [harvesterNamespaces, setHarvesterNamespaces] = useState<any[]>([]);
  const [rawNamespaces, setRawNamespaces] = useState<any | null>(null);
  const [capabilities, setCapabilities] = useState<any | null>(null);
  const [harvesterBackups, setHarvesterBackups] = useState<any[]>([]);
  const [rawBackups, setRawBackups] = useState<any | null>(null);
  const [harvesterScheduleVmBackups, setHarvesterScheduleVmBackups] = useState<any[]>([]);
  const [rawScheduleVmBackups, setRawScheduleVmBackups] = useState<any | null>(null);
  const [resourceLoading, setResourceLoading] = useState<Record<string, boolean>>({});

  const loadedRef = useRef<Set<string>>(new Set());

  const loadResource = useCallback(
    async (key: string, fn: () => Promise<any>, cb: (json: any) => void, force = false) => {
      const cid = cloudId;
      if (!cid) return;
      if (!force && loadedRef.current.has(key)) return;
      if (force && loadedRef.current.has(key)) loadedRef.current.delete(key);
      setResourceLoading((prev) => ({ ...prev, [key]: true }));
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`请求超时: ${key}`)), REQUEST_TIMEOUT);
        });
        const json = await Promise.race([fn(), timeoutPromise]);
        cb(json as any);
        if (!force) loadedRef.current.add(key);
      } catch (e) {
        console.warn(`[PaasDatabases] load ${key}`, e);
        try {
          cb(null);
        } catch {
          /* ignore */
        }
      } finally {
        setResourceLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [cloudId],
  );

  const loadEssentials = useCallback(
    (force = false) => {
      if (!cloudId) return;
      runLoadEssentials(force, {
        cloudId,
        loadResource,
        checkPerm,
        canReadNetworkScope,
        canViewKubeOvnGroup,
        ovnVpcEnabled,
        canReadFlatSubnets,
        canReadVpcSubnets,
        setCloud,
        setEcs,
        setRawEcs,
        setHarvesterNads,
        setRawNads,
        setKubeOvnVpcs,
        setRawVpcs,
        setKubeOvnSubnets,
        setRawSubnets,
        setHarvesterImages,
        setRawImages,
        setHarvesterVolumes,
        setRawVolumes,
        setHarvesterStorageClasses,
        setHarvesterNodes,
        setRawNodes,
        setHarvesterNamespaces,
        setRawNamespaces,
        setCapabilities,
      });
    },
    [
      cloudId,
      loadResource,
      checkPerm,
      canReadNetworkScope,
      canViewKubeOvnGroup,
      ovnVpcEnabled,
      canReadFlatSubnets,
      canReadVpcSubnets,
    ],
  );

  const loadBackups = useCallback(
    (force: boolean) => {
      if (!cloudId) return;
      if (!checkPerm('clouds.backups:read') && !checkPerm('clouds:read')) return;
      loadResource(
        'backups',
        () => fetchHarvesterBackups(cloudId, force),
        (json) => {
          const list: any[] = Array.isArray((json as any)?.data?.items)
            ? (json as any).data.items
            : [];
          setHarvesterBackups(Array.isArray(list) ? list : []);
          setRawBackups(json || null);
        },
        force,
      );
      loadResource(
        'scheduleVmBackups',
        () => fetchHarvesterScheduleVmBackups(cloudId, force),
        (json) => {
          const list: any[] = Array.isArray((json as any)?.data?.items)
            ? (json as any).data.items
            : [];
          setHarvesterScheduleVmBackups(Array.isArray(list) ? list : []);
          setRawScheduleVmBackups(json || null);
        },
        force,
      );
    },
    [cloudId, checkPerm, loadResource],
  );

  const handleTabChange = useCallback(
    (key: string) => {
      if (
        key === 'backups_group' ||
        key === 'schedule_vm_backups' ||
        key === 'vm_snapshots' ||
        key === 'rds_data_backups' ||
        key === 'rds_db_backup' ||
        key === 'rds_db_snapshot' ||
        key === 'rds_db_schedule'
      ) {
        loadBackups(false);
      }
    },
    [loadBackups],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCloudsLoading(true);
      try {
        const list: any[] = await fetchClouds();
        const arr = Array.isArray(list) ? list : [];
        const filtered = arr.filter((c) =>
          String(c?.config?.provider || '').toLowerCase().startsWith('cloudmap'),
        );
        if (cancelled) return;
        setClouds(filtered);
        setCloudId((prev) => {
          if (prev && filtered.some((c) => String(c.id) === String(prev))) return prev;
          return filtered[0]?.id ? String(filtered[0].id) : undefined;
        });
      } finally {
        if (!cancelled) setCloudsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    loadedRef.current.clear();
    if (!cloudId) return;
    loadEssentials(false);
  }, [cloudId, loadEssentials]);

  const namespacesOptions = useMemo(() => {
    const nsSet = new Set<string>();
    (harvesterNamespaces || []).forEach((n: any) => {
      const name = n?.metadata?.name || n?.name || '';
      if (name) nsSet.add(name);
    });
    return Array.from(nsSet).filter(Boolean).sort();
  }, [harvesterNamespaces]);

  const refreshVms = useCallback(
    async (force: boolean) => {
      if (!cloudId || !checkPerm('clouds.ecs:read')) return;
      setResourceLoading((prev) => ({ ...prev, ecs: true }));
      try {
        if (force) {
          try {
            await apiPost(`/api/clouds/${cloudId}/sync`);
          } catch {
            /* ignore */
          }
        }
        const json = await fetchCloudProviderEcs(cloudId, force);
        const list: any[] = Array.isArray((json as any)?.data)
          ? (json as any).data
          : (json as any)?.data?.Instances?.Instance ||
            (json as any)?.data?.items ||
            (json as any)?.data?.data ||
            [];
        setEcs(Array.isArray(list) ? list : []);
        setRawEcs(json || null);
      } finally {
        setResourceLoading((prev) => ({ ...prev, ecs: false }));
      }
    },
    [cloudId, checkPerm],
  );

  const forceRefreshVms = useCallback(async () => {
    if (!cloudId) return;
    setResourceLoading((prev) => ({ ...prev, ecs: true }));
    try {
      try {
        await apiPost(`/api/clouds/${cloudId}/sync`);
      } catch {
        /* ignore */
      }
      const json = await fetchCloudProviderEcs(cloudId, true);
      const list: any[] = Array.isArray((json as any)?.data)
        ? (json as any).data
        : (json as any)?.data?.Instances?.Instance ||
          (json as any)?.data?.items ||
          (json as any)?.data?.data ||
          [];
      setEcs(Array.isArray(list) ? list : []);
      setRawEcs(json || null);
    } finally {
      setResourceLoading((prev) => ({ ...prev, ecs: false }));
    }
  }, [cloudId]);

  const poolHeaderTrailing = (
    <Select
      showSearch
      prefix="可用区"
      placeholder="选择资源池"
      style={{ minWidth: 240 }}
      loading={cloudsLoading}
      value={cloudId}
      onChange={(v) => setCloudId(String(v))}
      options={clouds.map((c) => ({
        value: String(c.id),
        label: c.name || String(c.id),
      }))}
      optionFilterProp="label"
    />
  );

  return (
    <PageContainer
      headerTrailing={poolHeaderTrailing}
      bordered={false}
      asCard={false}
      hideDivider
    >
      {cloudsLoading ? (
        <Spin />
      ) : clouds.length === 0 ? (
        <Alert type="warning" showIcon message="暂无 Cloudmap 资源池" description="请先在「资源池管理」中接入 Cloudmap 类型资源池。" />
      ) : !cloudId ? (
        <Alert type="info" showIcon message="请选择资源池" />
      ) : (
        <HarvesterPublicNamespacesProvider cloudId={cloudId}>
          <CloudmapCloudDatabaseTabs
            cloudId={cloudId}
            onTabChange={handleTabChange}
            showBackupsTab={canViewBackupsGroup}
            ecs={ecs}
            ecsLoading={resourceLoading.ecs}
            onRefreshVms={() => refreshVms(true)}
            onForceRefreshVms={forceRefreshVms}
            harvesterImages={harvesterImages}
            harvesterStorageClasses={harvesterStorageClasses}
            kubeOvnSubnets={kubeOvnSubnets}
            harvesterNads={harvesterNads}
            onReloadImages={
              checkPerm('clouds.images:read') || checkPerm('clouds.ecs:read')
                ? () =>
                    loadResource(
                      'images',
                      () => fetchHarvesterImages(cloudId, true),
                      (json) => setHarvesterImages(json?.data?.items || []),
                      true,
                    )
                : undefined
            }
            onReloadSubnets={
              canReadFlatSubnets || canReadVpcSubnets || checkPerm('clouds.networks:read')
                ? () =>
                    loadResource(
                      'subnets',
                      () => fetchKubeOvnSubnets(cloudId, true),
                      (json) => setKubeOvnSubnets(json?.data?.items || []),
                      true,
                    )
                : undefined
            }
            onReloadNads={
              checkPerm('clouds.networks:read')
                ? () =>
                    loadResource(
                      'nads',
                      () => fetchHarvesterNads(cloudId, true),
                      (json) => setHarvesterNads(json?.data?.items || []),
                      true,
                    )
                : undefined
            }
            onReloadStorageClasses={
              checkPerm('clouds.disks:read') || checkPerm('clouds.ecs:read')
                ? () =>
                    loadResource(
                      'storageClasses',
                      () => fetchHarvesterStorageClasses(cloudId, true),
                      (json) => setHarvesterStorageClasses(json?.data?.items || []),
                      true,
                    )
                : undefined
            }
            harvesterBackups={harvesterBackups}
            harvesterScheduleVmBackups={harvesterScheduleVmBackups}
            backupsLoading={resourceLoading.backups}
            scheduleVmBackupsLoading={resourceLoading.scheduleVmBackups}
            harvesterNamespaces={harvesterNamespaces}
            onRefreshBackups={() => loadBackups(true)}
            isTenant={isTenant}
            mode="ops"
            namespacesOptions={namespacesOptions}
          />
        </HarvesterPublicNamespacesProvider>
      )}
    </PageContainer>
  );
};

export default PaasDatabasesPage;
