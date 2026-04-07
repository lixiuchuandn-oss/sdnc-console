import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Drawer, Tabs, Descriptions, Tag, Button, Space, Switch, Select } from 'antd';
import { ArrowLeftOutlined, SyncOutlined } from '@ant-design/icons';
import CodeEditor from '../../../../components/CodeEditor';
import JsonHighlight from '../../../../components/JsonHighlight';
import { fetchHarvesterResourceByLink } from '../../../../services/harvesterApi';
import HarvesterVmDetailDrawer from './HarvesterVmDetailDrawer';
import HarvesterEventsTab from './HarvesterEventsTab';
import ServiceRelatedPodsTab from './ServiceRelatedPodsTab';

export interface HarvesterResourceDrawerProps {
  open: boolean;
  onClose: () => void;
  resourceType: string; // 资源类型名称，用于标题显示，例如 "Node", "Namespace"
  record: any;     // 列表行数据(数据库实体)，用于显示"基础信息"。必须包含 links 字段以支持"实时数据"。
  activeTab?: string;
  onTabChange?: (key: string) => void;
  cloudId?: string;
  namespaces?: any[];
  volumes?: any[];
  images?: any[];
  pods?: any[]; // Pod 列表，用于 Service 关联 Pod 展示
  onRefresh?: (force?: boolean) => void;
  onOpenReconfigure?: (vm: any) => void;
  onBackup?: (vm: any) => void;
  onSnapshot?: (vm: any) => void;
  onClone?: (vm: any) => void;
  onMigrate?: (vm: any) => void;
  onDelete?: (vm: any) => void;
  forceOpsMode?: boolean;
  // Pod 操作回调
  onViewPodDetail?: (pod: any) => void;
  onViewPodLog?: (pod: any) => void;
  onOpenPodTerminal?: (pod: any) => void;
  // 返回按钮回调（用于嵌套抽屉）
  onBack?: () => void;
  // 隐藏关联 Pod Tab（用于服务拓扑）
  hideRelatedPods?: boolean;
}

const ViewLinkTab: React.FC<{ cloudId?: string; viewLink?: string; active: boolean }> = ({ cloudId, viewLink, active }) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(10);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadContent = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchHarvesterResourceByLink(cloudId!, viewLink!);
      setContent(typeof res === 'object' ? JSON.stringify(res, null, 2) : String(res));
    } catch (e: any) {
      console.error(e);
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active && cloudId && viewLink) {
      loadContent();
    }
  }, [active, cloudId, viewLink]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (autoRefresh && active && cloudId && viewLink) {
      intervalRef.current = setInterval(loadContent, refreshInterval * 1000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoRefresh, refreshInterval, active, cloudId, viewLink]);

  if (!viewLink) {
    return <div style={{ padding: 16, color: '#999' }}>无 View Link 数据</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '8px 16px', 
        borderBottom: '1px solid #f0f0f0', 
        background: '#fafafa', 
        display: 'flex', 
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <div style={{ fontSize: '12px', color: '#666', flex: 1, minWidth: 200 }}>
          Request URL: {viewLink}
        </div>
        <Space size="small">
          <Switch
            checked={autoRefresh}
            onChange={setAutoRefresh}
            checkedChildren="自动"
            unCheckedChildren="手动"
            size="small"
          />
          {autoRefresh && (
            <Select
              value={refreshInterval}
              onChange={setRefreshInterval}
              size="small"
              style={{ width: 80 }}
              options={[
                { value: 5, label: '5秒' },
                { value: 10, label: '10秒' },
                { value: 30, label: '30秒' },
                { value: 60, label: '1分钟' },
              ]}
            />
          )}
          <Button 
            size="small" 
            icon={<SyncOutlined spin={loading} />} 
            onClick={loadContent}
            loading={loading}
          >
            刷新
          </Button>
        </Space>
      </div>
      {loading && !content ? (
        <div style={{ padding: 16 }}>加载中...</div>
      ) : error && !content ? (
        <div style={{ padding: 16, color: 'red' }}>错误: {error}</div>
      ) : (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <style>{`
            .view-link-editor { height: 100% !important; }
            .view-link-editor .cm-editor { height: 100% !important; }
            .view-link-editor .cm-scroller { overflow: auto !important; max-height: 100% !important; }
          `}</style>
          <CodeEditor
            readOnly
            value={content}
            language="json"
            className="view-link-editor"
            style={{ border: 'none', borderRadius: 0 }}
          />
        </div>
      )}
    </div>
  );
};

const HarvesterResourceDrawer: React.FC<HarvesterResourceDrawerProps> = (props) => {
  const {
    open,
    onClose,
    resourceType,
    record,
    activeTab: externalActiveTab = 'detail',
    onTabChange,
    cloudId,
    pods,
    forceOpsMode,
    onViewPodDetail,
    onViewPodLog,
    onOpenPodTerminal,
    onBack,
    hideRelatedPods = false,
  } = props;

  // 内部管理 tab 状态（当没有外部 onTabChange 时使用）
  const [internalActiveTab, setInternalActiveTab] = useState('detail');
  
  // 判断是否使用内部状态
  const useInternalState = !onTabChange;
  const activeTab = useInternalState ? internalActiveTab : externalActiveTab;
  
  // 处理 tab 切换
  const handleTabChange = useCallback((key: string) => {
    if (useInternalState) {
      setInternalActiveTab(key);
    } else {
      onTabChange?.(key);
    }
  }, [useInternalState, onTabChange]);

  if (resourceType === 'VirtualMachine' && !forceOpsMode) {
    return <HarvesterVmDetailDrawer {...props} />;
  }

  // 如果 record 没有 links.view，根据 resourceType 和 metadata 自动构造
  const viewLink = record?.links?.view || (() => {
    if (!record?.metadata?.name || !record?.metadata?.namespace) return null;
    
    const ns = record.metadata.namespace;
    const name = record.metadata.name;
    
    // 根据资源类型构造 Kubernetes API 路径
    const typeToPath: Record<string, string> = {
      'Service': `/api/v1/namespaces/${ns}/services/${name}`,
      'Ingress': `/apis/networking.k8s.io/v1/namespaces/${ns}/ingresses/${name}`,
      'Pod': `/api/v1/namespaces/${ns}/pods/${name}`,
      'Node': `/api/v1/nodes/${name}`,
      'Namespace': `/api/v1/namespaces/${name}`,
      'Deployment': `/apis/apps/v1/namespaces/${ns}/deployments/${name}`,
      'StatefulSet': `/apis/apps/v1/namespaces/${ns}/statefulsets/${name}`,
      'DaemonSet': `/apis/apps/v1/namespaces/${ns}/daemonsets/${name}`,
      'Job': `/apis/batch/v1/namespaces/${ns}/jobs/${name}`,
      'CronJob': `/apis/batch/v1/namespaces/${ns}/cronjobs/${name}`,
      'ConfigMap': `/api/v1/namespaces/${ns}/configmaps/${name}`,
      'Secret': `/api/v1/namespaces/${ns}/secrets/${name}`,
    };
    
    return typeToPath[resourceType] || null;
  })();

  const drawerTitle = record 
    ? `${resourceType}: ${record.metadata?.name || record.name || ''}`
    : ` ${resourceType} Opsinfo`;

  return (
    <Drawer
      title={
        <Space>
          {onBack && (
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
              返回
            </Button>
          )}
          <span>{drawerTitle}</span>
        </Space>
      }
      open={open}
      onClose={onClose}
      placement="right"
      width="60%"
      styles={{ body: { padding: 0, height: '100%', overflow: 'hidden' } }}
    >
      <style>{`
        .full-height-drawer-tabs { height: 100%; display: flex; flex-direction: column; }
        .full-height-drawer-tabs .ant-tabs-nav { margin-bottom: 0; padding: 0 16px; }
        .full-height-drawer-tabs .ant-tabs-content-holder { flex: 1; height: 100%; overflow: hidden; }
        .full-height-drawer-tabs .ant-tabs-content { height: 100%; }
        .full-height-drawer-tabs .ant-tabs-tabpane { height: 100%; }
        .full-height-drawer-tabs .ant-tabs-tabpane-active { display: flex; flex-direction: column; }
      `}</style>
      <Tabs
        className="full-height-drawer-tabs"
        activeKey={activeTab}
        onChange={handleTabChange}
        items={[
          {
            key: 'detail',
            label: '摘要 (Instance)',
            children: (
              <div style={{ height: '100%', overflow: 'auto', padding: '16px' }}>
                <Descriptions bordered column={1} size="small">
                  {Object.entries(record || {})
                    .sort(([keyA], [keyB]) => {
                        const PRIORITY_KEYS = ['name', 'status', 'nodeInfo', 'internalIP', 'externalIP', 'capacity', 'allocatable'];
                        const idxA = PRIORITY_KEYS.indexOf(keyA);
                        const idxB = PRIORITY_KEYS.indexOf(keyB);
                        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                        if (idxA !== -1) return -1;
                        if (idxB !== -1) return 1;
                        return 0;
                    })
                    .map(([key, value]) => {
                    // Skip complex objects/arrays for cleaner display, or JSON stringify them
                    // Skip rawData as it's too large usually
                    // Skip links as they are technical metadata (HATEOAS) and pollute the UI
                    if (key === 'rawData' || key === 'links') return null;
                    
                    let displayValue: React.ReactNode = String(value);
                    if (typeof value === 'object' && value !== null) {
                      if (Array.isArray(value)) {
                         if (value.length > 0 && typeof value[0] !== 'object') {
                             displayValue = value.join(', ');
                         } else {
                             displayValue = (
                               <JsonHighlight value={JSON.stringify(value, null, 2)} />
                             );
                         }
                      } else {
                          // Expand object keys (Second-level keys)
                          displayValue = (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {Object.entries(value)
                                    .sort(([keyA], [keyB]) => {
                                        if (key === 'nodeInfo') {
                                            const KEYS = ['machineID', 'systemUUID', 'bootID', 'kernelVersion', 'osImage', 'containerRuntimeVersion', 'kubeletVersion', 'operatingSystem', 'architecture'];
                                            const idxA = KEYS.indexOf(keyA);
                                            const idxB = KEYS.indexOf(keyB);
                                            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                                            if (idxA !== -1) return -1;
                                            if (idxB !== -1) return 1;
                                        }
                                        return 0;
                                    })
                                    .map(([subKey, subValue], index, arr) => (
                                    <div key={subKey} style={{ 
                                        display: 'flex', 
                                        alignItems: 'flex-start',
                                        borderBottom: index < arr.length - 1 ? '1px dashed #f0f0f0' : 'none',
                                        paddingBottom: index < arr.length - 1 ? '4px' : '0',
                                        marginBottom: index < arr.length - 1 ? '4px' : '0'
                                    }}>
                                        <span style={{ 
                                            display: 'inline-block', 
                                            color: 'rgba(0, 0, 0, 0.45)', 
                                            marginRight: '8px',
                                            minWidth: '120px', // Fixed width for alignment
                                            flexShrink: 0,
                                            fontSize: '12px'
                                        }}>
                                            {subKey}:
                                        </span>
                                        <span style={{ wordBreak: 'break-all', flex: 1, whiteSpace: 'pre-wrap' }}>
                                            {typeof subValue === 'object' && subValue !== null 
                                                ? (
                                                  <JsonHighlight value={JSON.stringify(subValue, null, 2)} />
                                                )
                                                : String(subValue)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                          );
                      }
                    }
                    
                    return (
                      <Descriptions.Item key={key} label={key}>
                        {displayValue}
                      </Descriptions.Item>
                    );
                  })}
                </Descriptions>
              </div>
            ),
          },
          ...(viewLink ? [{
            key: 'view_link',
            label: '实时数据 (View Link)',
            children: <ViewLinkTab cloudId={cloudId} viewLink={viewLink} active={activeTab === 'view_link'} />
          }] : []),
          // Service 类型显示关联 Pod Tab（除非 hideRelatedPods 为 true）
          ...(resourceType === 'Service' && !hideRelatedPods ? [{
            key: 'related_pods',
            label: '关联 Pod',
            children: (
              <ServiceRelatedPodsTab
                serviceSelector={record?.rawData?.spec?.selector || record?.spec?.selector}
                pods={pods || []}
                loading={false}
                onViewDetail={onViewPodDetail}
                onViewLog={onViewPodLog}
                onOpenTerminal={onOpenPodTerminal}
              />
            )
          }] : []),
        ]}
      />
    </Drawer>
  );
};

export default HarvesterResourceDrawer;
