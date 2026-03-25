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
 *    - 标准模式：内网直传与 URL 导入两个 Tab（前者优先）；URL 导入需选择目标 StorageClass 并校验链接。
 *    - 简易模式：仅展示内网直传说明，不展示 Tab。
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
import { Table, Input, Select, Tag, Button, message, Form, Dropdown, Descriptions, Modal, Row, Col, Tabs, Typography, Steps, Alert, Card, Tooltip } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { EllipsisOutlined, ReloadOutlined, DownloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { API_BASE_URL } from '../../../../services/api';
import { getToken } from '../../../../utils/tokenStorage';
import { deleteHarvesterImage, createHarvesterImage, fetchHarvesterStorageClasses } from '../../../../services/harvesterApi';
import { isSystemNamespace, isPublicNamespace, isSystemStorageClass } from '../../../../utils/harvesterUtils';
import { OsIcon, getOsKeywordGroups } from '../../../../components/OsIcon';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

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
  onRefresh?: (force?: boolean, silent?: boolean) => void;

  isTenant?: boolean;
  mode?: 'standard' | 'simple';
  bordered?: boolean;
};

const ImagesSection: React.FC<Props> = ({ cloudId, images, loading, onRefresh, isTenant = false, mode = 'standard', bordered = true }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasImagesWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.images:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureImagesWrite = () => {
    if (hasImagesWrite) return true;
    message.error('当前账号没有镜像操作权限（需要 clouds.images:write 或 clouds:write 权限）');
    return false;
  };

  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>(''); // 默认不过滤，显示所有类型
  const [osFilter, setOsFilter] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<string>(''); // all | public | private
  // 创建镜像弹窗状态
  const [creating, setCreating] = useState<boolean>(false);
  // 批量选择的行 key
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  // 创建表单实例
  const [form] = Form.useForm();
  // 创建方式 Tab：内网直传 / URL 导入（标准模式可切换；简易模式仅直传）
  const [createTab, setCreateTab] = useState<'url'|'tool'>('tool');
  
  // 存储类列表，用于 URL 导入时选择目标存储类
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [scLoading, setScLoading] = useState(false);

  // 抽屉状态，用于展示镜像的 Harvester 详情与事件等
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [uploaderDownloading, setUploaderDownloading] = useState(false);

  React.useEffect(() => {
    if (creating && cloudId) {
      setScLoading(true);
      fetchHarvesterStorageClasses(cloudId).then((res: any) => {
        const raw = res?.data?.items ?? res?.items ?? res?.data;
        setStorageClasses(Array.isArray(raw) ? raw : []);
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
    // 优先检查 sourceType
    const sourceType = String(img?.spec?.sourceType || '').toLowerCase();
    
    // 从卷导出的镜像默认为 disk 类型
    if (sourceType === 'export-from-volume') return 'disk';
    
    // 如果 spec 中没有 sourceType，但存在 pvcName 或 pvcNamespace，说明是从卷导出的镜像
    if (img?.spec?.pvcName || img?.spec?.pvcNamespace) return 'disk';
    
    // 如果 spec 字段缺失，尝试从 managedFields 判断（Harvester API 返回的数据可能不包含完整 spec）
    // 检查 storageClassName 是否包含 "image-" 前缀（从卷导出的镜像通常会有这样的存储类）
    const storageClassName = String(img?.storageClassName || img?.spec?.storageClassName || img?.status?.storageClassName || '').toLowerCase();
    if (storageClassName.includes('image-') && storageClassName.includes('longhorn')) {
      // 从卷导出的镜像，存储类通常是 longhorn-image-{name} 格式
      return 'disk';
    }
    
    // 本地上传和URL导入的镜像，根据文件名或URL推断类型
    if (sourceType === 'upload' || sourceType === 'download') {
      const disp = String(
        img?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
        img?.spec?.displayName ||
        img?.metadata?.name ||
        img?.name ||
        ''
      ).toLowerCase();
      const url = String(img?.spec?.url || '').toLowerCase();
      
      // 检查文件名或URL中是否包含 .iso
      if (/\.(iso)$/.test(disp) || /\.(iso)(\?|$|#)/.test(url)) return 'iso';
      // 检查文件名或URL中是否包含磁盘镜像扩展名
      if (/\.(qcow2|img|raw)$/.test(disp) || /\.(qcow2|img|raw)(\?|$|#)/.test(url)) return 'disk';
      // 如果无法从文件名推断，默认认为是 disk 类型（因为大多数上传/导入的镜像都是磁盘镜像）
      return 'disk';
    }
    
    // 其他情况：检查标签和格式
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
    // 如果没有过滤条件，直接返回所有镜像
    const hasFilters = keyword.trim() || (mode === 'standard' ? statusFilter : '') || typeFilter || osFilter || (mode === 'standard' ? scopeFilter : '');
    if (!hasFilters && !isTenant) {
      return Array.isArray(images) ? images : [];
    }
    
    const kw = keyword.trim().toLowerCase();
    const st = statusFilter.trim().toLowerCase();
    const osKey = osFilter.trim().toLowerCase();
    return (Array.isArray(images) ? images : []).filter((r:any) => {
      const ns = getNs(r);
      
      // [系统资源过滤]
      // 租户模式: 严格隔离，禁止查看系统命名空间，但允许查看公共命名空间 (harvester-public)
      if (isTenant) {
        if (isSystemNamespace(ns) && !isPublicNamespace(ns)) return false;
      }

      // Scope Filter - 只有用户主动选择时才过滤
      if (mode === 'standard' && scopeFilter === 'public' && !isPublicNamespace(ns)) return false;
      if (mode === 'standard' && scopeFilter === 'private') {
        // Private: 非公共且非系统
        if (isPublicNamespace(ns) || isSystemNamespace(ns)) return false;
      }

      // 关键字过滤 - 只有用户输入时才过滤
      // 搜索范围：displayName、spec.displayName、labels中的imageDisplayName、name、namespace
      if (kw) {
        const displayName = String(
          r?.displayName || 
          r?.spec?.displayName || 
          r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || 
          ''
        ).toLowerCase();
        const imageName = String(r?.name || r?.metadata?.name || '').toLowerCase();
        const namespace = String(ns).toLowerCase();
        if (!displayName.includes(kw) && !imageName.includes(kw) && !namespace.includes(kw)) {
          return false;
        }
      }
      
      // 状态过滤 - 只有用户选择时才过滤
      if (mode === 'standard' && st) {
        const stateValue = r?.state || (typeof r?.status === 'string' ? r.status : (r?.status?.phase || r?.status?.status)) || '';
        const key = String(stateValue).toLowerCase();
        if (key !== st) return false;
      }
      
      // 镜像类型过滤 - 只有用户主动选择类型时才过滤
      if (typeFilter) {
        const kind = resolveImageKind(r);
        if (kind !== typeFilter) return false;
      }
      
      // OS过滤 - 只有用户输入时才过滤
      if (osKey) {
        const osLabel = String(r?.metadata?.labels?.['harvesterhci.io/os'] || '').toLowerCase();
        const iconName = String(r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || r?.metadata?.name || r?.name || '').toLowerCase();
        const keys = expandOsKeywords(osKey);
        if (!keys.some(k => osLabel.includes(k) || iconName.includes(k))) return false;
      }
      return true;
    });
  }, [images, keyword, statusFilter, typeFilter, osFilter, scopeFilter, isTenant, mode]);

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
  const getImageAlias = (r: any): string =>
    String(
      r?.displayName ||
      r?.spec?.displayName ||
      r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
      '',
    ).trim();

  /**
   * 批量删除已选镜像
   * - 根据 selectedKeys 从 images 中反查目标对象
   * - 针对每个镜像调用删除接口，并统计成功/失败数量
   */
  const batchDelete = async () => {
    if (!ensureImagesWrite()) return;
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
            const alias = getImageAlias(r);
            const label = alias ? `${alias} (${name})` : name;
            try { await deleteHarvesterImage(cloudId, ns, name); return { ok: true, name: label }; }
            catch (e: any) { return { ok: false, name: label, err: e?.message || String(e) }; }
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
        // 优先使用顶层的 displayName，然后检查 spec.displayName，最后检查 labels
        const disp = r?.displayName || r?.spec?.displayName || r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || r?.name || r?.metadata?.name || '-';
        const nameForIcon = r?.displayName || r?.spec?.displayName || r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || r?.name || r?.metadata?.name || '';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <OsIcon osName={nameForIcon} style={{ flexShrink: 0, fontSize: 16 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{disp}</span>
          </span>
        );
    } },
    { title: '镜像ID', key: 'resource_name', render: (_:any, r:any)=> <span className="text-secondary">{r?.name || r?.metadata?.name || '-'}</span> },
    { title: '命名空间', key: 'namespace', render: (_:any, r:any)=> getNs(r) },
    ...(mode === 'standard' ? [{ title: '作用域', key: 'scope', render: (_:any, r:any)=> isPublicNamespace(getNs(r)) ? '公共镜像' : '私有镜像' }] : []),
    ...(mode === 'standard' ? [{ title: '状态', key: 'status', render: (_:any, r:any)=> statusBadge(typeof r?.status === 'string' ? r.status : (r?.status?.phase || r?.status?.status || 'Unknown')) }] : []),
    { title: '镜像类型', key: 'image_kind', render: (_:any, r:any)=> {
        const kind = resolveImageKind(r);
        const text = kind === 'iso' ? 'ISO' : kind === 'disk' ? 'Qcow2' : '其他';
        const color = kind === 'iso' ? 'pink' : kind === 'disk' ? 'blue' : undefined;
        return <Tag color={color}>{text}</Tag>;
    } },
    { title: '虚拟大小', key: 'vsize', render: (_:any, r:any)=> {
        // 优先使用 virtualSize，如果为 0 或不存在，则使用 size
        const vsize = r?.virtualSize ?? r?.status?.virtualSize;
        const size = r?.size ?? r?.status?.size;
        if (vsize && vsize > 0) {
          return gbText(vsize);
        } else if (size) {
          // size 可能是字符串格式，需要转换
          const sizeNum = typeof size === 'string' ? Number(size) : size;
          if (sizeNum && sizeNum > 0) {
            return gbText(sizeNum);
          }
        }
        return '-';
      } },
    { title: '存储类', key: 'sc', render: (_:any, r:any)=> r?.storageClassName || r?.spec?.storageClassName || r?.status?.storageClassName || '-' },
    { title: '创建时间', key: 'created_at', render: (_:any, r:any)=> {
        const t = r?.metadata?.creationTimestamp || r?.createdAt;
        return t ? new Date(t).toLocaleString() : '-';
    } },
    { title: '操作', key: 'actions', width: 80, align: 'left' as const, fixed: 'right' as const, render: (_:any, r:any)=> {
      const name = r?.name || r?.metadata?.name || '';
      const alias = getImageAlias(r);
      const deleteLabel = alias ? `${alias} (${name})` : name;
      const ns = getNs(r);
      const links = r?.links || {};
      const download = links?.download || '';

      const handleDownload = () => { if (download) window.open(download, '_blank'); };
      const handleDelete = async () => { 
          if (!ensureImagesWrite()) return;
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
          buttonProps={{ className: 'row-actions-trigger', disabled: !hasImagesWrite }}
          items={[
            ...(!isTenant ? [{ key: 'opsinfo', label: '运维信息', onClick: () => handleOpenOpsinfo(r, 'detail') }] : []),
            { key: 'download', label: '下载镜像', disabled: !download, onClick: handleDownload },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, disabled: !hasImagesWrite, onClick: () => Modal.confirm({ title: '确认删除镜像？', content: `确定要删除镜像 ${deleteLabel} 吗？此操作不可恢复。`, onOk: handleDelete }) },
          ]} 
        />
      );
    } },
  ], [cloudId, onRefresh, isTenant, hasImagesWrite, mode]);

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_images_table');

  /**
   * 处理 URL 导入镜像的创建逻辑
   * - 使用 StdFormModal 自带的校验流程
   * - 创建成功后刷新列表并关闭弹窗
   */
  const handleCreate = async () => {
    if (!ensureImagesWrite()) return;
    try {
      const v = await form.validateFields();
      // 根据镜像类型设置 diskFormat
      let diskFormat: string | undefined;
      if (v.imageType) {
        if (v.imageType === 'iso') {
          diskFormat = 'iso';
        } else if (v.imageType === 'disk') {
          diskFormat = 'qcow2'; // 默认使用 qcow2 格式
        }
      }
      await createHarvesterImage(cloudId, {
        namespace: v.namespace || 'default',
        name: v.name || undefined,
        displayName: v.displayName || undefined,
        sourceType: v.sourceType || undefined,
        url: v.url || undefined,
        diskFormat: diskFormat,
        targetStorageClassName: v.storageClassName || undefined,
        storageClassParameters: v.storageClassParameters || {}
      });
      message.success('创建成功');
      setCreating(false);
      // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，但后端会优先查询数据库）
      // 静默刷新，不显示提示信息
      onRefresh?.(true, true); // force=true 跳过缓存，silent=true 静默刷新
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    }
  };

  /** 通过 fetch 下载直传工具：失败时在当前页 message 提示，避免 href 打开错误页 */
  const handleDownloadImageUploader = async () => {
    const url = `${API_BASE_URL}/api/tools/imageuploader.exe`;
    setUploaderDownloading(true);
    try {
      const token = getToken();
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers });
      if (res.status === 404) {
        message.error('镜像上传工具文件不存在，请确认服务器已部署或联系管理员');
        return;
      }
      if (!res.ok) {
        message.error(`下载失败（HTTP ${res.status}）`);
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = 'ImageUploader.exe';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (e: any) {
      message.error(e?.message || '下载失败，请检查网络');
    } finally {
      setUploaderDownloading(false);
    }
  };

  const renderUrlImportPanel = () => (
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
      <Form.Item label="镜像类型" name="imageType" tooltip="选择镜像类型，如果不选择将根据文件名自动推断">
        <Select
          placeholder="选择镜像类型（可选）"
          allowClear
          options={[
            { value: 'disk', label: 'Qcow2（磁盘镜像）' },
            { value: 'iso', label: 'ISO（光盘镜像）' },
          ]}
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Form.Item label="存储类" name="storageClassName">
        <Select
          loading={scLoading}
          options={storageClasses
            .map((sc: any) => {
              const n = sc?.metadata?.name || sc?.name;
              if (!n || isSystemStorageClass(n)) return null;
              return { label: n, value: n };
            })
            .filter(Boolean) as { label: string; value: string }[]}
          placeholder="请选择存储类 (可选)"
          allowClear
          style={{ width: '100%' }}
        />
      </Form.Item>
      <Typography.Paragraph type="secondary">
        说明：URL 导入由 Cloudmap 集群侧自行下载，适合大文件与不稳定网络。请确保链接可被集群访问。
      </Typography.Paragraph>
    </>
  );

  const renderToolUploadPanel = () => (
    <div style={{ padding: '0 8px' }}>
      <Steps
        direction="vertical"
        size="small"
        current={-1}
        items={[
          {
            title: '下载工具',
            description: (
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <Button
                  type="primary"
                  icon={<DownloadOutlined />}
                  loading={uploaderDownloading}
                  onClick={() => { void handleDownloadImageUploader(); }}
                >
                  下载 ImageUploader.exe
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

      <Card size="small" title="高级用法：命令行模式" style={{ marginTop: 16, background: '#f9f9f9' }} styles={{ body: { padding: '8px 12px' } }}>
        <Typography.Paragraph style={{ marginBottom: 4, fontFamily: 'monospace', fontSize: 12 }} copyable>
          ImageUploader.exe --direct --url=https://10.x.x.x --token=... --name=ubuntu-20.04 --file=./image.iso
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          提示：在命令行运行工具可查看完整参数说明，适合脚本集成。
        </Typography.Text>
      </Card>
    </div>
  );

  const isUrlCreateTab = mode === 'standard' && createTab === 'url';

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="名称/命名空间" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} value={keyword} onChange={(e)=>setKeyword(e.target.value)} className="toolbar-search" />
          {mode === 'standard' && (
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
          )}
          {mode === 'standard' && (
            <Select
              allowClear
              placeholder="镜像状态"
              value={statusFilter || undefined}
              onChange={(v)=> setStatusFilter(v || '')}
              className="toolbar-filter-sm"
              options={[{ value: '', label: '全部' }, ...statusOptions.map(k=> ({ value: k, label: cnStatus(k) }))]}
            />
          )}
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
              { value: 'unknown', label: '其他' },
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
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setScopeFilter('');
              setStatusFilter('');
              setTypeFilter(''); // 重置为空，显示所有类型
              setOsFilter('');
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" disabled={!hasImagesWrite} onClick={()=> { if (!ensureImagesWrite()) return; form.resetFields(); setCreateTab('tool'); setCreating(true); }}>新增镜像</Button>
          <Tooltip
            title={
              !hasImagesWrite
                ? undefined
                : selectedKeys.length === 0
                  ? '请先选择镜像'
                  : undefined
            }
          >
            <span>
              <Dropdown
                menu={{
                  items: [
                    { type: 'divider' },
                    { key: 'batchDelete', label: '批量删除', disabled: !hasImagesWrite || selectedKeys.length === 0 },
                  ],
                  onClick: ({ key }) => {
                    if (!hasImagesWrite) {
                      message.error('当前账号没有批量操作镜像的权限（需要 clouds.images:write 或 clouds:write 权限）');
                      return;
                    }
                    if (selectedKeys.length === 0) {
                      message.warning('请先选择镜像');
                      return;
                    }
                    if (key === 'batchDelete') batchDelete();
                  },
                }}
              >
                <Button icon={<EllipsisOutlined />} disabled={!hasImagesWrite || selectedKeys.length === 0} />
              </Dropdown>
            </span>
          </Tooltip>
          <TableColumnSettingsButton 
            allColumns={allColumns} 
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
        onFinish={isUrlCreateTab ? handleCreate : ()=> setCreating(false)}
        form={form}
        okText={isUrlCreateTab ? '创建' : '关闭'}
        width={600}
      >
        {mode === 'simple' ? (
          renderToolUploadPanel()
        ) : (
          <Tabs
            activeKey={createTab}
            destroyInactiveTabPane
            onChange={(k)=> {
              const key = (k as 'url'|'tool');
              setCreateTab(key);
              if (key === 'url') form.setFieldsValue({ sourceType: 'download' });
            }}
            items={[
              {
                key: 'tool',
                label: '内网直传（传输工具）',
                children: renderToolUploadPanel(),
              },
              {
                key: 'url',
                label: 'URL 导入（集群拉取）',
                children: renderUrlImportPanel(),
              },
            ]}
          />
        )}
      </StdFormModal>
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r:any)=> getId(r)}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
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
