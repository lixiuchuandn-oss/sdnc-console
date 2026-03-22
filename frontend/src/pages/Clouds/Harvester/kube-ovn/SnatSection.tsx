import React, { useState, useMemo } from 'react';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, message, MenuProps } from 'antd';
import { ExportOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnSnatRule, deleteCloudProviderOvnSnatRule } from '../../../../services/harvesterApi';
import MetadataModal from './MetadataModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean, silent?: boolean) => void;
  bordered?: boolean;
}

interface SnatSectionProps extends BaseSectionProps {
  snatRules: any[];
  eips: any[];
  vpcs: any[]; // Used to filter subnets or context
  subnets: any[];
}

export const SnatSection: React.FC<SnatSectionProps> = ({ cloudId, snatRules, eips, subnets, loading, onRefresh, bordered = true }) => {
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

  // 筛选数据
  const filteredData = useMemo(() => {
    return snatRules.filter((item: any) => {
      const name = item.metadata?.name || '';
      const eip = item.spec?.ovnEip || '';
      const vpcSubnet = item.spec?.vpcSubnet || '';
      const vpc = item.spec?.vpc || '';
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!name.toLowerCase().includes(kw) && 
            !eip.toLowerCase().includes(kw) && 
            !vpcSubnet.toLowerCase().includes(kw)) {
          return false;
        }
      }
      
      // VPC筛选
      if (vpcFilter && vpc !== vpcFilter) {
        return false;
      }
      
      return true;
    });
  }, [snatRules, keyword, vpcFilter]);

  // 筛选选项
  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    snatRules.forEach((item: any) => {
      const vpc = item.spec?.vpc;
      if (vpc) set.add(vpc);
    });
    return Array.from(set);
  }, [snatRules]);

  const handleCreate = async () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createCloudProviderOvnSnatRule(cloudId, values);
      message.success('SNAT 规则创建成功');
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
        content: `确定要删除 SNAT 规则 ${record.metadata?.name} 吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteCloudProviderOvnSnatRule(cloudId, record.metadata?.name);
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
            <ExportOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={n}>{n}</span>
          </span>
        );
      },
    },
    { 
      title: 'CIDR', 
      key: 'cidr', 
      render: (_: any, r: any) => <Tag>{r.spec?.vpcSubnet}</Tag> 
    },
    { 
      title: 'VPC', 
      key: 'vpc', 
      render: (_: any, r: any) => r.spec?.vpc || '-' 
    },
    { 
      title: 'EIP', 
      key: 'eip', 
      render: (_: any, r: any) => r.spec?.ovnEip || '-' 
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
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setVpcFilter('');
              }}
            >
              重置
            </button>
          </>
        )}
        primaryAction={{
          label: '创建SNAT规则',
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
        title="创建 SNAT 规则"
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如: my-snat-rule" />
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
          <Form.Item name="vpcSubnet" label="VPC子网" rules={[{ required: true, message: '请选择VPC子网' }]}>
            <Select placeholder="请选择子网">
              {subnets.map(s => (
                <Select.Option key={s.metadata?.name || s.name} value={s.metadata?.name || s.name}>
                  {s.metadata?.name || s.name} (VPC: {s.spec?.vpc || s.vpc})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SnatSection;
