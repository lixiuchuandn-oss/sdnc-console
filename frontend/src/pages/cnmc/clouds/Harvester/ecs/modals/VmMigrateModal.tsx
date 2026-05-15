/**
 * 虚拟机热迁移弹窗（Harvester / KubeVirt）
 * frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/VmMigrateModal.tsx
 *
 * 负责发起 VM 的实时迁移：
 * - 自动探测当前 VM 所在节点（优先使用 VM.status.nodeName，必要时回查 VMI）；
 * - 展示当前节点与目标节点的资源对比：CPU / 内存（含 metrics 占用率）；
 * - 支持选择“最佳节点（自动调度）”或指定目标节点；
 * - 提交时调用 migrateHarvesterVm，携带 instanceId 与目标节点。
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Form, Modal, Select, message, Typography, Table, Space, Progress } from 'antd';
import { CloudServerOutlined, AimOutlined } from '@ant-design/icons';
import {
  migrateHarvesterVm,
  fetchHarvesterResourceByLink,
  fetchHarvesterNodeDetail,
  fetchHarvesterVMAggregated,
} from '../../../../../../services/harvesterApi';

const { Text } = Typography;

interface VmMigrateModalProps {
  open: boolean;
  onClose: () => void;
  onOk: () => void;
  cloudId: string;
  vm: any;
  nodes: any[];
}

/** K8s quantity →「x.xx 核」展示（与节点 allocatable 口径一致） */
function formatCpuQuantityDisplay(q?: string): string {
  if (!q) return '-';
  const s = String(q).trim();
  if (/m$/i.test(s)) {
    const v = Number(s.replace(/m$/i, ''));
    if (!isFinite(v)) return '-';
    return `${(v / 1000).toFixed(2)} 核`;
  }
  if (/n$/i.test(s)) {
    const v = Number(s.replace(/n$/i, ''));
    if (!isFinite(v)) return '-';
    return `${(v / 1e9).toFixed(4)} 核`;
  }
  if (/u$/i.test(s)) {
    const v = Number(s.replace(/u$/i, ''));
    if (!isFinite(v)) return '-';
    return `${(v / 1e6).toFixed(4)} 核`;
  }
  const v = Number(s);
  if (!isFinite(v)) return '-';
  return `${v.toFixed(2)} 核`;
}

/** K8s memory quantity → GiB 字符串 */
function formatMemoryQuantityDisplay(q?: string): string {
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
}

const cellMetricRender = (text: string, pct?: number) => (
  <div>
    <div style={{ whiteSpace: 'pre-line', lineHeight: 1.35, marginBottom: typeof pct === 'number' ? 4 : 0 }}>{text}</div>
    {typeof pct === 'number' ? (
      <div style={{ lineHeight: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Progress
            percent={Math.max(0, Math.min(100, pct))}
            size="small"
            showInfo={false}
          />
        </div>
        <Text type="secondary" style={{ fontSize: 12, flexShrink: 0, whiteSpace: 'nowrap' }}>
          {pct.toFixed(1)}%
        </Text>
      </div>
    ) : null}
  </div>
);

const VmMigrateModal: React.FC<VmMigrateModalProps> = ({
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
  const [currentNodeDetail, setCurrentNodeDetail] = useState<any | null>(null);
  const [targetNodeDetail, setTargetNodeDetail] = useState<any | null>(null);
  const [currentNodeMetrics, setCurrentNodeMetrics] = useState<any | null>(null);
  const [targetNodeMetrics, setTargetNodeMetrics] = useState<any | null>(null);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setTargetNodeName(null);
      const n = vm?.status?.nodeName || null;
      setCurrentNodeName(n);
      try {
        form.setFieldsValue({ targetNode: '__AUTO__' });
      } catch {
        /* ignore */
      }
      if (!n && vm?.metadata?.namespace && vm?.metadata?.name) {
        const path = `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(vm.metadata.namespace)}/virtualmachineinstances/${encodeURIComponent(vm.metadata.name)}`;
        fetchHarvesterResourceByLink(cloudId, path)
          .then((v) => {
            const nn = v?.status?.nodeName || null;
            if (nn) setCurrentNodeName(nn);
          })
          .catch(() => {});
      }
    }
  }, [open, form, cloudId, vm?.metadata?.namespace, vm?.metadata?.name, vm?.status?.nodeName]);

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
    return () => {
      cancelled = true;
    };
  }, [open, cloudId, currentNodeName]);

  useEffect(() => {
    const name = targetNodeName;
    if (!open || !name) {
      setTargetNodeDetail(null);
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
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cloudId, targetNodeName]);

  useEffect(() => {
    const name = currentNodeName;
    if (!open || !name) {
      setCurrentNodeMetrics(null);
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
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cloudId, currentNodeName]);

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
    return () => {
      cancelled = true;
    };
  }, [open, cloudId, targetNodeName]);

  const handleFinish = async (values: any) => {
    try {
      setLoading(true);

      const vmNs = String(vm?.metadata?.namespace || '').trim();
      const vmVmName = String(vm?.metadata?.name || '').trim();
      let latestVm = vm;
      if (vmNs && vmVmName) {
        try {
          const res: any = await fetchHarvesterVMAggregated(cloudId, vmNs, vmVmName);
          const data = res?.data?.vm ? res.data : res;
          latestVm = data?.vm || data || vm;
          if (latestVm && data?.related) {
            latestVm.related = data.related;
          }
        } catch {
          /* ignore */
        }
      }

      const domain = latestVm?.spec?.template?.spec?.domain;
      const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
      const gpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
      const interfaces = Array.isArray(domain?.devices?.interfaces) ? domain.devices.interfaces : [];

      const isUsbHostDevice = (d: any) => {
        const n = String(d?.name || '').toLowerCase();
        const dn = String(d?.deviceName || '').toLowerCase();
        return n.startsWith('usb') || dn.includes('usb');
      };
      const hasUsb = hostDevices.some((d: any) => isUsbHostDevice(d));
      const hasPciHostDevice = hostDevices.some((d: any) => !isUsbHostDevice(d));
      const hasGpu = gpus.length > 0;
      const hasPassthroughNic = interfaces.some((it: any) => !!it?.sriov || !!it?.macvtap);

      const reasons = [
        hasUsb ? 'USB直通设备' : null,
        hasPciHostDevice || hasGpu ? 'PCI/GPU直通设备' : null,
        hasPassthroughNic ? '直通网卡(SR-IOV/macvtap)' : null,
      ].filter(Boolean) as string[];

      if (reasons.length > 0) {
        throw new Error(`该虚拟机存在${reasons.join('、')}，不支持热迁移`);
      }

      const instanceId =
        vm?.metadata?.namespace && vm?.metadata?.name
          ? `${vm.metadata.namespace}/${vm.metadata.name}`
          : vm?.id || '';

      if (!instanceId) {
        throw new Error('无法识别虚拟机 ID');
      }

      const target = values?.targetNode === '__AUTO__' ? undefined : values?.targetNode;
      await migrateHarvesterVm(cloudId, instanceId, target);

      message.success('迁移任务已提交，在迁移记录页面可看到迁移进度');
      onOk();
      onClose();
    } catch (error: any) {
      message.error(error.message || '迁移请求失败');
    } finally {
      setLoading(false);
    }
  };

  const vmName = vm?.metadata?.name || '-';
  const vmNs = vm?.metadata?.namespace || '';
  const vmAlias = String(vm?.metadata?.annotations?.['tower.io/alias'] || '').trim();
  /** 标题区：优先展示业务显示名，并保留 K8s 名称便于对照 */
  const vmTitleLabel = vmAlias ? `${vmAlias}（${vmName}）` : vmName;
  const currentNode = currentNodeName || vm?.status?.nodeName;

  const nodeOptions = nodes
    .filter((n) => n?.metadata?.name !== currentNode)
    .map((n) => ({
      label: n?.metadata?.name,
      value: n?.metadata?.name,
    }));

  const selectOptions = useMemo(
    () => [{ label: '自动选择最佳节点（推荐）', value: '__AUTO__' }, ...nodeOptions],
    [nodeOptions],
  );

  const nodeMap = useMemo(() => {
    const m: Record<string, any> = {};
    nodes.forEach((n) => {
      const name = n?.metadata?.name;
      if (name) m[name] = n;
    });
    return m;
  }, [nodes]);

  const displayRows = useMemo(() => {
    const curCpuRaw = (currentNodeDetail?.status?.allocatable?.cpu ||
      currentNodeDetail?.status?.capacity?.cpu ||
      nodeMap[currentNode || '']?.status?.allocatable?.cpu ||
      nodeMap[currentNode || '']?.status?.capacity?.cpu) as string | undefined;
    const curMemRaw = (currentNodeDetail?.status?.allocatable?.memory ||
      currentNodeDetail?.status?.capacity?.memory ||
      nodeMap[currentNode || '']?.status?.allocatable?.memory ||
      nodeMap[currentNode || '']?.status?.capacity?.memory) as string | undefined;
    const tgtCpuRaw = (targetNodeDetail?.status?.allocatable?.cpu ||
      targetNodeDetail?.status?.capacity?.cpu ||
      nodeMap[targetNodeName || '']?.status?.allocatable?.cpu ||
      nodeMap[targetNodeName || '']?.status?.capacity?.cpu) as string | undefined;
    const tgtMemRaw = (targetNodeDetail?.status?.allocatable?.memory ||
      targetNodeDetail?.status?.capacity?.memory ||
      nodeMap[targetNodeName || '']?.status?.allocatable?.memory ||
      nodeMap[targetNodeName || '']?.status?.capacity?.memory) as string | undefined;
    const parseCpuToCores = (s?: string): number => {
      if (!s) return 0;
      const t = String(s).trim();
      if (/m$/i.test(t)) {
        const v = Number(t.replace(/m$/i, ''));
        return isFinite(v) ? v / 1000 : 0;
      }
      if (/n$/i.test(t)) {
        const v = Number(t.replace(/n$/i, ''));
        return isFinite(v) ? v / 1e9 : 0;
      }
      if (/u$/i.test(t)) {
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
    const formatPct = (v?: number) => (typeof v === 'number' && isFinite(v) ? `${v.toFixed(1)}%` : '-');
    const toGiBNum = (bytes: number) => (bytes > 0 ? bytes / (1024 * 1024 * 1024) : 0);
    const curMemText = `${formatMemoryQuantityDisplay(curMemRaw)}${curMemUsedBytes ? `（已用 ${toGiBNum(curMemUsedBytes).toFixed(2)} GiB，${formatPct(curMemPct)}）` : ''}`;
    const tgtMemText = `${formatMemoryQuantityDisplay(tgtMemRaw)}${tgtMemUsedBytes ? `（已用 ${toGiBNum(tgtMemUsedBytes).toFixed(2)} GiB，${formatPct(tgtMemPct)}）` : ''}`;
    const curCpuText = `${formatCpuQuantityDisplay(curCpuRaw)}${curCpuUsed ? `（已用 ${curCpuUsed.toFixed(2)} 核，${formatPct(curCpuPct)}）` : ''}`;
    const tgtCpuText = `${formatCpuQuantityDisplay(tgtCpuRaw)}${tgtCpuUsed ? `（已用 ${tgtCpuUsed.toFixed(2)} 核，${formatPct(tgtCpuPct)}）` : ''}`;
    return [
      { key: 'cpu', metric: 'CPU', current: curCpuText, target: tgtCpuText, currentPct: curCpuPct, targetPct: tgtCpuPct },
      { key: 'memory', metric: '内存', current: curMemText, target: tgtMemText, currentPct: curMemPct, targetPct: tgtMemPct },
    ];
  }, [
    currentNodeDetail,
    targetNodeDetail,
    currentNode,
    targetNodeName,
    nodeMap,
    currentNodeMetrics,
    targetNodeMetrics,
  ]);

  const combinedColumns = useMemo(
    () => [
      {
        title: '指标',
        dataIndex: 'metric',
        key: 'metric',
        width: 80,
        fixed: 'left' as const,
      },
      {
        title: (
          <Space size={6}>
            <CloudServerOutlined style={{ color: '#1677ff' }} />
            <span>当前节点</span>
            {currentNodeName && <span style={{ color: '#8c8c8c', fontSize: '12px' }}>（{currentNodeName}）</span>}
          </Space>
        ),
        dataIndex: 'current',
        key: 'current',
        render: (_: unknown, row: (typeof displayRows)[0]) => cellMetricRender(row.current, row.currentPct),
      },
      {
        title: (
          <Space size={6}>
            <AimOutlined style={{ color: '#52c41a' }} />
            <span>目标节点</span>
            {targetNodeName && <span style={{ color: '#8c8c8c', fontSize: '12px' }}>（{targetNodeName}）</span>}
          </Space>
        ),
        dataIndex: 'target',
        key: 'target',
        render: (_: unknown, row: (typeof displayRows)[0]) => {
          if (!targetNodeName) {
            return (
              <Text type="secondary" style={{ fontStyle: 'italic' }}>
                选择具体节点后显示对比
              </Text>
            );
          }
          return cellMetricRender(row.target, row.targetPct);
        },
      },
    ],
    [currentNodeName, targetNodeName],
  );

  const modalTitle = (
    <Space size={6}>
      <span>热迁移</span>
      <Text type="secondary">
        {vmNs ? `${vmNs} / ` : ''}
        {vmTitleLabel}
      </Text>
    </Space>
  );

  return (
    <Modal
      open={open}
      title={modalTitle}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="开始迁移"
      confirmLoading={loading}
      width={760}
      destroyOnHidden
      centered
      styles={{ body: { maxHeight: '80vh', overflowY: 'auto', overflowX: 'hidden' } }}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
      <Form.Item
        name="targetNode"
        label="迁移目标"
        rules={[{ required: true, message: '请选择迁移目标' }]}
      >
        <Select
          placeholder="选择目标节点或自动调度"
          options={selectOptions}
          style={{ width: '100%' }}
          size="large"
          onChange={(v) => setTargetNodeName(v && v !== '__AUTO__' ? v : null)}
        />
      </Form.Item>


      <Table
        size="small"
        bordered
        pagination={false}
        columns={combinedColumns as any}
        dataSource={displayRows as any}
        rowKey="key"
        className="std-table vm-migrate-compare-table"
        scroll={{ x: 520 }}
      />
      <style>{`
        .vm-migrate-compare-table .ant-table-cell { vertical-align: top; }
      `}</style>
      </Form>
    </Modal>
  );
};

export default VmMigrateModal;
