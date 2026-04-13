import React from 'react';
import { Tabs } from 'antd';
import VolumesSection from '../../../Harvester/ebs/sections/VolumesSection';
import SnapshotsSection from '../../../Harvester/ebs/sections/SnapshotsSection';
import { fetchCloudProviderEcs, fetchHarvesterVolumes } from '../../runtime/api';

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

export type CloudmapStorageGroupTabsProps = {
  cloudId: string;
  mode: 'standard' | 'ops';
  showLog: boolean;
  checkPerm: (act: string) => boolean;
  handleTabChange: (key: string) => void;
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

const CloudmapStorageGroupTabs: React.FC<CloudmapStorageGroupTabsProps> = (
  props,
) => {
  const {
    cloudId,
    mode,
    showLog,
    checkPerm,
    handleTabChange,
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

  return (
    <Tabs
      type="line"
      destroyOnHidden
      defaultActiveKey="volumes"
      onChange={handleTabChange}
      items={[
        {
          key: 'volumes',
          label: '虚拟云盘',
          children: (
            <>
              <VolumesSection
                cloudId={cloudId}
                volumes={harvesterVolumes}
                loading={resourceLoading.volumes}
                vms={ecs}
                storageClasses={harvesterStorageClasses}
                mode={mode}
                onRefresh={() => {
                  loadResource(
                    'volumes',
                    () => fetchHarvesterVolumes(cloudId, true),
                    (json) =>
                      setHarvesterVolumes(json?.data?.items || []),
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
                }}
              />
              <DebugJSON data={rawVolumes} show={showLog} />
            </>
          ),
        },
        {
          key: 'snapshots',
          label: '云盘快照',
          children: (
            <>
              <SnapshotsSection
                cloudId={cloudId}
                snapshots={harvesterSnapshots}
                namespaces={harvesterNamespaces}
                loading={resourceLoading.snapshots}
                onRefresh={() => loadTabResource('snapshots', true)}
                mode={mode}
              />
              <DebugJSON data={rawSnapshots} show={showLog} />
            </>
          ),
        },
      ].filter((i: any) => {
        if (i.key === 'volumes') return checkPerm('clouds.disks:read');
        if (i.key === 'snapshots')
          return checkPerm('clouds.snapshots:read');
        return true;
      })}
    />
  );
};

export default CloudmapStorageGroupTabs;
