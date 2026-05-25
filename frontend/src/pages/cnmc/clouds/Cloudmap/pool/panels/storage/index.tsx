import React from 'react';
import { Empty } from 'antd';
import { CLOUD_CEPH_READ } from '../../../../../../../constants/cloudPermissions';
import VolumesSection from '../../../../Harvester/ebs/sections/VolumesSection';
import SnapshotsSection from '../../../../Harvester/ebs/sections/SnapshotsSection';
import CloudmapStorageCephRbdMirror from './CloudmapStorageCephRbdMirror';
import { fetchCloudProviderEcs, fetchHarvesterVolumes } from '../../api';

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

export type CloudmapStorageRoutePanelProps = {
  cloudId: string;
  isTenant: boolean;
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  innerActiveKey: string;
  loadResource: (
    key: string,
    fn: () => Promise<any>,
    cb: (json: any) => void,
    force?: boolean,
  ) => Promise<void>;
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  ecs: any[];
  setEcs: (v: any[]) => void;
  setRawEcs: (v: any) => void;
  harvesterVolumes: any[];
  setHarvesterVolumes: (v: any[]) => void;
  harvesterStorageClasses: any[];
  harvesterSnapshots: any[];
  harvesterNamespaces: any[];
  resourceLoading: Record<string, boolean>;
  rawVolumes: any;
  rawSnapshots: any;
};

function canViewStorageInner(key: string, checkPerm: (a: string) => boolean): boolean {
  const cephish =
    checkPerm(CLOUD_CEPH_READ) ||
    checkPerm('clouds.disks:read') ||
    checkPerm('clouds.cluster-nodes:read') ||
    checkPerm('clouds:read');
  if (key === 'rbd_mirror') return cephish;
  if (key === 'volumes') return checkPerm('clouds.disks:read');
  if (key === 'snapshots') return checkPerm('clouds.snapshots:read');
  return false;
}

const CloudmapStorageRoutePanel: React.FC<CloudmapStorageRoutePanelProps> = (props) => {
  const {
    cloudId,
    isTenant,
    showLog,
    checkPerm,
    innerActiveKey,
    loadResource,
    loadTabResource,
    ecs,
    setEcs,
    setRawEcs,
    harvesterVolumes,
    setHarvesterVolumes,
    harvesterStorageClasses,
    harvesterSnapshots,
    harvesterNamespaces,
    resourceLoading,
    rawVolumes,
    rawSnapshots,
  } = props;

  if (!canViewStorageInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
  }

  if (innerActiveKey === 'rbd_mirror') {
    return <CloudmapStorageCephRbdMirror cloudId={cloudId} />;
  }
  if (innerActiveKey === 'volumes') {
    return (
      <>
        <VolumesSection
          cloudId={cloudId}
          volumes={harvesterVolumes}
          loading={resourceLoading.volumes}
          vms={ecs}
          storageClasses={harvesterStorageClasses}
          onRefresh={() => {
            loadResource(
              'volumes',
              () => fetchHarvesterVolumes(cloudId, true),
              (json) => setHarvesterVolumes(json?.data?.items || []),
              true,
            );
            loadResource(
              'ecs',
              () => fetchCloudProviderEcs(cloudId, true),
              (json) => {
                const list: any[] = Array.isArray((json as any)?.data)
                  ? (json as any).data
                  : (json as any)?.data?.Instances?.Instance ||
                    (json as any)?.data?.items ||
                    (json as any)?.data?.data ||
                    [];
                setEcs(Array.isArray(list) ? list : []);
                setRawEcs(json || null);
              },
              true,
            );
            void loadTabResource('storage_classes', true);
          }}
        />
        <DebugJSON data={rawVolumes} show={showLog} />
      </>
    );
  }
  if (innerActiveKey === 'snapshots') {
    return (
      <>
        <SnapshotsSection
          cloudId={cloudId}
          snapshots={harvesterSnapshots}
          namespaces={harvesterNamespaces}
          loading={resourceLoading.snapshots}
          onRefresh={() => void loadTabResource('snapshots', true)}
        />
        <DebugJSON data={rawSnapshots} show={showLog} />
      </>
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapStorageRoutePanel;
