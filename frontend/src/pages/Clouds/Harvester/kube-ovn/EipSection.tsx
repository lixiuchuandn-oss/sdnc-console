import React, { useState, useMemo } from 'react';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, message, Alert, MenuProps, Badge } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnEip, deleteCloudProviderOvnEip } from '../../../../services/harvesterApi';
import MetadataModal from './MetadataModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean) => void;
  bordered?: boolean;
}

interface EipSectionProps extends BaseSectionProps {
  eips: any[];
  subnets: any[]; // Needed for creating EIP (external subnets)
}

export const EipSection: React.FC<EipSectionProps> = ({ cloudId, eips, subnets, loading, onRefresh, bordered = true }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasVpcsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.vpcs:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [metadataRecord, setMetadataRecord] = useState<any>(null);
  
  // 筛选条件
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  const externalSubnets = subnets.filter(s => {
    const vpc = s.spec?.vpc || s.vpc;
    return !vpc || vpc === 'ovn-vpc-external-network';
  });

  // 筛选数据
  const filteredData = useMemo(() => {
    return eips.filter((item: any) => {
      const name = item.metadata?.name || '';
      const ip = item.spec?.v4Ip || '';
      const type = item.spec?.type || '';
      const ready = item.status?.ready;
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!name.toLowerCase().includes(kw) && !ip.toLowerCase().includes(kw)) {
          return false;
        }
      }
      
      // 状态筛选
      if (statusFilter) {
        const isReady = ready ? 'ready' : 'notready';
        if (isReady !== statusFilter) return false;
      }
      
      // 类型筛选
      if (typeFilter && type !== typeFilter) {
        return false;
      }
      
      return true;
    });
  }, [eips, keyword, statusFilter, typeFilter]);

  // 筛选选项
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    eips.forEach((item: any) => {
      if (item.status?.ready) {
        set.add('ready');
      } else {
        set.add('notready');
      }
    });
    return Array.from(set);
  }, [eips]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    eips.forEach((item: any) => {
      const type = item.spec?.type;
      if (type) set.add(type);
    });
    return Array.from(set);
  }, [eips]);

  const handleCreate = async () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createCloudProviderOvnEip(cloudId, values);
      message.success('EIP 创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      onRefresh(true);
    } catch (e: any) {
      let errMsg = e.message || '创建失败';
      try {
        const errObj = JSON.parse(errMsg);
        if (errObj && typeof errObj === 'object') {
          errMsg = errObj.message || errMsg;
          if (errObj.error) errMsg += `: ${errObj.error}`;
        }
      } catch (parseError) {
        // ignore
      }
      message.error(errMsg);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleMenuClick = async (key: string, record: any) => {
    if (key === 'metadata') {
      setMetadataRecord(record);
    } else if (key === 'delete') {
      if (!hasVpcsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除 EIP ${record.metadata?.name} 吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteCloudProviderOvnEip(cloudId, record.metadata?.name);
            message.success('删除成功');
            onRefresh(true);
          } catch (e: any) {
            message.error(`删除失败: ${e.message}`);
          }
        }
      });
    }
  };

  const columns = [
    { 
      title: '名称', 
      key: 'name', 
      render: (_: any, r: any) => r.metadata?.name 
    },
    { 
      title: '外部子网', 
      key: 'externalSubnet', 
      render: (_: any, r: any) => r.spec?.externalSubnet 
    },
    { 
      title: 'IP地址', 
      key: 'ip', 
      render: (_: any, r: any) => <Tag color="blue">{r.spec?.v4Ip}</Tag> 
    },
    { 
      title: 'MAC地址', 
      key: 'mac', 
      render: (_: any, r: any) => r.spec?.macAddress || '-' 
    },
    { 
      title: '类型', 
      key: 'type', 
      render: (_: any, r: any) => r.spec?.type || '-' 
    },
    { 
      title: '状态', 
      key: 'status', 
      render: (_: any, r: any) => (
        <Badge 
          status={r.status?.ready ? 'success' : 'warning'} 
          text={r.status?.ready ? 'Ready' : 'Not Ready'} 
        />
      ) 
    },
    {
      title: '操作', 
      key: 'action', 
      width: 80, 
      render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          { key: 'metadata', label: '查看元数据' },
          { type: 'divider' },
          { key: 'delete', label: '删除', danger: true, disabled: !hasVpcsWrite }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)}
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasVpcsWrite }}
          />
        );
      }
    }
  ];

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input 
              allowClear 
              placeholder="名称/ID" 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword} 
              onChange={(e) => setKeyword(e.target.value)} 
              className="toolbar-search"
            />
            <Select 
              allowClear 
              placeholder="状态" 
              value={statusFilter || undefined} 
              onChange={(v) => setStatusFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                { value: 'ready', label: 'Ready' },
                { value: 'notready', label: 'Not Ready' }
              ]} 
            />
            <Select 
              allowClear 
              placeholder="类型" 
              value={typeFilter || undefined} 
              onChange={(v) => setTypeFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...typeOptions.map(t => ({ value: t, label: t }))
              ]} 
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setStatusFilter('');
                setTypeFilter('');
              }}
            >
              重置
            </button>
          </>
        )}
        primaryAction={{
          label: '创建EIP',
          onClick: () => { if (!hasVpcsWrite) return; setIsCreateVisible(true); },
          disabled: !hasVpcsWrite
        }}
        onRefresh={() => onRefresh(true)}
        refreshLoading={loading}
      >
        <Table 
          className="std-table"
          dataSource={filteredData} 
          columns={columns} 
          loading={loading} 
          bordered={false}
          rowKey={r => r.metadata?.uid} 
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </PageDetailSection>
      
      <MetadataModal visible={!!metadataRecord} record={metadataRecord} onClose={() => setMetadataRecord(null)} />

      <Modal
        title="创建 EIP"
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          {externalSubnets.length === 0 && (
            <Alert
              type="warning"
              message="当前没有任何可用的外部子网 (Provider Network)"
              style={{ marginBottom: 16 }}
            />
          )}
          
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入EIP名称' }]}>
            <Input placeholder="例如: my-eip-1" />
          </Form.Item>

          <Form.Item name="externalSubnet" label="外部子网" rules={[{ required: true, message: '请选择外部子网' }]}>
            <Select placeholder="请选择子网">
              {externalSubnets.map(s => (
                <Select.Option key={s.metadata?.name || s.name} value={s.metadata?.name || s.name}>
                  {s.metadata?.name || s.name} ({s.spec?.cidrBlock || s.cidr})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="v4Ip" label="指定IP (可选)">
            <Input placeholder="例如: 1.2.3.4 (留空自动分配)" />
          </Form.Item>
          <Form.Item name="type" label="类型" initialValue="nat">
            <Select>
              <Select.Option value="nat">NAT</Select.Option>
              <Select.Option value="distributed">Distributed</Select.Option>
              <Select.Option value="centralized">Centralized</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default EipSection;
