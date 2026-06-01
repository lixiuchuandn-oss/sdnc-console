import React, { useMemo, useState } from 'react';
import { App, Button, Input, Table, Tooltip, Typography, Modal, Form } from 'antd';
import { KeyOutlined, PlusOutlined, ImportOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import {
  fetchCloudProviderKeyPairs,
  createCloudProviderKeyPair,
  importCloudProviderKeyPair,
  deleteCloudProviderKeyPair,
} from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  keyPairs: any[];
  onSetKeyPairs: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const parseKeyPairList = (json: any): any[] =>
  (json?.data?.KeyPairs?.KeyPair) || (json?.KeyPairs?.KeyPair) || (json?.data?.key_pairs) || (json?.key_pairs) || [];

const KeyPairsSectionAliyun: React.FC<Props> = ({ cloudId, keyPairs, onSetKeyPairs, onRefreshAll }) => {
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
      const json = await fetchCloudProviderKeyPairs(cloudId);
      onSetKeyPairs(parseKeyPairList(json));
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const reloadAfterWrite = async () => {
    await refresh();
    if (onRefreshAll) await onRefreshAll();
  };

  const filtered = useMemo(() => {
    const list = Array.isArray(keyPairs) ? keyPairs : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.KeyPairName || r?.name || ''} ${r?.KeyPairFingerPrint || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [keyPairs, keyword]);

  const submitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      const resp: any = await createCloudProviderKeyPair(cloudId, values.keyPairName);
      const priv = resp?.data?.PrivateKeyBody || resp?.PrivateKeyBody;
      setCreateOpen(false);
      await reloadAfterWrite();
      if (priv) {
        Modal.success({
          title: '密钥对创建成功',
          width: 640,
          content: (
            <div>
              <Typography.Paragraph type="warning">私钥仅此一次返回，请立即复制保存：</Typography.Paragraph>
              <Input.TextArea value={priv} rows={8} readOnly />
            </div>
          ),
        });
      } else {
        message.success('创建成功');
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    } finally { setSubmitting(false); }
  };

  const submitImport = async () => {
    try {
      const values = await importForm.validateFields();
      setSubmitting(true);
      await importCloudProviderKeyPair(cloudId, values.keyPairName, values.publicKeyBody);
      message.success('导入成功');
      setImportOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '导入失败');
    } finally { setSubmitting(false); }
  };

  const handleDelete = (r: any) => {
    const name = r?.KeyPairName || r?.name;
    if (!name) return;
    Modal.confirm({
      title: '确定删除该密钥对?',
      content: `密钥对 ${name} 删除后不可恢复`,
      okText: '确认删除', okType: 'danger', cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCloudProviderKeyPair(cloudId, name);
          message.success('删除成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '删除失败'); }
      },
    });
  };

  const columns = useMemo(() => ([
    {
      title: '名称', key: 'name', fixed: 'left' as const, width: 260,
      sorter: (a: any, b: any) => String(a?.KeyPairName || a?.name || '').localeCompare(String(b?.KeyPairName || b?.name || '')),
      render: (_: any, r: any) => <Typography.Text strong ellipsis={{ tooltip: r?.KeyPairName || r?.name }}>{r?.KeyPairName || r?.name || '-'}</Typography.Text>,
    },
    {
      title: '指纹', key: 'fp',
      render: (_: any, r: any) => {
        const fp = r?.KeyPairFingerPrint || r?.fingerprint || '-';
        return fp !== '-' ? <Typography.Text type="secondary" copyable={{ text: fp }} ellipsis={{ tooltip: fp }}>{fp}</Typography.Text> : '-';
      },
    },
    {
      title: '创建时间', key: 'ctime', width: 170,
      render: (_: any, r: any) => {
        const t = r?.CreationTime;
        if (!t) return '-';
        try { return new Date(t).toLocaleString('zh-CN', { hour12: false }); } catch { return t; }
      },
    },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 80,
      render: (_: any, r: any) => (
        <RowActionsButton
          items={[{ key: 'del', label: '删除', danger: true }]}
          onClick={({ key }: { key: string }) => { if (key === 'del') handleDelete(r); }}
        />
      ),
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
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r: any) => r?.KeyPairName || r?.name}
        dataSource={filtered}
        columns={columns as any}
        loading={loading}
        scroll={{ x: true }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal title="创建密钥对" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={submitCreate} confirmLoading={submitting} okText="创建" cancelText="取消" destroyOnClose>
        <Form form={createForm} layout="vertical">
          <Form.Item name="keyPairName" label="密钥对名称" rules={[{ required: true, message: '请输入名称' }, { pattern: /^[a-zA-Z][\w.:-]{1,127}$/, message: '需字母开头，可含数字、._:-，2-128 位' }]}>
            <Input placeholder="如 my-keypair" allowClear />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="导入密钥对" open={importOpen} onCancel={() => setImportOpen(false)} onOk={submitImport} confirmLoading={submitting} okText="导入" cancelText="取消" destroyOnClose>
        <Form form={importForm} layout="vertical">
          <Form.Item name="keyPairName" label="密钥对名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 my-keypair" allowClear />
          </Form.Item>
          <Form.Item name="publicKeyBody" label="公钥内容" rules={[{ required: true, message: '请粘贴公钥内容' }]}>
            <Input.TextArea rows={5} placeholder="ssh-rsa AAAA..." />
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <KeyOutlined />;
export const Label = 'SSH 密钥对';
export default KeyPairsSectionAliyun;
