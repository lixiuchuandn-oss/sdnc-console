import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, Tag, Space, Button, Row, Col, Alert, Tabs, Descriptions, message } from 'antd';
import {
  CloudUploadOutlined,
  SafetyCertificateOutlined,
  DeploymentUnitOutlined,
  NodeIndexOutlined,
  UnorderedListOutlined,
  DesktopOutlined,
  HomeOutlined,
  LoginOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import PageDetailContainer from '../../../../components/PageDetailContainer';
import {
  fetchClouds,
  fetchCsmVirtualElements,
  fetchCsmPhysicalElements,
  fetchCsmElementGroups,
  fetchCsmServiceChains,
  fetchCsmVRouters,
  fetchCsmAssets,
} from '../../../../services/api';
import { resolvePoolTypeLabel } from '../../../cnmc/pools/poolProviders';
import { normalizeCsmPoolTabParam } from '../../../../layouts/admin/csm/csmPoolSidebar';
import { routeSpecs } from '../../../../routes/RouteSpec';
import CsmServiceChainSection from './sections/CsmServiceChainSection';
import CsmPhysicalHostSection from './sections/CsmPhysicalHostSection';
import CsmVswClusterSection from './sections/CsmVswClusterSection';
import CsmPoolAssetsSection from './sections/CsmPoolAssetsSection';
import CsmVirtualElementsSection from './sections/CsmVirtualElementsSection';
import CsmElementGroupsSection from './sections/CsmElementGroupsSection';
import CsmPoolPoliciesSection from './sections/CsmPoolPoliciesSection';

export interface CloudItem {
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
}

const CloudDetailCsm: React.FC<{
  cloudId: string;
  backListPath?: string;
  backListLabel?: string;
  adminPoolDetailLayout?: boolean;
}> = ({
  cloudId,
  backListPath = '/admin/clouds',
  backListLabel = '资源池管理',
  adminPoolDetailLayout = false,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = useMemo(
    () => normalizeCsmPoolTabParam(searchParams.get('tab')),
    [searchParams],
  );
  const onDetailTabChange = useCallback(
    (key: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', key);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [virtualElements, setVirtualElements] = useState<any[]>([]);
  const [physicalElements, setPhysicalElements] = useState<any[]>([]);
  const [elementGroups, setElementGroups] = useState<any[]>([]);
  const [serviceChains, setServiceChains] = useState<any[]>([]);
  const [vRouters, setVRouters] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);

  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    return fromConfig || '-';
  }, [cloud]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cloudsRes = await fetchClouds();
      const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray((cloudsRes as any)?.data) ? (cloudsRes as any).data : []);
      setCloud((cloudList || []).find((c: any) => String(c.id) === String(cloudId)) || null);
      const [virtualJson, physicalJson, groupsJson, chainsJson, vRoutersJson, assetsJson] = await Promise.all([
        fetchCsmVirtualElements(cloudId).catch(() => null),
        fetchCsmPhysicalElements(cloudId).catch(() => null),
        fetchCsmElementGroups(cloudId).catch(() => null),
        fetchCsmServiceChains(cloudId).catch(() => null),
        fetchCsmVRouters(cloudId).catch(() => null),
        fetchCsmAssets(cloudId).catch(() => null),
      ]);
      const vList: any[] = (virtualJson as any)?.data?.items || (virtualJson as any)?.items || (virtualJson as any)?.data || [];
      const pList: any[] = (physicalJson as any)?.data?.items || (physicalJson as any)?.items || (physicalJson as any)?.data || [];
      const gList: any[] = (groupsJson as any)?.data?.items || (groupsJson as any)?.items || (groupsJson as any)?.data || [];
      const cList: any[] = (chainsJson as any)?.data?.items || (chainsJson as any)?.items || (chainsJson as any)?.data || [];
      const vrList: any[] = (vRoutersJson as any)?.data?.items || (vRoutersJson as any)?.items || (vRoutersJson as any)?.data || [];
      const aList: any[] = (assetsJson as any)?.data?.items || (assetsJson as any)?.items || (assetsJson as any)?.data || [];
      setVirtualElements(Array.isArray(vList) ? vList : []);
      setPhysicalElements(Array.isArray(pList) ? pList : []);
      setElementGroups(Array.isArray(gList) ? gList : []);
      setServiceChains(Array.isArray(cList) ? cList : []);
      setVRouters(Array.isArray(vrList) ? vrList : []);
      setAssets(Array.isArray(aList) ? aList : []);
    } catch (e: any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
            void loadAll();
  }, [loadAll]);

  return (
    <PageDetailContainer
      hideHeader={!!adminPoolDetailLayout}
      rootStyle={
        adminPoolDetailLayout
          ? {
              height: '100%',
              maxHeight: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxSizing: 'border-box',
            }
          : undefined
      }
      contentWrapperStyle={
        adminPoolDetailLayout
          ? {
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }
          : undefined
      }
      breadcrumbs={
        adminPoolDetailLayout
          ? undefined
          : [
              { title: <HomeOutlined />, href: '/' },
              { title: backListLabel, href: backListPath },
              { title: `CSM ${cloud?.name || '-'}` },
            ]
      }
      icon={adminPoolDetailLayout ? undefined : <CloudUploadOutlined />}
      title={adminPoolDetailLayout ? undefined : `CSM ${cloud?.name || '-'}`}
      titleLevel={3}
      asCard={false}
      subtitle={adminPoolDetailLayout ? undefined : 'CSM 详情（独立页面），汇总平台内资源与网络'}
      overviewContent={
        adminPoolDetailLayout
          ? undefined
          : (
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">CSM（SDN）</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">
            {cloud?.type ? resolvePoolTypeLabel(cloud.type) : '-'}
          </Descriptions.Item>
              <Descriptions.Item label="资源状态">
                {cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}
              </Descriptions.Item>
          <Descriptions.Item label="Endpoint">
            <Space>
              {cloud?.endpoint || '-'}
              {cloud?.endpoint && (
                <Button
                  type="link"
                  size="small"
                  icon={<LoginOutlined />}
                  style={{ padding: 0 }}
                  title="在新窗口打开"
                  onClick={() => {
                    let url = cloud.endpoint || '';
                    if (url.endsWith('/v3')) {
                      url = url.substring(0, url.length - 3);
                    } else if (url.endsWith('/v3/')) {
                      url = url.substring(0, url.length - 4);
                    }
                    window.open(url, '_blank');
                  }}
                >
                  打开
                </Button>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="版本">{versionText}</Descriptions.Item>
          <Descriptions.Item label="TLS 忽略">{tlsIgnored ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
            )
      }
    >
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16, flexShrink: 0 }} showIcon />
      )}
      <div
        style={
          adminPoolDetailLayout
            ? { flex: 1, minHeight: 0, overflow: 'auto' }
            : undefined
        }
      >
        <Tabs
        activeKey={activeTab}
        onChange={onDetailTabChange}
        tabBarStyle={adminPoolDetailLayout ? { display: 'none' } : undefined}
        items={[
          {
            key: 'physical',
            label: (
              <Space size={4}>
                <NodeIndexOutlined />
                <span>物理主机</span>
                <span>({physicalElements.length})</span>
              </Space>
            ),
            children: (
                <CsmPhysicalHostSection
                  physicalElements={physicalElements}
                  loading={loading}
                  onRefresh={loadAll}
                />
              ),
          },
          {
            key: 'vrouters',
            label: (
              <Space size={4}>
                <DeploymentUnitOutlined />
                <span>VSW 集群</span>
                <span>({vRouters.length})</span>
              </Space>
            ),
            children: (
                <CsmVswClusterSection
                  vRouters={vRouters}
                  loading={loading}
                  onRefresh={loadAll}
                />
              ),
          },
          {
            key: 'assets',
            label: (
              <Space size={4}>
                <DesktopOutlined />
                <span>防护对象</span>
                <span>({assets.length})</span>
              </Space>
            ),
            children: (
                <CsmPoolAssetsSection
                  cloudId={cloudId}
                  assets={assets}
                  loading={loading}
                  onRefresh={loadAll}
                />
              ),
          },
          {
            key: 'virtual',
            label: (
              <Space size={4}>
                <DeploymentUnitOutlined />
                <span>虚拟安全网元</span>
                <span>({virtualElements.length})</span>
              </Space>
            ),
            children: (
                <CsmVirtualElementsSection
                  cloudId={cloudId}
                  virtualElements={virtualElements}
                  loading={loading}
                  onRefresh={loadAll}
                />
              ),
          },
          {
            key: 'groups',
            label: (
              <Space size={4}>
                <SafetyCertificateOutlined />
                <span>安全网元组</span>
                <span>({elementGroups.length})</span>
              </Space>
            ),
            children: (
                <CsmElementGroupsSection
                  elementGroups={elementGroups}
                  loading={loading}
                  onRefresh={loadAll}
                />
              ),
          },
          {
            key: 'serviceChains',
            label: (
              <Space size={4}>
                <UnorderedListOutlined />
                <span>服务链</span>
                <span>({serviceChains.length})</span>
              </Space>
            ),
            children: <CsmServiceChainSection cloudId={cloudId} showLog={false} />,
          },
          {
            key: 'policies',
            label: (
              <Space size={4}>
                <FileTextOutlined />
                <span>阻断策略</span>
              </Space>
            ),
            children: <CsmPoolPoliciesSection cloudId={cloudId} />,
          },
        ]}
      />
      </div>
    </PageDetailContainer>
  );
};

const TRAFFIC_CSM_POOLS_SPEC = routeSpecs.find((s) => s.id === 'traffic-csm-pools');

/**
 * 流量编排下 `/admin/security/traffic/csm-pools/:cloudId` 的路由壳（与 `App` 懒加载约定），不单独建薄文件。
 */
export function CsmPoolDetailPage() {
  const { cloudId } = useParams();
  if (!cloudId) return null;
  const listPath = TRAFFIC_CSM_POOLS_SPEC?.path ?? '/admin/security/traffic/csm-pools';
  const listLabel =
    TRAFFIC_CSM_POOLS_SPEC?.breadcrumbLabel || TRAFFIC_CSM_POOLS_SPEC?.title || '安全资源池';
  return (
    <CloudDetailCsm
      adminPoolDetailLayout
      cloudId={decodeURIComponent(cloudId)}
      backListPath={listPath}
      backListLabel={listLabel}
    />
  );
}

export default CloudDetailCsm;
