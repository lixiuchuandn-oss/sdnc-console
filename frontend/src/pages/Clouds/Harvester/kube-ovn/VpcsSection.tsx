import React, { useState, useMemo } from 'react';
import { Table, Button, Space, Modal, Input, Tag, Tooltip, Tabs } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';

/**
 * 接口定义
 */
interface KubeOvnVpcsSectionProps {
  vpcs: any[];
  subnets?: any[];
  loading: boolean;
  onRefresh?: () => void;
}

/**
 * 数据提取辅助函数 (统一处理 CRD 结构兼容性)
 */
const SafeRead = {
  name: (data: any) => data?.name || data?.metadata?.name || '',
  uid: (data: any) => data?.uid || data?.metadata?.uid || '',
  creationTimestamp: (data: any) => data?.createdAt || data?.metadata?.creationTimestamp,
  
  // VPC 特有字段
  vpcCidr: (data: any) => data?.cidr || data?.spec?.cidr || '-',
  vpcNamespaces: (data: any) => data?.namespaces || data?.spec?.namespaces || [],
  
  // Subnet 特有字段
  subnetVpc: (data: any) => data?.vpc || data?.spec?.vpc || 'ovn-cluster',
  subnetCidr: (data: any) => data?.cidr || data?.spec?.cidrBlock || data?.spec?.cidr || '-',
  subnetGateway: (data: any) => data?.gateway || data?.spec?.gateway || '-',
  subnetProtocol: (data: any) => data?.protocol || data?.spec?.protocol || 'IPv4',
  subnetPrivate: (data: any) => !!(data?.private || data?.spec?.private),
  subnetNat: (data: any) => !!(data?.nat || data?.spec?.natOutgoing),
};

/**
 * 组件: KubeOvnVpcsSection
 * 描述: 展示 Kube-OVN VPC 列表及其关联的 Subnets
 */
const KubeOvnVpcsSection: React.FC<KubeOvnVpcsSectionProps> = ({ 
  vpcs = [], 
  subnets = [], 
  loading, 
  onRefresh 
}) => {
  // --- State ---
  const [searchText, setSearchText] = useState('');
  const [tableColumns, setTableColumns] = useState<any[]>([]);
  const [metadataModalVisible, setMetadataModalVisible] = useState(false);
  const [currentMetadata, setCurrentMetadata] = useState<any>(null);

  // --- Logic ---
  
  // 过滤逻辑
  const dataSource = useMemo(() => {
    if (!searchText) return vpcs;
    const key = searchText.toLowerCase().trim();
    return vpcs.filter(item => {
      const name = SafeRead.name(item).toLowerCase();
      const uid = SafeRead.uid(item).toLowerCase();
      return name.includes(key) || uid.includes(key);
    });
  }, [vpcs, searchText]);

  // JSON 查看器
  const handleShowMetadata = (record: any) => {
    setCurrentMetadata(record);
    setMetadataModalVisible(true);
  };

  // --- Columns ---

  // 子网列定义
  const subnetColumns = [
    {
      title: '子网名称',
      key: 'name',
      render: (_: any, r: any) => <span>{SafeRead.name(r)}</span>,
    },
    {
      title: 'CIDR',
      key: 'cidr',
      render: (_: any, r: any) => <Tag>{SafeRead.subnetCidr(r)}</Tag>,
    },
    {
      title: '网关',
      key: 'gateway',
      render: (_: any, r: any) => SafeRead.subnetGateway(r),
    },
    {
      title: '协议',
      key: 'protocol',
      render: (_: any, r: any) => SafeRead.subnetProtocol(r),
    },
    {
      title: '类型',
      key: 'type',
      render: (_: any, r: any) => {
        const isPrivate = SafeRead.subnetPrivate(r);
        const isNat = SafeRead.subnetNat(r);
        return (
          <Space size={4}>
            {isPrivate && <Tag color="gold">Private</Tag>}
            {isNat && <Tag color="blue">NAT</Tag>}
            {!isPrivate && !isNat && <Tag>Standard</Tag>}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const items = [
          { key: 'metadata', label: '查看 MetaData', onClick: () => handleShowMetadata(r) },
          ...(r?.links?.view ? [{ key: 'view', label: '查看 SourceData', onClick: () => window.open(r.links.view, '_blank') }] : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ];

  // VPC 列定义
  const allColumns = useMemo(() => [
    {
      title: '名称',
      key: 'name',
      render: (_: any, r: any) => {
        const name = SafeRead.name(r);
        let tag = null;
        if (name === 'ovn-cluster') tag = <Tag color="gold">Default</Tag>;
        if (name === 'ovn-vpc-external-network') tag = <Tag color="purple">Provider</Tag>;
        
        return (
          <Space>
            <span>{name}</span>
            {tag}
          </Space>
        );
      },
    },
    {
      title: 'UID',
      key: 'uid',
      render: (_: any, r: any) => {
        const uid = SafeRead.uid(r);
        if (!uid) return '-';
        return <span>{uid}</span>;
      },
    },
    {
      title: 'CIDR',
      key: 'cidr',
      render: (_: any, r: any) => <Tag>{SafeRead.vpcCidr(r)}</Tag>,
    },
    {
      title: '命名空间',
      key: 'namespace',
      render: (_: any, r: any) => {
        const ns = SafeRead.vpcNamespaces(r);
        if (Array.isArray(ns) && ns.length > 0) {
          return (
            <Space size={2} wrap>
              {ns.map((n: string) => <Tag key={n} style={{ fontSize: 10 }}>{n}</Tag>)}
            </Space>
          );
        }
        return '-';
      },
    },
    {
      title: '创建时间',
      key: 'createdAt',
      render: (_: any, r: any) => {
        const time = SafeRead.creationTimestamp(r);
        return time ? new Date(time).toLocaleString() : '-';
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const items = [
          { key: 'metadata', label: '查看元数据', onClick: () => handleShowMetadata(r) },
          ...(r?.links?.view ? [{ key: 'view', label: '查看', onClick: () => window.open(r.links.view, '_blank') }] : []),
        ];
        return <ResourceActionsDropdown items={items} buttonProps={{ className: 'row-actions-trigger' }} />;
      },
    },
  ], []);

  // --- Render Helpers ---

  const renderExpandedRow = (record: any) => {
    const vpcName = SafeRead.name(record);
    
    // 核心关联逻辑：筛选出 spec.vpc 等于当前 VPC 名称的子网
    const relatedSubnets = subnets.filter(s => {
      const targetVpc = SafeRead.subnetVpc(s);
      return String(targetVpc).trim() === String(vpcName).trim();
    });

    if (relatedSubnets.length === 0) {
      return <div>暂无关联子网</div>;
    }

    return (
      <div>
        <div>
          关联子网 ({relatedSubnets.length})
        </div>
        <Table
          columns={subnetColumns}
          dataSource={relatedSubnets}
          pagination={false}
          rowKey={(r) => SafeRead.name(r) || Math.random().toString()}
          size="small"
          bordered
        />
      </div>
    );
  };

  // --- Main Render ---

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <Input 
          className="toolbar-search"
          placeholder="搜索 VPC 名称或 UID" 
          value={searchText} 
          onChange={(e) => setSearchText(e.target.value)} 
          allowClear
        />
      )}
      toolbarRight={(
        <>
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_vpcs_table"
          />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} loading={loading}>刷新</Button>
        </>
      )}
    >
      <Table
        className="std-table"
        bordered
        rowKey={(r) => SafeRead.name(r) || Math.random().toString()}
        columns={tableColumns}
        dataSource={dataSource}
        loading={loading}
        pagination={{size: 'small'}}
        expandable={{
          expandedRowRender: renderExpandedRow,
          rowExpandable: () => true,
        }}
      />

      <Modal
        title="元数据查看"
        open={metadataModalVisible}
        onCancel={() => setMetadataModalVisible(false)}
        footer={null}
        width={800}
      >
        <Tabs items={[
            {
                key: 'json',
                label: 'Raw JSON',
                children: (
                    <Input.TextArea 
                        readOnly 
                        value={currentMetadata ? JSON.stringify(currentMetadata, null, 2) : ''} 
                        autoSize={{ minRows: 10, maxRows: 20 }}
                        className="metadata-viewer"
                    />
                )
            }
        ]} />
      </Modal>
    </PageDetailSection>
  );
};

export default KubeOvnVpcsSection;
