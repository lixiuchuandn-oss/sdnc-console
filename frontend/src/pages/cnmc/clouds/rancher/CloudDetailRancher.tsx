import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Space, Tabs } from 'antd';
import {
  CloudUploadOutlined,
  HomeOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import { fetchCloudById } from '../../../../services/api';
import RancherOverviewSection, { type RancherCloud } from './sections/RancherOverviewSection';
import { getProviderName } from '../../pools/poolProviders';
import './rancher-detail.css';

const CloudDetailRancher: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [cloud, setCloud] = useState<RancherCloud | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    setError(null);
    try {
      const c = await fetchCloudById(String(cloudId), { skipCache: true });
      if (c) {
        setCloud({
          id: c.id,
          name: c.name,
          region: c.region,
          type: c.type,
          status: c.status,
          endpoint: c.endpoint,
          description: c.description,
          config: c.config,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          lastTestAt: c.lastTestAt,
        });
      } else {
        setCloud(null);
        setError('未找到该容器云资源池');
      }
    } catch (e: any) {
      setCloud(null);
      setError(e?.message || '加载资源池失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    void load();
  }, [load]);

  const titleName = cloud?.name || (loading ? '加载中…' : '容器云');
  const vendorTag = cloud?.config?.provider ? getProviderName(cloud.config.provider) : '';

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源池管理' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: vendorTag ? `容器云 · ${vendorTag} ${titleName}` : `容器云 ${titleName}` },
      ]}
      icon={<CloudUploadOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
      title={vendorTag ? `容器云 · ${vendorTag} ${titleName}` : `容器云 ${titleName}`}
      titleLevel={3}
      onBack={() => navigate('/admin/clouds')}
      backTooltip="返回列表"
      moreMenuItems={[{ key: 'refresh', label: '刷新' }]}
      onMoreMenuClick={({ key }) => {
        if (key === 'refresh') {
          void load().then(() => message.success('已刷新'));
        }
      }}
      asCard={false}
    >
      {error && (
        <Alert
          type="warning"
          showIcon
          message={error}
          style={{ marginBottom: 16 }}
          action={
            <Space>
              <Button size="small" onClick={() => navigate('/admin/clouds')}>
                返回列表
              </Button>
              <Button type="primary" size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
                重试
              </Button>
            </Space>
          }
        />
      )}

      <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: (
              <span>
                <InfoCircleOutlined /> 概览
              </span>
            ),
            children: <RancherOverviewSection cloud={cloud} loading={loading} />,
          },
        ]}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailRancher;
