/**
 * Cloudmap · 云存储 · RBD 跨集群镜像：在上游装配 bundle / YAML / 视图。
 */
import React from 'react';
import { useCephBlockBundleLoad } from '../../../../Harvester/ceph/sections/block/useCephBlockBundleLoad';
import { useCephBlockYamlDrawer } from '../../../../Harvester/ceph/sections/block/useCephBlockYamlDrawer';
import CephBlockCrYamlDrawer from '../../../../Harvester/ceph/sections/block/CephBlockCrYamlDrawer';
import CephBlockRbdMirrorPane from '../../../../Harvester/ceph/sections/block/CephBlockRbdMirrorPane';

export type CloudmapStorageCephRbdMirrorProps = { cloudId: string };

const CloudmapStorageCephRbdMirror: React.FC<CloudmapStorageCephRbdMirrorProps> = ({ cloudId }) => {
  const { loading, mirrorRows, load } = useCephBlockBundleLoad(cloudId);
  const yaml = useCephBlockYamlDrawer(cloudId);

  return (
    <div style={{ width: '100%' }}>
      <CephBlockRbdMirrorPane
        loading={loading}
        mirrorRows={mirrorRows}
        load={load}
        openYamlDrawer={(t) => yaml.openYamlDrawer(t)}
      />
      <CephBlockCrYamlDrawer
        open={yaml.yamlOpen}
        title={yaml.yamlTitle}
        yamlText={yaml.yamlText}
        loading={yaml.yamlLoading}
        onClose={yaml.closeYamlDrawer}
      />
    </div>
  );
};

export default CloudmapStorageCephRbdMirror;
