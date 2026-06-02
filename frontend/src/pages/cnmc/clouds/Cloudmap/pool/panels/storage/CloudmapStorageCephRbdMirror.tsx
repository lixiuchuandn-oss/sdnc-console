/**
 * Cloudmap · 云存储 · RBD 跨集群镜像：在上游装配 bundle / YAML / 视图。
 */
import React, { useCallback } from 'react';
import yaml from 'js-yaml';
import { message } from 'antd';
import { useCephBlockBundleLoad } from '../../../../Harvester/ceph/sections/block/useCephBlockBundleLoad';
import { useHarvesterResourceLinkYamlDrawerSlot } from '../../../../Harvester/shared/components/HarvesterResourceLinkYamlDrawerSlot';
import { getCephRbdMirrorRook } from '../../../../../../../services/cephApi';
import CephBlockRbdMirrorPane, {
  type CephBlockYamlTarget,
} from '../../../../Harvester/ceph/sections/block/CephBlockRbdMirrorPane';
import type { CephSectionOnRefresh } from '../../loaders/cephRefresh';

export type CloudmapStorageCephRbdMirrorProps = {
  cloudId: string;
  onRefresh?: CephSectionOnRefresh;
};

const CloudmapStorageCephRbdMirror: React.FC<CloudmapStorageCephRbdMirrorProps> = ({
  cloudId,
  onRefresh,
}) => {
  const { loading, mirrorRows, load } = useCephBlockBundleLoad(cloudId);
  const { openStaticYamlDrawer, yamlDrawer } = useHarvesterResourceLinkYamlDrawerSlot(cloudId);

  const openYamlDrawer = useCallback(
    async (t: CephBlockYamlTarget) => {
      try {
        const res = await getCephRbdMirrorRook(cloudId, t.namespace, t.name);
        if (!res.ok || res.data == null) {
          message.error(res.error || '拉取详情失败');
          return;
        }
        openStaticYamlDrawer(yaml.dump(res.data, { lineWidth: 120, noRefs: true }), {
          title: `RBD Mirror · ${t.namespace}/${t.name}`,
          sourceLabel: `RBD Mirror · ${t.namespace}/${t.name}`,
        });
      } catch (e: unknown) {
        console.error(e);
        message.error('拉取详情失败');
      }
    },
    [cloudId, openStaticYamlDrawer],
  );

  return (
    <div style={{ width: '100%' }}>
      <CephBlockRbdMirrorPane
        loading={loading}
        mirrorRows={mirrorRows}
        load={load}
        onRefresh={onRefresh}
        openYamlDrawer={openYamlDrawer}
      />
      {yamlDrawer}
    </div>
  );
};

export default CloudmapStorageCephRbdMirror;
