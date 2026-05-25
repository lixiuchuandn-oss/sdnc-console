/**
 * Cloudmap 池数据加载依赖类型。
 * 业务域与 `layouts/admin/cloudmap/cloudPoolSidebar` 的 `CLOUDMAP_POOL_NAV_KEYS`、
 * `panels/<域>/` 目录一一对应；路径内层段与侧栏 `pathSeg` 一致。
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AswCtlSwitchProbeRecord } from 'services/harvester/types/aswProbe';
import type { DatacenterRack } from '../../../../../../services/datacenterTopologyApi';
import type { NodeLiveMetrics } from '../../../Harvester/hsm/lib/physicalNodeRackUtils';

/** 首屏/池级必备数据：`runPoolEssentials` 注入（由 `useCloudmapPoolDetailEngine` 组装） */
export type PoolEssentialsDeps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  canReadNetworkScope: boolean;
  canViewKubeOvnGroup: boolean;
  ovnVpcEnabled: boolean;
  canReadFlatSubnets: boolean;
  canReadVpcSubnets: boolean;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  setCloud: Dispatch<SetStateAction<any | null>>;
  setEcs: Dispatch<SetStateAction<any[]>>;
  setRawEcs: Dispatch<SetStateAction<any | null>>;
  setHarvesterNads: Dispatch<SetStateAction<any[]>>;
  setRawNads: Dispatch<SetStateAction<any | null>>;
  setKubeOvnVpcs: Dispatch<SetStateAction<any[]>>;
  setRawVpcs: Dispatch<SetStateAction<any | null>>;
  setKubeOvnSubnets: Dispatch<SetStateAction<any[]>>;
  setRawSubnets: Dispatch<SetStateAction<any | null>>;
  setHarvesterImages: Dispatch<SetStateAction<any[]>>;
  setRawImages: Dispatch<SetStateAction<any | null>>;
  setHarvesterVolumes: Dispatch<SetStateAction<any[]>>;
  setRawVolumes: Dispatch<SetStateAction<any | null>>;
  setHarvesterStorageClasses: Dispatch<SetStateAction<any[]>>;
  setHarvesterNodes: Dispatch<SetStateAction<any[]>>;
  setRawNodes: Dispatch<SetStateAction<any | null>>;
  setHarvesterNamespaces: Dispatch<SetStateAction<any[]>>;
  setCapabilities: Dispatch<SetStateAction<any | null>>;
};

/** 按 URL 内层段按需拉数：`runPathResourceLoad` 注入（与侧栏 pathSeg 对齐） */
export type PoolPathResourceDeps = {
  cloudId: string;
  checkPerm: (act: string) => boolean;
  canReadNetworkScope: boolean;
  canReadLoadBalancers: boolean;
  canViewKubeOvnGroup: boolean;
  canViewFlatNetworkGroup: boolean;
  ovnVpcEnabled: boolean;
  harvesterSecrets: any[];
  loadedRef: MutableRefObject<Set<string>>;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  setResourceLoading: Dispatch<SetStateAction<Record<string, boolean>>>;
  setHarvesterNamespacesForManagement: Dispatch<SetStateAction<any[]>>;
  setHarvesterNamespaces: Dispatch<SetStateAction<any[]>>;
  setEcs: Dispatch<SetStateAction<any[]>>;
  setRawEcs: Dispatch<SetStateAction<any | null>>;
  setHarvesterVolumes: Dispatch<SetStateAction<any[]>>;
  setRawVolumes: Dispatch<SetStateAction<any | null>>;
  setHarvesterSnapshots: Dispatch<SetStateAction<any[]>>;
  setRawSnapshots: Dispatch<SetStateAction<any | null>>;
  setHarvesterBackups: Dispatch<SetStateAction<any[]>>;
  setRawBackups: Dispatch<SetStateAction<any | null>>;
  setHarvesterScheduleVmBackups: Dispatch<SetStateAction<any[]>>;
  setRawScheduleVmBackups: Dispatch<SetStateAction<any | null>>;
  setHarvesterSshKeys: Dispatch<SetStateAction<any[]>>;
  setRawSshKeys: Dispatch<SetStateAction<any | null>>;
  setHarvesterCloudInits: Dispatch<SetStateAction<any[]>>;
  setRawCloudInits: Dispatch<SetStateAction<any | null>>;
  setHarvesterTemplates: Dispatch<SetStateAction<any[]>>;
  setRawTemplates: Dispatch<SetStateAction<any | null>>;
  setHarvesterImages: Dispatch<SetStateAction<any[]>>;
  setRawImages: Dispatch<SetStateAction<any | null>>;
  setHarvesterMigrations: Dispatch<SetStateAction<any[]>>;
  setRawMigrations: Dispatch<SetStateAction<any | null>>;
  setHarvesterGpuResources: Dispatch<SetStateAction<any[]>>;
  setRawGpu: Dispatch<SetStateAction<any | null>>;
  setHarvesterUsbDevices: Dispatch<SetStateAction<any[]>>;
  setRawUsbDevices: Dispatch<SetStateAction<any | null>>;
  setHarvesterPciDevices: Dispatch<SetStateAction<any[]>>;
  setRawPciDevices: Dispatch<SetStateAction<any | null>>;
  setHarvesterLoadBalancers: Dispatch<SetStateAction<any[]>>;
  setRawLoadBalancers: Dispatch<SetStateAction<any | null>>;
  setHarvesterServices: Dispatch<SetStateAction<any[]>>;
  setRawServices: Dispatch<SetStateAction<any | null>>;
  setHarvesterVlans: Dispatch<SetStateAction<any[]>>;
  setRawVlans: Dispatch<SetStateAction<any | null>>;
  setHarvesterKubeOvnProviderNetworks: Dispatch<SetStateAction<any[]>>;
  setHarvesterIPPools: Dispatch<SetStateAction<any[]>>;
  setRawIPPools: Dispatch<SetStateAction<any | null>>;
  setHarvesterNads: Dispatch<SetStateAction<any[]>>;
  setRawNads: Dispatch<SetStateAction<any | null>>;
  setHarvesterClusterNetworks: Dispatch<SetStateAction<any[]>>;
  setRawClusterNetworks: Dispatch<SetStateAction<any | null>>;
  setHarvesterNodes: Dispatch<SetStateAction<any[]>>;
  setRawNodes: Dispatch<SetStateAction<any | null>>;
  setHarvesterStorageClasses: Dispatch<SetStateAction<any[]>>;
  setKubeOvnVpcs: Dispatch<SetStateAction<any[]>>;
  setRawVpcs: Dispatch<SetStateAction<any | null>>;
  setKubeOvnSubnets: Dispatch<SetStateAction<any[]>>;
  setRawSubnets: Dispatch<SetStateAction<any | null>>;
  setKubeOvnEips: Dispatch<SetStateAction<any[]>>;
  setRawEips: Dispatch<SetStateAction<any | null>>;
  setKubeOvnSnatRules: Dispatch<SetStateAction<any[]>>;
  setRawSnatRules: Dispatch<SetStateAction<any | null>>;
  setKubeOvnDnatRules: Dispatch<SetStateAction<any[]>>;
  setRawDnatRules: Dispatch<SetStateAction<any | null>>;
  setKubeOvnFlatEips: Dispatch<SetStateAction<any[]>>;
  setKubeOvnFlatSnatRules: Dispatch<SetStateAction<any[]>>;
  setKubeOvnFlatDnatRules: Dispatch<SetStateAction<any[]>>;
  setHarvesterDeployments: Dispatch<SetStateAction<any[]>>;
  setHarvesterStatefulSets: Dispatch<SetStateAction<any[]>>;
  setHarvesterDaemonSets: Dispatch<SetStateAction<any[]>>;
  setHarvesterPods: Dispatch<SetStateAction<any[]>>;
  setHarvesterJobs: Dispatch<SetStateAction<any[]>>;
  setHarvesterCronJobs: Dispatch<SetStateAction<any[]>>;
  setHarvesterIngresses: Dispatch<SetStateAction<any[]>>;
  setRawIngresses: Dispatch<SetStateAction<any | null>>;
  setHarvesterConfigMaps: Dispatch<SetStateAction<any[]>>;
  setHarvesterSecrets: Dispatch<SetStateAction<any[]>>;
  setHarvesterImagePullSecrets: Dispatch<SetStateAction<any[]>>;
  setHarvesterPDBs: Dispatch<SetStateAction<any[]>>;
  setHarvesterNetworkPolicies: Dispatch<SetStateAction<any[]>>;
  setGatewayApiStatus: Dispatch<
    SetStateAction<{
      installed: boolean;
      resources: {
        gatewayClass: boolean;
        gateway: boolean;
        httpRoute: boolean;
        grpcRoute: boolean;
      };
    } | null>
  >;
  setGatewayClasses: Dispatch<SetStateAction<any[]>>;
  setGateways: Dispatch<SetStateAction<any[]>>;
  setHttpRoutes: Dispatch<SetStateAction<any[]>>;
  setGrpcRoutes: Dispatch<SetStateAction<any[]>>;
  setDatacenterRacks: Dispatch<SetStateAction<DatacenterRack[]>>;
  setDatacenterNodeMetricsMap: Dispatch<SetStateAction<Record<string, NodeLiveMetrics>>>;
  setHarvesterAswSwitches: Dispatch<SetStateAction<AswCtlSwitchProbeRecord[]>>;
};
