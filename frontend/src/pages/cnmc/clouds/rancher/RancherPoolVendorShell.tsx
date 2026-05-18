/**
 * CNMC：`admin/clouds/vendor/rancher/:id` 挂载入口。
 * 拉取云实例元数据、对齐规范 URL 后进入 `RancherPoolHomeRedirect`。
 */
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Spin } from 'antd';
import { CloudUploadOutlined, HomeOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { fetchCloudById } from '../../../../services/api';
import {
  buildPoolEntryPath,
  inferPoolRouteKind,
  mapFetchedCloudToPoolRow,
  stripPoolPathTrailingSlash,
  type PoolDetailCloudRow,
} from '../../pools/lib/poolDetailNav';
import { getProviderName } from '../../pools/lib/poolProviders';
import { RancherPoolHomeRedirect } from './RancherClusterWorkspace';

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

const RancherPoolVendorShell: React.FC = () => {
  const { id: poolId = '' } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [row, setRow] = useState<PoolDetailCloudRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!poolId) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
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
      if (stripPoolPathTrailingSlash(want) !== here) {
        navigate(want, { replace: true });
        return;
      }
      setRow(r);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, pathname, poolId]);

  if (!poolId) return null;

  if (err) {
    return (
      <PageDetailContainer
        asCard={false}
        backTooltip="返回列表"
        breadcrumbs={[
          { title: <HomeOutlined />, href: '/' },
          { title: '资源池管理' },
          { title: '资源池管理', href: '/admin/clouds' },
          { title: 'Rancher' },
        ]}
        icon={<CloudUploadOutlined style={{ color: '#1890ff', fontSize: 24 }} />}
        onBack={() => navigate('/admin/clouds')}
        title="Rancher"
        titleLevel={3}
      >
        <Alert
          action={
            <Button type="primary" onClick={() => navigate('/admin/clouds')}>
              返回资源池列表
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
    return <Spin style={{ margin: '48px auto', display: 'block' }} size="large" tip="加载 Rancher 资源池…" />;
  }

  const rk = inferPoolRouteKind(row);
  if (rk.kind !== 'vendor' || rk.slug !== 'rancher') {
    return <Spin style={{ margin: '48px auto', display: 'block' }} size="large" />;
  }

  const providerRaw = String(row.config?.provider || row.type || '').toLowerCase().trim();
  const bound = String(row.config?.clusterId || '').trim() || undefined;
  return (
    <RancherPoolHomeRedirect
      boundClusterId={bound}
      cloudName={row.name || '-'}
      poolId={poolId}
      providerLabel={getProviderName(providerRaw)}
    />
  );
};

export default RancherPoolVendorShell;
