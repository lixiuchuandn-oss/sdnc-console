/**
 * Harvester - 镜像 (Image) 列表 Section
 * 列表列与筛选见 `ecs/lib/imagesSectionUtils.ts`、`imagesTableColumns.tsx`；
 * 删除/上传任务见 `imagesSectionActions.ts`、`hooks/useImagesSectionActions.tsx`。
 */
import React, { useCallback, useMemo, useState } from 'react';
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
import { ResourceLinkYamlDrawer } from '../../shared/components/ResourceLinkYamlDrawer';
import { useHarvesterResourceLinkYamlDrawer } from '../../shared/lib/useHarvesterResourceLinkYamlDrawer';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import ImageLabelEditModal from '../modals/ImageLabelEditModal';
import ImageCreateModal from '../modals/ImageCreateModal';
import {
  IMAGE_OS_FILTER_OPTIONS,
  IMAGE_STATUS_FILTER_OPTIONS,
  imageUploadTaskStatusLabel,
} from '../lib/imagesSectionConstants';
import {
  filterAndSortImages,
  getImageRowId,
  imageStatusLabelZh,
  type ImageListRecord,
} from '../lib/imagesSectionUtils';
import { buildImagesTableColumns } from '../lib/imagesTableColumns';
import { useImagesSectionActions } from '../hooks/useImagesSectionActions';
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
};

const ImagesSection: React.FC<Props> = ({
  cloudId,
  images,
  loading,
  onRefresh,
  vms = [],
  isTenant = false,
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
    toolTaskList,
    taskDrawerOpen,
    setTaskDrawerOpen,
    taskDrawerLoading,
    loadUploadTasks,
    getSmoothProgress,
    upsertTask,
    uploadControllersRef,
    handleDeleteUploadTask,
    handleCancelUploadTask,
    handleDeleteRow,
    batchDelete,
  } = useImagesSectionActions({
    cloudId,
    images,
    vms,
    onRefresh,
    hasImagesWrite,
    ensureImagesWrite,
  });

  const handleOpenYaml = useCallback(
    (record: ImageListRecord) => {
      openYamlDrawer(
        { ...record, kind: (record.kind as string) || 'VirtualMachineImage' },
        { title: '镜像 YAML' },
      );
    },
    [openYamlDrawer],
  );

  const filtered = useMemo(
    () =>
      filterAndSortImages(
        localImages,
        { keyword, statusFilter, typeFilter, osFilter, scopeFilter },
        { isTenant },
      ),
    [localImages, keyword, statusFilter, typeFilter, osFilter, scopeFilter, isTenant],
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
      }),
    [isTenant, hasImagesWrite, ensureImagesWrite, handleOpenYaml, handleDeleteRow],
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
                    if (key === 'batchDelete') {
                      batchDelete(selectedKeys, images, () => setSelectedKeys([]));
                    }
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
        onUrlImportSuccess={() =>
          void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true })
        }
        onBrowserUploadSuccess={() =>
          void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true })
        }
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
      <ResourceLinkYamlDrawer
        open={yamlDrawerOpen}
        onClose={closeYamlDrawer}
        cloudId={cloudId}
        viewLink={yamlViewLink}
        title={yamlDrawerTitle || '镜像 YAML'}
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
        onSuccess={() =>
          void runHarvesterSectionRefresh(onRefresh, { force: true, silent: true })
        }
      />
    </PageDetailSection>
  );
};

export default ImagesSection;
