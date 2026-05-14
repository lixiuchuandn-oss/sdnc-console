/**
 * Cloudmap · 云存储 · RADOS 命名空间：在上游装配 bundle / YAML / 视图（不经过 Harvester 侧块存储编排页）。
 */
import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCephBlockBundleLoad } from '../../../../Harvester/ceph/sections/block/useCephBlockBundleLoad';
import { useCephBlockYamlDrawer } from '../../../../Harvester/ceph/sections/block/useCephBlockYamlDrawer';
import CephBlockCrYamlDrawer from '../../../../Harvester/ceph/sections/block/CephBlockCrYamlDrawer';
import CephBlockRadosNamespacePane from '../../../../Harvester/ceph/sections/block/CephBlockRadosNamespacePane';

export type CloudmapStorageCephRadosNamespacesProps = { cloudId: string };

const CloudmapStorageCephRadosNamespaces: React.FC<CloudmapStorageCephRadosNamespacesProps> = ({
  cloudId,
}) => {
  const [searchParams] = useSearchParams();
  const blockPool = searchParams.get('blockPool');
  const searchPreset = blockPool != null && blockPool !== '' ? blockPool : null;

  const { loading, loadErr, radosRows, load } = useCephBlockBundleLoad(cloudId);
  const yaml = useCephBlockYamlDrawer(cloudId);

  return (
    <div style={{ width: '100%' }}>
      <CephBlockRadosNamespacePane
        cloudId={cloudId}
        loading={loading}
        loadErr={loadErr}
        radosRows={radosRows}
        load={load}
        searchPreset={searchPreset}
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

export default CloudmapStorageCephRadosNamespaces;
