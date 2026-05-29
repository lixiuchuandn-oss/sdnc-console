import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Input, Modal, Table, Tooltip, Typography, Form } from 'antd';
import { KeyOutlined, PlusOutlined, ImportOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import { fetchHuaweiKeypairs, createHuaweiKeypair, deleteHuaweiKeypair } from '../../../../../services/huaweiApi';

type Props = {
  cloudId: string;
  keyPairs: any[];
  onSetKeyPairs: (list: any[]) => void;
};

const parseKpList = (json: any): any[] => {
  const raw = (json?.data?.keypairs) || (json?.keypairs) || [];
  return Array.isArray(raw) ? raw.map((x: any) => x?.keypair || x) : [];
};

const KeyPairsSection: React.FC<Props> = ({ cloudId, keyPairs, onSetKeyPairs }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importForm] = Form.useForm();

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json = await fetchHuaweiKeypairs(cloudId);
      onSetKeyPairs(parseKpList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (cloudId && (!keyPairs || keyPairs.length === 0)) refresh(); }, [cloudId]);

  const filtered = useMemo(() => {
    const list = Array.isArray(keyPairs) ? keyPairs : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => !kw || `${r?.name || ''} ${r?.fingerprint || ''}`.toLowerCase().includes(kw));
  }, [keyPairs, keyword]);

  const submitCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      const resp: any = await createHuaweiKeypair(cloudId, v.name);
      const priv = resp?.data?.keypair?.private_key || resp?.keypair?.private_key;
      setCreateOpen(false);
      await refresh();
      if (priv) {
        Modal.success({
          title: '密钥对创建成功', width: 640,
          content: (<div><Typography.Paragraph type="warning">私钥仅此一次返回，请立即复制保存：</Typography.Paragraph><Input.TextArea value={priv} rows={8} readOnly /></div>),
        });
      } else { message.success('创建成功'); }
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const submitImport = async () => {
    try {
      const v = await importForm.validateFields();
      setSubmitting(true);
      await createHuaweiKeypair(cloudId, v.name, v.publicKey);
      message.success('导入成功');
      setImportOpen(false);
      await refresh();
    } catch (e: any) { if (e?.errorFields) return; message.error(e?.message || '导入失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = (r: any) => {
    const name = r?.name;
    if (!name) return;
    Modal.confirm({
      title: '确定删除该密钥对?', content: `密钥对 ${name} 删除后不可恢复`, okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => { try { await deleteHuaweiKeypair(cloudId, name); message.success('删除成功'); await refresh(); } catch (e: any) { message.error(e?.message || '删除失败'); } },
    });
  };

  const columns = useMemo(() => ([
    { title: '名称', key: 'name', fixed: 'left' as const, width: 260, sorter: (a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')), render: (_: any, r: any) => <Typography.Text strong ellipsis={{ tooltip: r?.name }}>{r?.name || '-'}</Typography.Text> },
    { title: '指纹', key: 'fp', render: (_: any, r: any) => { const fp = r?.fingerprint || '-'; return fp !== '-' ? <Typography.Text type="secondary" copyable={{ text: fp }} ellipsis={{ tooltip: fp }}>{fp}</Typography.Text> : '-'; } },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (<RowActionsButton items={[{ key: 'del', label: '删除', danger: true }]} onClick={({ key }: { key: string }) => { if (key === 'del') handleDelete(r); }} />),
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [cloudId]);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="名称 / 指纹" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateOpen(true); }}>创建密钥对</Button>
          <Button icon={<ImportOutlined />} onClick={() => { importForm.resetFields(); setImportOpen(true); }}>导入</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table className="std-table" bordered={false} rowKey={(r: any) => r?.name} dataSource={filtered} columns={columns as any} loading={loading} scroll={{ x: true }} pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }} />

      <Modal title="创建密钥对" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="密钥对名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="如 my-keypair" allowClear /></Form.Item>
        </Form>
      </Modal>

      <Modal title="导入密钥对" open={importOpen} onCancel={() => setImportOpen(false)} onOk={submitImport} confirmLoading={submitting} okText="导入" cancelText="取消" destroyOnClose>
        <Form form={importForm} layout="vertical">
          <Form.Item name="name" label="密钥对名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="如 my-keypair" allowClear /></Form.Item>
          <Form.Item name="publicKey" label="公钥内容" rules={[{ required: true, message: '请粘贴公钥内容' }]}><Input.TextArea rows={5} placeholder="ssh-rsa AAAA..." /></Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <KeyOutlined />;
export const Label = 'SSH 密钥对';
export default KeyPairsSection;
