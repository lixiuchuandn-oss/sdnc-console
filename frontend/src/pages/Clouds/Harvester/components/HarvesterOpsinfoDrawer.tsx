import React, { useEffect, useState } from 'react';
import { Drawer, Tabs, Descriptions, Card, List, Tag } from 'antd';
import LinedTextArea from '../../../../components/LinedTextArea';
import { fetchHarvesterResourceByLink } from '../../../../services/harvesterApi';

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
  onRefresh?: (force?: boolean) => void;
  onOpenReconfigure?: (vm: any) => void;
  onBackup?: (vm: any) => void;
  onSnapshot?: (vm: any) => void;
  onClone?: (vm: any) => void;
  onMigrate?: (vm: any) => void;
  onDelete?: (vm: any) => void;
  forceOpsMode?: boolean;
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
    forceOpsMode,
  } = props;

  const drawerTitle = record 
    ? `${resourceType}: ${record.metadata?.name || record.name || ''}`
    : ` ${resourceType} Opsinfo`;
  const providerFlatSubnets = Array.isArray(record?.__flatSubnets) ? record.__flatSubnets : [];
  const providerPublicSubnets = Array.isArray(record?.__publicSubnets) ? record.__publicSubnets : [];
  const isProviderNetwork = record?.kind === 'ProviderNetwork';

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
                {isProviderNetwork ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <Card size="small" title={`公共子网 (${providerPublicSubnets.length})`}>
                      <List
                        size="small"
                        dataSource={providerPublicSubnets}
                        locale={{ emptyText: '暂无关联公共子网' }}
                        renderItem={(item: any) => {
                          const alias = String(item?.alias || '').trim();
                          const name = String(item?.name || '-').trim();
                          const cidr = String(item?.cidr || '-').trim();
                          const vlan = String(item?.vlan || '-').trim();
                          return (
                            <List.Item>
                              <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <span style={{ fontWeight: 500, wordBreak: 'break-all' }}>{alias || name}</span>
                                  <Tag color="blue">VLAN: {vlan}</Tag>
                                </div>
                                <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 2 }}>{cidr}</div>
                              </div>
                            </List.Item>
                          );
                        }}
                      />
                    </Card>
                    <Card size="small" title={`扁平子网 (${providerFlatSubnets.length})`}>
                      <List
                        size="small"
                        dataSource={providerFlatSubnets}
                        locale={{ emptyText: '暂无关联扁平子网' }}
                        renderItem={(item: any) => {
                          const alias = String(item?.alias || '').trim();
                          const name = String(item?.name || '-').trim();
                          const cidr = String(item?.cidr || '-').trim();
                          const vlan = String(item?.vlan || '-').trim();
                          return (
                            <List.Item>
                              <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <span style={{ fontWeight: 500, wordBreak: 'break-all' }}>{alias || name}</span>
                                  <Tag color="blue">VLAN: {vlan}</Tag>
                                </div>
                                <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 2 }}>{cidr}</div>
                              </div>
                            </List.Item>
                          );
                        }}
                      />
                    </Card>
                  </div>
                ) : null}
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
                    .flatMap(([key, value]) => {
                    // Skip complex objects/arrays for cleaner display, or JSON stringify them
                    // Skip rawData as it's too large usually
                    // Skip links as they are technical metadata (HATEOAS) and pollute the UI
                    if (key === 'rawData' || key === 'links' || key === '__flatSubnets' || key === '__publicSubnets') return [];
                    
                    // 对于 status 字段，如果是快照/备份资源，优先显示关键信息
                    if (key === 'status' && value && typeof value === 'object' && !Array.isArray(value)) {
                      const status = value as any;
                      // Kube-OVN Subnet status（含 conditions）；须在备份启发式之前，否则会被 conditions 误判为备份
                      if (record?.kind === 'Subnet') {
                        const items: React.ReactElement[] = [];
                        const subnetHandled = new Set([
                          'v4AvailableIPs',
                          'v4availableIPs',
                          'v4UsingIPs',
                          'v4usingIPs',
                          'v4availableIPrange',
                          'v4usingIPrange',
                          'v6AvailableIPs',
                          'v6availableIPs',
                          'v6UsingIPs',
                          'v6usingIPs',
                          'v6availableIPrange',
                          'v6usingIPrange',
                          'conditions',
                        ]);
                        const v4Avail = status.v4AvailableIPs ?? status.v4availableIPs;
                        const v4Use = status.v4UsingIPs ?? status.v4usingIPs;
                        if (v4Avail !== undefined) {
                          items.push(
                            <Descriptions.Item key="subnet-v4avail" label="状态 - IPv4 可用数">
                              {String(v4Avail)}
                            </Descriptions.Item>,
                          );
                        }
                        if (v4Use !== undefined) {
                          items.push(
                            <Descriptions.Item key="subnet-v4using" label="状态 - IPv4 已用数">
                              {String(v4Use)}
                            </Descriptions.Item>,
                          );
                        }
                        if (status.v4availableIPrange !== undefined) {
                          items.push(
                            <Descriptions.Item key="subnet-v4avail-range" label="状态 - IPv4 可用范围">
                              <span style={{ wordBreak: 'break-all' }}>{String(status.v4availableIPrange)}</span>
                            </Descriptions.Item>,
                          );
                        }
                        if (status.v4usingIPrange !== undefined) {
                          items.push(
                            <Descriptions.Item key="subnet-v4using-range" label="状态 - IPv4 已用范围">
                              <span style={{ wordBreak: 'break-all' }}>{String(status.v4usingIPrange)}</span>
                            </Descriptions.Item>,
                          );
                        }
                        const v6Avail = status.v6AvailableIPs ?? status.v6availableIPs;
                        const v6Use = status.v6UsingIPs ?? status.v6usingIPs;
                        if (v6Avail !== undefined) {
                          items.push(
                            <Descriptions.Item key="subnet-v6avail" label="状态 - IPv6 可用数">
                              {String(v6Avail)}
                            </Descriptions.Item>,
                          );
                        }
                        if (v6Use !== undefined) {
                          items.push(
                            <Descriptions.Item key="subnet-v6using" label="状态 - IPv6 已用数">
                              {String(v6Use)}
                            </Descriptions.Item>,
                          );
                        }
                        if (status.conditions !== undefined) {
                          if (Array.isArray(status.conditions) && status.conditions.length > 0) {
                            items.push(
                              <Descriptions.Item key="subnet-conditions" label="状态 - Conditions">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {status.conditions.map((cond: any, idx: number) => (
                                    <div
                                      key={idx}
                                      style={{
                                        padding: '8px',
                                        background: '#f5f5f5',
                                        borderRadius: '4px',
                                        borderLeft:
                                          cond.status === 'True'
                                            ? '3px solid #52c41a'
                                            : cond.status === 'False'
                                              ? '3px solid #ff4d4f'
                                              : '3px solid #faad14',
                                      }}
                                    >
                                      <div><strong>类型:</strong> {cond.type || '-'}</div>
                                      <div><strong>状态:</strong> {cond.status || '-'}</div>
                                      {cond.reason && <div><strong>原因:</strong> {cond.reason}</div>}
                                      {cond.message && <div><strong>消息:</strong> {cond.message}</div>}
                                      {cond.lastTransitionTime && (
                                        <div><strong>最后变更:</strong> {cond.lastTransitionTime}</div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </Descriptions.Item>,
                            );
                          } else {
                            items.push(
                              <Descriptions.Item key="subnet-conditions-empty" label="状态 - Conditions">
                                <div style={{ color: '#999', fontStyle: 'italic' }}>
                                  {Array.isArray(status.conditions) ? '暂无条件信息' : '条件信息未初始化'}
                                </div>
                              </Descriptions.Item>,
                            );
                          }
                        }
                        Object.entries(status)
                          .filter(([sk]) => !subnetHandled.has(sk))
                          .forEach(([sk, sv]) => {
                            items.push(
                              <Descriptions.Item key={`subnet-st-${sk}`} label={`状态 - ${sk}`}>
                                {typeof sv === 'object' && sv !== null ? (
                                  <pre style={{ margin: 0, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                                    {JSON.stringify(sv, null, 2)}
                                  </pre>
                                ) : (
                                  String(sv)
                                )}
                              </Descriptions.Item>,
                            );
                          });
                        if (items.length === 0) {
                          items.push(
                            <Descriptions.Item key="subnet-st-empty" label="status">
                              <span style={{ color: '#999' }}>暂无 status 或尚未由控制器写入</span>
                            </Descriptions.Item>,
                          );
                        }
                        return items;
                      }
                      // 检查是否是 VirtualMachineBackup 的 status
                      if ('readyToUse' in status || 'volumeBackups' in status || 'conditions' in status) {
                        const items: React.ReactElement[] = [];
                        items.push(
                          <Descriptions.Item key="status-readyToUse" label="状态 - ReadyToUse">
                            <span style={{ 
                              color: status.readyToUse ? '#52c41a' : '#faad14',
                              fontWeight: 'bold'
                            }}>
                              {status.readyToUse ? '✓ 就绪' : '✗ 未就绪'}
                            </span>
                          </Descriptions.Item>
                        );
                        if (status.error) {
                          items.push(
                            <Descriptions.Item key="status-error" label="状态 - 错误">
                              <div style={{ color: '#ff4d4f' }}>
                                <div><strong>时间:</strong> {status.error.time || '-'}</div>
                                <div><strong>消息:</strong> {status.error.message || '-'}</div>
                              </div>
                            </Descriptions.Item>
                          );
                        }
                        // 显示 Conditions，即使为空也显示提示
                        if (status.conditions !== undefined) {
                          if (Array.isArray(status.conditions) && status.conditions.length > 0) {
                            items.push(
                              <Descriptions.Item key="status-conditions" label="状态 - Conditions">
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                  {status.conditions.map((cond: any, idx: number) => (
                                    <div key={idx} style={{ 
                                      padding: '8px', 
                                      background: '#f5f5f5', 
                                      borderRadius: '4px',
                                      borderLeft: cond.status === 'True' ? '3px solid #52c41a' : cond.status === 'False' ? '3px solid #ff4d4f' : '3px solid #faad14'
                                    }}>
                                      <div><strong>类型:</strong> {cond.type || '-'}</div>
                                      <div><strong>状态:</strong> {cond.status || '-'}</div>
                                      {cond.reason && <div><strong>原因:</strong> {cond.reason}</div>}
                                      {cond.message && <div><strong>消息:</strong> {cond.message}</div>}
                                      {cond.lastTransitionTime && <div><strong>最后变更:</strong> {cond.lastTransitionTime}</div>}
                                    </div>
                                  ))}
                                </div>
                              </Descriptions.Item>
                            );
                          } else {
                            items.push(
                              <Descriptions.Item key="status-conditions-empty" label="状态 - Conditions">
                                <div style={{ color: '#999', fontStyle: 'italic' }}>
                                  {Array.isArray(status.conditions) ? '暂无条件信息' : '条件信息未初始化'}
                                </div>
                              </Descriptions.Item>
                            );
                          }
                        }
                        if (status.volumeBackups && Array.isArray(status.volumeBackups) && status.volumeBackups.length > 0) {
                          items.push(
                            <Descriptions.Item key="status-volumeBackups" label="状态 - VolumeBackups">
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {status.volumeBackups.map((vb: any, idx: number) => (
                                  <div key={idx} style={{ 
                                    padding: '8px', 
                                    background: '#f5f5f5', 
                                    borderRadius: '4px',
                                    borderLeft: vb.readyToUse ? '3px solid #52c41a' : '3px solid #faad14'
                                  }}>
                                    <div><strong>名称:</strong> {vb.name || '-'}</div>
                                    <div><strong>就绪:</strong> {vb.readyToUse ? '✓ 是' : '✗ 否'}</div>
                                    {vb.volumeName && <div><strong>卷名:</strong> {vb.volumeName}</div>}
                                    {vb.progress !== undefined && <div><strong>进度:</strong> {vb.progress}%</div>}
                                    {vb.error && (
                                      <div style={{ color: '#ff4d4f', marginTop: '4px' }}>
                                        <strong>错误:</strong> {vb.error.message || JSON.stringify(vb.error)}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </Descriptions.Item>
                          );
                        }
                        if (status.progress !== undefined) {
                          items.push(
                            <Descriptions.Item key="status-progress" label="状态 - 进度">
                              <span>{status.progress}%</span>
                            </Descriptions.Item>
                          );
                        }
                        if (status.creationTime) {
                          items.push(
                            <Descriptions.Item key="status-creationTime" label="状态 - 创建时间">
                              <span>{status.creationTime}</span>
                            </Descriptions.Item>
                          );
                        }
                        // 如果 volumeBackups 存在但是空数组，也要显示
                        if (status.volumeBackups !== undefined && (!Array.isArray(status.volumeBackups) || status.volumeBackups.length === 0)) {
                          items.push(
                            <Descriptions.Item key="status-volumeBackups-empty" label="状态 - VolumeBackups">
                              <div style={{ color: '#faad14', fontStyle: 'italic' }}>
                                {Array.isArray(status.volumeBackups) ? '暂无卷备份数据' : '卷备份数据未初始化'}
                              </div>
                            </Descriptions.Item>
                          );
                        }
                        // 显示 status 的其他字段（排除已特殊处理的字段）
                        Object.entries(status)
                          .filter(([sk]) => !['readyToUse', 'error', 'conditions', 'volumeBackups', 'progress', 'creationTime'].includes(sk))
                          .forEach(([sk, sv]) => {
                            items.push(
                              <Descriptions.Item key={`status-${sk}`} label={`状态 - ${sk}`}>
                                {typeof sv === 'object' && sv !== null 
                                  ? <pre style={{ margin: 0, fontSize: 12, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(sv, null, 2)}</pre>
                                  : String(sv)}
                              </Descriptions.Item>
                            );
                          });
                        return items;
                      }
                    }
                    
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
          ...(record?.links?.view ? [{
            key: 'view_link',
            label: '实时数据 (View Link)',
            children: <ViewLinkTab cloudId={cloudId} viewLink={record.links.view} active={activeTab === 'view_link'} />
          }] : []),
        ]}
      />
    </Drawer>
  );
};

export default HarvesterResourceDrawer;
