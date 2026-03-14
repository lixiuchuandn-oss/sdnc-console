import React, { useMemo } from 'react';
import { Alert, Button, Card, Col, Empty, Form, Input, Popconfirm, Row, Space, Typography } from 'antd';
import { MinusCircleOutlined, ReloadOutlined } from '@ant-design/icons';

const formatAccessMode = (m: string) => {
  if (m === 'ReadWriteOnce') return 'RWO (ReadWriteOnce)';
  if (m === 'ReadWriteMany') return 'RWX (ReadWriteMany)';
  if (m === 'ReadOnlyMany') return 'ROX (ReadOnlyMany)';
  return m || '-';
};

const formatAccessModes = (modes: any[]) => {
  const list = (Array.isArray(modes) ? modes : []).map((x) => String(x || '')).filter(Boolean);
  if (list.length === 0) return '-';
  return Array.from(new Set(list)).map(formatAccessMode).join(', ');
};

type Props = {
  record: any;
  cloudId: string;
  onDetach: (diskName: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  loading?: boolean;
  volumes?: any[]; // 可选的 volumes 列表，用于回退数据源（与虚拟卷详情页保持一致）
};

/**
 * 解绑数据盘组件
 * 
 * [功能描述]
 * 展示当前虚拟机已挂载的所有数据卷，支持点击解绑操作。
 * 只解绑，不删除卷。
 * 
 * [数据来源]
 * 与虚拟卷详情页保持一致：
 * 1. 优先使用 record?.related?.volumes（来自聚合接口的 related.volumes）
 * 2. 如果没有，则使用 volumes props（从外部传入）
 * 从 VM 的 spec.template.spec.volumes 和 spec.template.spec.domain.devices.disks 中提取数据卷信息。
 * 过滤掉系统盘（bootOrder=1）和 CloudInit/Container 类型的卷。
 */
const DetachDataDisk: React.FC<Props> = ({ record, onDetach, onRefresh, loading = false, volumes = [] }) => {
  const [refreshing, setRefreshing] = React.useState(false);
  // 从 VM 记录中提取已挂载的数据卷
  const dataDisks = useMemo(() => {
    if (!record) return [];
    
    const vols = record?.spec?.template?.spec?.volumes || [];
    const disks = record?.spec?.template?.spec?.domain?.devices?.disks || [];
    const vmNs = record?.metadata?.namespace || record?.namespace || '';
    
    // [数据源优先级] 与虚拟卷详情页保持一致：优先使用 related.volumes，其次使用 volumes props
    const pvcSource = (Array.isArray(record?.related?.volumes) && record.related.volumes.length > 0) 
      ? record.related.volumes 
      : volumes;
    
    return vols
      .map((v: any) => {
        const claimName = v?.persistentVolumeClaim?.claimName;
        const diskInfo = disks.find((d: any) => d.name === v.name);
        
        // 只处理 PersistentVolumeClaim 类型的卷（数据盘）
        if (!claimName) return null;
        
        // 过滤掉系统盘（bootOrder=1）
        if (diskInfo?.bootOrder === 1) return null;
        
        // 获取容量/文件类型等信息（使用与虚拟卷详情页相同的数据源逻辑）
        let capacityStr = '-';
        if (pvcSource && pvcSource.length > 0) {
          const pvc = pvcSource.find((p: any) => {
            const pName = p?.metadata?.name || p?.name;
            const pNs = p?.metadata?.namespace || p?.namespace;
            return pName === claimName && pNs === vmNs;
          });
          if (pvc) {
            const actualPvc = pvc?.rawData || pvc;
            capacityStr = actualPvc?.status?.capacity?.storage || 
                         actualPvc?.spec?.resources?.requests?.storage || 
                         pvc?.size || 
                         '-';

            const scName = actualPvc?.spec?.storageClassName || pvc?.storageClassName || '-';
            const accessModes = actualPvc?.spec?.accessModes;
            const accessStr = formatAccessModes(accessModes);
            const volumeMode = String(actualPvc?.spec?.volumeMode || '').toLowerCase();
            const fileType =
              volumeMode === 'block'
                ? '块设备 (Block)'
                : volumeMode === 'filesystem'
                ? '文件系统 (Filesystem)'
                : volumeMode || '-';
            return {
              key: v.name,
              name: v.name,
              claimName,
              capacity: capacityStr,
              storageClassName: scName,
              accessModes: accessStr,
              fileType,
              bus: diskInfo?.disk?.bus || '-',
              bootOrder: diskInfo?.bootOrder,
              hotpluggable: !!(v?.hotpluggable || diskInfo?.hotpluggable),
            };
          }
        }
        
        return {
          key: v.name,
          name: v.name,
          claimName,
          capacity: capacityStr,
          storageClassName: '-',
          accessModes: '-',
          fileType: '-',
          bus: diskInfo?.disk?.bus || '-',
          bootOrder: diskInfo?.bootOrder,
          hotpluggable: !!(v?.hotpluggable || diskInfo?.hotpluggable),
        };
      })
      .filter(Boolean) // 过滤掉 null
      .sort((a: any, b: any) => {
        // 按 bootOrder 排序，然后按名称排序
        const aOrder = a.bootOrder || 999;
        const bOrder = b.bootOrder || 999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      });
  }, [record, volumes]);

  const handleDetach = async (diskName: string) => {
    // 不在这里显示消息，由 onDetach 回调统一处理消息提示
    try {
      await onDetach(diskName);
      // 解绑成功后，如果提供了刷新回调，则调用刷新
      if (onRefresh) {
        await onRefresh();
      }
    } catch (error: any) {
      // 错误已经由 onDetach 处理并显示消息，这里只需要防止错误冒泡
      // 不再次显示错误消息，避免重复提示
      console.error('解绑操作失败:', error);
    }
  };

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
      // 刷新成功后，数据会自动更新（因为 record 依赖会触发 useMemo 重新计算）
    } catch (error: any) {
      console.error('刷新失败:', error);
      // 注意：错误消息由 refreshVm 函数内部处理，这里不需要再次提示
    } finally {
      setRefreshing(false);
    }
  };

  const renderDiskCard = (item: any) => {
    const bus = String(item?.bus || '-');
  const fileType = String(item?.fileType || '-');
    return (
      <Card
        size="small"
        title={item?.name || '-'}
        extra={
          <Popconfirm
            title="确认解绑"
            description={
              <div>
                <div style={{ marginBottom: 8 }}>
                  确定要解绑数据盘 <strong>"{item?.name}"</strong> 吗？
                </div>
                <div style={{ color: '#999', fontSize: 12 }}>解绑后虚拟机将无法访问该卷的数据，但卷本身不会被删除。</div>
              </div>
            }
            onConfirm={() => (item?.name ? handleDetach(item.name) : undefined)}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<MinusCircleOutlined />} loading={loading} />
          </Popconfirm>
        }
        style={{ marginBottom: 12, border: '1px solid #d9d9d9' }}
      >
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="名称">
              <Input value={String(item?.claimName || '-')} disabled readOnly />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="容量">
              <Input value={String(item?.capacity || '-')} disabled readOnly />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="总线">
              <Input value={bus && bus !== '-' ? bus.toUpperCase() : '-'} disabled readOnly />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="存储类" style={{ marginBottom: 0 }}>
              <Input value={String(item?.storageClassName || '-')} disabled readOnly />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="访问方式" style={{ marginBottom: 0 }}>
              <Input value={String(item?.accessModes || '-')} disabled readOnly />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="文件类型" style={{ marginBottom: 0 }}>
              <Input value={fileType} disabled readOnly />
            </Form.Item>
          </Col>
        </Row>
      </Card>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Typography.Text type="secondary">移除仅会将数据盘从虚拟机中解绑，不会删除卷本身。</Typography.Text>
        {onRefresh ? (
          <Button type="link" icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing} style={{ padding: 0 }}>
            刷新
          </Button>
        ) : null}
      </div>

      {dataDisks.length === 0 ? (
        <div style={{ padding: '28px 0' }}>
          <Empty description="当前没有已挂载的数据盘" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <div>
          {(dataDisks as any[]).map((item: any) => (
            <div key={String(item?.key || item?.name || '')}>{renderDiskCard(item)}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DetachDataDisk;
