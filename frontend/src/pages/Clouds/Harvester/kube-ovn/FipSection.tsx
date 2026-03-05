import React, { useState, useMemo } from 'react';
import { Table, Tag, Button, Space, Modal, Form, Input, Select, message, MenuProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnFip, deleteCloudProviderOvnFip } from '../../../../services/harvesterApi';
import MetadataModal from './MetadataModal';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean) => void;
  bordered?: boolean;
}

interface FipSectionProps extends BaseSectionProps {
  fips: any[];
  eips: any[];
  vpcs: any[];
}

export const FipSection: React.FC<FipSectionProps> = ({ cloudId, fips, eips, vpcs, loading, onRefresh, bordered = true }) => {
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [metadataRecord, setMetadataRecord] = useState<any>(null);
  
  // 筛选条件
  const [keyword, setKeyword] = useState<string>('');
  const [vpcFilter, setVpcFilter] = useState<string>('');
  const [ipTypeFilter, setIpTypeFilter] = useState<string>('');

  // 筛选数据
  const filteredData = useMemo(() => {
    return fips.filter((item: any) => {
      const name = item.metadata?.name || '';
      const eip = item.spec?.ovnEip || '';
      const ipName = item.spec?.ipName || '';
      const vpc = item.spec?.vpc || '';
      const ipType = item.spec?.ipType || '';
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!name.toLowerCase().includes(kw) && 
            !eip.toLowerCase().includes(kw) && 
            !ipName.toLowerCase().includes(kw)) {
          return false;
        }
      }
      
      // VPC筛选
      if (vpcFilter && vpc !== vpcFilter) {
        return false;
      }
      
      // IP类型筛选
      if (ipTypeFilter && ipType !== ipTypeFilter) {
        return false;
      }
      
      return true;
    });
  }, [fips, keyword, vpcFilter, ipTypeFilter]);

  // 筛选选项
  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    fips.forEach((item: any) => {
      const vpc = item.spec?.vpc;
      if (vpc) set.add(vpc);
    });
    return Array.from(set);
  }, [fips]);

  const ipTypeOptions = useMemo(() => {
    const set = new Set<string>();
    fips.forEach((item: any) => {
      const ipType = item.spec?.ipType;
      if (ipType) set.add(ipType);
    });
    return Array.from(set);
  }, [fips]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      await createCloudProviderOvnFip(cloudId, values);
      message.success('FIP 创建成功');
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
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除 FIP ${record.metadata?.name} 吗？`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            await deleteCloudProviderOvnFip(cloudId, record.metadata?.name);
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
      title: 'EIP', 
      key: 'eip', 
      render: (_: any, r: any) => r.spec?.ovnEip || '-' 
    },
    { 
      title: '内部IP', 
      key: 'ip', 
      render: (_: any, r: any) => <Tag>{r.spec?.ipName}</Tag> 
    },
    { 
      title: '类型', 
      key: 'type', 
      render: (_: any, r: any) => r.spec?.ipType || '-' 
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
          { key: 'delete', label: '删除', danger: true }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)}
            buttonProps={{ className: 'row-actions-trigger' }}
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
              placeholder="关键字" 
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
              className="toolbar-filter"
              options={[
                { value: '', label: '全部' },
                ...vpcOptions.map(v => ({ value: v, label: v }))
              ]} 
            />
            <Select 
              allowClear 
              placeholder="IP类型" 
              value={ipTypeFilter || undefined} 
              onChange={(v) => setIpTypeFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...ipTypeOptions.map(t => ({ value: t, label: t }))
              ]} 
            />
          </>
        )}
        primaryAction={{
          label: '创建FIP',
          onClick: () => setIsCreateVisible(true)
        }}
        onRefresh={() => onRefresh(true)}
        refreshLoading={loading}
      >
        <Table 
          className="std-table"
          dataSource={filteredData} 
          columns={columns} 
          loading={loading} 
          bordered={bordered}
          rowKey={r => r.metadata?.uid} 
          pagination={{
            size: 'small',
            showQuickJumper: false
          }}
        />
      </PageDetailSection>
      
      <MetadataModal visible={!!metadataRecord} record={metadataRecord} onClose={() => setMetadataRecord(null)} />

      <Modal
        title="创建 FIP"
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入FIP名称' }]}>
            <Input placeholder="例如: my-fip-1" />
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
          <Form.Item name="vpc" label="VPC" rules={[{ required: true, message: '请选择VPC' }]}>
            <Select placeholder="请选择VPC">
              {vpcs.map(v => (
                <Select.Option key={v.metadata?.name} value={v.metadata?.name}>
                  {v.metadata?.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="ipType" label="IP类型" initialValue="eip">
            <Select>
              <Select.Option value="eip">EIP</Select.Option>
              <Select.Option value="vip">VIP</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="ipName" label="内部IP/名称" rules={[{ required: true, message: '请输入内部IP名称' }]}>
             <Input placeholder="例如: vm-ip-name or 192.168.x.x" />
          </Form.Item>
          <Form.Item name="v4Ip" label="指定IP (可选)">
             <Input placeholder="例如: 10.0.x.x (留空自动分配)" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default FipSection;
