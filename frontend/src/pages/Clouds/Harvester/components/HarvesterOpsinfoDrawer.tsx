import React, { useEffect, useState, useMemo } from 'react';
import { Drawer, Tabs, Descriptions, Tag } from 'antd';
import yaml from 'js-yaml';
import LinedTextArea from '../../../../components/LinedTextArea';
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
}

const ViewLinkTab: React.FC<{ cloudId?: string; viewLink?: string; active: boolean }> = ({ cloudId, viewLink, active }) => {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (active && cloudId && viewLink) {
      loadContent();
    }
  }, [active, cloudId, viewLink]);

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

  if (!viewLink) {
    return <div style={{ padding: 16, color: '#999' }}>无 View Link 数据</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', fontSize: '12px', color: '#666' }}>
        Request URL: {viewLink}
      </div>
      {loading ? (
        <div style={{ padding: 16 }}>加载中...</div>
      ) : error ? (
        <div style={{ padding: 16, color: 'red' }}>错误: {error}</div>
      ) : (
        <LinedTextArea
          readOnly
          value={content}
          className="metadata-viewer"
          style={{ flex: 1, border: 'none', borderRadius: 0 }}
        />
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
    activeTab = 'detail',
    onTabChange,
    cloudId,
    pods,
    forceOpsMode,
    onViewPodDetail,
    onViewPodLog,
    onOpenPodTerminal,
  } = props;

  if (resourceType === 'VirtualMachine' && !forceOpsMode) {
    return <HarvesterVmDetailDrawer {...props} />;
  }

  const drawerTitle = record 
    ? `${resourceType}: ${record.metadata?.name || record.name || ''}`
    : ` ${resourceType} Opsinfo`;

  return (
    <Drawer
      title={drawerTitle}
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
        onChange={onTabChange}
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
                             displayValue = <pre style={{ margin: 0, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(value, null, 2)}</pre>;
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
                                                ? <pre style={{ margin: 0, fontSize: 12, fontFamily: 'Consolas, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(subValue, null, 2)}</pre>
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
          ...((record?.links?.view) ? [{
            key: 'view_link',
            label: '实时数据 (View Link)',
            children: <ViewLinkTab cloudId={cloudId} viewLink={record?.links?.view} active={activeTab === 'view_link'} />
          }] : []),
          // Service 类型显示关联 Pod Tab
          ...(resourceType === 'Service' ? [{
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
