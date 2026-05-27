import React, { useCallback, useMemo } from 'react';
import { Empty } from 'antd';
import VolumesSection from '../../../../Harvester/ebs/sections/VolumesSection';
import SnapshotsSection from '../../../../Harvester/ebs/sections/SnapshotsSection';
import { createStorageTabOnRefresh } from '../../loaders/storageRefresh';

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
  loadTabResource: (
    key: string,
    force?: boolean,
    skipSync?: boolean,
  ) => Promise<void>;
  ecs: any[];
  harvesterVolumes: any[];
  harvesterStorageClasses: any[];
  harvesterSnapshots: any[];
  harvesterNamespaces: any[];
  resourceLoading: Record<string, boolean>;
  rawVolumes: any;
  rawSnapshots: any;
};

function canViewStorageInner(key: string, checkPerm: (act: string) => boolean): boolean {
  if (key === 'volumes') return checkPerm('clouds.disks:read');
  if (key === 'snapshots') return checkPerm('clouds.snapshots:read');
  return false;
}

const CloudmapStorageRoutePanel: React.FC<CloudmapStorageRoutePanelProps> = (props) => {
  const {
    cloudId,
    showLog,
    checkPerm,
    innerActiveKey,
    loadTabResource,
    ecs,
    harvesterVolumes,
    harvesterStorageClasses,
    harvesterSnapshots,
    harvesterNamespaces,
    resourceLoading,
    rawVolumes,
    rawSnapshots,
  } = props;

  const refreshVolumesTabAuxiliaries = useCallback(() => {
    if (
      checkPerm('clouds.storage-classes:read') ||
      checkPerm('clouds.ecs:read') ||
      checkPerm('clouds:read')
    ) {
      void loadTabResource('storage_classes', true);
    }
  }, [checkPerm, loadTabResource]);

  const storageTabOnRefresh = useMemo(() => {
    const deps = { loadTabResource, refreshVolumesTabAuxiliaries };
    return {
      volumes: createStorageTabOnRefresh('volumes', deps),
      snapshots: createStorageTabOnRefresh('snapshots', deps),
    };
  }, [loadTabResource, refreshVolumesTabAuxiliaries]);

  const refreshImagesAfterExport = useCallback(
    (force?: boolean, skipSync?: boolean) => {
      if (!checkPerm('clouds.images:read')) return;
      void loadTabResource('images', force !== false, skipSync);
    },
    [checkPerm, loadTabResource],
  );

  const refreshStorageClasses = useCallback(
    (force?: boolean, skipSync?: boolean) => {
      void loadTabResource('storage_classes', force !== false, skipSync);
    },
    [loadTabResource],
  );

  if (!canViewStorageInner(innerActiveKey, checkPerm)) {
    return <Empty description="无权限访问" style={{ marginTop: 48 }} />;
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
          onRefresh={storageTabOnRefresh.volumes}
          onRefreshStorageClasses={refreshStorageClasses}
          onRefreshImages={refreshImagesAfterExport}
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
          onRefresh={storageTabOnRefresh.snapshots}
        />
        <DebugJSON data={rawSnapshots} show={showLog} />
      </>
    );
  }
  return <Empty description="未知页面" style={{ marginTop: 48 }} />;
};

export default CloudmapStorageRoutePanel;
