import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudUploadOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, Button, Input, Modal, Progress, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import {
  deleteMaasImage,
  fetchMaasImageSyncStatus,
  fetchMaasImages,
  maasImagesSync,
  maasImagesSyncStop,
} from '../../../../../services/maasApi';
import type { MaasImageGroup, MaasImageVariant } from '../lib/maasImages';
import {
  formatMaasImageSize,
  maasImageStatusLabel,
  maasPlatformLabel,
} from '../lib/maasImages';
import { MAAS_LIST_TABLE_PAGINATION } from '../lib/maasTablePagination';
import { MaasToolbarRefresh } from '../lib/maasToolbar';

const SYNC_POLL_MS = 5000;

type Props = {
  poolId: string;
};

const variantColumns: ColumnsType<MaasImageVariant> = [
  { title: '内核 / 架构', dataIndex: 'label', key: 'label' },
  { title: '架构标识', dataIndex: 'architecture', key: 'architecture', ellipsis: true },
  {
    title: '大小',
    key: 'size',
    render: (_, r) => formatMaasImageSize(r.size_bytes),
  },
  {
    title: '默认',
    key: 'default',
    render: (_, r) => (r.is_default ? <Tag color="blue">默认</Tag> : '—'),
  },
];

const ImagesSection: React.FC<Props> = ({ poolId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<MaasImageGroup[]>([]);
  const [keyword, setKeyword] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [syncActionLoading, setSyncActionLoading] = useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!poolId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaasImages(poolId, { skipCache: true });
      if (!res?.ok) {
        setError(res?.message || '拉取镜像失败');
        return;
      }
      setRows(Array.isArray(res.items) ? res.items : []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '拉取镜像失败');
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  const loadSyncStatus = useCallback(async () => {
    if (!poolId) return false;
    try {
      const res = await fetchMaasImageSyncStatus(poolId, { skipCache: true });
      if (!res?.ok) return false;
      setIsImporting(!!res.is_importing);
      return !!res.is_importing;
    } catch {
      return false;
    }
  }, [poolId]);

  const refreshAll = useCallback(async () => {
    await loadSyncStatus();
    await loadList();
  }, [loadList, loadSyncStatus]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (!isImporting || !poolId) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const importing = await loadSyncStatus();
        await loadList();
        if (!importing) {
          message.success('镜像同步已完成');
        }
      })();
    }, SYNC_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isImporting, poolId, loadList, loadSyncStatus]);

  const handleSync = useCallback(async () => {
    if (!poolId) return;
    setSyncActionLoading(true);
    try {
      const res = await maasImagesSync(poolId);
      if (!res?.ok) {
        message.error(res?.message || '启动同步失败');
        return;
      }
      message.success(res.message || '已开始同步');
      setIsImporting(true);
      void loadList();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '启动同步失败');
    } finally {
      setSyncActionLoading(false);
    }
  }, [poolId, loadList]);

  const handleStopSync = useCallback(async () => {
    if (!poolId) return;
    setSyncActionLoading(true);
    try {
      const res = await maasImagesSyncStop(poolId);
      if (!res?.ok) {
        message.error(res?.message || '停止同步失败');
        return;
      }
      message.success(res.message || '已请求停止同步');
      await loadSyncStatus();
      await loadList();
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : '停止同步失败');
    } finally {
      setSyncActionLoading(false);
    }
  }, [poolId, loadList, loadSyncStatus]);

  const handleDelete = useCallback(
    (record: MaasImageGroup) => {
      Modal.confirm({
        title: '删除镜像',
        content: (
          <>
            确定删除「{record.display_name}」的默认安装包？
            {record.variant_count > 1 ? (
              <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                仅删除默认内核变体（resource id={String(record.default_resource_id)}）。
                同版本其它内核变体需单独处理。
              </div>
            ) : null}
          </>
        ),
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          setDeleteLoadingId(String(record.default_resource_id));
          try {
            const res = await deleteMaasImage(poolId, record.default_resource_id);
            if (!res?.ok) {
              message.error(res?.message || '删除失败');
              return;
            }
            message.success(res.message || '已删除');
            await loadList();
          } catch (e: unknown) {
            message.error(e instanceof Error ? e.message : '删除失败');
          } finally {
            setDeleteLoadingId(null);
          }
        },
      });
    },
    [poolId, loadList],
  );

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.display_name.toLowerCase().includes(q) ||
        r.osystem.toLowerCase().includes(q) ||
        r.distro_series.toLowerCase().includes(q) ||
        maasPlatformLabel(r.platform).toLowerCase().includes(q),
    );
  }, [rows, keyword]);

  const columns: ColumnsType<MaasImageGroup> = [
    {
      title: '操作系统',
      dataIndex: 'display_name',
      key: 'display_name',
      fixed: 'left',
      ellipsis: true,
      render: (v: string, r) => (
        <span>
          {v}
          {r.variant_count > 1 ? (
            <span style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 12 }}>
              {r.variant_count} 个内核变体
            </span>
          ) : null}
        </span>
      ),
    },
    {
      title: '平台',
      key: 'platform',
      render: (_, r) => maasPlatformLabel(r.platform),
    },
    {
      title: '大小',
      key: 'size',
      render: (_, r) => formatMaasImageSize(r.size_bytes),
    },
    {
      title: '状态',
      key: 'status',
      render: (_, r) => {
        const label = maasImageStatusLabel(r.status);
        const color =
          r.status === 'ready' ? 'success' : r.status === 'downloading' ? 'processing' : 'default';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      render: (_, record) => (
        <RowActionsButton
          items={[{ key: 'delete', label: '删除', danger: true }]}
          onClick={({ key }) => {
            if (key === 'delete') handleDelete(record);
          }}
        />
      ),
    },
  ];

  return (
    <PageDetailSection
      asCard={false}
      title="操作系统镜像"
      toolbarLeft={
        <>
          <Input
            allowClear
            className="toolbar-search"
            placeholder="操作系统名称"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => setKeyword('')}
          >
            重置
          </button>
        </>
      }
      toolbarRight={
        <div className="toolbar-actions">
          <Button
            type="primary"
            loading={syncActionLoading}
            disabled={isImporting}
            onClick={() => void handleSync()}
          >
            同步镜像
          </Button>
          <Button
            disabled={!isImporting || syncActionLoading}
            onClick={() => void handleStopSync()}
          >
            停止同步
          </Button>
          <Tooltip title="分片上传将在后续版本提供（M4）">
            <Button icon={<CloudUploadOutlined />} disabled>
              上传自定义镜像
            </Button>
          </Tooltip>
          <MaasToolbarRefresh loading={loading} onRefresh={() => void refreshAll()} />
        </div>
      }
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      {isImporting ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="正在从官方源同步镜像"
          description={
            <Progress percent={100} status="active" showInfo={false} style={{ marginTop: 8 }} />
          }
        />
      ) : null}
      <Table<MaasImageGroup>
        className="std-table"
        bordered={false}
        rowKey="group_id"
        loading={loading || !!deleteLoadingId}
        columns={columns}
        dataSource={filtered}
        scroll={{ x: true }}
        pagination={MAAS_LIST_TABLE_PAGINATION}
        expandable={{
          rowExpandable: (r) => r.variant_count > 1,
          expandedRowRender: (record) => (
            <Table<MaasImageVariant>
              className="std-table"
              bordered={false}
              rowKey={(v) => String(v.resource_id)}
              columns={variantColumns}
              dataSource={record.variants}
              pagination={false}
              scroll={{ x: true }}
            />
          ),
        }}
      />
    </PageDetailSection>
  );
};

export default ImagesSection;
