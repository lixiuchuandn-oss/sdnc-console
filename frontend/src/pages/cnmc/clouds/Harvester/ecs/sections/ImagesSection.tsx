/**
 * Harvester - 镜像 (Image) 列表 Section
 * 列表列与筛选见 `ecs/lib/imagesSectionUtils.ts`、`imagesTableColumns.tsx`；
 * 删除/上传任务见 `imagesSectionActions.ts`、`hooks/useImagesSectionActions.tsx`。
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Table,
  Input,
  Select,
  Button,
  message,
  Dropdown,
  Tooltip,
} from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import WriteGuard from '../../../../../../components/WriteGuard';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import ImageLabelEditModal from '../modals/ImageLabelEditModal';
import ImageCreateModal from '../modals/ImageCreateModal';
import type { HarvesterImageUploadTask } from '../../../../../../services/harvesterApi';
import {
  IMAGE_OS_FILTER_OPTIONS,
  IMAGE_STATUS_FILTER_OPTIONS,
} from '../lib/imagesSectionConstants';
import {
  filterAndSortImages,
  getImageRowId,
  imageStatusLabelZh,
  type ImageListRecord,
} from '../lib/imagesSectionUtils';
import { buildImagesTableColumns } from '../lib/imagesTableColumns';
import {
  getTowerUploadTaskIdFromRow,
  isTowerUploadVirtualRow,
  mergeUploadTasksIntoImageList,
} from '../lib/imagesSectionActions';
import { useImagesSectionActions } from '../hooks/useImagesSectionActions';
import {
  ImageUploadTasksDrawer,
  type ImageUploadTasksDrawerHandle,
} from '../components/ImageUploadTasksDrawer';
import {
  createHarvesterToolbarRefresh,
  notifyHarvesterImagesInventoryChanged,
  runHarvesterSectionRefresh,
  type HarvesterImagesInventoryReload,
  type HarvesterSectionOnRefresh,
} from '../../shared/lib/harvesterSectionRefresh';
import { useHarvesterPublicNamespaces } from '../../shared/context/HarvesterPublicNamespacesContext';

type Props = {
  cloudId: string;
  images: ImageListRecord[];
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
  onImagesInventoryReload?: HarvesterImagesInventoryReload;
  vms?: ImageListRecord[];
  isTenant?: boolean;
  /** 租户上传镜像默认命名空间（侧栏 ns 或首个授权 ns） */
  tenantDefaultNamespace?: string;
};

const ImagesSection: React.FC<Props> = ({
  cloudId,
  images,
  loading,
  onRefresh,
  onImagesInventoryReload,
  vms = [],
  isTenant = false,
  tenantDefaultNamespace,
}) => {
  const { user } = useAuth();
  const { isPublicNamespace } = useHarvesterPublicNamespaces();
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

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [osFilter, setOsFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [labelEditModalOpen, setLabelEditModalOpen] = useState(false);
  const [labelEditRecord, setLabelEditRecord] = useState<ImageListRecord | null>(null);
  const { yamlDrawerOpen, yamlViewLink, yamlDrawerTitle, openYamlDrawer, closeYamlDrawer } =
    useHarvesterResourceLinkYamlDrawer(cloudId);

  const {
    localImages,
    listTaskList,
    uploadTasks,
    uploadTasksLoading,
    reloadUploadTasks,
    onListTaskChange,
    onListTaskRemove,
    handleSyncUploadTask,
    handleDeleteRow,
    batchDelete,
  } = useImagesSectionActions({
    cloudId,
    images,
    vms,
    onRefresh,
    onImagesInventoryReload,
    hasImagesWrite,
    ensureImagesWrite,
  });

  const uploadDrawerRef = useRef<ImageUploadTasksDrawerHandle>(null);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const resumeTaskRef = useRef<HarvesterImageUploadTask | null>(null);

  const handlePickResumeFile = useCallback(() => {
    resumeFileInputRef.current?.click();
  }, []);

  const handleResumeFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      const task = resumeTaskRef.current;
      if (!file || !task) return;
      uploadDrawerRef.current?.resumeUpload(task, file);
      resumeTaskRef.current = null;
    },
    [],
  );

  const handleOpenYaml = useCallback(
    (record: ImageListRecord) => {
      openYamlDrawer(
        { ...record, kind: (record.kind as string) || 'VirtualMachineImage' },
        { title: '镜像 YAML' },
      );
    },
    [openYamlDrawer],
  );

  const handleListTaskRemove = useCallback(
    (taskId: string, opts?: { refreshInventory?: boolean }) => {
      onListTaskRemove(taskId, opts);
      uploadDrawerRef.current?.removeTask(taskId);
    },
    [onListTaskRemove],
  );

  const mergedImages = useMemo(
    () => mergeUploadTasksIntoImageList(localImages, listTaskList, { isPublicNamespace }),
    [localImages, listTaskList, isPublicNamespace],
  );

  const filtered = useMemo(
    () =>
      filterAndSortImages(
        mergedImages,
        { keyword, statusFilter, typeFilter, osFilter, scopeFilter },
        { isTenant },
      ),
    [mergedImages, keyword, statusFilter, typeFilter, osFilter, scopeFilter, isTenant],
  );

  const allColumns = useMemo(
    () =>
      buildImagesTableColumns({
        isTenant,
        hasImagesWrite,
        ensureImagesWrite,
        onOpenYaml: (r) => handleOpenYaml(r),
        onEditLabels: (r) => {
          setLabelEditRecord(r);
          setLabelEditModalOpen(true);
        },
        onDeleteRow: (r) => void handleDeleteRow(r),
        onSyncUploadTask: async (r) => {
          const next = await handleSyncUploadTask(r);
          if (next?.id) uploadDrawerRef.current?.upsertTask(next);
        },
      }),
    [isTenant, hasImagesWrite, ensureImagesWrite, handleOpenYaml, handleDeleteRow, handleSyncUploadTask],
  );

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_images_table');

  const handleToolbarRefresh = useMemo(
    () => createHarvesterToolbarRefresh(onRefresh),
    [onRefresh],
  );

  return (
    <PageDetailSection
      asCard={false}
      toolbarLeft={
        <>
          <Input
            allowClear
            placeholder="名称/项目"
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
          <WriteGuard canWrite={hasImagesWrite}>
            <Button
              type="primary"
              onClick={() => {
                if (!ensureImagesWrite()) return;
                setCreating(true);
              }}
            >
              新增镜像
            </Button>
          </WriteGuard>
          <Button
            onClick={() => {
              uploadDrawerRef.current?.openDrawer(false);
            }}
          >
            上传任务
          </Button>
          <WriteGuard canWrite={hasImagesWrite}>
            <Tooltip title={selectedKeys.length === 0 ? '请先选择镜像' : undefined}>
              <span>
                <Dropdown
                  menu={{
                    items: [
                      { type: 'divider' },
                      {
                        key: 'batchDelete',
                        label: '批量删除',
                        disabled: selectedKeys.length === 0,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (selectedKeys.length === 0) {
                        message.warning('请先选择镜像');
                        return;
                      }
                      if (key === 'batchDelete') {
                        batchDelete(selectedKeys, images, () => setSelectedKeys([]));
                      }
                    },
                  }}
                >
                  <Button
                    icon={<EllipsisOutlined />}
                    disabled={selectedKeys.length === 0}
                  />
                </Dropdown>
              </span>
            </Tooltip>
          </WriteGuard>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey="harvester_images_table" />
          <Button icon={<ReloadOutlined />} onClick={handleToolbarRefresh} loading={loading} />
        </>
      }
    >
      <ImageCreateModal
        open={creating}
        onClose={() => setCreating(false)}
        cloudId={cloudId}
        variant={isTenant ? 'standard' : 'full'}
        isTenant={isTenant}
        tenantDefaultNamespace={tenantDefaultNamespace}
        ensureWrite={ensureImagesWrite}
        onUrlImportSuccess={() =>
          notifyHarvesterImagesInventoryChanged(cloudId, onImagesInventoryReload, {
            inventoryDelaysMs: [0, 2000],
            statusSyncDelaysMs: [3000, 6000, 9000, 12000, 15000, 20000],
          })
        }
        onBrowserUploadSuccess={() =>
          void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true })
        }
        onUploadStarted={() => uploadDrawerRef.current?.openDrawer(true)}
        onStartBrowserUpload={(params) => uploadDrawerRef.current?.startUpload(params)}
      />
      <ImageUploadTasksDrawer
        ref={uploadDrawerRef}
        cloudId={cloudId}
        hasImagesWrite={hasImagesWrite}
        ensureImagesWrite={ensureImagesWrite}
        uploadTasks={uploadTasks}
        uploadTasksLoading={uploadTasksLoading}
        reloadUploadTasks={reloadUploadTasks}
        onListTaskChange={onListTaskChange}
        onListTaskRemove={handleListTaskRemove}
        resumeTaskRef={resumeTaskRef}
        onPickResumeFile={handlePickResumeFile}
      />
      <input
        ref={resumeFileInputRef}
        type="file"
        accept=".iso,.img,.qcow2,.raw,.vmdk,.vdi,.vhd,.vhdx,.qed"
        style={{ display: 'none' }}
        onChange={handleResumeFileChange}
      />
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) =>
          isTowerUploadVirtualRow(r) ? getTowerUploadTaskIdFromRow(r) : getImageRowId(r)
        }
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: setSelectedKeys }}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        pagination={{
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: true }}
      />
      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle || '镜像 YAML'}
      />

      <ImageLabelEditModal
        open={labelEditModalOpen}
        onClose={() => setLabelEditModalOpen(false)}
        cloudId={cloudId}
        resource={labelEditRecord}
        onSuccess={() =>
          void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true })
        }
      />
    </PageDetailSection>
  );
};

export default ImagesSection;
