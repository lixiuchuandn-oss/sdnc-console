/**
 * Harvester - 镜像 (Image) 列表 Section
 * frontend/src/pages/Clouds/Harvester/sections/ImagesSection.tsx
 *
 * === 功能描述 ===
 * 负责展示和管理 Harvester 集群中的虚拟机镜像资源。
 * 核心功能包括：
 * 1. 列表展示: 展示镜像名称、大小、状态、进度等信息。
 * 2. 镜像导入: 支持通过 URL 下载导入镜像，或使用“Cloudmap 直传工具”上传。
 * 3. 资源操作: 支持镜像的删除、编辑、查看详情。
 *
 * === 核心逻辑 ===
 * 1. [状态映射]:
 *    - 将后端状态 (Imported, Downloading, Failed 等) 映射为中文描述和 Antd Badge 颜色。
 *    - 特别处理下载进度展示 (Progress)，实时反馈导入状态。
 * 2. [创建流程]:
 *    - 提供 URL 导入和工具上传两种模式的 Tab 切换。
 *    - URL 导入时，需选择目标 StorageClass，并校验 URL 格式。
 * 3. [详情抽屉]:
 *    - 点击行支持打开 `HarvesterResourceDrawer`，展示镜像的 YAML 和 Events。
 *    - 在打开抽屉前，自动补全 `kind: VirtualMachineImage` 以适配通用抽屉逻辑。
 *
 * === 交互依赖 ===
 * - 上游: 依赖 `CloudDetailHarvester` 传入 `images` 列表。
 * - 下游: 调用 `createHarvesterImage`, `deleteHarvesterImage` 等 API。
 * - 外部: 依赖 `fetchHarvesterStorageClasses` 获取存储类选项。
 */
import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Button, message, Form, Dropdown, Descriptions, Modal, Row, Col, Tabs, Typography, Steps, Alert, Card } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { EllipsisOutlined, ReloadOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettings from '../../../../components/TableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { API_BASE_URL } from '../../../../services/api';
import { deleteHarvesterImage, createHarvesterImage, fetchHarvesterStorageClasses } from '../../../../services/harvesterApi';
import { isSystemNamespace, isPublicNamespace } from '../../../../utils/harvesterUtils';
import { OsIcon, getOsKeywordGroups } from '../../../../components/OsIcon';

/**
 * 组件入参说明
 * - cloudId: 当前云 ID，用于调用 Harvester 镜像相关 API
 * - images: 镜像列表（可能为原始对象或带 rawData 的包装对象）
 * - loading: 外层传入的加载状态
 * - onRefresh: 刷新回调，支持传入 force=true 强制从后端同步
 */
type Props = {
  cloudId: string;
  images: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;

  isTenant?: boolean;
};

const ImagesSection: React.FC<Props> = ({ cloudId, images, loading, onRefresh, isTenant = false }) => {
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [osFilter, setOsFilter] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<string>(''); // all | public | private
  // 创建镜像弹窗状态
  const [creating, setCreating] = useState<boolean>(false);
  // 批量选择的行 key
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  // 创建表单实例
  const [form] = Form.useForm();
  // 创建方式 Tab：URL 导入 / 直传工具说明
  const [createTab, setCreateTab] = useState<'url'|'tool'>('url');
  
  // 存储类列表，用于 URL 导入时选择目标存储类
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [scLoading, setScLoading] = useState(false);

  // 抽屉状态，用于展示镜像的 Harvester 详情与事件等
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

  const handleOpenOpsinfo = async (record: any, tab: string = 'detail') => {
    // Ensure kind is present for Events tab
    const r = { ...record, kind: record.kind || 'VirtualMachineImage' };
    setCurrentRecord(r);
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

  /**
   * 将镜像状态英文 key 转为中文描述
   */
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
  /**
   * 状态 Badge 渲染：根据状态选择不同颜色和中文文案
   */
  const statusBadge = (s?: string) => {
    const k = String(s || '').toLowerCase();
    const text = cnStatus(s);
    const color = (function(){
      if (k === 'ready') return 'green';
      if (k === 'failed') return 'red';
      if (k === 'imported') return 'success';
      if (k === 'downloading') return 'blue';
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
  const resolveImageKind = (img: any): 'iso' | 'disk' | 'unknown' => {
    const labels = img?.metadata?.labels || {};
    const typeLabel = String(labels['harvesterhci.io/image-type'] || '').toLowerCase();
    if (typeLabel === 'iso') return 'iso';
    if (['raw_qcow2', 'qcow2', 'raw'].includes(typeLabel)) return 'disk';
    const diskFormat = String(img?.spec?.diskFormat || img?.diskFormat || '').toLowerCase();
    if (diskFormat === 'iso') return 'iso';
    if (['qcow2', 'raw'].includes(diskFormat)) return 'disk';
    const disp = String(
      labels['harvesterhci.io/imageDisplayName'] ||
      img?.metadata?.name ||
      img?.name ||
      ''
    ).toLowerCase();
    if (/\.(iso)$/.test(disp)) return 'iso';
    if (/\.(qcow2|img|raw)$/.test(disp)) return 'disk';
    return 'unknown';
  };
  const KEYWORD_GROUPS = getOsKeywordGroups();
  const expandOsKeywords = (val: string) => {
    const v = (val || '').toLowerCase();
    const g = KEYWORD_GROUPS.find((gr: string[]) => gr.includes(v));
    return g ? g : (v ? [v] : []);
  };

  const getId = (r: any): string => String(r?.name || r?.metadata?.name || '');
  const getNs = (r: any): string => String(r?.namespace || r?.metadata?.namespace || 'default');

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    const osKey = osFilter.trim().toLowerCase();
    return (Array.isArray(images) ? images : []).filter((r:any) => {
      const name = String(
        r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || ''
      ).toLowerCase();
      const id = String(r?.name || r?.metadata?.name || '').toLowerCase();
      const ns = getNs(r);
      
      // [系统资源过滤]
      // 租户模式: 严格隔离，禁止查看系统命名空间，但允许查看公共命名空间 (harvester-public)
      if (isTenant) {
        if (isSystemNamespace(ns) && !isPublicNamespace(ns)) return false;
      } else {
        // 管理员模式: 默认不过滤，或根据其他逻辑过滤
      }

      // Scope Filter
      if (scopeFilter === 'public' && !isPublicNamespace(ns)) return false;
      
      if (scopeFilter === 'private') {
        // Private: 非公共且非系统
        if (isPublicNamespace(ns) || isSystemNamespace(ns)) return false;
      }

      if (kw && !(name.includes(kw) || id.includes(kw))) return false;
      const key = String((typeof r?.status === 'string' ? r.status : (r?.status?.phase || r?.status?.status)) || '').toLowerCase();
      if (st && key !== st) return false;
      const kind = resolveImageKind(r);
      if (kind === 'unknown') return false; // Filter out unknown images
      if (typeFilter && kind !== typeFilter) return false;
      if (osKey) {
        const osLabel = String(r?.metadata?.labels?.['harvesterhci.io/os'] || '').toLowerCase();
        const iconName = String(r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || r?.metadata?.name || r?.name || '').toLowerCase();
        const keys = expandOsKeywords(osKey);
        if (!keys.some(k => osLabel.includes(k) || iconName.includes(k))) return false;
      }
      return true;
    });
  }, [images, keyword, statusFilter, typeFilter, osFilter, scopeFilter]);

  const statusOptions = ['imported','pending','downloading','ready','failed','unknown'];
  const osOptions = [
    { value: '', label: '全部' },
    { value: 'windows', label: 'Windows' },
    { value: 'ubuntu', label: 'Ubuntu' },
    { value: 'centos', label: 'CentOS' },
    { value: 'debian', label: 'Debian' },
    { value: 'redhat', label: 'RedHat/RHEL' },
    { value: 'rhel', label: 'RedHat/RHEL' },
    { value: 'fedora', label: 'Fedora' },
    { value: 'suse', label: 'SUSE/openSUSE/SLES' },
    { value: 'opensuse', label: 'SUSE/openSUSE/SLES' },
    { value: 'sles', label: 'SUSE/openSUSE/SLES' },
    { value: 'android', label: 'Android' },
    { value: 'freebsd', label: 'FreeBSD' },
    { value: 'kylin', label: '麒麟' },
    { value: 'neokylin', label: '中标麒麟' },
    { value: 'uos', label: 'UOS' },
    { value: 'openeuler', label: 'openEuler' },
    { value: 'anolis', label: 'Anolis' },
  ];
  
  /**
   * 安全读取镜像属性的工具方法
   * 统一封装 name / uid / os / 架构等常用字段的多来源兜底逻辑
   */
  const SafeRead = {
    name: (r: any) =>
      r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || '-',
    uid: (r: any) => r?.metadata?.uid || r?.id || r?.metadata?.name || r?.name || '',
    os: (r: any) => r?.metadata?.labels?.['harvesterhci.io/os'] || '',
    kernel: (r: any) => '', 
    arch: (r: any) => r?.metadata?.labels?.['harvesterhci.io/architecture'] || '',
  };

  /**
   * 批量删除已选镜像
   * - 根据 selectedKeys 从 images 中反查目标对象
   * - 针对每个镜像调用删除接口，并统计成功/失败数量
   */
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

  /**
   * 表格列定义
   * - 显示名称列可点击打开 Harvester 资源详情抽屉
   * - 操作列包含：详情、下载、删除三种操作
   */
  const allColumns = useMemo(() => [
    { title: '镜像名称', key: 'display_name', render: (_:any, r:any)=> {
        const labelDisp = r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'];
        const disp = labelDisp || '-';
        const nameForIcon = labelDisp || r?.name || r?.metadata?.name || '';
        return (
          <span>
            <OsIcon osName={nameForIcon} style={{ marginRight: 8, fontSize: 16 }} />
            {disp}
          </span>
        );
    } },
    { title: '镜像ID', key: 'resource_name', render: (_:any, r:any)=> <span className="text-secondary">{r?.name || r?.metadata?.name || '-'}</span> },
    { title: '命名空间', key: 'namespace', render: (_:any, r:any)=> getNs(r) },
    { title: '作用域', key: 'scope', render: (_:any, r:any)=> isPublicNamespace(getNs(r)) ? '公共镜像' : '私有镜像' },
    { title: '状态', key: 'status', render: (_:any, r:any)=> statusBadge(typeof r?.status === 'string' ? r.status : (r?.status?.phase || r?.status?.status || 'Unknown')) },
    { title: '镜像类型', key: 'image_kind', render: (_:any, r:any)=> {
        const kind = resolveImageKind(r);
        const text = kind === 'iso' ? 'ISO' : kind === 'disk' ? 'Qcow2' : '未知';
        const color = kind === 'iso' ? 'pink' : kind === 'disk' ? 'blue' : undefined;
        return <Tag color={color}>{text}</Tag>;
    } },
    { title: '虚拟大小', key: 'vsize', render: (_:any, r:any)=> gbText(r?.virtualSize ?? r?.status?.virtualSize) },
    { title: '存储类', key: 'sc', render: (_:any, r:any)=> r?.storageClassName || r?.spec?.storageClassName || r?.status?.storageClassName || '-' },
    { title: '创建时间', key: 'created_at', render: (_:any, r:any)=> {
        const t = r?.metadata?.creationTimestamp || r?.createdAt;
        return t ? new Date(t).toLocaleString() : '-';
    } },
    { title: '操作', key: 'actions', width: 80, align: 'left' as const, fixed: 'right' as const, render: (_:any, r:any)=> {
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
            ...(!isTenant ? [{ key: 'opsinfo', label: '运维信息', onClick: () => handleOpenOpsinfo(r, 'detail') }] : []),
            { key: 'download', label: '下载镜像', disabled: !download, onClick: handleDownload },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, onClick: () => Modal.confirm({ title: `删除 ${name}?`, onOk: handleDelete }) },
          ]} 
        />
      );
    } },
  ], [cloudId, onRefresh, isTenant]);

  const [tableColumns, setTableColumns] = useState<any[]>(allColumns);

  /**
   * 处理 URL 导入镜像的创建逻辑
   * - 使用 StdFormModal 自带的校验流程
   * - 创建成功后刷新列表并关闭弹窗
   */
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
          <Input allowClear placeholder="关键字" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} value={keyword} onChange={(e)=>setKeyword(e.target.value)} className="toolbar-search" />
          <Select
            allowClear
            placeholder="作用域"
            value={scopeFilter || undefined}
            onChange={(v)=> setScopeFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { value: '', label: '全部' },
              { value: 'public', label: '公共镜像' },
              { value: 'private', label: '私有镜像' },
            ]}
          />
          <Select
            allowClear
            placeholder="镜像状态"
            value={statusFilter || undefined}
            onChange={(v)=> setStatusFilter(v || '')}
            className="toolbar-filter-sm"
            options={[{ value: '', label: '全部' }, ...statusOptions.map(k=> ({ value: k, label: cnStatus(k) }))]}
          />
          <Select
            allowClear
            placeholder="镜像类型"
            value={typeFilter || undefined}
            onChange={(v)=> setTypeFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { value: '', label: '全部' },
              { value: 'iso', label: 'ISO' },
              { value: 'disk', label: 'Qcow2' },
            ]}
          />
          <Select
            allowClear
            placeholder="操作系统类型"
            value={osFilter || undefined}
            onChange={(v)=> setOsFilter(v || '')}
            className="toolbar-filter-sm"
            options={osOptions}
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
                  <Form.Item label="镜像名称" name="displayName" rules={[{ required: true }]}> 
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
                        description: '运行工具后，选择目标命名空间，填写镜像名称（如 ubuntu-20.04）。'
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
        className={!isTenant ? "std-table" : "std-table no-border"}
        bordered={!isTenant}
        rowKey={(r:any)=> getId(r)}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{
          size: 'small',
          showQuickJumper: false,
          showSizeChanger: true,
        }}
        scroll={{ x: 'max-content' }}
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
