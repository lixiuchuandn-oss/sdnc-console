/**
 * Xinference 资源池 · 运行模型（instances CREATING/ERROR + models READY 合并）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Input, Select, Space, Table, Tabs, Typography, message } from 'antd';
import { LoadingOutlined, PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import PageDetailSection from '../../../../../components/PageDetailSection';
import {
  XINFERENCE_GALLERY_MODEL_TYPES,
  modelTypeLabel,
  type XinferenceGalleryModelType,
} from '../lib/xinferenceModelRegistry';
import ModelReplicaDetailModal from '../components/ModelReplicaDetailModal';
import {
  countActiveCreating,
  filterPoolModelsByKeyword,
  filterPoolModelsByStatus,
  filterPoolModelsByType,
  mergeRunningModelsAndInstances,
  parsePoolModelStatusFilter,
  type PoolModelStatusFilter,
  type XinferencePoolModelRow,
} from '../lib/mergeRunningModels';
import { buildRunningModelsTableColumns } from '../lib/runningModelsTableColumns';
import {
  LAUNCH_PROGRESS_POLL_MS,
  matchModelInstanceUid,
  notifyCancelLaunchFailure,
  notifyRemoveInstanceMetadataFailure,
} from '../lib/launchProgressUtils';
import {
  cancelXinferenceModelLaunch,
  fetchXinferenceLaunchProgress,
  removeXinferenceInstanceMetadata,
  fetchXinferenceModelInstances,
  fetchXinferencePoolModels,
  terminateXinferenceModel,
} from '../../../../../services/xinferenceApi';

type Props = {
  poolId: string;
};

const LIST_POLL_IDLE_MS = 15000;
const CANCEL_VERIFY_DELAY_MS = 5000;

const STATUS_FILTER_OPTIONS: { label: string; value: PoolModelStatusFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '下载/加载中', value: 'creating' },
  { label: '已就绪', value: 'ready' },
  { label: '失败', value: 'error' },
];

const RunningModelsSection: React.FC<Props> = ({ poolId }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [modelType, setModelType] = useState<XinferenceGalleryModelType>('LLM');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<PoolModelStatusFilter>(() =>
    parsePoolModelStatusFilter(searchParams.get('status')),
  );
  const [rows, setRows] = useState<XinferencePoolModelRow[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [warnMsg, setWarnMsg] = useState<string | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [cancellingUid, setCancellingUid] = useState<string | null>(null);
  const [cancelAttemptedUids, setCancelAttemptedUids] = useState<Set<string>>(() => new Set());
  const [replicaModal, setReplicaModal] = useState<{ uid: string; name: string } | null>(null);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const progressPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const listPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelVerifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorNotifiedUidsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setStatusFilter(parsePoolModelStatusFilter(searchParams.get('status')));
  }, [searchParams]);

  const handleStatusFilterChange = useCallback(
    (v: PoolModelStatusFilter) => {
      setStatusFilter(v);
      const next = new URLSearchParams(searchParams);
      if (v === 'all') next.delete('status');
      else next.set('status', v);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const syncCancelAttempted = useCallback((list: XinferencePoolModelRow[]) => {
    const alive = new Set(list.map((i) => i.modelUid));
    setCancelAttemptedUids((prev) => {
      const next = new Set<string>();
      for (const uid of prev) {
        if (alive.has(uid)) next.add(uid);
      }
      return next.size === prev.size ? prev : next;
    });
  }, []);

  /** 与启动抽屉一致：拉 progress，失败保留上次值（不置 0） */
  const refreshProgressForUids = useCallback(
    async (uids: string[]) => {
      if (!poolId || uids.length === 0) return;
      const entries = await Promise.all(
        uids.map(async (uid) => {
          try {
            const p = await fetchXinferenceLaunchProgress(poolId, uid);
            return { uid, p } as const;
          } catch {
            return null;
          }
        }),
      );
      setProgressMap((prev) => {
        const next = { ...prev };
        for (const item of entries) {
          if (item) next[item.uid] = item.p;
        }
        return next;
      });
    },
    [poolId],
  );

  const applyPoolModels = useCallback(
    (
      ready: Awaited<ReturnType<typeof fetchXinferencePoolModels>>['ready'],
      instances: Awaited<ReturnType<typeof fetchXinferencePoolModels>>['instances'],
      meta: Pick<
        Awaited<ReturnType<typeof fetchXinferencePoolModels>>,
        'instancesDegraded' | 'instancesMessage' | 'modelsDegraded' | 'modelsMessage'
      >,
    ) => {
      const merged = mergeRunningModelsAndInstances(ready, instances);
      setRows(merged);
      syncCancelAttempted(merged);
      if (countActiveCreating(merged) === 0) setRestartRequired(false);
      const warnings: string[] = [];
      if (meta.instancesDegraded && meta.instancesMessage) warnings.push(meta.instancesMessage);
      if (meta.modelsDegraded && meta.modelsMessage) warnings.push(meta.modelsMessage);
      setWarnMsg(warnings.length ? warnings.join('；') : null);
      return merged;
    },
    [syncCancelAttempted],
  );

  const load = useCallback(async () => {
    if (!poolId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    setWarnMsg(null);
    try {
      const pool = await fetchXinferencePoolModels(poolId, { skipCache: true });
      const merged = applyPoolModels(pool.ready, pool.instances, pool);
      const creatingUids = merged
        .filter((m) => m.lifecycleStatus.toUpperCase() === 'CREATING')
        .map((m) => m.modelUid);
      await refreshProgressForUids(creatingUids);
    } catch (e: unknown) {
      setRows([]);
      setErr(e instanceof Error ? e.message : '加载运行模型失败');
    } finally {
      setLoading(false);
    }
  }, [poolId, applyPoolModels, refreshProgressForUids]);

  const reloadQuiet = useCallback(async () => {
    if (!poolId) return;
    try {
      const pool = await fetchXinferencePoolModels(poolId, { skipCache: true });
      applyPoolModels(pool.ready, pool.instances, pool);
    } catch {
      /* 静默 */
    }
  }, [poolId, applyPoolModels]);

  /** 与启动抽屉 pollLaunchProgress 一致：2s 拉 progress + instances，并刷新合并列表 */
  const pollCreatingFast = useCallback(async () => {
    if (!poolId) return;
    const creating = rowsRef.current.filter(
      (m) => m.lifecycleStatus.toUpperCase() === 'CREATING',
    );
    if (creating.length === 0) return;

    const uids = creating.map((m) => m.modelUid);
    await refreshProgressForUids(uids);

    try {
      const [pool, instancesRes] = await Promise.all([
        fetchXinferencePoolModels(poolId, { skipCache: true }),
        fetchXinferenceModelInstances(poolId, { skipCache: true }).catch(() => null),
      ]);
      const merged = applyPoolModels(pool.ready, pool.instances, pool);

      const aliveUids = new Set(merged.map((m) => m.modelUid));
      for (const uid of errorNotifiedUidsRef.current) {
        if (!aliveUids.has(uid)) errorNotifiedUidsRef.current.delete(uid);
      }

      for (const uid of uids) {
        const inst = instancesRes?.instances?.find((i) => matchModelInstanceUid(i.modelUid, uid));
        const st = inst?.status?.toUpperCase();
        if (st === 'ERROR' && !errorNotifiedUidsRef.current.has(uid)) {
          errorNotifiedUidsRef.current.add(uid);
          message.error(inst?.errorMessage || `模型 ${uid} 启动失败，请查看集群日志`);
        }
      }
    } catch {
      /* 轮询偶发失败时继续 */
    }
  }, [poolId, applyPoolModels, refreshProgressForUids]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (cancelVerifyTimerRef.current) clearTimeout(cancelVerifyTimerRef.current);
    };
  }, []);

  const activeCreatingCount = useMemo(() => countActiveCreating(rows), [rows]);

  useEffect(() => {
    if (progressPollTimerRef.current) {
      clearInterval(progressPollTimerRef.current);
      progressPollTimerRef.current = null;
    }
    if (listPollTimerRef.current) {
      clearInterval(listPollTimerRef.current);
      listPollTimerRef.current = null;
    }
    if (!poolId) return;

    if (activeCreatingCount > 0) {
      void pollCreatingFast();
      progressPollTimerRef.current = setInterval(
        () => void pollCreatingFast(),
        LAUNCH_PROGRESS_POLL_MS,
      );
    } else {
      listPollTimerRef.current = setInterval(() => void reloadQuiet(), LIST_POLL_IDLE_MS);
    }

    return () => {
      if (progressPollTimerRef.current) clearInterval(progressPollTimerRef.current);
      if (listPollTimerRef.current) clearInterval(listPollTimerRef.current);
    };
  }, [activeCreatingCount, poolId, pollCreatingFast, reloadQuiet]);

  const rowsByType = useMemo(() => filterPoolModelsByType(rows, modelType), [rows, modelType]);
  const rowsByStatus = useMemo(
    () => filterPoolModelsByStatus(rowsByType, statusFilter),
    [rowsByType, statusFilter],
  );
  const filteredRows = useMemo(
    () => filterPoolModelsByKeyword(rowsByStatus, keyword),
    [rowsByStatus, keyword],
  );

  const handleTerminate = useCallback(
    async (modelUid: string) => {
      try {
        await terminateXinferenceModel(poolId, modelUid);
        message.success('已停止模型');
        await load();
      } catch (e: unknown) {
        message.error(e instanceof Error ? e.message : '停止模型失败');
      }
    },
    [load, poolId],
  );

  const schedulePostActionRefresh = useCallback(() => {
    if (cancelVerifyTimerRef.current) clearTimeout(cancelVerifyTimerRef.current);
    cancelVerifyTimerRef.current = setTimeout(() => void reloadQuiet(), CANCEL_VERIFY_DELAY_MS);
  }, [reloadQuiet]);

  const handleCancelLaunch = useCallback(
    async (modelUid: string) => {
      if (cancelAttemptedUids.has(modelUid)) {
        message.warning('已请求取消该模型，请勿重复操作');
        return;
      }
      setCancellingUid(modelUid);
      setCancelAttemptedUids((prev) => new Set(prev).add(modelUid));
      try {
        await cancelXinferenceModelLaunch(poolId, modelUid);
        message.success('已请求取消，约 5 秒后将自动刷新确认');
        schedulePostActionRefresh();
      } catch (e: unknown) {
        if (notifyCancelLaunchFailure(e)) setRestartRequired(true);
        await reloadQuiet();
      } finally {
        setCancellingUid(null);
      }
    },
    [cancelAttemptedUids, poolId, reloadQuiet, schedulePostActionRefresh],
  );

  const handleRemoveMetadata = useCallback(
    async (modelUid: string) => {
      if (cancelAttemptedUids.has(modelUid)) {
        message.warning('已请求清理该实例记录，请勿重复操作');
        return;
      }
      setCancellingUid(modelUid);
      setCancelAttemptedUids((prev) => new Set(prev).add(modelUid));
      try {
        const r = await removeXinferenceInstanceMetadata(poolId, modelUid);
        message.success(r.removed ? '已清理实例元数据' : '操作完成');
        schedulePostActionRefresh();
        await reloadQuiet();
      } catch (e: unknown) {
        notifyRemoveInstanceMetadataFailure(e);
        await reloadQuiet();
      } finally {
        setCancellingUid(null);
      }
    },
    [cancelAttemptedUids, poolId, reloadQuiet, schedulePostActionRefresh],
  );

  const columns = useMemo(
    () =>
      buildRunningModelsTableColumns({
        modelType,
        progressMap,
        cancelAttemptedUids,
        cancellingUid,
        onTerminate: (uid) => void handleTerminate(uid),
        onCancelLaunch: (uid) => void handleCancelLaunch(uid),
        onRemoveMetadata: (uid) => void handleRemoveMetadata(uid),
        onReplicaDetail: (row) =>
          setReplicaModal({ uid: row.modelUid, name: row.modelName }),
      }),
    [
      modelType,
      progressMap,
      cancelAttemptedUids,
      cancellingUid,
      handleCancelLaunch,
      handleRemoveMetadata,
      handleTerminate,
    ],
  );

  if (!poolId) {
    return <Alert type="warning" message="缺少资源池参数" showIcon />;
  }

  return (
    <>
      {err && <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} />}
      {warnMsg && !err && (
        <Alert type="warning" message={warnMsg} showIcon style={{ marginBottom: 16 }} />
      )}
      {restartRequired && !err && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="疑似僵尸下载：Cancel 接口已失效"
          description="请勿再点击取消，请在 Xinference 节点执行 stop.sh → start.sh 后刷新本页。"
        />
      )}
      <PageDetailSection
        title="运行模型"
        icon={<PlayCircleOutlined style={{ color: '#1677ff', fontSize: 20 }} />}
        asCard={false}
      >
        <Tabs
          activeKey={modelType}
          onChange={(k) => setModelType(k as XinferenceGalleryModelType)}
          items={XINFERENCE_GALLERY_MODEL_TYPES.map((t) => ({ key: t.key, label: t.label }))}
          tabBarExtraContent={
            <Typography.Text type="secondary">
              {activeCreatingCount > 0 ? (
                <Space size={4}>
                  <LoadingOutlined spin style={{ color: '#1677ff' }} />
                  <span>
                    下载/加载中 {activeCreatingCount} 个 · 每 {LAUNCH_PROGRESS_POLL_MS / 1000}s
                    刷新进度
                  </span>
                </Space>
              ) : (
                `展示 ${filteredRows.length}/${rowsByType.length} 个`
              )}
            </Typography.Text>
          }
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 16,
          }}
        >
          <Space wrap>
            <Select
              value={statusFilter}
              style={{ width: 148 }}
              options={STATUS_FILTER_OPTIONS}
              onChange={(v: PoolModelStatusFilter) => handleStatusFilterChange(v)}
            />
            <Input.Search
              allowClear
              placeholder="搜索模型 UID、名称、引擎等"
              style={{ width: 280 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={(v) => setKeyword(v)}
            />
          </Space>
          <Button type="primary" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新{modelTypeLabel(modelType)}
          </Button>
        </div>

        <Table
          className="std-table no-border"
          bordered={false}
          rowKey="modelUid"
          columns={columns}
          dataSource={filteredRows}
          loading={loading}
          scroll={{ x: true }}
          pagination={{ showTotal: (total) => `共 ${total} 条` }}
          locale={{
            emptyText: keyword.trim()
              ? '无匹配记录'
              : statusFilter === 'creating'
                ? '暂无下载/加载中的模型，请前往「模型广场」启动'
                : `暂无${modelTypeLabel(modelType)}记录`,
          }}
        />
      </PageDetailSection>

      <ModelReplicaDetailModal
        open={!!replicaModal}
        poolId={poolId}
        modelUid={replicaModal?.uid ?? ''}
        modelName={replicaModal?.name}
        onClose={() => setReplicaModal(null)}
      />
    </>
  );
};

export default RunningModelsSection;