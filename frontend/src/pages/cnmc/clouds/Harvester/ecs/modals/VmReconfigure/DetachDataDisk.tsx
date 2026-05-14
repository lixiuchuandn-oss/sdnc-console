import React, { useMemo } from 'react';
import { Button, Empty, List, Modal, Tag, Typography } from 'antd';
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

/** 与外层 flex+gap 配合：清掉 Tag 默认 margin，否则与 gap 叠在一起（写在父 div 上无效，须作用在 .ant-tag 根节点） */
const DISK_META_TAG_PROPS = {
  color: 'blue' as const,
  bordered: true as const,
  style: { marginInlineEnd: 0, marginBottom: 0 } as React.CSSProperties,
};

type Props = {
  record: any;
  cloudId: string;
  onDetach: (diskName: string) => Promise<void>;
  onRefresh?: (force?: boolean) => void | Promise<void>;
  loading?: boolean;
  volumes?: any[]; // 可选的 volumes 列表，用于回退数据源（与虚拟卷详情页保持一致）
};

/**
 * 解绑云硬盘（块设备）组件
 *
 * 展示当前虚拟机已挂载、且以 PVC 声明的卷（含系统盘、数据盘、ISO 光驱卷等），支持解绑；不删卷。
 * 与虚拟卷详情页一致：优先 `record.related.volumes`，否则用 `volumes` props 补全容量/存储类等。
 * 非 PVC 卷（如 cloudInitNoCloud）无 `claimName`，不在此列表出现。
 */
const DetachDataDisk: React.FC<Props> = ({ record, onDetach, onRefresh, loading = false, volumes = [] }) => {
  const [refreshing, setRefreshing] = React.useState(false);
  // 从 VM 记录中提取已挂载的 PVC 块设备（可解绑列表）
  const dataDisks = useMemo(() => {
    if (!record) return [];

    const vols = record?.spec?.template?.spec?.volumes || [];
    const disks = record?.spec?.template?.spec?.domain?.devices?.disks || [];
    const vmNs = record?.metadata?.namespace || record?.namespace || '';

    // [数据源优先级] 与虚拟卷详情页保持一致：优先使用 related.volumes，其次使用 volumes props
    const pvcSource =
      Array.isArray(record?.related?.volumes) && record.related.volumes.length > 0
        ? record.related.volumes
        : volumes;

    return vols
      .map((v: any) => {
        const claimName = v?.persistentVolumeClaim?.claimName;
        const diskInfo = disks.find((d: any) => d.name === v.name);

        // 仅列出 PVC 卷（可解绑的云硬盘）；非 PVC 类型不在此处理
        if (!claimName) return null;

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
            capacityStr =
              actualPvc?.status?.capacity?.storage ||
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
              bus: diskInfo?.disk?.bus || diskInfo?.cdrom?.bus || '-',
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
          bus: diskInfo?.disk?.bus || diskInfo?.cdrom?.bus || '-',
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
    try {
      await onDetach(diskName);
      if (onRefresh) {
        await onRefresh(true);
      }
    } catch (error: any) {
      console.error('解绑操作失败:', error);
      throw error;
    }
  };

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh(true);
    } catch (error: any) {
      console.error('刷新失败:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const openDetachConfirm = (item: any) => {
    if (!item?.name) return;
    Modal.confirm({
      title: '确认解绑',
      centered: true,
      width: 480,
      zIndex: 1100,
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>
            确定要解绑云硬盘 <strong>&quot;{item.name}&quot;</strong> 吗？
          </div>
          <div style={{ color: '#999', fontSize: 12 }}>
            解绑后虚拟机将无法访问该卷；若为系统盘或光驱，请确认可接受后再操作。卷本身不会被删除。
          </div>
        </div>
      ),
      okText: '确定',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleDetach(item.name),
    });
  };

  const busLabel = (bus: string) => {
    const b = String(bus || '-');
    return b && b !== '-' ? b.toUpperCase() : '-';
  };

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Typography.Text type="secondary">
          移除仅将云硬盘从虚拟机解绑，不会实际删除。
        </Typography.Text>
        {onRefresh ? (
          <Button type="link" icon={<ReloadOutlined />} onClick={handleRefresh} loading={refreshing} style={{ padding: 0 }}>
            刷新
          </Button>
        ) : null}
      </div>

      {dataDisks.length === 0 ? (
        <div style={{ padding: '28px 0' }}>
          <Empty description="当前没有已挂载的 PVC 云硬盘" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <List
          size="small"
          bordered
          dataSource={dataDisks as any[]}
          renderItem={(item: any) => (
              <List.Item
                key={String(item?.key || item?.name || '')}
                actions={[
                  <Button
                    key="detach"
                    type="link"
                    danger
                    size="small"
                    icon={<MinusCircleOutlined />}
                    loading={loading}
                    onClick={() => openDetachConfirm(item)}
                    aria-label="解绑该云硬盘"
                  >
                    解绑
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={<Typography.Text strong>{item.name}</Typography.Text>}
                  description={
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        rowGap: 6,
                        marginTop: 4,
                      }}
                    >
                      <Tag {...DISK_META_TAG_PROPS}>PVC：{item.claimName}</Tag>
                      <Tag {...DISK_META_TAG_PROPS}>类型：{item.fileType}</Tag>
                      <Tag {...DISK_META_TAG_PROPS}>容量：{item.capacity}</Tag>
                      <Tag {...DISK_META_TAG_PROPS}>存储类：{item.storageClassName}</Tag>
                      <Tag {...DISK_META_TAG_PROPS}>访问：{item.accessModes}</Tag>
                      <Tag {...DISK_META_TAG_PROPS}>总线：{busLabel(item.bus)}</Tag>
                      <Tag {...DISK_META_TAG_PROPS}>启动顺序：{item.bootOrder}</Tag>
                    </div>
                  }
                />
              </List.Item>
            )}
        />
      )}
    </div>
  );
};

export default DetachDataDisk;
