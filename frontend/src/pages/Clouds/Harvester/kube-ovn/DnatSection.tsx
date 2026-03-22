import React, { useState, useMemo } from 'react';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, message, MenuProps } from 'antd';
import { ImportOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnDnatRule, deleteCloudProviderOvnDnatRule } from '../../../../services/harvesterApi';
import MetadataModal from './MetadataModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean, silent?: boolean) => void;
  bordered?: boolean;
}

interface DnatSectionProps extends BaseSectionProps {
  dnatRules: any[];
  eips: any[];
  vpcs: any[];
}

export const DnatSection: React.FC<DnatSectionProps> = ({ cloudId, dnatRules, eips, vpcs, loading, onRefresh, bordered = true }) => {
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
  const [vpcFilter, setVpcFilter] = useState<string>('');
  const [protocolFilter, setProtocolFilter] = useState<string>('');

  // 筛选数据
  const filteredData = useMemo(() => {
    return dnatRules.filter((item: any) => {
      const name = item.metadata?.name || '';
      const eip = item.spec?.ovnEip || '';
      const internalIp = item.spec?.internalIp || '';
      const vpc = item.spec?.vpc || '';
      const protocol = item.spec?.protocol || '';
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!name.toLowerCase().includes(kw) && 
            !eip.toLowerCase().includes(kw) && 
            !internalIp.toLowerCase().includes(kw)) {
          return false;
        }
      }
      
      // VPC筛选
      if (vpcFilter && vpc !== vpcFilter) {
        return false;
      }
      
      // 协议筛选
      if (protocolFilter && protocol !== protocolFilter) {
        return false;
      }
      
      return true;
    });
  }, [dnatRules, keyword, vpcFilter, protocolFilter]);

  // 筛选选项
  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    dnatRules.forEach((item: any) => {
      const vpc = item.spec?.vpc;
      if (vpc) set.add(vpc);
    });
    return Array.from(set);
  }, [dnatRules]);

  const protocolOptions = useMemo(() => {
    const set = new Set<string>();
    dnatRules.forEach((item: any) => {
      const protocol = item.spec?.protocol;
      if (protocol) set.add(protocol);
    });
    return Array.from(set);
  }, [dnatRules]);

  const handleCreate = async () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createCloudProviderOvnDnatRule(cloudId, values);
      message.success('DNAT 规则创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      // 创建后刷新（silent=true）时，使用 skipSync=true 跳过全量同步
      onRefresh(true, true);
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
        content: `确定要删除 DNAT 规则 ${record.metadata?.name} 吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteCloudProviderOvnDnatRule(cloudId, record.metadata?.name);
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
      ellipsis: true,
      render: (_: any, r: any) => {
        const n = r.metadata?.name || '—';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <ImportOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={n}>{n}</span>
          </span>
        );
      },
    },
    { 
      title: 'EIP', 
      key: 'eip', 
      render: (_: any, r: any) => r.spec?.ovnEip || '-' 
    },
    { 
      title: '端口', 
      key: 'port', 
      render: (_: any, r: any) => `${r.spec?.protocol} ${r.spec?.externalPort} -> ${r.spec?.internalPort}` 
    },
    { 
      title: '内部IP', 
      key: 'ip', 
      render: (_: any, r: any) => r.spec?.internalIp || '-' 
    },
    { 
      title: 'VPC', 
      key: 'vpc', 
      render: (_: any, r: any) => r.spec?.vpc || '-' 
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
              placeholder="VPC" 
              value={vpcFilter || undefined} 
              onChange={(v) => setVpcFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...vpcOptions.map(v => ({ value: v, label: v }))
              ]} 
            />
            <Select 
              allowClear 
              placeholder="协议" 
              value={protocolFilter || undefined} 
              onChange={(v) => setProtocolFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...protocolOptions.map(p => ({ value: p, label: p.toUpperCase() }))
              ]} 
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setVpcFilter('');
                setProtocolFilter('');
              }}
            >
              重置
            </button>
          </>
        )}
        primaryAction={{
          label: '创建DNAT规则',
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
        title="创建 DNAT 规则"
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如: my-dnat-rule" />
          </Form.Item>
          <Form.Item name="ovnEip" label="EIP" rules={[{ required: true, message: '请选择EIP' }]}>
            <Select placeholder="请选择EIP">
              {eips.map(e => (
                <Select.Option key={e.metadata?.name} value={e.metadata?.name}>
                  {e.metadata?.name} ({e.spec?.v4Ip})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="protocol" label="协议" initialValue="tcp">
            <Select>
              <Select.Option value="tcp">TCP</Select.Option>
              <Select.Option value="udp">UDP</Select.Option>
              <Select.Option value="sctp">SCTP</Select.Option>
            </Select>
          </Form.Item>
          <Space>
             <Form.Item name="externalPort" label="外部端口" rules={[{ required: true, message: '请输入外部端口' }]}>
                <Input placeholder="例如: 80" />
             </Form.Item>
             <Form.Item name="internalPort" label="内部端口" rules={[{ required: true, message: '请输入内部端口' }]}>
                <Input placeholder="例如: 8080" />
             </Form.Item>
          </Space>
          <Form.Item name="internalIp" label="内部IP" rules={[{ required: true, message: '请输入内部IP' }]}>
             <Input placeholder="例如: 10.0.1.5" />
          </Form.Item>
          <Form.Item name="vpc" label="VPC" rules={[{ required: true, message: '请选择VPC' }]}>
             <Select placeholder="请选择VPC">
               {vpcs.map(v => (
                 <Select.Option key={v.metadata?.name} value={v.metadata?.name}>
                   {v.metadata?.name}
                 </Select.Option>
               ))}
             </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default DnatSection;
