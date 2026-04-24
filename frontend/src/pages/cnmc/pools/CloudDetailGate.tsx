/**
 * 云资源池详情入口：拉取 Cloud、按 provider 分发到各厂商/平台详情页；
 * 未覆盖的 provider 显示轻量提示。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { Alert, Button, Spin, Space } from 'antd';
import { CloudUploadOutlined, HomeOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import CloudDetailHw from '../clouds/Hw/CloudDetailHw';
import CloudDetailAliyun from '../clouds/Aliyun/CloudDetailAliyun';
import CloudmapPoolShell from '../clouds/Cloudmap/CloudmapPoolShell';
import { getProviderName } from './poolProviders';
import { fetchCloudById, fetchRancherClustersForPool } from '../../../services/api';

type CloudItem = {
  id: string;
  name: string;
  region: string;
  type: string;
  config?: any;
  status?: string;
  endpoint?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
};

/** Rancher 池详情 URL 无独立页：拉取下游集群后进入与列表「进入」相同的工作台首页。 */
const RANCHER_HOME_QUERY = 'tab=cluster&sub=projects' as const;

const RancherPoolHomeRedirect: React.FC<{
  poolId: string;
  cloudName: string;
  providerLabel: string;
  /** 接入时写入 config，一池一集群；有则直跳，避免误用列表第一项 */
  boundClusterId?: string;
}> = ({ poolId, cloudName, providerLabel, boundClusterId }) => {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<'loading' | 'error' | 'empty'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(() =>
    boundClusterId
      ? `/admin/clouds/${encodeURIComponent(poolId)}/clusters/${encodeURIComponent(boundClusterId)}?${RANCHER_HOME_QUERY}`
      : null,
  );

  useEffect(() => {
    if (boundClusterId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchRancherClustersForPool(poolId);
        if (cancelled) return;
        if (!list.length) {
          setPhase('empty');
          return;
        }
        const cid = list[0].id;
        setTarget(
          `/admin/clouds/${encodeURIComponent(poolId)}/clusters/${encodeURIComponent(cid)}?${RANCHER_HOME_QUERY}`,
        );
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message || '加载集群列表失败');
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poolId, boundClusterId]);

  if (target) {
    return <Navigate to={target} replace />;
  }

  const titleText = `${providerLabel} ${cloudName || '-'}`;

  if (phase === 'loading') {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 320,
          width: '100%',
        }}
      >
        <Spin size="large" tip="正在进入 Rancher 集群工作台…" />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <PageDetailContainer
        breadcrumbs={[
          { title: <HomeOutlined />, href: '/' },
          { title: '资源池管理' },
          { title: '资源池管理', href: '/admin/clouds' },
          { title: titleText },
        ]}
        icon={<CloudUploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
        title={titleText}
        titleLevel={3}
        onBack={() => navigate('/admin/clouds')}
        backTooltip="返回列表"
        moreMenuItems={[{ key: 'refresh', label: '刷新' }]}
        onMoreMenuClick={() => {}}
        asCard={false}
      >
        <Alert
          type="warning"
          message="无法进入集群工作台"
          description={errorMsg}
          showIcon
          action={
            <Space>
              <Button onClick={() => navigate('/admin/clouds')}>返回列表</Button>
              <Button type="primary" icon={<ReloadOutlined />} onClick={() => window.location.reload()}>
                重试
              </Button>
            </Space>
          }
        />
      </PageDetailContainer>
    );
  }

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源池管理' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: titleText },
      ]}
      icon={<CloudUploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
      title={titleText}
      titleLevel={3}
      onBack={() => navigate('/admin/clouds')}
      backTooltip="返回列表"
      moreMenuItems={[{ key: 'refresh', label: '刷新' }]}
      onMoreMenuClick={() => {}}
      asCard={false}
    >
      <Alert
        type="info"
        message="该 Rancher 资源池下暂无下游集群"
        description="请在 Rancher 中导入集群或检查 API 令牌权限后，从资源池列表再次进入。"
        showIcon
        action={
          <Button type="primary" onClick={() => navigate('/admin/clouds')}>
            返回资源池列表
          </Button>
        }
      />
    </PageDetailContainer>
  );
};

const CloudDetailGate: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providerRaw = useMemo(() => String(cloud?.config?.provider || cloud?.type || ''), [cloud]);
  const provider = useMemo(() => providerRaw.toLowerCase().trim(), [providerRaw]);
  const providerName = useMemo(() => getProviderName(provider), [provider]);

  const loadCloud = async () => {
    if (!id) return;
    try {
      setError(null);
      const c = await fetchCloudById(String(id), { skipCache: true });
      if (c) {
        setCloud({
          id: c.id,
          name: c.name,
          region: c.region,
          type: c.type,
          config: c.config,
          status: c.status,
          endpoint: c.endpoint,
          description: c.description,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        });
      } else {
        setCloud(null);
        setError('未找到该资源池，可能已被删除或无访问权限');
      }
    } catch (e: any) {
      setCloud(null);
      setError(e?.message || '获取资源池详情失败');
    }
  };

  useEffect(() => {
    loadCloud();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id) {
    return null;
  }

  if (provider.includes('huawei')) {
    return <CloudDetailHw cloudId={id} />;
  }
  if (provider.includes('aliyun')) {
    return <CloudDetailAliyun cloudId={id} />;
  }
  if (cloud && provider === 'cloudmap.csm') {
    return (
      <Navigate
        to={`/admin/security/traffic/csm-pools/${encodeURIComponent(String(id))}`}
        replace
      />
    );
  }
  if (provider === 'cloudmap.edge' || provider === 'cloudmap.private') {
    return <CloudmapPoolShell cloudId={id} />;
  }
  if (provider === 'rancher' && cloud) {
    const bound = String(cloud.config?.clusterId || '').trim();
    return (
      <RancherPoolHomeRedirect
        poolId={String(id)}
        cloudName={cloud.name}
        providerLabel={providerName}
        boundClusterId={bound || undefined}
      />
    );
  }
  if (provider === 'harvester' && cloud) {
    return (
      <PageDetailContainer
        breadcrumbs={[
          { title: <HomeOutlined />, href: '/' },
          { title: '资源池管理' },
          { title: '资源池管理', href: '/admin/clouds' },
          { title: `${providerName} ${cloud.name || '-'}` },
        ]}
        icon={<CloudUploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
        title={`${providerName} ${cloud.name || '-'}`}
        titleLevel={3}
        onBack={() => navigate('/admin/clouds')}
        backTooltip="返回列表"
        moreMenuItems={[{ key: 'refresh', label: '刷新' }]}
        onMoreMenuClick={() => {}}
        asCard={false}
      >
        <Alert
          type="warning"
          message="Harvester 独立资源池已下线"
          description={
            <div>
              <p>该类型资源池的专属管理界面已移除，平台不再支持新接入 Harvester 独立资源池。</p>
              <p>请改用 Cloudmap 私有云或融合边缘云接入；存量池可在「资源池管理」列表中进行连接测试、编辑凭证或删除。</p>
            </div>
          }
          showIcon
          action={
            <Button type="primary" onClick={() => navigate('/admin/clouds')}>
              返回资源池列表
            </Button>
          }
        />
      </PageDetailContainer>
    );
  }

  if (!cloud || !provider) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320, width: '100%' }}>
        {error ? (
          <Alert
            type="warning"
            message="资源池信息未就绪"
            description={error}
            showIcon
            action={
              <Space>
                <Button onClick={() => navigate('/admin/clouds')}>返回列表</Button>
                <Button type="primary" icon={<ReloadOutlined />} onClick={() => loadCloud()}>
                  重试
                </Button>
              </Space>
            }
          />
        ) : (
          <div
            style={{
              position: 'relative',
              minHeight: 160,
              minWidth: 200,
            }}
          >
            <Spin size="large" tip="加载资源池信息...">
              <div style={{ minHeight: 120, minWidth: 120 }} />
            </Spin>
          </div>
        )}
      </div>
    );
  }

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源池管理' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: `${providerName} ${cloud?.name || '-'}` },
      ]}
      icon={<CloudUploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
      title={`${providerName} ${cloud?.name || '-'}`}
      titleLevel={3}
      onBack={() => navigate('/admin/clouds')}
      backTooltip="返回列表"
      moreMenuItems={[{ key: 'refresh', label: '刷新' }]}
      onMoreMenuClick={() => {}}
      asCard={false}
    >
      <Alert
        type="info"
        message="该供应商暂未提供专属详情视图"
        description="请返回列表或稍后再试"
        style={{ marginBottom: 16 }}
        showIcon
      />
    </PageDetailContainer>
  );
};

export default CloudDetailGate;
