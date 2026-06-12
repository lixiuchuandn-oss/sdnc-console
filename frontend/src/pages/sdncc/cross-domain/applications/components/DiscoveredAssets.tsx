import React, { useEffect, useState, useMemo } from 'react';
import { Table, Tag, Button, Space, Select, message, Badge, Typography, Form, Input } from 'antd';
import { SearchOutlined, PlusOutlined, LinkOutlined } from '@ant-design/icons';
import SharedToolbar from '../../../../../components/SharedToolbar';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { fetchSaseDiscoveredAssets } from '../../../../../services/api';
import type { AppItem } from '../types/app';

const { Text } = Typography;

interface DiscoveredAsset {
  network_id: string; // or id
  type: string;
  value: string; // IP
  port?: string;
  pool_id?: string;
  cloudId?: string; // Augmented
  cloudName?: string; // Augmented
  gatewayName?: string; // SASE Gateway Name
  lastSeen?: string;
  os?: string; // New field
  mac?: string; // New field
  hostname?: string; // New field
  ports?: string[]; // Aggregated ports
}

interface Props {
  domains: any[]; // To get cloudIds
  existingApps: AppItem[];
  onCreateApp: (asset: DiscoveredAsset) => void;
  onLinkApp: (asset: DiscoveredAsset) => void;
  onCountChange?: (count: number) => void;
}

const DiscoveredAssets: React.FC<Props> = ({ domains, existingApps, onCreateApp, onLinkApp, onCountChange }) => {
  const [assets, setAssets] = useState<DiscoveredAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all'); // all, managed, unmanaged
  const [keyword, setKeyword] = useState('');
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({});
  const [form] = Form.useForm();

  const columnLabels: Record<string, string> = {
    hostInfo: '主机信息',
    ports: '开放端口',
    risk: '风险等级',
    type: '资产类型',
    location: '所属网关/网际路由域',
    status: '状态',
    action: '操作',
  };

  const fetchAssets = async () => {
    setLoading(true);
    try {
      // Fetch only from local Tower database (reported by SASE gateways)
      const res = await fetchSaseDiscoveredAssets({ page_size: 1000 });
      // Support both array response and { items: [] } structure
      const items = Array.isArray(res) ? res : (Array.isArray((res as any)?.items) ? (res as any).items : []);
      
      // Aggregate by (vrUuid + ip) to combine ports
      const assetMap = new Map<string, any>();

      items.forEach((item: any) => {
        // Use vrUuid from backend (if available) or gatewayName as part of key to distinguish same IP from different gateways
        const key = `${item.vrUuid || item.gatewayName}-${item.ip}`;
        
        if (assetMap.has(key)) {
            const existing = assetMap.get(key);
            // Merge ports
            if (item.port && !existing.ports.includes(item.port)) {
                existing.ports.push(item.port);
            }
            // Update lastSeen to the latest one
            if (new Date(item.lastSeen) > new Date(existing.lastSeen)) {
                existing.lastSeen = item.lastSeen;
            }
            // Merge other info if missing (e.g. OS/Hostname might be on one record but not another?) 
            // Assuming they are consistent for the same host, but let's be safe
            if (!existing.os && item.os) existing.os = item.os;
            if (!existing.hostname && item.hostname) existing.hostname = item.hostname;
            if (!existing.mac && item.mac) existing.mac = item.mac;

        } else {
            assetMap.set(key, {
                ...item,
                ports: item.port ? [item.port] : []
            });
        }
      });

      const formatted = Array.from(assetMap.values()).map((item: any) => {
        const domain = domains?.find(d => d.id === item.domainId);
        return {
          network_id: item.id,
          type: item.type || 'ip',
          value: item.ip,
          port: item.port, // Keep primary port for compat, though we use ports array now
          ports: item.ports.sort((a: any, b: any) => Number(a) - Number(b)),
          cloudId: item.cloudId,
          cloudName: '已上报资产',
          gatewayName: item.gatewayName,
          domainName: domain?.name,
          os: item.os,
          mac: item.mac,
          hostname: item.hostname,
          lastSeen: item.lastSeen
        };
      });
      
      setAssets(formatted);
      onCountChange?.(formatted.length);
    } catch (e) {
      console.warn('Failed to fetch discovered assets', e);
      message.error('获取发现资产失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Always fetch, regardless of domains
    fetchAssets();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains]); // Keep domains dependency if cloudName mapping depends on it, but logic inside is safe

  // Reconciliation Logic
  const processedAssets = assets.map(asset => {
    // Check if IP matches any App
    const matchedApp = existingApps.find(app => {
      // Check serviceAddresses
      if (app.serviceAddresses?.some(sa => sa.ip === asset.value)) return true;
      // Check instances (if we had IP map, but here we only have asset IP)
      // For simplicity, we match by IP value
      return false;
    });

    return {
      ...asset,
      status: matchedApp ? 'managed' : 'unmanaged',
      appName: matchedApp?.name,
      appId: matchedApp?.id
    };
  });

  const filteredAssets = processedAssets.filter(a => {
    if (keyword) {
      const kw = keyword.toLowerCase();
      if (!a.value.toLowerCase().includes(kw) && !String(a.cloudName || '').toLowerCase().includes(kw)) return false;
    }
    if (filterStatus === 'all') return true;
    return a.status === filterStatus;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns: any[] = [
    {
      title: '主机信息',
      key: 'hostInfo',
      width: 250,
      render: (_: any, record: any) => (
        <Space direction="vertical" size={0}>
          <Text strong copyable>{record.value}</Text>
          {record.hostname && <Text type="secondary" style={{fontSize: 12}}>{record.hostname}</Text>}
          {record.os && <Tag style={{marginTop: 4}}>{record.os}</Tag>}
        </Space>
      )
    },
    {
      title: '开放端口',
      key: 'ports',
      width: 200,
      render: (_: any, record: any) => (
        <Space wrap size={[4, 4]}>
             {record.ports && record.ports.length > 0 ? (
               record.ports.map((p: string) => <Tag color="blue" key={p}>{p}</Tag>)
             ) : (
               <Text type="secondary">-</Text>
             )}
        </Space>
      )
    },
    {
      title: '风险等级',
      key: 'risk',
      width: 100,
      render: () => <Badge status="success" text="安全" />
    },
    {
      title: '资产类型',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (t: string) => <Tag>{t}</Tag>
    },
    {
      title: '所属网关/网际路由域',
      key: 'location',
      width: 200,
      render: (_: any, record: any) => (
         <Space direction="vertical" size={0}>
            {record.gatewayName && <Tag color="blue">{record.gatewayName}</Tag>}
            {record.domainName ? (
                 <Text type="secondary">{record.domainName}</Text>
            ) : (
                 record.cloudName && <Text type="secondary">{record.cloudName}</Text>
            )}
         </Space>
      )
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_: any, record: any) => {
        if (record.status === 'managed') {
          return <Badge status="success" text={<span style={{color: '#52c41a'}}>已纳管 ({record.appName})</span>} />;
        }
        return <Badge status="warning" text="未纳管" />;
      }
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 100,
      render: (_: any, record: any) => {
        const items = [];
        if (record.status === 'unmanaged') {
            items.push({
                key: 'create',
                label: '转为应用',
                icon: <PlusOutlined />,
                onClick: () => onCreateApp(record)
            });
            items.push({
                key: 'link',
                label: '关联现有',
                icon: <LinkOutlined />,
                onClick: () => onLinkApp(record)
            });
        }
        
        if (items.length === 0) return <Button type="link" size="small" disabled>已关联</Button>;
        
        return (
            <ResourceActionsDropdown 
                items={items}
            />
        );
      }
    }
  ];

  const displayColumns = useMemo(() => {
    return columns.filter((c) => visibleCols[String(c.key)] !== false);
  }, [columns, visibleCols]);

  return (
    <>
      <SharedToolbar
        left={
          <Form
            form={form}
            layout="vertical"
            initialValues={{ status: 'all', keyword: '' }}
            style={{ rowGap: 8, columnGap: 8, display: 'flex', alignItems: 'flex-end' }}
            onValuesChange={(_, all) => {
              setFilterStatus(all.status);
              setKeyword(all.keyword || '');
            }}
          >
            <Form.Item name="keyword" style={{ marginBottom: 0 }}>
              <Input 
              allowClear 
              placeholder="资产名称/IP" 
              style={{ width: 200 }} 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              />
            </Form.Item>
            <Form.Item 
              name="status" 
              style={{ marginBottom: 0 }}
            >
              <Select 
                style={{ width: 150 }} 
                options={[
                  { label: '全部资产', value: 'all' },
                  { label: '未纳管', value: 'unmanaged' },
                  { label: '已纳管', value: 'managed' },
                ]}
              />
            </Form.Item>
            <Button 
              type="link" 
              style={{ padding: 0, height: 32, lineHeight: '32px' }}
              onClick={() => {
                form.resetFields();
                setFilterStatus('all');
                setKeyword('');
              }}
            >
              重置
            </Button>
          </Form>
        }
        onRefresh={fetchAssets}
        refreshLoading={loading}
        columnsConfig={{
          value: Object.keys(columnLabels).filter(k => visibleCols[k] !== false),
          options: Object.keys(columnLabels).map(k => ({ label: columnLabels[k], value: k })),
          onChange: (vals) => {
            const newCols: Record<string, boolean> = {};
            Object.keys(columnLabels).forEach(k => {
              newCols[k] = vals.includes(k);
            });
            setVisibleCols(newCols);
          }
        }}
      />
      <Table 
        className="vr-table std-table"
        bordered={false}
        rowKey={(r) => r.network_id || r.value}
        columns={displayColumns} 
        dataSource={filteredAssets} 
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />
    </>
  );
};

export default DiscoveredAssets;
