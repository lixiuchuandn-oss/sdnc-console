/**
 * 物理节点详情抽屉 — 数据三面：
 * - Harvester `GET /v1/nodes`（Host CR，Tower 标准化 + 库存字段）
 * - HMS `GET /v1/hms/node/nics` → 对外 `nics`
 * - HMS `GET /v1/hms/node/hardwareInfo` → 对外 `hardware`（system/cpu/memory/disk/switch）
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  pickLldpChassisId,
  pickLldpLocalInterface,
  pickLldpManagementIpv4,
  pickLldpPeerPort,
  pickLldpSystemDescription,
  pickLldpSystemName,
} from '../../hsm/lib/lldpHmsRowFields';

type HmsNic = {
  device: string;
  state?: string;
  mac?: string;
  master?: string;
  usedByHarvester?: boolean;
};

export interface PhysicalNodeDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  record: any;
  metrics?: { cpuUsedCores?: number; memUsedBytes?: number };
  /** 从集群刷新节点列表/详情数据（与列表区刷新同源） */
  onRefreshFromCluster?: (force?: boolean) => void;
  refreshLoading?: boolean;
}

function Panel({ children }: { children: React.ReactNode }) {
  return <Flex vertical gap="middle">{children}</Flex>;
}

function PanelWide({ children }: { children: React.ReactNode }) {
  return <Flex vertical gap="large">{children}</Flex>;
}

/** 单列详情表：统一标签列宽（antd Descriptions styles） */
const DESCR_COL1 = {
  bordered: true as const,
  size: 'small' as const,
  column: 1 as const,
  styles: { label: { width: 200 } },
};

/** 无数据时不展示「-」「—」等占位符 */
const displayCell = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null') return '';
  return s;
};

/** 抽屉内 Table：仅用 antd 官方 API（size / bordered），不叠 `std-table` 等项目全局表样式 */
const DRAWER_TABLE_PROPS = {
  size: 'small' as const,
  bordered: true as const,
};

function tableScrollXWhenHasData(len: number): { x: true } | undefined {
  return len > 0 ? { x: true } : undefined;
}

const HMS_DISK_COLS = [
  { title: '设备', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '容量', dataIndex: 'size', key: 'size' },
  { title: '型号', dataIndex: 'model', key: 'model', render: (v: any) => displayCell(v) },
  { title: '序列号', dataIndex: 'serial', key: 'serial', render: (v: any) => displayCell(v) },
  { title: '挂载', dataIndex: 'mountpoint', key: 'mountpoint', render: (v: any) => displayCell(v) },
];

const HMS_MEM_COLS = [
  { title: '插槽', dataIndex: 'Locator', key: 'loc', ellipsis: true },
  { title: 'Bank', dataIndex: 'Bank Locator', key: 'bank', ellipsis: true },
  { title: '容量', dataIndex: 'Size', key: 'size', ellipsis: true },
  { title: '类型', dataIndex: 'Type', key: 'type', ellipsis: true },
  { title: '速率', dataIndex: 'Speed', key: 'speed', ellipsis: true },
  { title: '厂商', dataIndex: 'Manufacturer', key: 'mfg', ellipsis: true },
  { title: '序列号', dataIndex: 'Serial Number', key: 'sn', ellipsis: true },
];

/** HMS LLDP：仅展示关键 TLV，列名中文（与 lldpHmsRowFields 抽键规则一致） */
const HMS_LLDP_TABLE_COLUMNS = [
  { title: '本机接口', dataIndex: 'localIf', key: 'localIf', ellipsis: { showTitle: true } },
  { title: '对端系统名', dataIndex: 'sysName', key: 'sysName', ellipsis: { showTitle: true } },
  { title: '对端系统描述', dataIndex: 'sysDesc', key: 'sysDesc', ellipsis: { showTitle: true } },
  { title: '对端端口', dataIndex: 'peerPort', key: 'peerPort', ellipsis: { showTitle: true } },
  { title: '对端管理 IPv4', dataIndex: 'mgmtIp', key: 'mgmtIp', ellipsis: { showTitle: true } },
  { title: '邻居 Chassis ID', dataIndex: 'chassis', key: 'chassis', ellipsis: { showTitle: true } },
];

function mapHmsLldpRowToKeyFields(row: Record<string, any>, index: number) {
  const rec = row && typeof row === 'object' ? (row as Record<string, string>) : {};
  const local =
    pickLldpLocalInterface(rec) || String((row as any)?.Interface ?? (row as any)?.interface ?? '').trim();
  return {
    key: `lldp-${index}`,
    localIf: local,
    sysName: pickLldpSystemName(rec),
    sysDesc: pickLldpSystemDescription(rec),
    peerPort: pickLldpPeerPort(rec),
    mgmtIp: pickLldpManagementIpv4(rec),
    chassis: pickLldpChassisId(rec),
  };
}

/** HMS / lscpu 风格 CPU 信息字段名 → 中文（左侧标签） */
const HMS_CPU_FIELD_LABEL_ZH: Record<string, string> = {
  'Address sizes': '地址位宽',
  Architecture: '架构',
  BogoMIPS: 'BogoMIPS',
  'Byte Order': '字节序',
  'CPU family': 'CPU 系列',
  'CPU max MHz': 'CPU 最高频率 (MHz)',
  'CPU min MHz': 'CPU 最低频率 (MHz)',
  'CPU op-mode(s)': 'CPU 运行模式',
  'CPU(s)': '逻辑 CPU 数量',
  'CPU(s) scaling MHz': 'CPU 调频（当前比例）',
  'Core(s) per socket': '每插槽物理核心数',
  Flags: '特性标志位',
  'L1d cache': 'L1 数据缓存',
  'L1i cache': 'L1 指令缓存',
  'L2 cache': 'L2 缓存',
  'L3 cache': 'L3 缓存',
  Model: '型号（编号）',
  'Model name': '型号名称',
  'NUMA node(s)': 'NUMA 节点数',
  'On-line CPU(s) list': '在线 CPU 列表',
  'Socket(s)': '物理 CPU 插槽数',
  Stepping: '步进',
  'Thread(s) per core': '每核硬件线程数',
  'Vendor ID': '厂商 ID',
  Virtualization: '虚拟化',
};

const HMS_CPU_VULNERABILITY_LABEL_ZH: Record<string, string> = {
  'Gather data sampling': 'Gather Data Sampling',
  'Itlb multihit': 'iTLB 多重命中',
  L1tf: 'L1 终端故障 (L1TF)',
  Mds: '微架构数据采样 (MDS)',
  Meltdown: '熔断 (Meltdown)',
  'Mmio stale data': 'MMIO 陈旧数据',
  'Reg file data sampling': '寄存器文件数据采样',
  Retbleed: 'Retbleed',
  'Spec rstack overflow': '推测执行返回栈溢出',
  'Spec store bypass': '推测性存储旁路',
  'Spectre v1': '幽灵 v1 (Spectre v1)',
  'Spectre v2': '幽灵 v2 (Spectre v2)',
  Srbds: '特殊寄存器缓冲区采样 (SRBDS)',
  Tsa: 'TSA',
  'Tsx async abort': 'TSX 异步中止',
};

function hmsCpuInfoLabelZh(key: string): string {
  const k = String(key || '').trim();
  const direct = HMS_CPU_FIELD_LABEL_ZH[k];
  if (direct) return direct;
  const numa = k.match(/^NUMA node(\d+) CPU\(s\)$/i);
  if (numa) return `NUMA 节点 ${numa[1]} 上的 CPU`;
  if (k.startsWith('Vulnerability ')) {
    const rest = k.slice('Vulnerability '.length).trim();
    const sub = HMS_CPU_VULNERABILITY_LABEL_ZH[rest] || rest;
    return `安全漏洞：${sub}`;
  }
  return k;
}

/** HMS hardware.system / SMBIOS DMI 风格字段名 → 中文（主板/系统信息左侧标签） */
const HMS_SYSTEM_FIELD_LABEL_ZH: Record<string, string> = {
  // Type 1 System Information
  Manufacturer: '制造商',
  'Product Name': '产品名称',
  Version: '版本',
  'Serial Number': '序列号',
  UUID: 'UUID',
  'SKU Number': 'SKU 编号',
  Family: '产品系列',
  'Wake-up Type': '唤醒类型',
  'Product Id': '产品 ID',
  'System SKUNumber': '系统 SKU 编号',
  'System Sku Number': '系统 SKU 编号',
  // Type 2 Baseboard
  'Board Name': '主板名称',
  'Board Product': '主板型号',
  'Board Manufacturer': '主板制造商',
  'Board Version': '主板版本',
  'Board Serial Number': '主板序列号',
  'Board Asset Tag': '主板资产标签',
  'Asset Tag': '资产标签',
  'Location in Chassis': '机箱内位置',
  'Location In Chassis': '机箱内位置',
  'Chassis Handle': '机箱句柄',
  // Type 3 Chassis
  'Chassis Manufacturer': '机箱制造商',
  'Chassis Type': '机箱类型',
  'Chassis Version': '机箱版本',
  'Chassis Serial Number': '机箱序列号',
  'Chassis Asset Tag': '机箱资产标签',
  'Chassis Part Number': '机箱料号',
  // Type 0 BIOS
  'BIOS Vendor': 'BIOS 厂商',
  'BIOS Version': 'BIOS 版本',
  'BIOS Release Date': 'BIOS 发布日期',
  'BIOS Date': 'BIOS 日期',
  // 常见同义/工具差异
  'System Type': '系统类型',
  'OEM String': 'OEM 字符串',
  'Enclosure type': '机箱类型',
  'Enclosure Type': '机箱类型',
  Name: '名称',
  'Part Number': '料号',
  'OEM String 1': 'OEM 字符串 1',
  'OEM String 2': 'OEM 字符串 2',
};

function hmsSystemInfoLabelZh(key: string): string {
  const k = String(key || '').trim();
  return HMS_SYSTEM_FIELD_LABEL_ZH[k] || k;
}

const HMS_SYNC_HINT =
  '节点列表「刷新」或 API `?force=true` 时，Tower 会拉取 HMS 并与 Harvester 节点写入同一批库存；若仍为空，请检查集群是否暴露对应 HMS 路径。';

const safeNodeName = (r: any) => String(r?.name || r?.metadata?.name || '').trim();

const collectRoles = (r: any): string[] => {
  const base: string[] = (Array.isArray(r?.roles) ? r.roles : []).map((s: string) => {
    if (String(s).startsWith('node-role.kubernetes.io/')) return String(s).split('/').pop() || s;
    return String(s);
  });
  const labels: Record<string, string> = r?.metadata?.labels || {};
  const legacy = String(labels?.['kubernetes.io/role'] || '').trim();
  const extra = Object.keys(labels || {})
    .filter((k) => k.startsWith('node-role.kubernetes.io/'))
    .map((k) => k.split('/').pop() || k);
  return Array.from(
    new Set([...base, ...(legacy ? [legacy] : []), ...extra].map((x) => String(x || '').trim()).filter(Boolean)),
  );
};

const parseCpuToCores = (s?: string | number): number => {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  if (/m$/i.test(t)) {
    const v = Number(t.replace(/m$/i, ''));
    return Number.isFinite(v) ? v / 1000 : 0;
  } else if (/n$/i.test(t)) {
    const v = Number(t.replace(/n$/i, ''));
    return Number.isFinite(v) ? v / 1e9 : 0;
  } else if (/u$/i.test(t)) {
    const v = Number(t.replace(/u$/i, ''));
    return Number.isFinite(v) ? v / 1e6 : 0;
  }
  const v = Number(t);
  return Number.isFinite(v) ? v : 0;
};

const parseMemoryToBytes = (s?: string | number): number => {
  if (s === undefined || s === null) return 0;
  const t = String(s).trim();
  if (!t) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)([KMGTP]i?)?$/i);
  if (!m) {
    const v = Number(t);
    return Number.isFinite(v) ? v : 0;
  }
  const val = Number(m[1]);
  const unit = (m[2] || '').toLowerCase();
  let bytes = val;
  if (unit === 'ki') bytes = val * 1024;
  else if (unit === 'mi') bytes = val * 1024 * 1024;
  else if (unit === 'gi') bytes = val * 1024 * 1024 * 1024;
  else if (unit === 'ti') bytes = val * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'pi') bytes = val * 1024 * 1024 * 1024 * 1024 * 1024;
  else if (unit === 'k') bytes = val * 1000;
  else if (unit === 'm') bytes = val * 1e6;
  else if (unit === 'g') bytes = val * 1e9;
  else if (unit === 't') bytes = val * 1e12;
  else if (unit === 'p') bytes = val * 1e15;
  return bytes;
};

const safeJsonParse = <T,>(raw: any): T | null => {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'object') return raw as T;
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

const formatBytesToGiB = (bytesLike: any): string => {
  const n = Number(bytesLike);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
};

const formatCpuToCoresText = (cpuLike: any): string => {
  const s = String(cpuLike ?? '').trim();
  if (!s) return '';
  if (/m$/i.test(s)) {
    const v = Number(s.replace(/m$/i, ''));
    if (!Number.isFinite(v)) return '';
    return `${(v / 1000).toFixed(2)} 核`;
  }
  const v = Number(s);
  if (Number.isFinite(v)) return `${v.toFixed(2)} 核`;
  return '';
};

const PhysicalNodeDetailDrawer: React.FC<PhysicalNodeDetailDrawerProps> = ({
  open,
  onClose,
  record,
  metrics,
  onRefreshFromCluster,
  refreshLoading = false,
}) => {
  const [activeTab, setActiveTab] = useState('harv-node');

  const nics: HmsNic[] = useMemo(() => {
    const arr = record?.nics;
    return Array.isArray(arr) ? arr : [];
  }, [record]);

  /** 节点列表 API 已将 rawData.hmsHardware 映射为 hardware */
  const hardware = useMemo(() => {
    const h = record?.hardware;
    return h && typeof h === 'object' ? h : null;
  }, [record]);

  /** hardwareInfo.switch 按本机 Interface（如 eno1）索引，便于与 nics.device 对齐 */
  const lldpByInterface = useMemo(() => {
    const sw = hardware?.switch;
    if (!Array.isArray(sw)) return {} as Record<string, any[]>;
    const m: Record<string, any[]> = {};
    for (const row of sw) {
      const iface = String(row?.Interface ?? '').trim();
      if (!iface) continue;
      if (!m[iface]) m[iface] = [];
      m[iface].push(row);
    }
    return m;
  }, [hardware]);

  const nodeRoles = useMemo(() => collectRoles(record), [record]);
  const physicalIfaces: string[] = useMemo(() => {
    const raw = record?.physicalInterfaces;
    return Array.isArray(raw) ? raw.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
  }, [record]);
  const ifaceStatusMap: Record<string, string> = useMemo(() => {
    const m = record?.interfaceStatusMap;
    return m && typeof m === 'object' ? m : {};
  }, [record]);

  const ready = useMemo(() => {
    if (typeof record?.ready === 'boolean') return record.ready;
    const conds: any[] = Array.isArray(record?.status?.conditions) ? record.status.conditions : [];
    return conds.some(
      (c) => String(c?.type || '') === 'Ready' && String(c?.status || '').toLowerCase() === 'true',
    );
  }, [record]);

  const internalIP =
    record?.internalIP ||
    record?.status?.addresses?.find((a: any) => a?.type === 'InternalIP')?.address ||
    '';

  const annotations = (record?.metadata?.annotations || {}) as Record<string, any>;
  const ntp = useMemo(() => {
    return safeJsonParse<{ ntpSyncStatus?: string; currentNtpServers?: string }>(
      annotations?.['node.harvesterhci.io/ntp-service'],
    );
  }, [annotations]);
  const podRequests = useMemo(() => {
    return safeJsonParse<Record<string, any>>(annotations?.['management.cattle.io/pod-requests']);
  }, [annotations]);
  const podLimits = useMemo(() => {
    return safeJsonParse<Record<string, any>>(annotations?.['management.cattle.io/pod-limits']);
  }, [annotations]);
  const harvesterVersion = useMemo(() => {
    const fields: any[] = Array.isArray(record?.metadata?.fields) ? record.metadata.fields : [];
    const hit = fields.find((x) => String(x || '').includes('CloudHCI'));
    return String(hit || '').trim();
  }, [record]);

  /** HMS 网卡列：antd Table + Tag / Space / Tooltip，无项目表样式 class */
  const nicColumns = useMemo(
    () => [
      {
        title: '设备',
        key: 'device',
        dataIndex: 'device',
        render: (v: any) => <span>{displayCell(v)}</span>,
      },
      {
        title: '状态',
        key: 'state',
        dataIndex: 'state',
        render: (v: any) => {
          const s = String(v ?? '').toLowerCase().trim();
          if (!s) return null;
          const color = s === 'up' ? 'success' : s === 'down' ? 'default' : 'default';
          return (
            <Tag color={color}>
              {s}
            </Tag>
          );
        },
      },
      {
        title: 'MAC',
        key: 'mac',
        dataIndex: 'mac',
        render: (v: any) => <span>{displayCell(v)}</span>,
      },
      {
        title: 'Master',
        key: 'master',
        dataIndex: 'master',
        render: (v: any) => <span>{displayCell(v)}</span>,
      },
      {
        title: '已占用',
        key: 'usedByHarvester',
        dataIndex: 'usedByHarvester',
        render: (v: any, r: HmsNic) => {
          const used = Boolean(v);
          const t = used ? `已被占用（master=${displayCell(r?.master)}）` : '未占用';
          return (
            <Tooltip title={t}>
              <Tag color={used ? 'processing' : 'default'}>
                {used ? '已占用' : '可用'}
              </Tag>
            </Tooltip>
          );
        },
      },
      {
        title: 'LLDP 摘要',
        key: 'lldp',
        render: (_: unknown, r: HmsNic) => {
          const dev = String(r?.device || '').trim();
          const rows = dev ? lldpByInterface[dev] : undefined;
          if (!rows?.length) {
            return null;
          }
          return (
            <Space direction="vertical" size={2}>
              {rows.map((sw, i) => {
                const line = [
                  displayCell(sw['System Name'] ?? sw['Chassis ID_MAC']),
                  displayCell(sw['Port Description'] ?? sw['Port ID_Ifname']),
                ]
                  .filter(Boolean)
                  .join(' · ');
                return line ? <span key={i}>{line}</span> : null;
              })}
            </Space>
          );
        },
      },
    ],
    [lldpByInterface],
  );

  const titleName = safeNodeName(record) || '节点详情';

  useEffect(() => {
    if (open) setActiveTab('harv-node');
  }, [open, titleName]);

  const tabItems = useMemo(() => {
    if (!record) return [];

    const cpuTotal = parseCpuToCores(
      record?.status?.allocatable?.cpu || record?.status?.capacity?.cpu || record?.cpu,
    );
    const memTotalBytes = parseMemoryToBytes(
      record?.status?.allocatable?.memory || record?.status?.capacity?.memory || record?.memory,
    );
    const cpuUsed = metrics?.cpuUsedCores ?? 0;
    const memUsedBytes = metrics?.memUsedBytes ?? 0;
    const cpuPct = cpuTotal > 0 ? (cpuUsed / cpuTotal) * 100 : null;
    const memPct = memTotalBytes > 0 ? (memUsedBytes / memTotalBytes) * 100 : null;
    const hasMetrics = metrics != null && (metrics.cpuUsedCores != null || metrics.memUsedBytes != null);

    const cpuUsageDisplay =
      cpuTotal > 0 && cpuPct !== null
        ? `${Math.max(0, Math.min(100, cpuPct)).toFixed(1)}% · ${cpuUsed.toFixed(2)}/${cpuTotal.toFixed(2)} core`
        : hasMetrics
          ? ''
          : '无实时指标（需 metrics.k8s.io）';

    const memUsageDisplay =
      memTotalBytes > 0 && memPct !== null
        ? `${Math.max(0, Math.min(100, memPct)).toFixed(1)}% · ${(memUsedBytes / (1024 * 1024 * 1024)).toFixed(2)}/${(memTotalBytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
        : hasMetrics
          ? ''
          : '无实时指标（需 metrics.k8s.io）';

    const cpuUsageTextType: React.ComponentProps<typeof Typography.Text>['type'] =
      !hasMetrics || cpuTotal <= 0
        ? 'secondary'
        : cpuPct != null && cpuPct >= 90
          ? 'warning'
          : undefined;

    const memUsageTextType: React.ComponentProps<typeof Typography.Text>['type'] =
      !hasMetrics || memTotalBytes <= 0
        ? 'secondary'
        : memPct != null && memPct >= 90
          ? 'warning'
          : undefined;

    const hw = hardware;
    const diskList: any[] = hw && Array.isArray(hw.disk) ? hw.disk : [];
    const memList: any[] = hw && Array.isArray(hw.memory) ? hw.memory : [];
    const memListSorted = [...memList].sort((a, b) => {
      const ae = /no module installed/i.test(String(a?.Size ?? ''));
      const be = /no module installed/i.test(String(b?.Size ?? ''));
      if (ae !== be) return ae ? 1 : -1;
      return 0;
    });
    const swList: any[] = hw && Array.isArray(hw.switch) ? hw.switch : [];
    const lldpTableRows = swList.map((row, i) => mapHmsLldpRowToKeyFields(row, i));
    const systemObj = hw?.system && typeof hw.system === 'object' ? hw.system : null;
    const cpuObj = hw?.cpu && typeof hw.cpu === 'object' ? hw.cpu : null;

    const capCpu = record?.status?.capacity?.cpu ?? record?.cpu;
    const capMem = record?.status?.capacity?.memory ?? record?.memory;
    const allocCpu = record?.status?.allocatable?.cpu;
    const allocMem = record?.status?.allocatable?.memory;

    const hmsHwMissing = (
      <PanelWide>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 hardware（hardwareInfo）">
          <Flex vertical align="center" gap="small">
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, textAlign: 'center' }}>
              {HMS_SYNC_HINT}
            </Typography.Paragraph>
          </Flex>
        </Empty>
      </PanelWide>
    );

    return [
      {
        key: 'harv-node',
        label: '物理节点',
        children: (
          <Panel>
            <Descriptions {...DESCR_COL1}>
              <Descriptions.Item label="名称">{titleName}</Descriptions.Item>
              <Descriptions.Item label="就绪">{ready ? 'Ready' : 'NotReady'}</Descriptions.Item>
              <Descriptions.Item label="角色">
                {nodeRoles.length ? (
                  <Space wrap size={[4, 4]}>
                    {nodeRoles.map((role) => (
                      <Tag key={role}>{role}</Tag>
                    ))}
                  </Space>
                ) : null}
              </Descriptions.Item>
              {hardware?.system?.['Product Name'] ? (
                <Descriptions.Item label="机型（HMS SMBIOS）">
                  {[String(hardware.system?.Manufacturer || '').trim(), String(hardware.system?.['Product Name'] || '').trim()]
                    .filter(Boolean)
                    .join(' ')}
                </Descriptions.Item>
              ) : null}
              <Descriptions.Item label="CPU 使用（实时）">
                <Typography.Text type={cpuUsageTextType}>{cpuUsageDisplay}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="内存使用（实时）">
                <Typography.Text type={memUsageTextType}>{memUsageDisplay}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="内网 IP">
                {internalIP ? (
                  <Typography.Text copyable={{ text: String(internalIP) }} code>
                    {internalIP}
                  </Typography.Text>
                ) : null}
              </Descriptions.Item>
              <Descriptions.Item label="容量 CPU">{displayCell(capCpu)}</Descriptions.Item>
              <Descriptions.Item label="可分配 CPU">{displayCell(allocCpu)}</Descriptions.Item>
              <Descriptions.Item label="容量内存">{displayCell(capMem)}</Descriptions.Item>
              <Descriptions.Item label="可分配内存">{displayCell(allocMem)}</Descriptions.Item>
              <Descriptions.Item label="物理口（LinkMonitor）">
                {physicalIfaces.length ? (
                  <Flex vertical gap={4}>
                    {physicalIfaces.map((name) => {
                      const st = ifaceStatusMap[name];
                      return (
                        <Space key={name} size="small" align="center">
                          <Typography.Text code>{name}</Typography.Text>
                          {st ? <Tag>{st}</Tag> : null}
                        </Space>
                      );
                    })}
                  </Flex>
                ) : (
                  <Typography.Text type="secondary">未从 LinkMonitor 解析到 device 口</Typography.Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="版本">
                {displayCell(
                  record?.kubeletVersion ||
                    record?.status?.nodeInfo?.kubeletVersion ||
                    record?.version,
                )}
              </Descriptions.Item>
              <Descriptions.Item label="架构">
                {displayCell(record?.architecture || record?.status?.nodeInfo?.architecture)}
              </Descriptions.Item>
              <Descriptions.Item label="系统镜像">
                {displayCell(record?.osImage || record?.status?.nodeInfo?.osImage)}
              </Descriptions.Item>
              <Descriptions.Item label="内核">
                {displayCell(record?.kernelVersion || record?.status?.nodeInfo?.kernelVersion)}
              </Descriptions.Item>
              <Descriptions.Item label="容器运行时">
                {displayCell(
                  record?.containerRuntimeVersion ||
                    record?.status?.nodeInfo?.containerRuntimeVersion,
                )}
              </Descriptions.Item>
            </Descriptions>
          </Panel>
        ),
      },
      {
        key: 'harv-annotations',
        label: '注解与网络',
        children: (
          <Panel>
            <Descriptions {...DESCR_COL1}>
              <Descriptions.Item label="集群版本展示">{displayCell(harvesterVersion)}</Descriptions.Item>
              <Descriptions.Item label="NTP 同步">{displayCell(ntp?.ntpSyncStatus)}</Descriptions.Item>
              <Descriptions.Item label="NTP 服务器">
                <Typography.Text style={{ wordBreak: 'break-all' }}>
                  {displayCell(ntp?.currentNtpServers)}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="OVN 节点 IP">
                {displayCell(annotations?.['ovn.kubernetes.io/ip_address'])}
              </Descriptions.Item>
              <Descriptions.Item label="OVN 节点 MAC">
                {displayCell(annotations?.['ovn.kubernetes.io/mac_address'])}
              </Descriptions.Item>
              <Descriptions.Item label="OVN CIDR">
                {displayCell(annotations?.['ovn.kubernetes.io/cidr'])}
              </Descriptions.Item>
              <Descriptions.Item label="OVN 网关">
                {displayCell(annotations?.['ovn.kubernetes.io/gateway'])}
              </Descriptions.Item>
              <Descriptions.Item label="Flannel 对外 IP">
                {displayCell(annotations?.['flannel.alpha.coreos.com/public-ip'])}
              </Descriptions.Item>
              <Descriptions.Item label="etcd 本地快照时间">
                {displayCell(annotations?.['etcd.rke2.cattle.io/local-snapshots-timestamp'])}
              </Descriptions.Item>
            </Descriptions>
          </Panel>
        ),
      },
      {
        key: 'harv-sched',
        label: '调度预留',
        children: (
          <Panel>
            <Descriptions {...DESCR_COL1}>
              <Descriptions.Item label="CPU 请求（Requests）">
                {podRequests?.cpu
                  ? `${String(podRequests.cpu)}（约 ${formatCpuToCoresText(podRequests.cpu)}）`
                  : null}
              </Descriptions.Item>
              <Descriptions.Item label="内存请求（Requests）">
                {podRequests?.memory
                  ? `${String(podRequests.memory)}（约 ${formatBytesToGiB(podRequests.memory)}）`
                  : null}
              </Descriptions.Item>
              <Descriptions.Item label="Pod 数请求">{displayCell(podRequests?.pods)}</Descriptions.Item>
              <Descriptions.Item label="临时存储请求">
                {displayCell(podRequests?.['ephemeral-storage'])}
              </Descriptions.Item>
              <Descriptions.Item label="CPU 上限（Limits）">
                {podLimits?.cpu
                  ? `${String(podLimits.cpu)}（约 ${formatCpuToCoresText(podLimits.cpu)}）`
                  : null}
              </Descriptions.Item>
              <Descriptions.Item label="内存上限（Limits）">
                {podLimits?.memory
                  ? `${String(podLimits.memory)}（约 ${formatBytesToGiB(podLimits.memory)}）`
                  : null}
              </Descriptions.Item>
            </Descriptions>
          </Panel>
        ),
      },
    
      {
        key: 'hms-board',
        label: 'HMS 主板',
        children: (
          <PanelWide>
            {!hw ? (
              hmsHwMissing
            ) : (
              <>
                {systemObj ? (
                  <Descriptions className="hms-hw-same-row-height" {...DESCR_COL1}>
                    {Object.entries(systemObj).map(([k, v]) => (
                      <Descriptions.Item key={k} label={hmsSystemInfoLabelZh(k)}>
                        {displayCell(v)}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 system" />
                )}
              </>
            )}
          </PanelWide>
        ),
      },
      {
        key: 'hms-cpu',
        label: 'HMS 处理器',
        children: (
          <PanelWide>
            {!hw ? (
              hmsHwMissing
            ) : (
              <>
                {cpuObj && Object.keys(cpuObj).length > 0 ? (
                  <Descriptions className="hms-hw-same-row-height" {...DESCR_COL1}>
                    {Object.entries(cpuObj).map(([k, v]) => (
                      <Descriptions.Item key={k} label={hmsCpuInfoLabelZh(k)}>
                        {displayCell(v)}
                      </Descriptions.Item>
                    ))}
                  </Descriptions>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 cpu" />
                )}
              </>
            )}
          </PanelWide>
        ),
      },
      {
        key: 'hms-memory',
        label: 'HMS 内存',
        children: (
          <PanelWide>
            {!hw ? (
              hmsHwMissing
            ) : (
              <>
                {memListSorted.length ? (
                  <Table
                    {...DRAWER_TABLE_PROPS}
                    scroll={tableScrollXWhenHasData(memListSorted.length)}
                    rowKey={(r: any, i?: number) => `${String(r?.Locator ?? '')}-${i ?? 0}`}
                    columns={HMS_MEM_COLS as any}
                    dataSource={memListSorted}
                    pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 memory" />
                )}
              </>
            )}
          </PanelWide>
        ),
      },
      {
        key: 'hms-disk',
        label: 'HMS 存储',
        children: (
          <PanelWide>
            {!hw ? (
              hmsHwMissing
            ) : (
              <>
                {diskList.length ? (
                  <Table
                    {...DRAWER_TABLE_PROPS}
                    scroll={tableScrollXWhenHasData(diskList.length)}
                    rowKey={(r: any, i?: number) => `${r?.name || ''}-${r?.type || ''}-${i ?? 0}`}
                    columns={HMS_DISK_COLS as any}
                    dataSource={diskList}
                    pagination={{ pageSize: 12, showTotal: (t) => `共 ${t} 条` }}
                    expandable={{
                      expandedRowRender: (r: any) =>
                        Array.isArray(r?.children) && r.children.length ? (
                          <Table
                            {...DRAWER_TABLE_PROPS}
                            scroll={tableScrollXWhenHasData(r.children.length)}
                            rowKey={(c: any, j?: number) => `${c?.name}-${j ?? 0}`}
                            columns={HMS_DISK_COLS as any}
                            dataSource={r.children}
                            pagination={false}
                          />
                        ) : (
                          <Typography.Text type="secondary">无子项（children）</Typography.Text>
                        ),
                      rowExpandable: (r: any) => Array.isArray(r?.children) && r.children.length > 0,
                    }}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 disk" />
                )}
              </>
            )}
          </PanelWide>
        ),
      },
      {
        key: 'hms-nics',
        label: 'HMS 网卡',
        children: (
          <PanelWide>
            {nics.length ? (
              <Table
                {...DRAWER_TABLE_PROPS}
                scroll={tableScrollXWhenHasData(nics.length)}
                rowKey={(r: any) => `${r?.device || ''}-${r?.mac || ''}-${r?.master || ''}`}
                columns={nicColumns as any}
                dataSource={nics}
                pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条`, size: 'small' }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 nics 数据">
                <Flex vertical align="center" gap="small">
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0, textAlign: 'center' }}>
                    {HMS_SYNC_HINT}
                  </Typography.Paragraph>
                </Flex>
              </Empty>
            )}
          </PanelWide>
        ),
      },
      {
        key: 'hms-lldp',
        label: 'HMS LLDP',
        children: (
          <PanelWide>
            {!hw ? (
              hmsHwMissing
            ) : (
              <>
                {swList.length ? (
                  <Table
                    {...DRAWER_TABLE_PROPS}
                    scroll={tableScrollXWhenHasData(lldpTableRows.length)}
                    rowKey="key"
                    columns={HMS_LLDP_TABLE_COLUMNS as any}
                    dataSource={lldpTableRows}
                    pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 条` }}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未返回 switch（LLDP）" />
                )}
              </>
            )}
          </PanelWide>
        ),
      },
    ];
  }, [
    record,
    titleName,
    ready,
    internalIP,
    harvesterVersion,
    ntp,
    annotations,
    podRequests,
    podLimits,
    nics,
    nicColumns,
    hardware,
    nodeRoles,
    physicalIfaces,
    ifaceStatusMap,
    metrics,
  ]);

  return (
    <Drawer
      title="物理节点信息"
      extra={
        onRefreshFromCluster ? (
          <Button size="small" onClick={() => onRefreshFromCluster(true)} loading={refreshLoading}>
            刷新
          </Button>
        ) : null
      }
      open={open && !!record}
      onClose={onClose}
      width="min(1000px, 96vw)"
      placement="right"
      destroyOnHidden
    >
      {record ? (
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      ) : null}
    </Drawer>
  );
};

export default PhysicalNodeDetailDrawer;
