/** 物理节点详情抽屉 · 常量、列定义与 HMS 标签映射 */

import React from 'react';
import { Empty, Flex, Space, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  pickLldpChassisId,
  pickLldpLocalInterface,
  pickLldpManagementIpv4,
  pickLldpPeerPort,
  pickLldpSystemDescription,
  pickLldpSystemName,
} from '../../hsm/lib/lldpHmsRowFields';

export type HmsNic = {
  device: string;
  state?: string;
  mac?: string;
  master?: string;
  usedByHarvester?: boolean;
};

export function Panel({ children }: { children: React.ReactNode }) {
  return <Flex vertical gap="middle">{children}</Flex>;
}

export function PanelWide({ children }: { children: React.ReactNode }) {
  return <Flex vertical gap="large">{children}</Flex>;
}

export const DESCR_COL1 = {
  bordered: true as const,
  size: 'small' as const,
  column: 1 as const,
  styles: { label: { width: 200 } },
};

export const displayCell = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  if (!s || s === 'undefined' || s === 'null') return '';
  return s;
};

export const DRAWER_TABLE_PROPS = {
  size: 'small' as const,
  bordered: true as const,
};

export function tableScrollXWhenHasData(len: number): { x: true } | undefined {
  return len > 0 ? { x: true } : undefined;
}

export const HMS_DISK_COLS = [
  { title: '设备', dataIndex: 'name', key: 'name' },
  { title: '类型', dataIndex: 'type', key: 'type' },
  { title: '容量', dataIndex: 'size', key: 'size' },
  { title: '型号', dataIndex: 'model', key: 'model', render: (v: unknown) => displayCell(v) },
  { title: '序列号', dataIndex: 'serial', key: 'serial', render: (v: unknown) => displayCell(v) },
  { title: '挂载', dataIndex: 'mountpoint', key: 'mountpoint', render: (v: unknown) => displayCell(v) },
];

export const HMS_MEM_COLS = [
  { title: '插槽', dataIndex: 'Locator', key: 'loc', ellipsis: true },
  { title: 'Bank', dataIndex: 'Bank Locator', key: 'bank', ellipsis: true },
  { title: '容量', dataIndex: 'Size', key: 'size', ellipsis: true },
  { title: '类型', dataIndex: 'Type', key: 'type', ellipsis: true },
  { title: '速率', dataIndex: 'Speed', key: 'speed', ellipsis: true },
  { title: '厂商', dataIndex: 'Manufacturer', key: 'mfg', ellipsis: true },
  { title: '序列号', dataIndex: 'Serial Number', key: 'sn', ellipsis: true },
];

export const HMS_LLDP_TABLE_COLUMNS = [
  { title: '本机接口', dataIndex: 'localIf', key: 'localIf', ellipsis: { showTitle: true } },
  { title: '对端系统名', dataIndex: 'sysName', key: 'sysName', ellipsis: { showTitle: true } },
  { title: '对端系统描述', dataIndex: 'sysDesc', key: 'sysDesc', ellipsis: { showTitle: true } },
  { title: '对端端口', dataIndex: 'peerPort', key: 'peerPort', ellipsis: { showTitle: true } },
  { title: '对端管理 IPv4', dataIndex: 'mgmtIp', key: 'mgmtIp', ellipsis: { showTitle: true } },
  { title: '邻居 Chassis ID', dataIndex: 'chassis', key: 'chassis', ellipsis: { showTitle: true } },
];

export function mapHmsLldpRowToKeyFields(row: Record<string, unknown>, index: number) {
  const rec = row && typeof row === 'object' ? (row as Record<string, string>) : {};
  const local =
    pickLldpLocalInterface(rec) ||
    String((row as { Interface?: string; interface?: string }).Interface ?? (row as { interface?: string }).interface ?? '').trim();
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

export function hmsCpuInfoLabelZh(key: string): string {
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

const HMS_SYSTEM_FIELD_LABEL_ZH: Record<string, string> = {
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
  'Chassis Manufacturer': '机箱制造商',
  'Chassis Type': '机箱类型',
  'Chassis Version': '机箱版本',
  'Chassis Serial Number': '机箱序列号',
  'Chassis Asset Tag': '机箱资产标签',
  'Chassis Part Number': '机箱料号',
  'BIOS Vendor': 'BIOS 厂商',
  'BIOS Version': 'BIOS 版本',
  'BIOS Release Date': 'BIOS 发布日期',
  'BIOS Date': 'BIOS 日期',
  'System Type': '系统类型',
  'OEM String': 'OEM 字符串',
  'Enclosure type': '机箱类型',
  'Enclosure Type': '机箱类型',
  Name: '名称',
  'Part Number': '料号',
  'OEM String 1': 'OEM 字符串 1',
  'OEM String 2': 'OEM 字符串 2',
};

export function hmsSystemInfoLabelZh(key: string): string {
  const k = String(key || '').trim();
  return HMS_SYSTEM_FIELD_LABEL_ZH[k] || k;
}

export const HMS_SYNC_HINT =
  '节点列表「刷新」或 API `?force=true` 时，Tower 会拉取 HMS 并与 Harvester 节点写入同一批库存；若仍为空，请检查集群是否暴露对应 HMS 路径。';

export function HmsHwMissingPanel() {
  return (
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
}

export function buildNicColumns(lldpByInterface: Record<string, unknown[]>): ColumnsType<HmsNic> {
  return [
    {
      title: '设备',
      key: 'device',
      dataIndex: 'device',
      render: (v: unknown) => <span>{displayCell(v)}</span>,
    },
    {
      title: '状态',
      key: 'state',
      dataIndex: 'state',
      render: (v: unknown) => {
        const s = String(v ?? '').toLowerCase().trim();
        if (!s) return null;
        return <Tag color={s === 'up' ? 'success' : 'default'}>{s}</Tag>;
      },
    },
    {
      title: 'MAC',
      key: 'mac',
      dataIndex: 'mac',
      render: (v: unknown) => <span>{displayCell(v)}</span>,
    },
    {
      title: 'Master',
      key: 'master',
      dataIndex: 'master',
      render: (v: unknown) => <span>{displayCell(v)}</span>,
    },
    {
      title: '已占用',
      key: 'usedByHarvester',
      dataIndex: 'usedByHarvester',
      render: (v: unknown, r: HmsNic) => {
        const used = Boolean(v);
        const t = used ? `已被占用（master=${displayCell(r?.master)}）` : '未占用';
        return (
          <Tooltip title={t}>
            <Tag color={used ? 'processing' : 'default'}>{used ? '已占用' : '可用'}</Tag>
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
        if (!rows?.length) return null;
        return (
          <Space direction="vertical" size={2}>
            {rows.map((sw, i) => {
              const row = sw as Record<string, unknown>;
              const line = [
                displayCell(row['System Name'] ?? row['Chassis ID_MAC']),
                displayCell(row['Port Description'] ?? row['Port ID_Ifname']),
              ]
                .filter(Boolean)
                .join(' · ');
              return line ? <span key={i}>{line}</span> : null;
            })}
          </Space>
        );
      },
    },
  ];
}
