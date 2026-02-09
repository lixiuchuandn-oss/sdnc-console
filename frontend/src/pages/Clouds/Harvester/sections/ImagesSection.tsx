import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button, message, Form, Dropdown, Descriptions, Modal, Row, Col, Tabs, Typography, Steps, Alert, Card } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { EllipsisOutlined, ReloadOutlined, DownloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterResourceDrawer';
import { API_BASE_URL } from '../../../../services/api';
import { deleteHarvesterImage, createHarvesterImage, fetchHarvesterStorageClasses } from '../../../../services/harvesterApi';

type Props = {
  cloudId: string;
  images: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
};

const ImagesSection: React.FC<Props> = ({ cloudId, images, loading, onRefresh }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [form] = Form.useForm();
  const [createTab, setCreateTab] = useState<'url'|'tool'>('url');
  
  // Storage Classes
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [scLoading, setScLoading] = useState(false);

  // Drawer State
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');

  React.useEffect(() => {
    if (creating && cloudId) {
      setScLoading(true);
      fetchHarvesterStorageClasses(cloudId).then((res: any) => {
        const items = res?.data?.items || res?.data || [];
        setStorageClasses(Array.isArray(items) ? items : []);
      }).catch(console.error).finally(() => setScLoading(false));
    }
  }, [creating, cloudId]);

  const handleOpenDrawer = async (record: any, tab: string = 'detail') => {
    // Ensure kind is present for Events tab
    const r = { ...record, kind: record.kind || 'VirtualMachineImage' };
    setCurrentRecord(r);
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

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
      const key = String((typeof r?.status === 'string' ? r.status : (r?.status?.phase || r?.status?.status)) || '').toLowerCase();
      if (st && key !== st) return false;
      return true;
    });
  }, [images, keyword, statusFilter]);
  const statusOptions = ['imported','pending','downloading','ready','failed','unknown'];
  
  const SafeRead = {
    name: (r: any) => r?.spec?.displayName || r?.displayName || r?.metadata?.name || r?.name || '',
    uid: (r: any) => r?.metadata?.uid || r?.id || r?.metadata?.name || r?.name || '',
    os: (r: any) => r?.metadata?.labels?.['harvesterhci.io/os'] || '',
    kernel: (r: any) => '', 
    arch: (r: any) => r?.metadata?.labels?.['harvesterhci.io/architecture'] || '',
  };

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
          onRefresh?.(true);
        } catch (e: any) {
          message.error(e?.message || '批量删除失败');
        }
      }
    });
  };

  const allColumns = useMemo(() => [
    { title: '显示名称', key: 'display_name', render: (_:any, r:any)=> (
        <a onClick={() => handleOpenDrawer(r)}>{r?.displayName || r?.spec?.displayName || r?.spec?.name || '-'}</a>
    ) },
    { title: '资源名称', key: 'resource_name', render: (_:any, r:any)=> <span className="text-secondary">{r?.name || r?.metadata?.name || '-'}</span> },
    { title: '状态', key: 'status', render: (_:any, r:any)=> statusBadge(typeof r?.status === 'string' ? r.status : (r?.status?.phase || r?.status?.status || 'Unknown')) },
    { title: '虚拟大小', key: 'vsize', render: (_:any, r:any)=> gbText(r?.virtualSize ?? r?.status?.virtualSize) },
    { title: '文件大小', key: 'size', render: (_:any, r:any)=> gbText(r?.size ?? r?.status?.size ?? r?.spec?.size ?? r?.status?.downloadedBytes) },
    { title: '存储类', key: 'sc', render: (_:any, r:any)=> r?.storageClassName || r?.spec?.storageClassName || r?.status?.storageClassName || '-' },
    { title: '操作', key: 'actions', width: 80, fixed: 'right' as const, render: (_:any, r:any)=> {
      const name = r?.name || r?.metadata?.name || '';
      const ns = getNs(r);
      const links = r?.links || {};
      const download = links?.download || '';

      const handleDownload = () => { if (download) window.open(download, '_blank'); };
      const handleDelete = async () => { 
          if (name) { 
              try {
                  await deleteHarvesterImage(cloudId, ns, name); 
                  message.success('删除成功'); 
                  onRefresh?.(); 
              } catch (e: any) {
                  message.error(e?.message || '删除失败');
              }
          } 
      };

      return (
        <ResourceActionsDropdown 
          buttonProps={{ className: 'row-actions-trigger' }}
          items={[
            { key: 'detail', label: '查看摘要', onClick: () => handleOpenDrawer(r, 'detail') },
            { key: 'events', label: '操作记录', onClick: () => handleOpenDrawer(r, 'events') },
            { type: 'divider' },
            { key: 'download', label: '下载镜像', disabled: !download, onClick: handleDownload },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, onClick: () => Modal.confirm({ title: `删除 ${name}?`, onOk: handleDelete }) },
          ]} 
        />
      );
    } },
  ], [cloudId, onRefresh]);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);

  const handleCreate = async () => {
    try {
      const v = await form.validateFields();
      await createHarvesterImage(cloudId, {
        namespace: v.namespace || 'default',
        name: v.name || undefined,
        displayName: v.displayName || undefined,
        sourceType: v.sourceType || undefined,
        url: v.url || undefined,
        targetStorageClassName: v.storageClassName || undefined,
        storageClassParameters: v.storageClassParameters || {}
      });
      message.success('创建成功');
      setCreating(false);
      onRefresh?.(true);
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    }
  };

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="关键字" value={keyword} onChange={(e)=>setKeyword(e.target.value)} className="toolbar-search" />
          <Select
            allowClear
            placeholder="镜像状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            className="toolbar-filter"
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
          <TableColumnSettings 
            columns={allColumns} 
            onChange={setTableColumns}
            settingsKey="harvester_images_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} loading={loading} />
        </>
      )}
    >
      <StdFormModal
        open={creating}
        title="新增镜像"
        onCancel={() => setCreating(false)}
        onFinish={createTab==='url' ? handleCreate : ()=> setCreating(false)}
        form={form}
        okText={createTab==='url' ? '创建' : '关闭'}
        width={600}
      >
        <Tabs
          activeKey={createTab}
          onChange={(k)=> {
            const key = (k as 'url'|'tool');
            setCreateTab(key);
            if (key === 'url') form.setFieldsValue({ sourceType: 'download' });
          }}
          items={[
            {
              key: 'url',
              label: 'URL 导入（集群拉取）',
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label="命名空间" name="namespace" rules={[{ required: true }]}>
                        <Select options={[{ label:'default', value:'default' }]} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label="来源类型" name="sourceType" rules={[{ required: true }]}> 
                        <Select options={[{label:'下载URL',value:'download'}]} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item label="显示名称" name="displayName" rules={[{ required: true }]}> 
                    <Input placeholder="如：ubuntu_20.04_200G.qcow2" />
                  </Form.Item>
                  <Form.Item label="资源名称" name="name" tooltip="可选，不填自动生成 image-*"> 
                    <Input placeholder="可选，不填自动生成" />
                  </Form.Item>
                  <Form.Item 
                    label="下载地址" 
                    name="url" 
                    dependencies={["sourceType"]} 
                    rules={[{ 
                      validator: async (_, v)=> { 
                        const t = form.getFieldValue('sourceType'); 
                        if (t!=='download') return Promise.resolve(); 
                        if (!v || !/^https?:\/\//i.test(String(v))) return Promise.reject('请输入合法的 http(s) 链接'); 
                        return Promise.resolve(); 
                      } 
                    }]}
                  > 
                    <Input placeholder="http(s)://..." />
                  </Form.Item>
                  <Form.Item label="存储类" name="storageClassName"> 
                    <Select 
                        loading={scLoading}
                        options={storageClasses.map(sc => ({ label: sc.name, value: sc.name }))}
                        placeholder="请选择存储类 (可选)"
                        allowClear
                        style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Typography.Paragraph type="secondary">
                    说明：URL 导入由 Cloudmap 集群侧自行下载，适合大文件与不稳定网络。请确保链接可被集群访问。
                  </Typography.Paragraph>
                </>
              )
            },
            {
              key: 'tool',
              label: '内网直传（传输工具）',
              children: (
                <div style={{ padding: '0 8px' }}>
                  <Alert
                    message="方案说明"
                    description="使用“Cloudmap 镜像直传工具”在内网将本地文件直接上传到 Cloudmap 集群，无需经过中间跳转，速度更快且支持断点续传。"
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                  />
                  
                  <Steps
                    direction="vertical"
                    size="small"
                    current={-1}
                    items={[
                      {
                        title: '下载工具',
                        description: (
                          <div style={{ marginTop: 8, marginBottom: 8 }}>
                             <Button type="primary" icon={<DownloadOutlined />} href={`${API_BASE_URL}/api/tools/cloudmap-uploader.exe`} download="CloudmapUploader.exe">
                               下载 CloudmapUploader.exe
                             </Button>
                             <div style={{ marginTop: 4, color: '#888', fontSize: 12 }}>
                               支持 Windows (x64) 平台，无需安装直接运行
                             </div>
                          </div>
                        )
                      },
                      {
                        title: '填写信息',
                        description: '运行工具后，选择目标命名空间，填写镜像显示名称（如 ubuntu-20.04）。'
                      },
                      {
                        title: '连接集群',
                        description: '填写 Cloudmap 地址与 Token 进行身份验证。'
                      },
                      {
                        title: '上传文件',
                        description: '选择本地镜像文件（ISO/QCOW2），点击“开始上传”。'
                      }
                    ]}
                  />

                  <Card size="small" title="高级用法：命令行模式" style={{ marginTop: 16, background: '#f9f9f9' }} bodyStyle={{ padding: '8px 12px' }}>
                     <Typography.Paragraph style={{ marginBottom: 4, fontFamily: 'monospace', fontSize: 12 }} copyable>
                       CloudmapUploader.exe --direct --url=https://10.x.x.x --token=... --name=ubuntu-20.04 --file=./image.iso
                     </Typography.Paragraph>
                     <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                       提示：在命令行运行工具可查看完整参数说明，适合脚本集成。
                     </Typography.Text>
                  </Card>
                </div>
              )
            }
          ]}
        />
      </StdFormModal>
      <Table
        className="std-table"
        bordered
        rowKey={(r:any)=> r?.name || r?.metadata?.name}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys)=> setSelectedKeys(keys),
          getCheckboxProps: (r:any)=> ({ disabled: !getId(r) })
        }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{ size: 'small'}}
      />
      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        resourceType="Image"
        record={currentRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
    </PageDetailSection>
  );
};

export default ImagesSection;
