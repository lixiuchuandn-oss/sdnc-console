/**
 * Harvester - 镜像 (Image) 列表 Section
 * 列表列与筛选逻辑见 `ecs/lib/imagesSectionUtils.ts`、`imagesTableColumns.tsx`。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Table,
  Input,
  Select,
  Tag,
  Button,
  message,
  Dropdown,
  Modal,
  Tooltip,
  Typography,
  Drawer,
  Progress,
} from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
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
import { findVmsReferencingHarvesterImage } from '../../../../../../utils/harvesterUtils';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import ImageLabelEditModal from '../modals/ImageLabelEditModal';
import ImageCreateModal from '../modals/ImageCreateModal';
import { resolveImageListStateKey } from '../lib/vmImageStatus';
import {
  IMAGE_OS_FILTER_OPTIONS,
  IMAGE_STATUS_FILTER_OPTIONS,
  imageUploadTaskStatusLabel,
} from '../lib/imagesSectionConstants';
import {
  filterAndSortImages,
  getImageDisplayAlias,
  getImageRowId,
  getImageRowNamespace,
  imageStatusLabelZh,
  type ImageListRecord,
} from '../lib/imagesSectionUtils';
import { buildImagesTableColumns } from '../lib/imagesTableColumns';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';

type Props = {
  cloudId: string;
  images: ImageListRecord[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  vms?: ImageListRecord[];
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
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasImagesWrite = useMemo(
    () =>
      hasPermissionForAction(perms, 'clouds.images:write') ||
      hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const ensureImagesWrite = useCallback(() => {
    if (hasImagesWrite) return true;
    message.error('当前账号没有镜像操作权限（需要 clouds.images:write 或 clouds:write 权限）');
    return false;
  }, [hasImagesWrite]);

  const [localImages, setLocalImages] = useState<ImageListRecord[]>(images);

  React.useEffect(() => {
    setLocalImages(images);
  }, [images]);

  const prevProgressRef = React.useRef<Map<string, number>>(new Map());
  React.useEffect(() => {
    if (!onRefresh) return;
    const hasProgressing = localImages.some((img) => {
      const stateKey = resolveImageListStateKey(img);
      const progressingStates = ['downloading', 'uploading', 'importing', 'exporting', 'pending'];
      if (!progressingStates.includes(stateKey)) return false;
      const status = img?.status as Record<string, unknown> | undefined;
      const progress = Number(status?.progress ?? img?.progress ?? 0);
      const rowName = getImageRowId(img);
      const prevProgress = prevProgressRef.current.get(rowName);
      if (prevProgress !== undefined && prevProgress !== progress) return true;
      if (progress > 0 && progress < 100 && prevProgress === undefined) {
        prevProgressRef.current.set(rowName, progress);
        return true;
      }
      if (prevProgress !== undefined) {
        prevProgressRef.current.set(rowName, progress);
      }
      return false;
    });

    if (hasProgressing) {
      const timer = window.setTimeout(() => {
        onRefresh(true, true);
      }, 3000);
      return () => window.clearTimeout(timer);
    }
  }, [localImages, onRefresh]);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [osFilter, setOsFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ImageListRecord | null>(null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [toolTaskList, setToolTaskList] = useState<HarvesterImageUploadTask[]>([]);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [taskDrawerLoading, setTaskDrawerLoading] = useState(false);
  const [taskProgressCache, setTaskProgressCache] = useState<Map<string, number>>(new Map());
  const [labelEditModalOpen, setLabelEditModalOpen] = useState(false);
  const [labelEditRecord, setLabelEditRecord] = useState<ImageListRecord | null>(null);
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const toolTaskListRef = useRef<HarvesterImageUploadTask[]>([]);
  const onRefreshRef = useRef(onRefresh);
  toolTaskListRef.current = toolTaskList;
  onRefreshRef.current = onRefresh;

  const getSmoothProgress = useCallback(
    (task: HarvesterImageUploadTask): number => {
      const current = Number(task.progress || 0);
      const cached = taskProgressCache.get(task.id) || 0;
      const smooth = Math.max(current, cached);
      if (smooth > cached) {
        setTaskProgressCache((prev) => {
          const next = new Map(prev);
          next.set(task.id, smooth);
          return next;
        });
      }
      return smooth;
    },
    [taskProgressCache],
  );

  React.useEffect(() => {
    if (!cloudId) return;
    let stopped = false;
    const loadTasks = async () => {
      try {
        const resp: { data?: { items?: HarvesterImageUploadTask[] }; items?: HarvesterImageUploadTask[] } =
          await fetchHarvesterImageUploadTasks(cloudId, 20);
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
      const resp: { data?: { items?: HarvesterImageUploadTask[] }; items?: HarvesterImageUploadTask[] } =
        await fetchHarvesterImageUploadTasks(cloudId, 50);
      const items = resp?.data?.items || resp?.items || [];
      setToolTaskList(Array.isArray(items) ? items : []);
    } catch (e: unknown) {
      if (!silent) message.error((e as { message?: string })?.message || '加载上传任务失败');
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
    } catch (e: unknown) {
      message.error((e as { message?: string })?.message || '删除任务记录失败');
    }
  };

  React.useEffect(() => {
    if (!cloudId) return;
    const timer = window.setInterval(async () => {
      const active = toolTaskListRef.current.filter((t) =>
        ['pending', 'ingesting', 'proxying', 'success'].includes(String(t?.status || '')),
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
        const newlyCompleted = next.filter(
          (x) =>
            x.status === 'success' &&
            !toolTaskListRef.current.some((t) => t.id === x.id && t.status === 'success'),
        );
        const progressChanged = next.some((x) => {
          const oldTask = toolTaskListRef.current.find((t) => t.id === x.id);
          return oldTask && oldTask.progress !== x.progress;
        });

        setToolTaskList((prev) => {
          const map = new Map(prev.map((x) => [x.id, x]));
          next.forEach((x) => map.set(x.id, x));
          return Array.from(map.values()).sort(
            (a, b) =>
              new Date(b.createdAt || b.updatedAt || 0).getTime() -
              new Date(a.createdAt || a.updatedAt || 0).getTime(),
          );
        });

        if (progressChanged || newlyCompleted.length > 0) {
          onRefreshRef.current?.(true, true);
        }
      } catch {
        // ignore polling failure
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [cloudId]);

  const handleOpenOpsinfo = useCallback((record: ImageListRecord, tab = 'detail') => {
    const r = { ...record, kind: (record.kind as string) || 'VirtualMachineImage' };
    setCurrentRecord(r);
    setDrawerTab(tab);
    setDrawerOpen(true);
  }, []);

  const filtered = useMemo(
    () =>
      filterAndSortImages(
        localImages,
        { keyword, statusFilter, typeFilter, osFilter, scopeFilter },
        { isTenant },
      ),
    [localImages, keyword, statusFilter, typeFilter, osFilter, scopeFilter, isTenant],
  );

  const handleDeleteRow = useCallback(
    async (r: ImageListRecord) => {
      const name = getImageRowId(r);
      if (!name) return;
      const ns = getImageRowNamespace(r);
      const used = findVmsReferencingHarvesterImage(ns, name, vms);
      if (used.length > 0) {
        message.warning(
          `镜像仍被以下虚拟机使用，无法删除：${used.map((u) => u.label).join('、')}`,
        );
        return;
      }
      try {
        await deleteHarvesterImage(cloudId, ns, name);
        message.success('删除成功');
        setLocalImages((prev) =>
          prev.filter((img) => {
            const meta = img?.metadata as Record<string, unknown> | undefined;
            return !(meta?.namespace === ns && meta?.name === name);
          }),
        );
        runHarvesterSectionRefresh(onRefresh, { force: true });
      } catch (e: unknown) {
        const err = e as { message?: string; status?: number };
        const errMsg = err?.message || '';
        if (
          err?.status === 422 ||
          errMsg.includes('422') ||
          errMsg.toLowerCase().includes('in use') ||
          errMsg.includes('被使用')
        ) {
          message.error('删除镜像失败: 当前镜像正在被虚拟机使用，请先删除引用该镜像的虚拟机');
        } else {
          message.error(errMsg || '删除失败');
        }
      }
    },
    [cloudId, onRefresh, vms],
  );

  const batchDelete = async () => {
    if (!ensureImagesWrite()) return;
    if (!Array.isArray(images) || selectedKeys.length === 0) return;
    Modal.confirm({
      title: '确认批量删除所选镜像？',
      onOk: async () => {
        try {
          const map = new Map<string, ImageListRecord>();
          for (const r of images || []) map.set(getImageRowId(r), r);
          const targets = selectedKeys.map((k) => map.get(String(k))).filter(Boolean) as ImageListRecord[];
          if (targets.length === 0) {
            message.warning('未找到可删除的镜像');
            return;
          }
          const results = await Promise.all(
            targets.map(async (r) => {
              const ns = getImageRowNamespace(r);
              const name = getImageRowId(r);
              const alias = getImageDisplayAlias(r);
              const label = alias ? `${alias} (${name})` : name;
              try {
                await deleteHarvesterImage(cloudId, ns, name);
                return { ok: true as const, name: label, ns, id: name };
              } catch (e: unknown) {
                return {
                  ok: false as const,
                  name: label,
                  err: (e as { message?: string })?.message || String(e),
                };
              }
            }),
          );
          const okResults = results.filter((x) => x.ok);
          const fail = results.filter((x) => !x.ok);
          if (okResults.length > 0) {
            message.success(`删除成功 ${okResults.length} 条`);
            const deletedIds = new Set(okResults.map((r) => `${r.ns}/${r.id}`));
            setLocalImages((prev) =>
              prev.filter((img) => {
                const meta = img?.metadata as Record<string, unknown> | undefined;
                return !deletedIds.has(`${meta?.namespace}/${meta?.name}`);
              }),
            );
          }
          if (fail.length > 0) {
            message.error(
              `删除失败 ${fail.length} 条：${fail.map((f) => (f.err ? `${f.name}（${f.err}）` : f.name)).join('；')}`,
            );
          }
          setSelectedKeys([]);
          runHarvesterSectionRefresh(onRefresh, { force: true });
        } catch (e: unknown) {
          message.error((e as { message?: string })?.message || '批量删除失败');
        }
      },
    });
  };

  const allColumns = useMemo(
    () =>
      buildImagesTableColumns({
        isTenant,
        hasImagesWrite,
        ensureImagesWrite,
        onOpenYaml: (r) => handleOpenOpsinfo(r, 'detail'),
        onEditLabels: (r) => {
          setLabelEditRecord(r);
          setLabelEditModalOpen(true);
        },
        onDeleteRow: (r) => void handleDeleteRow(r),
      }),
    [isTenant, hasImagesWrite, ensureImagesWrite, handleOpenOpsinfo, handleDeleteRow],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_images_table');

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  const upsertTask = (task: HarvesterImageUploadTask) => {
    setToolTaskList((prev) => {
      const map = new Map(prev.map((x) => [x.id, x]));
      map.set(task.id, task);
      return Array.from(map.values()).sort(
        (a, b) =>
          new Date(b.createdAt || b.updatedAt || 0).getTime() -
          new Date(a.createdAt || a.updatedAt || 0).getTime(),
      );
    });
  };

  const handleCancelUploadTask = async (task: HarvesterImageUploadTask) => {
    try {
      if (!ensureImagesWrite()) return;
      uploadControllersRef.current.get(task.id)?.abort();
      const resp = (await cancelHarvesterImageUploadTask(cloudId, task.id)) as {
        data?: HarvesterImageUploadTask;
      };
      const next = (resp?.data || resp) as HarvesterImageUploadTask;
      if (next?.id) upsertTask(next);
      else {
        const latest = (await fetchHarvesterImageUploadTask(cloudId, task.id)) as {
          data?: HarvesterImageUploadTask;
        };
        upsertTask((latest?.data || latest) as HarvesterImageUploadTask);
      }
      onRefreshRef.current?.(true, true);
      prevProgressRef.current.clear();
      message.success('已取消');
    } catch (e: unknown) {
      message.error((e as { message?: string })?.message || '取消失败');
    }
  };

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/命名空间"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          {!isTenant && (
            <Select
              allowClear
              placeholder="作用域"
              value={scopeFilter || undefined}
              onChange={(v) => setScopeFilter(v || '')}
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
            onChange={(v) => setStatusFilter(v || '')}
            className="toolbar-filter-sm"
            options={[
              { value: '', label: '全部' },
              ...IMAGE_STATUS_FILTER_OPTIONS.map((k) => ({
                value: k,
                label: imageStatusLabelZh(k),
              })),
            ]}
          />
          <Select
            allowClear
            placeholder="镜像类型"
            value={typeFilter || undefined}
            onChange={(v) => setTypeFilter(v || '')}
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
            onChange={(v) => setOsFilter(v || '')}
            className="toolbar-filter-sm"
            options={IMAGE_OS_FILTER_OPTIONS}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setScopeFilter('');
              setStatusFilter('');
              setTypeFilter('');
              setOsFilter('');
            }}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
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
                    {
                      key: 'batchDelete',
                      label: '批量删除',
                      disabled: !hasImagesWrite || selectedKeys.length === 0,
                    },
                  ],
                  onClick: ({ key }) => {
                    if (!hasImagesWrite) {
                      message.error(
                        '当前账号没有批量操作镜像的权限（需要 clouds.images:write 或 clouds:write 权限）',
                      );
                      return;
                    }
                    if (selectedKeys.length === 0) {
                      message.warning('请先选择镜像');
                      return;
                    }
                    if (key === 'batchDelete') void batchDelete();
                  },
                }}
              >
                <Button
                  icon={<EllipsisOutlined />}
                  disabled={!hasImagesWrite || selectedKeys.length === 0}
                />
              </Dropdown>
            </span>
          </Tooltip>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey="harvester_images_table" />
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </>
      }
    >
      <ImageCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        cloudId={cloudId}
        variant="full"
        ensureWrite={ensureImagesWrite}
        onUrlImportSuccess={() => onRefresh?.(true, true)}
        onBrowserUploadSuccess={() => onRefresh?.(true, true)}
        onUploadTaskUpsert={upsertTask}
        uploadControllersRef={uploadControllersRef}
      />
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => getImageRowId(r)}
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
                    {imageUploadTaskStatusLabel(t.status)}
                  </Tag>
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  命名空间：{t.namespace || '-'}
                </Typography.Text>
                <Progress
                  percent={getSmoothProgress(t)}
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
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <Button
                    size="small"
                    disabled={
                      !['pending', 'ingesting', 'proxying'].includes(String(t.status || '')) ||
                      !hasImagesWrite
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
                    disabled={
                      ['pending', 'ingesting', 'proxying'].includes(String(t.status || '')) ||
                      !hasImagesWrite
                    }
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
