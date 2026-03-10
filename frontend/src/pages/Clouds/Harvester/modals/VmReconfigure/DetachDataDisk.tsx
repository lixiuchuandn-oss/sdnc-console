import React, { useMemo } from 'react';
import { List, Button, Popconfirm, Tag, Descriptions, Card, Space } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { ReactComponent as DiskIcon } from '../../../../../assets/clouds/disk.svg';

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
const DetachDataDisk: React.FC<Props> = ({ record, cloudId, onDetach, onRefresh, loading = false, volumes = [] }) => {
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
        
        // 获取容量信息（使用与虚拟卷详情页相同的数据源逻辑）
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
          }
        }
        
        return {
          key: v.name,
          name: v.name,
          claimName,
          capacity: capacityStr,
          bus: diskInfo?.disk?.bus || '-',
          bootOrder: diskInfo?.bootOrder,
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

  if (dataDisks.length === 0) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: '#999' }}>
        <div style={{ 
          width: 64, height: 64, borderRadius: 12, background: '#f0f9ff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 16
        }}>
          <DiskIcon width={36} height={36} style={{ fill: '#1890ff' }} />
        </div>
        <div style={{ fontSize: 14 }}>当前没有已挂载的数据盘</div>
      </div>
    );
  }

  return (
    <div>
      <Space style={{ width: '100%', marginBottom: 16 }} align="center">
        <div style={{ color: '#999' }}>解绑操作只会将数据盘从虚拟机中移除，不会删除卷本身</div>
        {onRefresh && (
          <Button
            type="link"
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
            loading={refreshing}
            style={{ padding: 0 }}
          >
            刷新
          </Button>
        )}
      </Space>
      <List
        loading={loading || refreshing}
        grid={{ gutter: 16, xs: 1, sm: 1, md: 1, lg: 1, xl: 1, xxl: 1 }}
        dataSource={dataDisks}
        renderItem={(item: any) => (
          <List.Item>
            <Card
              hoverable
              style={{ borderRadius: 8 }}
              bodyStyle={{ padding: '16px 20px' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ 
                      width: 32, height: 32, borderRadius: 6, background: '#f0f9ff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginRight: 12, flexShrink: 0
                    }}>
                      <DiskIcon width={18} height={18} style={{ fill: '#1890ff' }} />
                    </div>
                    <span style={{ fontSize: 16, fontWeight: 500, color: '#262626' }}>
                      {item.name}
                    </span>
                  </div>
                  <Descriptions size="small" column={1} style={{ marginTop: 8 }}>
                    <Descriptions.Item label="PVC 名称">
                      <span style={{ color: '#595959' }}>{item.claimName}</span>
                    </Descriptions.Item>
                    <Descriptions.Item label="容量">
                      <span style={{ color: '#595959' }}>{item.capacity}</span>
                    </Descriptions.Item>
                    <Descriptions.Item label="总线类型">
                      {item.bus === '-' ? (
                        <span style={{ color: '#999' }}>-</span>
                      ) : (
                        <Tag color="blue">{item.bus.toUpperCase()}</Tag>
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                </div>
                <div style={{ marginLeft: 16 }}>
                  <Popconfirm
                    title="确认解绑"
                    description={
                      <div>
                        <div style={{ marginBottom: 8 }}>确定要解绑数据盘 <strong>"{item.name}"</strong> 吗？</div>
                        <div style={{ color: '#999', fontSize: 12 }}>
                          解绑后虚拟机将无法访问该卷的数据，但卷本身不会被删除。
                        </div>
                      </div>
                    }
                    onConfirm={() => handleDetach(item.name)}
                    okText="确定"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={loading}
                      style={{ minWidth: 80 }}
                    >
                      解绑
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            </Card>
          </List.Item>
        )}
      />
    </div>
  );
};

export default DetachDataDisk;
