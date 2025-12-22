import React, { useMemo, useState } from 'react';
import { App, Button, Input, Table, Modal, Space, Typography, Tag, Select } from 'antd';
import { ReloadOutlined, SafetyCertificateOutlined, SearchOutlined } from '@ant-design/icons';
import { fetchCloudProviderSecurityGroups, deleteCloudProviderSecurityGroup } from '../../../../services/api';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';

type Props = {
  cloudId: string;
  secGroups: any[];
  onSetSecGroups: (list: any[]) => void;
  onOpenDetail: (type: string, title: string, data: any) => void;
  onOpenCreate?: () => void;
  showLog?: boolean;
  raw?: any;
};

const securityGroupTypeMap: Record<string, string> = {
  normal: '普通安全组',
  enterprise: '企业级安全组',
};

const SecurityGroupSectionAliyun: React.FC<Props> = ({ cloudId, secGroups, onSetSecGroups, onOpenDetail, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [vpcFilter, setVpcFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);

  const filtered = useMemo(() => {
    const kn = keyword.trim().toLowerCase();
    const list = Array.isArray(secGroups) ? secGroups : [];
    
    return list.filter((g: any) => {
      const nm = String(g?.SecurityGroupName || g?.name || '').toLowerCase();
      const id = String(g?.SecurityGroupId || g?.id || '').toLowerCase();
      const desc = String(g?.Description || g?.description || '').toLowerCase();
      const okKw = !kn || nm.includes(kn) || id.includes(kn) || desc.includes(kn);

      const tp = String(g?.SecurityGroupType || g?.type || '').toLowerCase();
      const okTp = !typeFilter || tp === typeFilter.toLowerCase();

      const vid = String(g?.VpcId || g?.vpc_id || '').toLowerCase();
      const okVpc = !vpcFilter || vid === vpcFilter.toLowerCase();

      return okKw && okTp && okVpc;
    });
  }, [secGroups, keyword, typeFilter, vpcFilter]);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json: any = await fetchCloudProviderSecurityGroups(cloudId);
      const list: any[] = json?.data?.SecurityGroups?.SecurityGroup || json?.SecurityGroups?.SecurityGroup || [];
      onSetSecGroups(Array.isArray(list) ? list : []);
      message.success('安全组已刷新');
    } catch (e: any) {
      message.error(e?.message || '查询安全组失败');
    } finally {
      setLoading(false);
    }
  };

  const columns = useMemo(() => [
    { 
      title: '安全组信息', 
      key: 'info', 
      width: 240,
      sorter: (a: any, b: any) => {
        const an = String(a?.SecurityGroupName || a?.name || '');
        const bn = String(b?.SecurityGroupName || b?.name || '');
        const cmp = an.localeCompare(bn);
        if (cmp !== 0) return cmp;
        return String(a?.SecurityGroupId || a?.id || '').localeCompare(String(b?.SecurityGroupId || b?.id || ''));
      },
      render: (_: any, r: any) => {
        const name = r?.SecurityGroupName || r?.name || '-';
        const id = r?.SecurityGroupId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: id }}>
              {id}
            </Typography.Text>
          </Space>
        );
      } 
    },
    { 
      title: '类型', 
      key: 'type', 
      width: 120,
      sorter: (a: any, b: any) => String(a?.SecurityGroupType || a?.type || '').localeCompare(String(b?.SecurityGroupType || b?.type || '')),
      render: (_: any, r: any) => {
        const t = r?.SecurityGroupType || r?.type || '-';
        return <Tag color={t === 'enterprise' ? 'blue' : 'default'}>{securityGroupTypeMap[t] || t}</Tag>;
      } 
    },
    { 
      title: '所属VPC', 
      key: 'vpc', 
      width: 180,
      sorter: (a: any, b: any) => String(a?.VpcId || a?.vpc_id || '').localeCompare(String(b?.VpcId || b?.vpc_id || '')),
      render: (_: any, r: any) => {
        const vid = r?.VpcId || r?.vpc_id;
        return vid ? (
          <Typography.Text type="secondary" copyable={{ text: vid }} ellipsis={{ tooltip: vid }} style={{ maxWidth: 160 }}>
            {vid}
          </Typography.Text>
        ) : '-';
      } 
    },
    { 
      title: '描述', 
      dataIndex: 'Description', 
      key: 'desc', 
      ellipsis: true,
      render: (_: any, r: any) => r?.Description || r?.description || '-' 
    },
    { 
      title: '创建时间', 
      key: 'time', 
      width: 160,
      render: (_: any, r: any) => {
        const t = r?.CreationTime || r?.created_at || r?.createdAt;
        if (!t) return '-';
        try {
          return new Date(t).toLocaleString('zh-CN', { hour12: false }); 
        } catch { return t; }
      },
      sorter: (a: any, b: any) => String(a?.CreationTime || '').localeCompare(String(b?.CreationTime || ''))
    },
    { 
      title: '操作', 
      key: 'actions', 
      fixed: 'right',
      width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'detail', label: '详情' },
          { key: 'del', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'detail') {
                const name = r?.SecurityGroupName || r?.name || '-';
                const id = r?.SecurityGroupId || r?.id || '-';
                onOpenDetail('security_group', `安全组 ${name}（${id}）`, r);
                return;
              }
              if (key === 'del') {
                const id0 = r?.SecurityGroupId || r?.id;
                if (!id0) return;
                Modal.confirm({
                  title: '确定删除该安全组?',
                  content: `ID: ${id0}`,
                  okText: '确认删除',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: async () => {
                    try {
                      await deleteCloudProviderSecurityGroup(cloudId, id0);
                      message.success('删除成功');
                      await refresh();
                    } catch (e: any) {
                      message.error(e?.message || '删除失败');
                    }
                  }
                });
              }
            }}
          />
        );
      } 
    },
  ], []);

  const vpcOptions = useMemo(() => {
    const all = new Set<string>();
    (Array.isArray(secGroups) ? secGroups : []).forEach((r: any) => {
      const vid = r?.VpcId || r?.vpc_id;
      if (vid) all.add(vid);
    });
    return Array.from(all).map(v => ({ label: v, value: v }));
  }, [secGroups]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <Space wrap>
          <Input 
            prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.25)' }} />}
            placeholder="搜索名称/ID/描述" 
            allowClear 
            value={keyword} 
            onChange={(e) => setKeyword(e.target.value)} 
            style={{ width: 220 }} 
          />
          <Select 
            placeholder="类型" 
            allowClear 
            value={typeFilter} 
            onChange={setTypeFilter} 
            style={{ width: 140 }} 
            options={[
              { label: '普通安全组', value: 'normal' },
              { label: '企业级安全组', value: 'enterprise' }
            ]}
            dropdownMatchSelectWidth={false}
          />
          <Select 
            placeholder="所属VPC" 
            allowClear 
            value={vpcFilter} 
            onChange={setVpcFilter} 
            style={{ width: 160 }} 
            options={vpcOptions}
            dropdownMatchSelectWidth={false}
          />
        </Space>
      )}
      toolbarRight={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading} />
        </Space>
      )}
      asCard={false}
    >
      <Table
        loading={loading}
        rowKey={(r: any) => r?.SecurityGroupId || r?.id}
        columns={columns as any}
        dataSource={filtered}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        scroll={{ x: 1000 }}
      />
      {!!showLog && (
        <div style={{ marginTop: 12 }}>
          <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}
    </PageDetailSection>
  );
};

export const Icon = <SafetyCertificateOutlined />;
export const Label = '安全组';
export default SecurityGroupSectionAliyun;
