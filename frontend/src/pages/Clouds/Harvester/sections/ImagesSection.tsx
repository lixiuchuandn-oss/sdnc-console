import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button, message, Modal, Form, Dropdown } from 'antd';
import { EllipsisOutlined, SettingOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../components/PageDetailSection';
import { deleteHarvesterImage, createHarvesterImage } from '../../../../services/api';

type Props = {
  cloudId: string;
  images: any[];
  loading: boolean;
  onRefresh?: () => void;
};

const ImagesSection: React.FC<Props> = ({ cloudId, images, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [form] = Form.useForm();

  const cnStatus = (s?: string): string => {
    const k = String(s || '').toLowerCase();
    const m: Record<string, string> = {
      imported: '已导入',
      pending: '等待',
      downloading: '下载中',
      ready: '就绪',
      failed: '失败',
      unknown: '未知'
    };
    return m[k] || (s || '-')
  };
  const statusBadge = (s?: string) => {
    const k = String(s || '').toLowerCase();
    const text = cnStatus(s);
    const color = (function(){
      if (k === 'ready') return 'green';
      if (k === 'failed') return 'red';
      if (k === 'downloading' || k === 'imported') return 'blue';
      if (k === 'pending') return 'gold';
      return undefined;
    })();
    return <Tag color={color}>{text}</Tag>;
  };
  const gbText = (bytes?: number | string): string => {
    const n = typeof bytes === 'number' ? bytes : (typeof bytes === 'string' ? Number(bytes) : NaN);
    if (!isFinite(n) || n <= 0) return '-';
    const gb = n / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)}GB`;
  };
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    return (Array.isArray(images) ? images : []).filter((r:any) => {
      const name = String(r?.displayName || r?.spec?.displayName || r?.spec?.name || '').toLowerCase();
      const id = String(r?.name || r?.metadata?.name || '').toLowerCase();
      if (kw && !(name.includes(kw) || id.includes(kw))) return false;
      const key = String(r?.status || r?.status?.phase || r?.status?.status || '').toLowerCase();
      if (st && key !== st) return false;
      return true;
    });
  }, [images, keyword, statusFilter]);
  const statusOptions = ['imported','pending','downloading','ready','failed','unknown'];
  const getId = (r: any): string => String(r?.name || r?.metadata?.name || '');
  const getNs = (r: any): string => String(r?.namespace || r?.metadata?.namespace || 'default');
  const batchDelete = async () => {
    if (!Array.isArray(images) || selectedKeys.length === 0) return;
    Modal.confirm({
      title: '确认批量删除所选镜像？',
      onOk: async () => {
        try {
          const map = new Map<string, any>();
          for (const r of (images || [])) map.set(getId(r), r);
          const targets = selectedKeys.map(k => map.get(String(k))).filter(Boolean);
          if (targets.length === 0) { message.warning('未找到可删除的镜像'); return; }
          const results = await Promise.all(targets.map(async (r: any) => {
            const ns = getNs(r); const name = getId(r);
            try { await deleteHarvesterImage(cloudId, ns, name); return { ok: true, name }; }
            catch (e: any) { return { ok: false, name, err: e?.message || String(e) }; }
          }));
          const ok = results.filter(x => x.ok).length;
          const fail = results.filter(x => !x.ok);
          if (ok > 0) message.success(`删除成功 ${ok} 条`);
          if (fail.length > 0) message.error(`删除失败 ${fail.length} 条：${fail.map(f=>f.name).join(', ')}`);
          setSelectedKeys([]);
          onRefresh?.();
        } catch (e: any) {
          message.error(e?.message || '批量删除失败');
        }
      }
    });
  };
  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e)=>setKeyword(e.target.value)} style={{ width: 240 }} />
          <Select
            allowClear
            placeholder="镜像状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            style={{ width: 200 }}
            options={[{ value: '', label: '全部' }, ...statusOptions.map(k=> ({ value: k, label: cnStatus(k) }))]}
          />
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" onClick={()=> { form.resetFields(); setCreating(true); }}>新增镜像</Button>
          <Dropdown
            menu={{
              items: [
                { type: 'divider' },
                { key: 'batchDelete', label: '批量删除', disabled: selectedKeys.length === 0 },
              ],
              onClick: ({ key }) => { if (key === 'batchDelete') batchDelete(); },
            }}
          >
            <Button icon={<EllipsisOutlined />} />
          </Dropdown>
          <Button icon={<SettingOutlined />} />
          <Button icon={<ReloadOutlined />} onClick={onRefresh} />
        </>
      )}
    >
      <Modal open={creating} onCancel={()=> setCreating(false)} onOk={async()=>{ try { const v = await form.validateFields(); await createHarvesterImage(cloudId, { namespace: v.namespace || 'default', name: v.name || undefined, displayName: v.displayName || undefined, sourceType: v.sourceType || undefined, url: v.url || undefined, targetStorageClassName: v.storageClassName || undefined, storageClassParameters: v.storageClassParameters || {} }); message.success('创建成功'); setCreating(false); onRefresh?.(); } catch(e:any){ message.error(e?.message || '创建失败'); } }} okText="提交" cancelText="取消" title="新增镜像" destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ namespace: 'default', sourceType: 'download' }}>
          <Form.Item label="命名空间" name="namespace" rules={[{ required: true }]}>
            <Select options={[{ label:'default', value:'default' }]} />
          </Form.Item>
          <Form.Item label="显示名称" name="displayName" rules={[{ required: true }]}> 
            <Input placeholder="如：ubuntu_20.04_200G.qcow2" />
          </Form.Item>
          <Form.Item label="资源名称" name="name"> 
            <Input placeholder="可选，不填自动生成 image-*" />
          </Form.Item>
          <Form.Item label="来源类型" name="sourceType" rules={[{ required: true }]}> 
            <Select options={[{label:'下载URL',value:'download'},{label:'上传文件',value:'upload'}]} />
          </Form.Item>
          <Form.Item label="下载地址" name="url" dependencies={["sourceType"]} rules={[{ validator: async (_, v)=> { const t = form.getFieldValue('sourceType'); if (t!=='download') return Promise.resolve(); if (!v || !/^https?:\/\//i.test(String(v))) return Promise.reject('请输入合法的 http(s) 链接'); return Promise.resolve(); } }]}> 
            <Input placeholder="http(s)://..." />
          </Form.Item>
          <Form.Item label="存储类" name="storageClassName"> 
            <Input placeholder="如：longhorn 或 longhorn-image-xxxx" />
          </Form.Item>
        </Form>
      </Modal>
      <Table
        className="kv-section-table"
        bordered
        rowKey={(r:any)=> r?.name || r?.metadata?.name}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys)=> setSelectedKeys(keys),
          getCheckboxProps: (r:any)=> ({ disabled: !getId(r) })
        }}
        columns={[
          { title: '镜像名称 / ID', key: 'nameid', render: (_:any, r:any)=> { const name=(r?.displayName || r?.spec?.displayName || r?.spec?.name || '-'); const id=(r?.name || r?.metadata?.name || '-'); return (<div><div>{name}</div><div style={{ color:'#999' }}>{id}</div></div>); } },
          { title: '状态', key: 'status', render: (_:any, r:any)=> statusBadge(r?.status || r?.status?.phase || r?.status?.status) },
          { title: '虚拟大小（GB）', key: 'vsize', render: (_:any, r:any)=> gbText(r?.virtualSize ?? r?.status?.virtualSize) },
          { title: '文件大小（GB）', key: 'size', render: (_:any, r:any)=> gbText(r?.size ?? r?.status?.size ?? r?.spec?.size ?? r?.status?.downloadedBytes) },
          { title: '存储类', key: 'sc', render: (_:any, r:any)=> r?.storageClassName || r?.spec?.storageClassName || r?.status?.storageClassName || '-' },
          { title: '操作', key: 'actions', render: (_:any, r:any)=> {
            const name = r?.name || r?.metadata?.name || '';
            const ns = getNs(r);
            const links = r?.links || {};
            const view = links?.view || '';
            const download = links?.download || '';
            const items = [
              { key: 'view', label: '查看', disabled: !view },
              { key: 'download', label: '下载', disabled: !download },
              { key: 'delete', label: <span style={{ color: '#ff4d4f' }}>删除</span>, disabled: !name },
            ];
            return (
              <RowActionsButton
                items={items}
                onClick={async ({ key }: { key: string }) => {
                  try {
                    if (key === 'view' && view) { window.open(view, '_blank'); return; }
                    if (key === 'download' && download) { window.open(download, '_blank'); return; }
                    if (key === 'delete' && name) { await deleteHarvesterImage(cloudId, ns, name); message.success('删除成功'); onRefresh?.(); return; }
                  } catch (e: any) {
                    message.error(e?.message || '操作失败');
                  }
                }}
              />
            );
          } },
        ] as any}
        dataSource={filtered}
        loading={loading}
        pagination={{ showSizeChanger:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
      />
    </PageDetailSection>
  );
};

export default ImagesSection;
