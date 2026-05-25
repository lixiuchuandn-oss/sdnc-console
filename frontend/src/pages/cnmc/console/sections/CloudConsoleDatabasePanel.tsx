/**
 * 云主机控制台 — 云数据库 / 消息队列：二级类目（RDS、NoSQL、MQ）+ 产品下拉，与 CloudConsoleMainPanel 导航形态一致。
 */
import React, { useCallback, useEffect, useMemo } from 'react';
import { Tabs, Empty, Dropdown, Space } from 'antd';
import { CaretDownFilled } from '@ant-design/icons';
import { useAuth } from '../../../../contexts/AuthContext';
import { canAccessTenantConsoleDatabaseNav } from '../lib/tenantConsolePageAccess';
import { PaasSection } from '../../clouds/Harvester/database';

type NavResource = { key: string; label: string; paasType: string };

type NavCategory = {
  key: string;
  label: string;
  resources: NavResource[];
};

const DB_TAB_CONFIG: NavCategory[] = [
  {
    key: 'rds',
    label: 'RDS',
    resources: [
      { key: 'mysql', label: 'MySQL', paasType: 'mysql' },
      { key: 'postgresql', label: 'PostgreSQL', paasType: 'postgresql' },
    ],
  },
  {
    key: 'nosql',
    label: 'NoSQL',
    resources: [{ key: 'mongodb', label: 'MongoDB', paasType: 'mongodb' }],
  },
  {
    key: 'mq',
    label: '消息队列',
    resources: [
      { key: 'rocketmq', label: 'RocketMQ', paasType: 'rocketmq' },
      { key: 'kafka', label: 'Kafka', paasType: 'kafka' },
    ],
  },
];

export type CloudConsoleDatabaseCategory = 'rds' | 'nosql' | 'mq';
export type CloudConsoleDatabaseResource = 'mysql' | 'postgresql' | 'mongodb' | 'rocketmq' | 'kafka';

interface Props {
  cloudId: string;
  vms: any[];
  images: any[];
  storageClasses: any[];
  subnets: any[];
  harvesterNads?: any[];
  loading: boolean;

  activeCategory: CloudConsoleDatabaseCategory;
  setActiveCategory: (c: CloudConsoleDatabaseCategory) => void;
  activeResource: CloudConsoleDatabaseResource;
  setActiveResource: (r: CloudConsoleDatabaseResource) => void;

  onRefreshVms: (force?: boolean) => void;
  onForceRefreshVms: () => void | Promise<void>;
  onReloadImages: () => void | Promise<void>;
  onReloadSubnets: () => void | Promise<void>;
  onReloadStorageClasses: (force?: boolean, skipSync?: boolean) => void;
  isTenant?: boolean;
  namespacesOptions?: string[];
  namespaceRecords?: any[];
  /** Harvester 集群能力，与主控制台拉取一致；用于云数据库创建 VM 的 machine 类型等 */
  harvesterClusterCapabilities?: any;
}

function resourceMeta(
  category: CloudConsoleDatabaseCategory,
  resource: CloudConsoleDatabaseResource,
): NavResource | undefined {
  const cat = DB_TAB_CONFIG.find((c) => c.key === category);
  return cat?.resources.find((r) => r.key === resource);
}

const CloudConsoleDatabasePanel: React.FC<Props> = ({
  cloudId,
  vms,
  images,
  storageClasses,
  subnets,
  harvesterNads = [],
  loading,
  activeCategory,
  setActiveCategory,
  activeResource,
  setActiveResource,
  onRefreshVms,
  onForceRefreshVms,
  onReloadImages,
  onReloadSubnets,
  onReloadStorageClasses,
  isTenant = false,
  namespacesOptions = [],
  namespaceRecords = [],
  harvesterClusterCapabilities,
}) => {
  const { user } = useAuth();
  const permissions = useMemo(() => {
    const p = user?.permissions;
    return Array.isArray(p) ? p : [];
  }, [user?.permissions]);
  const canAccessDatabase = useMemo(
    () => canAccessTenantConsoleDatabaseNav(permissions),
    [permissions],
  );

  const getDefaultResource = useCallback((catKey: CloudConsoleDatabaseCategory) => {
    const cat = DB_TAB_CONFIG.find((c) => c.key === catKey);
    return (cat?.resources[0]?.key ?? 'mysql') as CloudConsoleDatabaseResource;
  }, []);

  useEffect(() => {
    const keys = DB_TAB_CONFIG.map((c) => c.key);
    if (!keys.includes(activeCategory)) {
      setActiveCategory('rds');
      setActiveResource(getDefaultResource('rds'));
    }
  }, [activeCategory, setActiveCategory, setActiveResource, getDefaultResource]);

  useEffect(() => {
    const cat = DB_TAB_CONFIG.find((c) => c.key === activeCategory);
    if (!cat?.resources.some((r) => r.key === activeResource)) {
      setActiveResource(getDefaultResource(activeCategory));
    }
  }, [activeCategory, activeResource, setActiveResource, getDefaultResource]);

  const currentMeta = resourceMeta(activeCategory, activeResource);

  const renderContent = useCallback(() => {
    if (!canAccessDatabase) return <Empty description="无权限访问云数据库" />;
    if (!currentMeta) return <Empty description="未知产品" />;
    return (
      <PaasSection
        vms={vms}
        loading={loading}
        cloudId={cloudId}
        onRefresh={onRefreshVms}
        onForceRefresh={onForceRefreshVms}
        images={images}
        storageClasses={storageClasses}
        kubeSubnets={subnets}
        harvesterNads={harvesterNads}
        onReloadImages={onReloadImages}
        onReloadSubnets={onReloadSubnets}
        onReloadStorageClasses={onReloadStorageClasses}
        isTenant={isTenant}
        paasType={currentMeta.paasType}
        sectionTitle={`${currentMeta.label} 实例`}
        namespacesOptions={namespacesOptions}
        namespaceRecords={namespaceRecords}
        clusterCapabilities={harvesterClusterCapabilities}
      />
    );
  }, [
    cloudId,
    vms,
    loading,
    images,
    storageClasses,
    subnets,
    harvesterNads,
    onRefreshVms,
    onForceRefreshVms,
    onReloadImages,
    onReloadSubnets,
    onReloadStorageClasses,
    isTenant,
    currentMeta,
    namespacesOptions,
    namespaceRecords,
    harvesterClusterCapabilities,
    canAccessDatabase,
  ]);

  const tabItems = useMemo(() => {
    return DB_TAB_CONFIG.map((cat) => {
      const isActive = cat.key === activeCategory;
      const currentResKey = isActive ? activeResource : (cat.resources[0].key as CloudConsoleDatabaseResource);
      const resRow = cat.resources.find((r) => r.key === currentResKey) ?? cat.resources[0];
      const currentResLabel = resRow.label;

      return {
        key: cat.key,
        label: (
          <Space size={4} align="center">
            <span>
              {cat.label} {currentResLabel}
            </span>
            <Dropdown
              menu={{
                items: cat.resources.map((res) => ({
                  key: res.key,
                  label: res.label,
                  onClick: (e: { domEvent: { stopPropagation: () => void } }) => {
                    e.domEvent.stopPropagation();
                    setActiveCategory(cat.key as CloudConsoleDatabaseCategory);
                    setActiveResource(res.key as CloudConsoleDatabaseResource);
                  },
                })),
                selectedKeys: [isActive ? activeResource : ''],
              }}
              trigger={['click']}
            >
              <span
                onClick={(e) => e.stopPropagation()}
                className="cloud-console-main-panel-dropdown-trigger"
              >
                <CaretDownFilled style={{ fontSize: 12 }} />
              </span>
            </Dropdown>
          </Space>
        ),
        children: <div>{isActive ? renderContent() : null}</div>,
      };
    });
  }, [
    activeCategory,
    activeResource,
    setActiveCategory,
    setActiveResource,
    renderContent,
  ]);

  return (
    <div className="cloud-console-panel-root">
      <Tabs
        type="card"
        activeKey={activeCategory}
        onChange={(key) => {
          const k = key as CloudConsoleDatabaseCategory;
          setActiveCategory(k);
          setActiveResource(getDefaultResource(k));
        }}
        items={tabItems}
      />
    </div>
  );
};

export default CloudConsoleDatabasePanel;
