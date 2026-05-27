/**
 * Cloudmap「统一存储总览」：存在 Rook 统一存储集群时展示统一存储总览，否则展示 Longhorn（存量底座）。
 * 探测仅用 `monitoring/ceph-clusters`（单资源列表），避免 `ceph/rook/bundle` 全量聚合带来的延迟。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { fetchCephClusters } from '../../../../../../../services/monitoringApi';
import CephStorageSection from '../../../../Harvester/ceph/sections/CephStorageSection';
import LonghornStorageSection from '../../../../Harvester/longhorn/sections/LonghornStorageSection';
import { interpretCephClusterProbe } from './lib/cloudmapStorageDashboardProbe';

export type CloudmapStorageDashboardByBackendProps = {
  cloudId: string;
};

type Phase = 'loading' | 'ceph' | 'longhorn' | 'error';

const CloudmapStorageDashboardByBackend: React.FC<CloudmapStorageDashboardByBackendProps> = ({ cloudId }) => {
  const [phase, setPhase] = useState<Phase>('loading');
  const [err, setErr] = useState<string | null>(null);
  const cloudIdRef = useRef(cloudId);
  cloudIdRef.current = cloudId;

  const load = useCallback(async () => {
    const targetId = cloudId;
    if (!targetId) {
      setPhase('error');
      setErr('缺少云实例 ID');
      return;
    }
    setPhase('loading');
    setErr(null);
    const res = await fetchCephClusters(targetId, { force: true });
    if (cloudIdRef.current !== targetId) return;
    if (!res.ok) {
      setPhase('error');
      setErr(res.error || '无法读取统一存储集群列表，暂无法判断存储类型');
      return;
    }
    const verdict = interpretCephClusterProbe(res.data);
    if (cloudIdRef.current !== targetId) return;
    if (verdict === 'forbidden') {
      setPhase('error');
      setErr('无权限列出统一存储集群，无法判断存储类型');
      return;
    }
    setPhase(verdict === 'ceph' ? 'ceph' : 'longhorn');
  }, [cloudId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === 'error') {
    return (
      <Alert
        type="error"
        showIcon
        message={err || '加载失败'}
        action={
          <Button size="small" type="primary" onClick={() => void load()}>
            重试
          </Button>
        }
      />
    );
  }

  if (phase === 'loading') {
    return null;
  }

  return (
    <>
      {phase === 'ceph' ? <CephStorageSection key={cloudId} cloudId={cloudId} /> : null}
      {phase === 'longhorn' ? <LonghornStorageSection key={cloudId} cloudId={cloudId} /> : null}
    </>
  );
};

export default CloudmapStorageDashboardByBackend;
