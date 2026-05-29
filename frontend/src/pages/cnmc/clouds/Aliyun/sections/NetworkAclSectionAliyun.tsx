import React, { useMemo, useState } from 'react';
import { App, Button, Input, Select, Table, Space, Tooltip, Typography, Modal, Form } from 'antd';
import { SafetyCertificateOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { statusTag } from '../../Hw/components/Common';
import {
  fetchCloudProviderNetworkAcls,
  createCloudProviderNetworkAcl,
  updateCloudProviderNetworkAcl,
  deleteCloudProviderNetworkAcl,
  associateCloudProviderNetworkAcl,
  unassociateCloudProviderNetworkAcl,
} from '../../../../../services/aliyunApi';
import NetworkAclEntryDrawerAliyun from '../drawers/NetworkAclEntryDrawerAliyun';

type Props = {
  cloudId: string;
  networkAcls: any[];
  vpcs: any[];
  vswitches: any[];
  onSetNetworkAcls: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const parseAclList = (json: any): any[] =>
  (json?.data?.NetworkAcls?.NetworkAcl) || (json?.NetworkAcls?.NetworkAcl) || (json?.data?.network_acls) || (json?.network_acls) || [];

const entryCount = (acl: any, dir: 'in' | 'eg') => {
  const raw = dir === 'in'
    ? (acl?.IngressAclEntries?.IngressAclEntry || acl?.ingressAclEntries)
    : (acl?.EgressAclEntries?.EgressAclEntry || acl?.egressAclEntries);
  return Array.isArray(raw) ? raw.length : 0;
};
const assocResources = (acl: any): any[] => {
  const raw = acl?.Resources?.Resource || acl?.resources;
  return Array.isArray(raw) ? raw : [];
};

const NetworkAclSectionAliyun: React.FC<Props> = ({ cloudId, networkAcls, vpcs, vswitches, onSetNetworkAcls, onRefreshAll }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [vpcFilter, setVpcFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [editForm] = Form.useForm();
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [assocOpen, setAssocOpen] = useState<boolean>(false);
  const [assocForm] = Form.useForm();
  const [assocTarget, setAssocTarget] = useState<any | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [drawerAcl, setDrawerAcl] = useState<any | null>(null);

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchCloudProviderNetworkAcls(cloudId);
      onSetNetworkAcls(parseAclList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const reloadAfterWrite = async () => {
    await refresh();
    if (onRefreshAll) await onRefreshAll();
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(networkAcls) ? networkAcls : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.NetworkAclName || r?.name || ''} ${r?.NetworkAclId || r?.id || ''} ${r?.VpcId || r?.vpc_id || ''}`.toLowerCase();
      const okKw = !kw || text.includes(kw);
      const vid = String(r?.VpcId || r?.vpc_id || '');
      const okVpc = !vpcFilter || vid === vpcFilter;
      return okKw && okVpc;
    });
  }, [networkAcls, keyword, vpcFilter]);

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderNetworkAcl(cloudId, { vpcId: values.vpcId, name: values.name, description: values.description });
      message.success('创建成功');
      setCreateOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    } finally { setSubmitting(false); }
  };

  const submitEdit = async () => {
    try {
      const values = await editForm.validateFields();
      const aclId = editTarget?.NetworkAclId || editTarget?.id;
      if (!aclId) return;
      setSubmitting(true);
      await updateCloudProviderNetworkAcl(cloudId, aclId, { name: values.name, description: values.description });
      message.success('更新成功');
      setEditOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '更新失败');
    } finally { setSubmitting(false); }
  };

  const submitAssoc = async () => {
    try {
      const values = await assocForm.validateFields();
      const aclId = assocTarget?.NetworkAclId || assocTarget?.id;
      if (!aclId) return;
      setSubmitting(true);
      await associateCloudProviderNetworkAcl(cloudId, aclId, values.vSwitchIds || []);
      message.success('关联成功');
      setAssocOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '关联失败');
    } finally { setSubmitting(false); }
  };

  const handleUnassociate = (acl: any) => {
    const aclId = acl?.NetworkAclId || acl?.id;
    const resources = assocResources(acl);
    const ids = resources.map((r: any) => r?.ResourceId).filter(Boolean);
    if (!aclId || ids.length === 0) { message.info('该 ACL 未关联交换机'); return; }
    Modal.confirm({
      title: '解除全部关联?',
      content: `将解除 ACL 与 ${ids.length} 个交换机的关联`,
      okText: '确认解除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try {
          await unassociateCloudProviderNetworkAcl(cloudId, aclId, ids);
          message.success('解除关联成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '解除关联失败'); }
      },
    });
  };

  const handleDelete = (acl: any) => {
    const aclId = acl?.NetworkAclId || acl?.id;
    if (!aclId) return;
    Modal.confirm({
      title: '确定删除该网络 ACL?',
      content: `ID: ${aclId}（删除前需先解除全部关联）`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCloudProviderNetworkAcl(cloudId, aclId);
          message.success('删除成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '删除失败'); }
      },
    });
  };

  const vSwitchOptions = useMemo(
    () => (Array.isArray(vswitches) ? vswitches : []).map((s: any) => ({ label: `${s?.VSwitchName || s?.name || s?.VSwitchId || s?.id}（${s?.VSwitchId || s?.id}）`, value: s?.VSwitchId || s?.id })),
    [vswitches],
  );
  const vpcOptions = useMemo(() => Array.from(new Set((networkAcls || []).map((r: any) => String(r?.VpcId || r?.vpc_id || '').trim()).filter(Boolean))).map(v => ({ label: v, value: v })), [networkAcls]);

  const columns = useMemo(() => ([
    {
      title: '名称/ID', key: 'name_id', fixed: 'left' as const, width: 240,
      sorter: (a: any, b: any) => String(a?.NetworkAclName || a?.name || '').localeCompare(String(b?.NetworkAclName || b?.name || '')),
      render: (_: any, r: any) => {
        const name = r?.NetworkAclName || r?.name || '-';
        const id = r?.NetworkAclId || r?.id || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    { title: '入/出规则', key: 'rules', width: 110, render: (_: any, r: any) => `${entryCount(r, 'in')} / ${entryCount(r, 'eg')}` },
    { title: '关联交换机', key: 'assoc', width: 110, render: (_: any, r: any) => `${assocResources(r).length} 个` },
    {
      title: '所属 VPC', key: 'vpc', width: 200, ellipsis: true,
      render: (_: any, r: any) => {
        const vid = r?.VpcId || r?.vpc_id || '';
        const hit = (vpcs || []).find((v: any) => String(v?.VpcId || v?.id || '') === String(vid || ''));
        const name = hit?.VpcName || hit?.name || vid;
        return name ? <Typography.Text type="secondary" ellipsis={{ tooltip: name }}>{name}</Typography.Text> : '-';
      },
    },
    { title: '描述', key: 'desc', ellipsis: true, render: (_: any, r: any) => r?.Description || r?.description || '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => {
        const items = [
          { key: 'rules', label: '管理规则' },
          { key: 'assoc', label: '关联交换机' },
          { key: 'unassoc', label: '解除关联' },
          { key: 'edit', label: '编辑' },
          { key: 'del', label: '删除', danger: true },
        ];
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }: { key: string }) => {
              if (key === 'rules') { setDrawerAcl(r); setDrawerOpen(true); return; }
              if (key === 'assoc') { setAssocTarget(r); assocForm.resetFields(); setAssocOpen(true); return; }
              if (key === 'unassoc') { handleUnassociate(r); return; }
              if (key === 'edit') { setEditTarget(r); editForm.setFieldsValue({ name: r?.NetworkAclName || r?.name, description: r?.Description || r?.description }); setEditOpen(true); return; }
              if (key === 'del') { handleDelete(r); return; }
            }}
          />
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [vpcs]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / ID / VPC" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select className="toolbar-filter-sm" placeholder="所属 VPC" allowClear value={vpcFilter} onChange={setVpcFilter} options={vpcOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setVpcFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>创建网络 ACL</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.NetworkAclId || r?.id}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title="创建网络 ACL" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="vpcId" label="所属 VPC" rules={[{ required: true, message: '请选择所属 VPC' }]}>
            <Select showSearch optionFilterProp="label" placeholder="请选择 VPC" options={(vpcs || []).map((v: any) => ({ label: `${v.VpcName || v.name || v.VpcId || v.id}（${v.VpcId || v.id}）`, value: v.VpcId || v.id }))} />
          </Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="请输入名称" maxLength={128} allowClear />
          </Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} placeholder="选填" maxLength={256} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑网络 ACL" open={editOpen} onCancel={() => setEditOpen(false)} onOk={submitEdit} confirmLoading={submitting} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="请输入名称" maxLength={128} allowClear />
          </Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} placeholder="选填" maxLength={256} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="关联交换机" open={assocOpen} onCancel={() => setAssocOpen(false)} onOk={submitAssoc} confirmLoading={submitting} okText="关联" cancelText="取消" destroyOnClose>
        <Form form={assocForm} layout="vertical">
          <Form.Item name="vSwitchIds" label="选择交换机" rules={[{ required: true, message: '请选择交换机' }]}>
            <Select mode="multiple" showSearch optionFilterProp="label" placeholder="可多选" options={vSwitchOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <NetworkAclEntryDrawerAliyun
        open={drawerOpen}
        cloudId={cloudId}
        acl={drawerAcl}
        onClose={() => { setDrawerOpen(false); setDrawerAcl(null); }}
        onUpdated={reloadAfterWrite}
      />
    </PageDetailSection>
  );
};

export const Icon = <SafetyCertificateOutlined />;
export const Label = '网络 ACL';
export default NetworkAclSectionAliyun;
