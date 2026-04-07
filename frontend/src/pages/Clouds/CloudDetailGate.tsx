/**
 * 云资源池详情入口：拉取 Cloud、按 provider 分发到各厂商/平台详情页；
 * 未覆盖的 provider 显示轻量提示。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Alert, Button, Spin, Space } from 'antd';
import { CloudUploadOutlined, HomeOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../components/PageDetailContainer';
import CloudDetailHw from './Hw/CloudDetailHw';
import CloudDetailHarvester from './Harvester/CloudDetailHarvester';
import CloudDetailAliyun from './Aliyun/CloudDetailAliyun';
import CloudDetailCsm from './Csm/CloudDetailCsm';
import CloudDetailCloudmap from './Cloudmap/CloudDetailCloudmap';
import { getProviderName } from './providers';
import { fetchCloudById } from '../../services/api';

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
  if (provider === 'cloudmap.csm') {
    return <CloudDetailCsm cloudId={id} />;
  }
  if (provider === 'cloudmap.edge' || provider === 'cloudmap.private') {
    return <CloudDetailCloudmap cloudId={id} />;
  }
  if (provider === 'harvester') {
    return <CloudDetailHarvester cloudId={id} defaultProvider={provider} />;
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
          <Spin size="large" tip="加载资源池信息..." />
        )}
      </div>
    );
  }

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源控制台' },
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
