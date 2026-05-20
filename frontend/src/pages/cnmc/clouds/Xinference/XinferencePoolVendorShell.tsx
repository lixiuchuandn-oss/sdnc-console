/**
 * CNMC：`admin/clouds/vendor/xinference/:id` 挂载入口。
 */
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Spin } from 'antd';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { fetchCloudById } from '../../../../services/api';
import {
  buildPoolEntryPath,
  inferPoolRouteKind,
  mapFetchedCloudToPoolRow,
  poolEntryPathname,
  stripPoolPathTrailingSlash,
  type PoolDetailCloudRow,
} from '../../pools/lib/poolDetailNav';
import XinferencePoolWorkspace from './XinferencePoolWorkspace';

async function fetchPoolRow(poolId: string): Promise<{ row: PoolDetailCloudRow | null; error: string | null }> {
  try {
    const c = await fetchCloudById(String(poolId), { skipCache: true });
    if (!c) return { row: null, error: '未找到该资源池，可能已被删除或无访问权限' };
    return {
      error: null,
      row: mapFetchedCloudToPoolRow(c as Record<string, any>),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '获取资源池详情失败';
    return { error: msg, row: null };
  }
}

const XinferencePoolVendorShell: React.FC = () => {
  const { id: poolId = '' } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [row, setRow] = useState<PoolDetailCloudRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!poolId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      const { row: r, error } = await fetchPoolRow(poolId);
      if (cancelled) return;
      if (error || !r) {
        setErr(error || '加载失败');
        setRow(null);
        setLoading(false);
        return;
      }
      const want = buildPoolEntryPath(r);
      const here = stripPoolPathTrailingSlash(pathname);
      if (stripPoolPathTrailingSlash(poolEntryPathname(want)) !== here) {
        navigate(want, { replace: true });
        return;
      }
      setRow(r);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, pathname, poolId, retryKey]);

  if (!poolId) return null;

  if (err) {
    return (
      <PageDetailContainer hideHeader asCard={false}>
        <Alert
          action={
            <Button type="primary" onClick={() => setRetryKey((k) => k + 1)}>
              重试
            </Button>
          }
          description={err}
          message="资源池不可用"
          showIcon
          type="warning"
        />
      </PageDetailContainer>
    );
  }

  if (loading || !row) {
    return <Spin style={{ margin: '48px auto', display: 'block' }} size="large" tip="加载 Xinference 资源池…" />;
  }

  const rk = inferPoolRouteKind(row);
  if (rk.kind !== 'vendor' || rk.slug !== 'xinference') {
    return <Spin style={{ margin: '48px auto', display: 'block' }} size="large" />;
  }

  return <XinferencePoolWorkspace poolId={poolId} />;
};

export default XinferencePoolVendorShell;
