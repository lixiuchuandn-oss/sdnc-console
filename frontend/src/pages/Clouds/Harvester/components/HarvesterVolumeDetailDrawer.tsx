/**
 * 云盘详情抽屉 - 布局与交互对齐 HarvesterVmDetailDrawer
 * 包含：标题区、Tab 导航（详情 / 事件）、详情卡片与事件列表
 * 打开时根据 namespace/name 拉取完整 PVC，避免列表数据不完整导致详情为空。
 */
import React, { useMemo, useState, useEffect } from 'react';
import { Drawer, Segmented, Button, Card, Descriptions, Tag, Tooltip, Spin } from 'antd';
import { CloseOutlined, DesktopOutlined, BellOutlined, HddOutlined } from '@ant-design/icons';
import { ReactComponent as DiskIcon } from '../../../../assets/clouds/disk.svg';
import { fetchHarvesterVolume } from '../../../../services/harvesterApi';
import HarvesterEventsTab from './HarvesterEventsTab';

interface HarvesterVolumeDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  record: any;
  cloudId?: string;
  activeTab?: string;
  onTabChange?: (key: string) => void;
}

const HarvesterVolumeDetailDrawer: React.FC<HarvesterVolumeDetailDrawerProps> = ({
  open,
  onClose,
  record,
  cloudId,
  activeTab = 'detail',
  onTabChange,
}) => {
  const [fetchedPvc, setFetchedPvc] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const initialPvc = useMemo(() => {
    if (!record) return null;
    const raw = record.raw || record;
    const withRawData = raw?.rawData || raw;
    return withRawData;
  }, [record]);

  const ns = initialPvc?.metadata?.namespace || initialPvc?.namespace || record?.namespace || '';
  const nm = initialPvc?.metadata?.name || initialPvc?.name || record?.name || '';

  useEffect(() => {
    if (!open || !cloudId || !ns || !nm) {
      setFetchedPvc(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchedPvc(null);
    fetchHarvesterVolume(cloudId, ns, nm, { skipCache: true })
      .then((res: any) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        setFetchedPvc(data || null);
      })
      .catch(() => {
        if (!cancelled) setFetchedPvc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, cloudId, ns, nm]);

  const pvc = fetchedPvc ?? initialPvc;

  const name = pvc?.metadata?.name || pvc?.name || '-';
  const namespace = pvc?.metadata?.namespace || pvc?.namespace || '-';
  const phase = (pvc?.status?.phase || '-') as string;
  const phaseLower = phase.toLowerCase();
  const storageRequest =
    pvc?.spec?.resources?.requests?.storage || '-';
  const storageCapacity = pvc?.status?.capacity?.storage || '-';
  const storageDisplay = storageCapacity !== '-' ? storageCapacity : storageRequest;
  const storageClass = pvc?.spec?.storageClassName || '-';
  const accessModes: string[] = Array.isArray(pvc?.spec?.accessModes)
    ? pvc.spec.accessModes
    : [];
  const volumeMode = pvc?.spec?.volumeMode || '-';
  const creationTimestamp =
    pvc?.metadata?.creationTimestamp || pvc?.creationTimestamp || '-';
  const dataSourceKind =
    pvc?.spec?.dataSourceRef?.kind || pvc?.spec?.dataSource?.kind || '';
  const dataSourceName =
    pvc?.spec?.dataSourceRef?.name || pvc?.spec?.dataSource?.name || '';
  const hasDataSource = !!(dataSourceName && dataSourceName.trim());
  const volumeName = pvc?.spec?.volumeName || (pvc?.status as any)?.volumeName;
  const conditions: any[] = Array.isArray(pvc?.status?.conditions)
    ? pvc.status.conditions
    : [];
  const annotations = pvc?.metadata?.annotations || {};
  const imageId = annotations['harvesterhci.io/imageId'];
  const uid = pvc?.metadata?.uid || '-';
  const resourceVersion = pvc?.metadata?.resourceVersion || '-';

  const handleTabChange = (val: string | number) => {
    onTabChange?.(String(val));
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      styles={{
        body: {
          padding: 0,
          background: '#f5f7fa',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* 1. 标题区域 */}
      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="harvester-drawer-title-icon-wrap">
            <HddOutlined />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>
              {name}
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>
              命名空间: {namespace}
            </div>
          </div>
          <Tag
            color={
              phaseLower === 'bound'
                ? 'success'
                : phaseLower === 'pending'
                  ? 'processing'
                  : 'default'
            }
            style={{ margin: 0 }}
          >
            {phase}
          </Tag>
        </div>
        <Button
          type="text"
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 4,
            fontSize: 16,
            padding: 0,
            color: '#666',
          }}
        >
          <CloseOutlined />
        </Button>
      </div>

      {/* 2. Tab 导航 */}
      <div
        style={{
          background: '#f5f7fa',
          padding: '0 24px',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: '0 0 24px 0',
          }}
        >
          <div
            style={{
              padding: 4,
              background: '#fff',
              borderRadius: 8,
              border: '1px solid #e0e0e0',
            }}
          >
            <Segmented
              size="small"
              value={activeTab}
              onChange={handleTabChange}
              options={[
                { label: '详情', value: 'detail', icon: <DesktopOutlined /> },
                { label: '事件', value: 'events', icon: <BellOutlined /> },
              ]}
            />
          </div>
        </div>
      </div>

      {/* 3. 内容区域 */}
      <style>{`
        .volume-drawer-scroll::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .volume-drawer-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .volume-drawer-scroll::-webkit-scrollbar-thumb {
          background: #e0e0e0;
          border-radius: 3px;
        }
        .volume-drawer-scroll::-webkit-scrollbar-thumb:hover {
          background: #ccc;
        }
      `}</style>
      <div
        className="volume-drawer-scroll"
        style={{
          padding: '0 24px 24px',
          flex: 1,
          overflowY: 'auto',
        }}
      >
        {activeTab === 'detail' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {loading && !pvc ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <Spin size="large" tip="加载卷详情…" />
              </div>
            ) : !pvc ? (
              <Card variant="borderless" styles={{ body: { padding: 24 } }}>
                <div style={{ color: '#999', textAlign: 'center' }}>
                  暂无卷数据，请关闭后重试或检查权限。
                </div>
              </Card>
            ) : (
              <>
            {/* 3.1 容量与规格 */}
            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 8,
                    background: '#f0f9ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <DiskIcon width={28} height={28} style={{ fill: '#1890ff' }} />
                </div>
                <div>
                  <div style={{ color: '#999', fontSize: 12 }}>容量</div>
                  <div style={{ fontSize: 20, fontWeight: 500 }}>
                    {storageDisplay}
                  </div>
                </div>
              </div>
              <Descriptions
                size="small"
                column={2}
                style={{ marginTop: 16 }}
                styles={{ label: { width: 120, color: '#999' } }}
              >
                <Descriptions.Item label="存储类">
                  {storageClass}
                </Descriptions.Item>
                <Descriptions.Item label="卷模式">
                  {volumeMode}
                </Descriptions.Item>
                <Descriptions.Item label="访问模式">
                  {accessModes.length > 0 ? accessModes.join(', ') : '-'}
                </Descriptions.Item>
                <Descriptions.Item label="创建时间">
                  {creationTimestamp}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {/* 3.2 数据源与绑定 */}
            {(hasDataSource || volumeName) && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <span style={{ color: '#666' }}>数据源与绑定</span>
                </div>
                <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                  <Descriptions
                    size="small"
                    column={1}
                    styles={{ label: { width: 120, color: '#999' } }}
                  >
                    {hasDataSource && (
                      <Descriptions.Item
                        label={
                          <Tooltip title="克隆或从快照恢复时的源 PVC">
                            <span
                              style={{
                                borderBottom: '1px dashed #999',
                                cursor: 'help',
                              }}
                            >
                              数据源
                            </span>
                          </Tooltip>
                        }
                      >
                        {dataSourceKind
                          ? `${dataSourceKind} / ${dataSourceName}`
                          : dataSourceName}
                      </Descriptions.Item>
                    )}
                    {volumeName && (
                      <Descriptions.Item
                        label={
                          <Tooltip title="绑定后的 PersistentVolume 名称">
                            <span
                              style={{
                                borderBottom: '1px dashed #999',
                                cursor: 'help',
                              }}
                            >
                              绑定卷 (PV)
                            </span>
                          </Tooltip>
                        }
                      >
                        {volumeName}
                      </Descriptions.Item>
                    )}
                  </Descriptions>
                </Card>
              </div>
            )}

            {/* 3.3 状态与元数据 */}
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span style={{ color: '#666' }}>状态与元数据</span>
              </div>
              <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                <Descriptions
                  size="small"
                  column={2}
                  styles={{ label: { width: 120, color: '#999' } }}
                >
                  {imageId && (
                    <Descriptions.Item label="镜像 ID">
                      {imageId}
                    </Descriptions.Item>
                  )}
                  <Descriptions.Item label="UID">{uid}</Descriptions.Item>
                  <Descriptions.Item label="Resource Version">
                    {resourceVersion}
                  </Descriptions.Item>
                </Descriptions>
                {conditions.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#999',
                        marginBottom: 8,
                      }}
                    >
                      状态条件
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {conditions.map((cond: any, idx: number) => (
                        <div
                          key={idx}
                          style={{
                            padding: '8px 12px',
                            background: '#f5f5f5',
                            borderRadius: 4,
                            borderLeft:
                              cond.status === 'True'
                                ? '3px solid #52c41a'
                                : cond.status === 'False'
                                  ? '3px solid #ff4d4f'
                                  : '3px solid #faad14',
                          }}
                        >
                          <div style={{ fontSize: 12, color: '#666' }}>
                            <strong>{cond.type}</strong> — {cond.status}
                            {cond.reason && ` (${cond.reason})`}
                          </div>
                          {cond.message && (
                            <div
                              style={{
                                fontSize: 12,
                                color: '#999',
                                marginTop: 4,
                              }}
                            >
                              {cond.message}
                            </div>
                          )}
                          {cond.lastTransitionTime && (
                            <div
                              style={{
                                fontSize: 11,
                                color: '#999',
                                marginTop: 2,
                              }}
                            >
                              {cond.lastTransitionTime}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </div>
          </>
            )}
          </div>
        )}

        {activeTab === 'events' && (
          <Card
            variant="borderless"
            styles={{ body: { padding: 0, height: '100%' } }}
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <HarvesterEventsTab
              cloudId={cloudId}
              record={pvc ?? (ns && nm ? { metadata: { namespace: ns, name: nm } } : undefined)}
              active={activeTab === 'events'}
              kind="PersistentVolumeClaim"
            />
          </Card>
        )}
      </div>
    </Drawer>
  );
};

export default HarvesterVolumeDetailDrawer;
