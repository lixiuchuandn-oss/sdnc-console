/**
 * Harvester - 镜像 (Image) 列表 Section
 * frontend/src/pages/cnmc/clouds/Harvester/ecs/sections/ImagesSection.tsx
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
 *    - 具体表单与 Tab 由 `ImageCreateModal` 承担。
 *    - 无 clouds.cloudmap.ops-view:write：弹窗仅「浏览器上传」。
 *    - 具备该权限：弹窗含浏览器上传、URL 导入、Windows 桌面工具下载。
 * 3. [详情抽屉]:
 *    - 点击行支持打开 `HarvesterResourceDrawer`，展示镜像的 YAML 和 Events。
 *    - 在打开抽屉前，自动补全 `kind: VirtualMachineImage` 以适配通用抽屉逻辑。
 *
 * === 交互依赖 ===
 * - 上游: 由资源池详情（如 Cloudmap）传入 `images` 列表。
 * - 下游: 列表侧调用 `deleteHarvesterImage` 等；新建镜像由 `ImageCreateModal` 内聚 API。
 * - 外部: 镜像列表与上传任务轮询相关 API；`uploadControllersRef` 与弹窗共用以便取消直传。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Table, Input, Select, Tag, Button, message, Dropdown, Modal, Tooltip, Typography, Drawer, Progress } from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../../shared/components/HarvesterOpsinfoDrawer';
import {
  deleteHarvesterImage,
  fetchHarvesterImageUploadTask,
  fetchHarvesterImageUploadTasks,
  deleteHarvesterImageUploadTask,
  cancelHarvesterImageUploadTask,
  type HarvesterImageUploadTask,
} from '../../../../../../services/harvesterApi';
import {
  isSystemNamespace,
  isImagePublicByScenario,
  resolveVmImageKind,
  findVmsReferencingHarvesterImage,
} from '../../../../../../utils/harvesterUtils';
import { OsIcon, getOsKeywordGroups } from '../../../../../../components/OsIcon';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import ImageLabelEditModal from '../modals/ImageLabelEditModal';
import ImageCreateModal from '../modals/ImageCreateModal';
import { useCloudmapOpsViewWrite } from '../../hooks/useCloudmapOpsViewWrite';
import { resolveImageListStateKey } from '../lib/vmImageStatus';

/**
 * Harvester 镜像底层文件占用：status.size / spec.size / 导入中 downloadedBytes；
 * Tower 列表 `listHarvesterImagesStandard` 还会在顶层镜像对象上回填 `size`。
 */
function getImageActualFileBytes(r: any): number | undefined {
  const raw = r?.status?.size ?? r?.spec?.size ?? r?.status?.downloadedBytes;
  let n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  const topSize = r?.size;
  n =
    typeof topSize === 'number'
      ? topSize
      : typeof topSize === 'string'
        ? Number(topSize)
        : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return undefined;
}

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
  /** 用于删除镜像前判断是否仍被虚拟机引用 */
  vms?: any[];

  isTenant?: boolean;
  bordered?: boolean;
};

const ImagesSection: React.FC<Props> = ({
  cloudId,
  images,
  loading,
  onRefresh,
  vms = [],
  isTenant = false,
  bordered = true,
}) => {
  const hasOpsView = useCloudmapOpsViewWrite();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasImagesWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.images:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureImagesWrite = useCallback(() => {
    if (hasImagesWrite) return true;
    message.error('当前账号没有镜像操作权限（需要 clouds.images:write 或 clouds:write 权限）');
    return false;
  }, [hasImagesWrite]);

  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>(''); // 默认不过滤，显示所有类型
  const [osFilter, setOsFilter] = useState<string>('');
  const [scopeFilter, setScopeFilter] = useState<string>(''); // all | public | private
  // 创建镜像弹窗状态
  const [creating, setCreating] = useState<boolean>(false);
  // 批量选择的行 key
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);

  // 抽屉状态，用于展示镜像的 Harvester 详情与事件等
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [toolTaskList, setToolTaskList] = useState<HarvesterImageUploadTask[]>([]);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskDrawerLoading, setTaskDrawerLoading] = useState(false);

  // 标签编辑状态
  const [labelEditModalOpen, setLabelEditModalOpen] = useState(false);
  const [labelEditRecord, setLabelEditRecord] = useState<any>(null);
  /** 浏览器直传 fetch 的 AbortController；与 ImageCreateModal 共用，取消任务时可中止上传 */
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const toolTaskListRef = useRef<HarvesterImageUploadTask[]>([]);
  const onRefreshRef = useRef(onRefresh);
  toolTaskListRef.current = toolTaskList;
  onRefreshRef.current = onRefresh;

  React.useEffect(() => {
    if (!cloudId) return;
    let stopped = false;
    const loadTasks = async () => {
      try {
        const resp: any = await fetchHarvesterImageUploadTasks(cloudId, 20);
        const items = resp?.data?.items || resp?.items || [];
        if (!stopped) setToolTaskList(Array.isArray(items) ? items : []);
      } catch {
        // ignore background load failure
      }
    };
    void loadTasks();
    return () => {
      stopped = true;
    };
  }, [cloudId]);

  const loadUploadTasks = async (silent = true) => {
    try {
      if (!silent) setTaskDrawerLoading(true);
      const resp: any = await fetchHarvesterImageUploadTasks(cloudId, 50);
      const items = resp?.data?.items || resp?.items || [];
      setToolTaskList(Array.isArray(items) ? items : []);
    } catch (e: any) {
      if (!silent) message.error(e?.message || '加载上传任务失败');
    } finally {
      if (!silent) setTaskDrawerLoading(false);
    }
  };

  const handleDeleteUploadTask = async (task: HarvesterImageUploadTask) => {
    try {
      if (!ensureImagesWrite()) return;
      await deleteHarvesterImageUploadTask(cloudId, task.id);
      message.success('任务记录已删除');
      setToolTaskList((prev) => prev.filter((x) => x.id !== task.id));
    } catch (e: any) {
      message.error(e?.message || '删除任务记录失败');
    }
  };

  React.useEffect(() => {
    if (!cloudId) return;
    const timer = window.setInterval(async () => {
      const active = toolTaskListRef.current.filter((t) =>
        ['pending', 'ingesting', 'proxying'].includes(String(t?.status || '')),
      );
      if (active.length === 0) return;
      try {
        const next = await Promise.all(
          active.map(async (t) => {
            try {
              const resp = await fetchHarvesterImageUploadTask(cloudId, t.id);
              const r = resp as { data?: HarvesterImageUploadTask };
              return (r?.data ?? r) as HarvesterImageUploadTask;
            } catch {
              return t;
            }
          }),
        );
        setToolTaskList((prev) => {
          const map = new Map(prev.map((x) => [x.id, x]));
          next.forEach((x) => map.set(x.id, x));
          return Array.from(map.values()).sort(
            (a, b) =>
              new Date(b.createdAt || b.updatedAt || 0).getTime() -
              new Date(a.createdAt || a.updatedAt || 0).getTime(),
          );
        });
        if (next.some((x) => x.status === 'success')) onRefreshRef.current?.(true, true);
      } catch {
        // ignore polling failure
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [cloudId]);

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
  const cnStatus = useCallback((s?: string): string => {
    const k = String(s || '').toLowerCase();
    const m: Record<string, string> = {
      imported: '已导入',
      pending: '等待',
      downloading: '下载中',
      ready: '就绪',
      failed: '失败',
      unknown: '未知',
    };
    return m[k] || (s || '-');
  }, []);
  /**
   * 状态 Badge 渲染：根据状态选择不同颜色和中文文案
   */
  const statusBadge = useCallback(
    (s?: string) => {
      const k = String(s || '').toLowerCase();
      const text = cnStatus(s);
      const color = (function () {
        if (k === 'ready') return 'green';
        if (k === 'failed') return 'red';
        if (k === 'imported') return 'success';
        if (k === 'downloading') return 'blue';
        if (k === 'pending') return 'gold';
        return undefined;
      })();
      return <Tag color={color}>{text}</Tag>;
    },
    [cnStatus],
  );
  const gbText = (bytes?: number | string): string => {
    const n = typeof bytes === 'number' ? bytes : (typeof bytes === 'string' ? Number(bytes) : NaN);
    if (!isFinite(n) || n <= 0) return '-';
    const gb = n / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)}GB`;
  };

  const expandOsKeywords = useCallback((val: string) => {
    const v = (val || '').toLowerCase();
    const groups = getOsKeywordGroups();
    const g = groups.find((gr: string[]) => gr.includes(v));
    return g ? g : v ? [v] : [];
  }, []);

  const getId = (r: any): string => String(r?.name || r?.metadata?.name || '');
  const getNs = (r: any): string => String(r?.namespace || r?.metadata?.namespace || 'default');

  /** 创建时间（毫秒），用于列表默认排序与表格列排序 */
  const getImageCreatedMs = useCallback((r: any) => {
    const t = r?.metadata?.creationTimestamp || r?.createdAt;
    const ms = t ? new Date(t).getTime() : 0;
    return Number.isFinite(ms) ? ms : 0;
  }, []);

  const filtered = useMemo(() => {
    const base = Array.isArray(images) ? images : [];
    // 如果没有过滤条件，直接返回所有镜像
    const hasFilters = keyword.trim() || statusFilter || typeFilter || osFilter || (hasOpsView ? scopeFilter : '');
    let list: any[];
    if (!hasFilters && !isTenant) {
      list = base;
    } else {
      const kw = keyword.trim().toLowerCase();
      const st = statusFilter.trim().toLowerCase();
      const osKey = osFilter.trim().toLowerCase();
      list = base.filter((r: any) => {
        const ns = getNs(r);

        // [系统资源过滤]
        // 租户模式: 严格隔离，禁止查看系统命名空间，但允许查看公共命名空间 (harvester-public)
        if (isTenant) {
          if (isSystemNamespace(ns) && !isImagePublicByScenario(r)) return false;
        }

        // Scope Filter - 只有用户主动选择时才过滤
        if (hasOpsView && scopeFilter === 'public' && !isImagePublicByScenario(r)) return false;
        if (hasOpsView && scopeFilter === 'private') {
          // Private: 非公共且非系统
          if (isImagePublicByScenario(r) || isSystemNamespace(ns)) return false;
        }

        // 关键字过滤 - 只有用户输入时才过滤
        // 搜索范围：displayName、spec.displayName、labels中的imageDisplayName、name、namespace
        if (kw) {
          const displayName = String(
            r?.displayName ||
              r?.spec?.displayName ||
              r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] ||
              '',
          ).toLowerCase();
          const imageName = String(r?.name || r?.metadata?.name || '').toLowerCase();
          const namespace = String(ns).toLowerCase();
          if (!displayName.includes(kw) && !imageName.includes(kw) && !namespace.includes(kw)) {
            return false;
          }
        }

        // 状态过滤 - 只有用户选择时才过滤
        if (st) {
          if (resolveImageListStateKey(r) !== st) return false;
        }

        // 镜像类型过滤 - 只有用户主动选择类型时才过滤
        if (typeFilter) {
          const kind = resolveVmImageKind(r);
          if (kind !== typeFilter) return false;
        }

        // OS过滤 - 只有用户输入时才过滤
        if (osKey) {
          const osLabel = String(r?.metadata?.labels?.['harvesterhci.io/os'] || '').toLowerCase();
          const iconName = String(r?.metadata?.labels?.['harvesterhci.io/imageDisplayName'] || r?.metadata?.name || r?.name || '').toLowerCase();
          const keys = expandOsKeywords(osKey);
          if (!keys.some((k) => osLabel.includes(k) || iconName.includes(k))) return false;
        }
        return true;
      });
    }
    // 默认按创建时间降序（最新在前）；清除列排序时仍保持该顺序
    return [...list].sort((a, b) => getImageCreatedMs(b) - getImageCreatedMs(a));
  }, [images, keyword, statusFilter, typeFilter, osFilter, scopeFilter, isTenant, hasOpsView, expandOsKeywords, getImageCreatedMs]);

  /** 与 resolveImageListStateKey 返回值一致（去掉易与 ready 混淆的 imported/pending） */
  const statusOptions = ['ready', 'failed', 'downloading', 'unknown'];
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
          if (fail.length > 0) {
            message.error(
              `删除失败 ${fail.length} 条：${fail.map((f: any) => (f.err ? `${f.name}（${f.err}）` : f.name)).join('；')}`,
            );
          }
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
    ...(hasOpsView
      ? [
          { title: '命名空间', key: 'namespace', render: (_: any, r: any) => getNs(r) },
          { title: '作用域', key: 'scope', render: (_: any, r: any) => (isImagePublicByScenario(r) ? '公共镜像' : '私有镜像') },
        ]
      : []),
    { title: '状态', key: 'status', render: (_:any, r:any)=> statusBadge(resolveImageListStateKey(r)) },
    { title: '镜像类型', key: 'image_kind', render: (_:any, r:any)=> {
        const kind = resolveVmImageKind(r);
        const text = kind === 'iso' ? 'ISO' : kind === 'disk' ? 'Qcow2' : '其他';
        const color = kind === 'iso' ? 'pink' : kind === 'disk' ? 'blue' : undefined;
        return <Tag color={color}>{text}</Tag>;
    } },
    { title: '虚拟大小', key: 'vsize', render: (_:any, r:any)=> {
        const vsize =
          r?.virtualSize ??
          r?.status?.virtualSize ??
          r?.spec?.virtualSize;
        if (vsize == null || vsize === '') return '-';
        const num = typeof vsize === 'string' ? Number(vsize) : vsize;
        return isFinite(num) && Number(num) > 0 ? gbText(num) : '-';
      } },
    {
      title: '实际大小',
      key: 'actual_size',
      render: (_: any, r: any) => {
        const bytes = getImageActualFileBytes(r);
        return bytes != null ? gbText(bytes) : '-';
      },
    },
    ...(hasOpsView
      ? [
          {
            title: '存储类',
            key: 'sc',
            render: (_: any, r: any) =>
              r?.storageClassName || r?.spec?.storageClassName || r?.status?.storageClassName || '-',
          },
        ]
      : []),
    {
      title: '创建时间',
      key: 'created_at',
      sorter: (a: any, b: any) => getImageCreatedMs(a) - getImageCreatedMs(b),
      defaultSortOrder: 'descend' as const,
      render: (_: any, r: any) => {
        const t = r?.metadata?.creationTimestamp || r?.createdAt;
        return t ? new Date(t).toLocaleString() : '-';
      },
    },
    { title: '操作', key: 'actions', align: 'left' as const, fixed: 'right' as const, render: (_:any, r:any)=> {
      const name = r?.name || r?.metadata?.name || '';
      const alias = getImageAlias(r);
      const deleteLabel = alias ? `${alias} (${name})` : name;
      const ns = getNs(r);
      const links = r?.links || {};
      const download = links?.download || '';

      const handleDownload = () => { if (download) window.open(download, '_blank'); };
      const handleDelete = async () => { 
          if (!ensureImagesWrite()) return;
          if (!name) return;
          const used = findVmsReferencingHarvesterImage(ns, name, vms);
          if (used.length > 0) {
            message.warning(`镜像仍被以下虚拟机使用，无法删除：${used.map((u) => u.label).join('、')}`);
            return;
          }
          try {
            await deleteHarvesterImage(cloudId, ns, name);
            message.success('删除成功');
            onRefresh?.(true);
          } catch (e: any) {
            message.error(e?.message || '删除失败');
          }
      };

      return (
        <ResourceActionsDropdown 
          buttonProps={{ className: 'row-actions-trigger', disabled: !hasImagesWrite }}
          items={[
            ...(!isTenant && hasOpsView ? [{ key: 'opsinfo', label: '查看YAML', onClick: () => handleOpenOpsinfo(r, 'detail') }] : []),
            { key: 'editLabels', label: '编辑标签', disabled: !hasImagesWrite, onClick: () => { setLabelEditRecord(r); setLabelEditModalOpen(true); } },
            { key: 'download', label: '下载镜像', disabled: !download, onClick: handleDownload },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, disabled: !hasImagesWrite, onClick: () => Modal.confirm({ title: '确认删除镜像？', content: `确定要删除镜像 ${deleteLabel} 吗？此操作不可恢复。`, onOk: handleDelete }) },
          ]} 
        />
      );
    } },
  ], [cloudId, onRefresh, vms, isTenant, hasImagesWrite, hasOpsView, ensureImagesWrite, statusBadge, getImageCreatedMs]);

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_images_table');

  /** 合并上传任务列表（新增镜像弹窗创建任务及轮询更新时调用） */
  const upsertTask = (task: HarvesterImageUploadTask) => {
    setToolTaskList((prev) => {
      const map = new Map(prev.map((x) => [x.id, x]));
      map.set(task.id, task);
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime(),
      );
    });
  };

  const handleCancelUploadTask = async (task: HarvesterImageUploadTask) => {
    try {
      if (!ensureImagesWrite()) return;
      uploadControllersRef.current.get(task.id)?.abort();
      const resp: any = await cancelHarvesterImageUploadTask(cloudId, task.id);
      const next = (resp?.data || resp) as HarvesterImageUploadTask;
      if (next?.id) upsertTask(next);
      else {
        const latest: any = await fetchHarvesterImageUploadTask(cloudId, task.id);
        upsertTask((latest?.data || latest) as HarvesterImageUploadTask);
      }
      message.success('已取消');
    } catch (e: any) {
      message.error(e?.message || '取消失败');
    }
  };

  const uploadStatusText = (t: HarvesterImageUploadTask) => {
    const s = String(t?.status || '').toLowerCase();
    const map: Record<string, string> = {
      pending: '等待上传',
      ingesting: '文件接收中',
      proxying: '后端代传中',
      success: '完成',
      failed: '失败',
      cancelled: '已取消',
    };
    return map[s] || s || '-';
  };

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={(
        <>
          <Input allowClear placeholder="名称/命名空间" suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} value={keyword} onChange={(e)=>setKeyword(e.target.value)} className="toolbar-search" />
          {hasOpsView && (
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
          <Button
            type="primary"
            disabled={!hasImagesWrite}
            onClick={() => {
              if (!ensureImagesWrite()) return;
              setCreating(true);
            }}
          >
            新增镜像
          </Button>
          <Button
            onClick={() => {
              setTaskDrawerOpen(true);
              void loadUploadTasks(false);
            }}
          >
            上传任务
          </Button>
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
      <ImageCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        cloudId={cloudId}
        variant={hasOpsView ? 'full' : 'standard'}
        ensureWrite={ensureImagesWrite}
        onUrlImportSuccess={() => onRefresh?.(true, true)}
        onUploadTaskUpsert={upsertTask}
        uploadControllersRef={uploadControllersRef}
      />
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r:any)=> getId(r)}
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: true }}
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
      <Drawer
        title="镜像上传任务"
        placement="right"
        width={460}
        open={taskDrawerOpen}
        onClose={() => setTaskDrawerOpen(false)}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={taskDrawerLoading}
            onClick={() => {
              void loadUploadTasks(false);
            }}
          />
        }
      >
        {toolTaskList.length === 0 ? (
          <Typography.Text type="secondary">暂无上传任务</Typography.Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {toolTaskList.map((t) => (
              <div key={t.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Typography.Text ellipsis style={{ maxWidth: 260 }}>
                    {t.displayName || t.filename || t.id}
                  </Typography.Text>
                  <Tag
                    color={
                      t.status === 'success'
                        ? 'green'
                        : t.status === 'failed'
                          ? 'red'
                          : t.status === 'cancelled'
                            ? 'default'
                            : 'blue'
                    }
                  >
                    {uploadStatusText(t)}
                  </Tag>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  命名空间：{t.namespace || '-'}
                </Typography.Text>
                <Progress
                  percent={Number(t.progress || 0)}
                  size="small"
                  status={
                    t.status === 'failed'
                      ? 'exception'
                      : t.status === 'success'
                        ? 'success'
                        : t.status === 'cancelled'
                          ? 'normal'
                          : 'active'
                  }
                  style={{ marginTop: 6, marginBottom: 4 }}
                />
                {t.errorMessage ? (
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    {t.errorMessage}
                  </Typography.Text>
                ) : null}
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
                  <Button
                    size="small"
                    disabled={
                      !['pending', 'ingesting', 'proxying'].includes(String(t.status || '')) || !hasImagesWrite
                    }
                    onClick={() =>
                      Modal.confirm({
                        title: '确认取消该上传任务？',
                        content: `取消后将停止上传：${t.displayName || t.filename || t.id}`,
                        onOk: async () => {
                          await handleCancelUploadTask(t);
                        },
                      })
                    }
                  >
                    取消
                  </Button>
                  <Button
                    size="small"
                    danger
                    disabled={['pending', 'ingesting', 'proxying'].includes(String(t.status || '')) || !hasImagesWrite}
                    onClick={() =>
                      Modal.confirm({
                        title: '确认删除该上传任务记录？',
                        content: `删除后将无法恢复：${t.displayName || t.filename || t.id}`,
                        onOk: async () => {
                          await handleDeleteUploadTask(t);
                        },
                      })
                    }
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <ImageLabelEditModal
        open={labelEditModalOpen}
        onClose={() => setLabelEditModalOpen(false)}
        cloudId={cloudId}
        resource={labelEditRecord}
        onSuccess={() => onRefresh?.(true, true)}
      />
    </PageDetailSection>
  );
};

export default ImagesSection;
