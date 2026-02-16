/**
 * Harvester - 虚拟机热迁移弹窗
 *
 * 负责发起 Harvester VM 的实时迁移：
 * - 自动探测当前 VM 所在节点（优先使用 VM.status.nodeName，必要时回查 VMI）；
 * - 展示当前节点与目标节点的资源对比：CPU / 内存 / 可承载 VM 数量（估算）；
 * - 支持选择“最佳节点（自动调度）”或指定目标节点；
 * - 提交时调用 migrateHarvesterVm，携带 instanceId 与目标节点。
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Form, Select, Alert, message, Typography, Table, Space, Row, Col, Input, Progress } from 'antd';
import StdFormModal from '../../../../components/StdFormModal';
import { migrateHarvesterVm, fetchHarvesterResourceByLink, fetchHarvesterNodeDetail } from '../../../../services/harvesterApi';

const { Text } = Typography;

/**
 * 组件入参
 * - open: 弹窗是否打开
 * - onClose: 关闭回调
 * - onOk: 迁移任务提交成功回调
 * - cloudId: 云 ID
 * - vm: 当前需要迁移的 Harvester VM 对象
 * - nodes: 当前集群可用于迁移的节点列表
 */
interface HarvesterMigrateModalProps {
  open: boolean;
  onClose: () => void;
  onOk: () => void;
  cloudId: string;
  vm: any; // Harvester VM Object
  nodes: any[]; // List of available nodes
}

const HarvesterMigrateModal: React.FC<HarvesterMigrateModalProps> = ({
  open,
  onClose,
  onOk,
  cloudId,
  vm,
  nodes,
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [currentNodeName, setCurrentNodeName] = useState<string | null>(null);
  const [targetNodeName, setTargetNodeName] = useState<string | null>(null);
  const [vmiLoading, setVmiLoading] = useState(false);
  const [currentNodeDetail, setCurrentNodeDetail] = useState<any | null>(null);
  const [targetNodeDetail, setTargetNodeDetail] = useState<any | null>(null);
  const [currentNodeMetrics, setCurrentNodeMetrics] = useState<any | null>(null);
  const [targetNodeMetrics, setTargetNodeMetrics] = useState<any | null>(null);
  const [currentNodePodsCount, setCurrentNodePodsCount] = useState<number | null>(null);
  const [targetNodePodsCount, setTargetNodePodsCount] = useState<number | null>(null);

  // 弹窗打开时：
  // - 重置表单
  // - 初始化当前节点（优先取 VM.status.nodeName，如无则再查 VMI）
  // - 默认选择“最佳节点（自动调度）”
  useEffect(() => {
    if (open) {
      form.resetFields();
      setTargetNodeName(null);
      const n = vm?.status?.nodeName || null;
      setCurrentNodeName(n);
      try {
        // 默认选择“最佳节点（自动调度）”
        setTargetNodeName(null);
        try { form.setFieldsValue({ targetNode: '__AUTO__' }); } catch {}
      } catch {}
      if (!n && vm?.metadata?.namespace && vm?.metadata?.name) {
        setVmiLoading(true);
        const path = `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(vm.metadata.namespace)}/virtualmachineinstances/${encodeURIComponent(vm.metadata.name)}`;
        fetchHarvesterResourceByLink(cloudId, path)
          .then((v) => {
            const nn = v?.status?.nodeName || null;
            if (nn) setCurrentNodeName(nn);
          })
          .catch(() => {})
          .finally(() => setVmiLoading(false));
      }
    }
  }, [open, form]);

  // 加载当前节点详情（容量/可分配资源）
  useEffect(() => {
    const name = currentNodeName;
    if (!open || !name) {
      setCurrentNodeDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchHarvesterNodeDetail(cloudId, name);
        if (!cancelled) setCurrentNodeDetail(json?.data || json);
      } catch {
        if (!cancelled) setCurrentNodeDetail(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, cloudId, currentNodeName]);

  // 加载目标节点详情 + 目标节点上当前 Pod 数量，用于估算可再承载的 VM 数量
  useEffect(() => {
    const name = targetNodeName;
    if (!open || !name) {
      setTargetNodeDetail(null);
      setTargetNodePodsCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const json = await fetchHarvesterNodeDetail(cloudId, name);
        if (!cancelled) setTargetNodeDetail(json?.data || json);
      } catch {
        if (!cancelled) setTargetNodeDetail(null);
      }
      try {
        const path = `/api/v1/pods?fieldSelector=${encodeURIComponent(`spec.nodeName=${name}`)}`;
        const podsJson = await fetchHarvesterResourceByLink(cloudId, path);
        const cnt = Array.isArray(podsJson?.items) ? podsJson.items.length : 0;
        if (!cancelled) setTargetNodePodsCount(cnt);
      } catch {
        if (!cancelled) setTargetNodePodsCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, cloudId, targetNodeName]);

  // 加载当前节点的实时 metrics（CPU/内存使用量）以及当前节点 Pod 数
  useEffect(() => {
    const name = currentNodeName;
    if (!open || !name) {
      setCurrentNodeMetrics(null);
      setCurrentNodePodsCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const path = `/apis/metrics.k8s.io/v1beta1/nodes/${encodeURIComponent(name)}`;
        const json = await fetchHarvesterResourceByLink(cloudId, path);
        if (!cancelled) setCurrentNodeMetrics(json);
      } catch {
        if (!cancelled) setCurrentNodeMetrics(null);
      }
      try {
        const podsPath = `/api/v1/pods?fieldSelector=${encodeURIComponent(`spec.nodeName=${name}`)}`;
        const podsJson = await fetchHarvesterResourceByLink(cloudId, podsPath);
        const cnt = Array.isArray(podsJson?.items) ? podsJson.items.length : 0;
        if (!cancelled) setCurrentNodePodsCount(cnt);
      } catch {
        if (!cancelled) setCurrentNodePodsCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, cloudId, currentNodeName]);

  // 加载目标节点的实时 metrics（CPU/内存使用量）
  useEffect(() => {
    const name = targetNodeName;
    if (!open || !name) {
      setTargetNodeMetrics(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const path = `/apis/metrics.k8s.io/v1beta1/nodes/${encodeURIComponent(name)}`;
        const json = await fetchHarvesterResourceByLink(cloudId, path);
        if (!cancelled) setTargetNodeMetrics(json);
      } catch {
        if (!cancelled) setTargetNodeMetrics(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, cloudId, targetNodeName]);

  /**
   * 提交迁移任务：
   * - instanceId 统一使用 namespace/name 形式；
   * - targetNode 为 "__AUTO__" 时传 undefined 以启用调度。
   */
  const handleFinish = async (values: any) => {
    try {
      setLoading(true);

      const instanceId = vm?.metadata?.namespace && vm?.metadata?.name 
        ? `${vm.metadata.namespace}/${vm.metadata.name}` 
        : (vm?.id || '');

      if (!instanceId) {
        throw new Error('无法识别虚拟机 ID');
      }

      const target = values?.targetNode === '__AUTO__' ? undefined : values?.targetNode;
      await migrateHarvesterVm(cloudId, instanceId, target);
      
      message.success('迁移任务已提交');
      onOk();
      onClose();
    } catch (error: any) {
      message.error(error.message || '迁移请求失败');
    } finally {
      setLoading(false);
    }
  };

  const vmName = vm?.metadata?.name || '-';
  const currentNode = currentNodeName || vm?.status?.nodeName;

  // Filter out current node from options if needed, or just show all
  // 节点下拉选项（排除当前所在节点）
  const nodeOptions = nodes
    .filter(n => n?.metadata?.name !== currentNode)
    .map(n => ({
      label: n?.metadata?.name,
      value: n?.metadata?.name,
    }));
  // 下拉选项首项为“最佳节点（自动调度）”
  const selectOptions = useMemo(() => ([
    { label: '最佳节点（自动调度）', value: '__AUTO__' },
    ...nodeOptions
  ]), [nodeOptions]);

  // 将节点数组转换为 name -> node 的 Map，便于后续查找
  const nodeMap = useMemo(() => {
    const m: Record<string, any> = {};
    nodes.forEach(n => {
      const name = n?.metadata?.name;
      if (name) m[name] = n;
    });
    return m;
  }, [nodes]);

  const metricsRows = useMemo(() => {
    const cur = currentNodeDetail || (currentNode ? nodeMap[currentNode] : null);
    const tgt = targetNodeDetail || (targetNodeName ? nodeMap[targetNodeName] : null);
    const curCap = cur?.status?.capacity || cur?.capacity || {};
    const curAlloc = cur?.status?.allocatable || cur?.allocatable || {};
    const tgtCap = tgt?.status?.capacity || tgt?.capacity || {};
    const tgtAlloc = tgt?.status?.allocatable || tgt?.allocatable || {};
    return [
      { key: 'cpu', metric: 'CPU(核)', current: curAlloc?.cpu || curCap?.cpu || '-', target: tgtAlloc?.cpu || tgtCap?.cpu || '-' },
      { key: 'memory', metric: '内存', current: curAlloc?.memory || curCap?.memory || '-', target: tgtAlloc?.memory || tgtCap?.memory || '-' },
      { key: 'pods', metric: '可分配Pod', current: curAlloc?.pods || curCap?.pods || '-', target: tgtAlloc?.pods || tgtCap?.pods || '-' },
    ];
  }, [currentNodeDetail, targetNodeDetail, currentNode, targetNodeName, nodeMap]);

  const columnsCurrent = [
    { title: '指标', dataIndex: 'metric', key: 'metric', width: 140 },
    { title: '当前节点', dataIndex: 'value', key: 'value', render: (t: any, row: any) => (
      <div>
        <div style={{ whiteSpace: 'pre-line', marginBottom: 4 }}>{t}</div>
        {typeof row?.pct === 'number' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress percent={Math.max(0, Math.min(100, row.pct))} size="small" showInfo={false} />
            <span>{Math.max(0, Math.min(100, row.pct)).toFixed(1)}%</span>
          </div>
        ) : null}
      </div>
    ) },
  ];

  const columnsTarget = [
    { title: '指标', dataIndex: 'metric', key: 'metric', width: 140 },
    { title: '目标节点', dataIndex: 'value', key: 'value', render: (t: any, row: any) => (
      <div>
        <div style={{ whiteSpace: 'pre-line', marginBottom: 4 }}>{t}</div>
        {typeof row?.pct === 'number' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Progress percent={Math.max(0, Math.min(100, row.pct))} size="small" showInfo={false} />
            <span>{Math.max(0, Math.min(100, row.pct)).toFixed(1)}%</span>
          </div>
        ) : null}
      </div>
    ) },
  ];

  const toCores = (q?: string): string => {
    if (!q) return '-';
    const s = String(q).trim();
    if (/m$/i.test(s)) {
      const v = Number(s.replace(/m$/i, ''));
      if (!isFinite(v)) return '-';
      return `${(v / 1000).toFixed(2)} 核`;
    } else if (/n$/i.test(s)) {
      const v = Number(s.replace(/n$/i, ''));
      if (!isFinite(v)) return '-';
      return `${(v / 1e9).toFixed(4)} 核`;
    } else if (/u$/i.test(s)) {
      const v = Number(s.replace(/u$/i, ''));
      if (!isFinite(v)) return '-';
      return `${(v / 1e6).toFixed(4)} 核`;
    }
    const v = Number(s);
    if (!isFinite(v)) return '-';
    return `${v.toFixed(2)} 核`;
  };

  const toGiB = (q?: string): string => {
    if (!q) return '-';
    const s = String(q).trim();
    const m = s.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
    if (!m) return '-';
    const val = Number(m[1]);
    const unit = (m[2] || '').toLowerCase();
    let bytes = val;
    if (unit === 'ki') bytes = val * 1024;
    else if (unit === 'mi') bytes = val * 1024 * 1024;
    else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
    else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
    else if (unit === 'k') bytes = val * 1000;
    else if (unit === 'm') bytes = val * 1e6;
    else if (unit === 'g') bytes = val * 1e9;
    else if (unit === 't') bytes = val * 1e12;
    const gib = bytes / (1024 * 1024 * 1024);
    return `${gib.toFixed(2)} GiB`;
  };

  const displayRows = useMemo(() => {
    const curCap = metricsRows && metricsRows.length ? metricsRows : [];
    const curCpuRaw = (currentNodeDetail?.status?.allocatable?.cpu || currentNodeDetail?.status?.capacity?.cpu || nodeMap[currentNode || '']?.status?.allocatable?.cpu || nodeMap[currentNode || '']?.status?.capacity?.cpu) as string | undefined;
    const curMemRaw = (currentNodeDetail?.status?.allocatable?.memory || currentNodeDetail?.status?.capacity?.memory || nodeMap[currentNode || '']?.status?.allocatable?.memory || nodeMap[currentNode || '']?.status?.capacity?.memory) as string | undefined;
    const tgtCpuRaw = (targetNodeDetail?.status?.allocatable?.cpu || targetNodeDetail?.status?.capacity?.cpu || nodeMap[targetNodeName || '']?.status?.allocatable?.cpu || nodeMap[targetNodeName || '']?.status?.capacity?.cpu) as string | undefined;
    const tgtMemRaw = (targetNodeDetail?.status?.allocatable?.memory || targetNodeDetail?.status?.capacity?.memory || nodeMap[targetNodeName || '']?.status?.allocatable?.memory || nodeMap[targetNodeName || '']?.status?.capacity?.memory) as string | undefined;
    const curPodsRaw = (currentNodeDetail?.status?.allocatable?.pods || currentNodeDetail?.status?.capacity?.pods || nodeMap[currentNode || '']?.status?.allocatable?.pods || nodeMap[currentNode || '']?.status?.capacity?.pods) as string | number | undefined;
    const tgtPodsRaw = (targetNodeDetail?.status?.allocatable?.pods || targetNodeDetail?.status?.capacity?.pods || nodeMap[targetNodeName || '']?.status?.allocatable?.pods || nodeMap[targetNodeName || '']?.status?.capacity?.pods) as string | number | undefined;
    const toInt = (v: any): number | undefined => {
      if (v == null) return undefined;
      const n = parseInt(String(v), 10);
      return Number.isFinite(n) ? n : undefined;
    };
    const curPodsAlloc = toInt(curPodsRaw);
    const tgtPodsAlloc = toInt(tgtPodsRaw);
    const curPodsCount = typeof currentNodePodsCount === 'number' ? currentNodePodsCount : undefined;
    const tgtPodsCount = typeof targetNodePodsCount === 'number' ? targetNodePodsCount : undefined;
    const curVmRemaining = (curPodsAlloc != null && curPodsCount != null) ? Math.max(0, curPodsAlloc - curPodsCount) : undefined;
    const tgtVmRemaining = (tgtPodsAlloc != null && tgtPodsCount != null) ? Math.max(0, tgtPodsAlloc - tgtPodsCount) : undefined;
    const curPods = curVmRemaining != null ? `${curVmRemaining} 台（估算）` : (curPodsAlloc != null ? `${curPodsAlloc} 名额（Pod）` : '-');
    const tgtPods = tgtVmRemaining != null ? `${tgtVmRemaining} 台（估算）` : (tgtPodsAlloc != null ? `${tgtPodsAlloc} 名额（Pod）` : '-');
    const parseCpuToCores = (s?: string): number => {
      if (!s) return 0;
      const t = String(s).trim();
      if (/m$/i.test(t)) {
        const v = Number(t.replace(/m$/i, ''));
        return isFinite(v) ? v / 1000 : 0;
      } else if (/n$/i.test(t)) {
        const v = Number(t.replace(/n$/i, ''));
        return isFinite(v) ? v / 1e9 : 0;
      } else if (/u$/i.test(t)) {
        const v = Number(t.replace(/u$/i, ''));
        return isFinite(v) ? v / 1e6 : 0;
      }
      const v = Number(t);
      return isFinite(v) ? v : 0;
    };
    const parseMemoryToBytes = (s?: string): number => {
      if (!s) return 0;
      const t = String(s).trim();
      const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
      if (!m) return 0;
      const val = Number(m[1]);
      const unit = (m[2] || '').toLowerCase();
      let bytes = val;
      if (unit === 'ki') bytes = val * 1024;
      else if (unit === 'mi') bytes = val * 1024 * 1024;
      else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
      else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
      else if (unit === 'k') bytes = val * 1000;
      else if (unit === 'm') bytes = val * 1e6;
      else if (unit === 'g') bytes = val * 1e9;
      else if (unit === 't') bytes = val * 1e12;
      return bytes;
    };
    const curCpuTotal = parseCpuToCores(curCpuRaw);
    const curMemTotalBytes = parseMemoryToBytes(curMemRaw);
    const tgtCpuTotal = parseCpuToCores(tgtCpuRaw);
    const tgtMemTotalBytes = parseMemoryToBytes(tgtMemRaw);
    const curCpuUsed = parseCpuToCores(currentNodeMetrics?.usage?.cpu);
    const tgtCpuUsed = parseCpuToCores(targetNodeMetrics?.usage?.cpu);
    const curMemUsedBytes = parseMemoryToBytes(currentNodeMetrics?.usage?.memory);
    const tgtMemUsedBytes = parseMemoryToBytes(targetNodeMetrics?.usage?.memory);
    const curCpuPct = curCpuTotal > 0 ? Math.round((curCpuUsed / curCpuTotal) * 1000) / 10 : undefined;
    const tgtCpuPct = tgtCpuTotal > 0 ? Math.round((tgtCpuUsed / tgtCpuTotal) * 1000) / 10 : undefined;
    const curMemPct = curMemTotalBytes > 0 ? Math.round((curMemUsedBytes / curMemTotalBytes) * 1000) / 10 : undefined;
    const tgtMemPct = tgtMemTotalBytes > 0 ? Math.round((tgtMemUsedBytes / tgtMemTotalBytes) * 1000) / 10 : undefined;
    const formatPct = (v?: number) => (typeof v === 'number' && isFinite(v)) ? `${v.toFixed(1)}%` : '-';
    const toGiBNum = (bytes: number) => (bytes > 0 ? (bytes / (1024 * 1024 * 1024)) : 0);
    const curMemText = `${toGiB(curMemRaw)}${curMemUsedBytes ? `（已用 ${toGiBNum(curMemUsedBytes).toFixed(2)} GiB，${formatPct(curMemPct)}）` : ''}`;
    const tgtMemText = `${toGiB(tgtMemRaw)}${tgtMemUsedBytes ? `（已用 ${toGiBNum(tgtMemUsedBytes).toFixed(2)} GiB，${formatPct(tgtMemPct)}）` : ''}`;
    const curCpuText = `${toCores(curCpuRaw)}${curCpuUsed ? `（已用 ${curCpuUsed.toFixed(2)} 核，${formatPct(curCpuPct)}）` : ''}`;
    const tgtCpuText = `${toCores(tgtCpuRaw)}${tgtCpuUsed ? `（已用 ${tgtCpuUsed.toFixed(2)} 核，${formatPct(tgtCpuPct)}）` : ''}`;
    const curPodsPctUsed = (curPodsAlloc != null && curPodsCount != null && curPodsAlloc > 0)
      ? Math.round((curPodsCount / curPodsAlloc) * 1000) / 10
      : undefined;
    const tgtPodsPctUsed = (tgtPodsAlloc != null && tgtPodsCount != null && tgtPodsAlloc > 0)
      ? Math.round((tgtPodsCount / tgtPodsAlloc) * 1000) / 10
      : undefined;
    return [
      { key: 'cpu', metric: 'CPU(核)', current: curCpuText, target: tgtCpuText, currentPct: curCpuPct, targetPct: tgtCpuPct },
      { key: 'memory', metric: '内存', current: curMemText, target: tgtMemText, currentPct: curMemPct, targetPct: tgtMemPct },
      { key: 'pods', metric: '剩余VM数量', current: curPods, target: tgtPods, currentPct: curPodsPctUsed, targetPct: tgtPodsPctUsed },
    ];
  }, [metricsRows, currentNodeDetail, targetNodeDetail, currentNode, targetNodeName, nodeMap, currentNodeMetrics, targetNodeMetrics, currentNodePodsCount, targetNodePodsCount]);

  const currentTableData = useMemo(() => {
    return displayRows.map(r => ({
      key: r.key,
      metric: r.metric,
      value: r.current,
      pct: r.currentPct,
    }));
  }, [displayRows]);

  const targetTableData = useMemo(() => {
    return displayRows.map(r => ({
      key: r.key,
      metric: r.metric,
      value: r.target,
      pct: r.targetPct,
    }));
  }, [displayRows]);

  return (
    <StdFormModal
      open={open}
      title={`虚拟机热迁移 - ${vmName}`}
      form={form}
      onCancel={onClose}
      onFinish={handleFinish}
      okText="开始迁移"
      confirmLoading={loading}
      width={600}
      destroyOnClose
      centered
    >
      <Form.Item label="当前节点">
        <Input value={currentNode || ''} placeholder="未知" readOnly />
      </Form.Item>
      <Table
        size="small"
        bordered
        pagination={false}
        columns={columnsCurrent as any}
        dataSource={currentTableData as any}
        rowKey="key"
        className="std-table"
        style={{ marginBottom: 16 }}
      />

      <Form.Item 
        name="targetNode" 
        label="目标节点" 
      >
        <Select
          placeholder="请选择目标节点"
          options={selectOptions}
          style={{ width: '100%' }}
          onChange={(v) => setTargetNodeName(v && v !== '__AUTO__' ? v : null)}
        />
      </Form.Item>
      <Table
        size="small"
        bordered
        pagination={false}
        columns={columnsTarget as any}
        dataSource={targetTableData as any}
        rowKey="key"
        className="std-table"
      />
    </StdFormModal>
  );
};

export default HarvesterMigrateModal;
