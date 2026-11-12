import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Form, Input, Select, Space, Tag, Modal, message, Table, Alert, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import type { ColumnsType } from 'antd/es/table';
import { apiPost } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import type { IbrSectionEmbedProps } from '../lib/embedProps';
import { loadIbrVrCatalog } from '../lib/ibrVrCatalog';
import Srv6HealthCheckModal from './Srv6HealthCheckModal';
// 复用 VR 页的样式（page-toolbar / toolbar-container / toolbar-actions / vr-table）

interface Srv6TunnelRow {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  ceAHaGroupName?: string | null;
  ceBHaGroupName?: string | null;
  status: string;
  createdAt: string;
  tunnelTopology?: 'S' | 'H' | null;
  hubPeSlot?: 'peA' | 'peB' | null;
  hubBindings?: {
    wanIf?: string;
    lanIf?: string;
    peerPublicNeighbor?: string;
  } | null;
  rdRtMeta?: { rtCommon?: string } | null;
  /** 配置面对账摘要（非 live BGP；无隧道级流量） */
  configHealth?: 'ok' | 'drift' | 'missing_archive' | 'endpoint_missing' | null;
  configHealthMessage?: string | null;
  configHealthIssueCount?: number;
  configHealthCheckedAt?: string | null;
}

function mapSrv6TunnelRow(it: any): Srv6TunnelRow {
  const fpA = it?.endpointFingerprint?.ceA;
  const fpB = it?.endpointFingerprint?.ceB;
  return {
    id: it.id,
    name: it.name,
    peA: it.peA,
    peB: it.peB,
    ceA: it.ceA,
    ceB: it.ceB,
    ceAHaGroupName: fpA?.haGroupName || null,
    ceBHaGroupName: fpB?.haGroupName || null,
    status: it.status,
    createdAt: it.createdAt,
    tunnelTopology: it.tunnelTopology,
    hubPeSlot: it.hubPeSlot,
    hubBindings: it.hubBindings,
    rdRtMeta: it.rdRtMeta,
    configHealth: it.configHealth ?? null,
    configHealthMessage: it.configHealthMessage ?? null,
    configHealthIssueCount: it.configHealthIssueCount ?? 0,
    configHealthCheckedAt: it.configHealthCheckedAt ?? null,
  };
}

function renderSrv6ListCeCell(
  uuid: string,
  haGroupName: string | null | undefined,
  vrLabel: (id?: string | null) => string,
) {
  const device = vrLabel(uuid);
  if (!haGroupName) return device;
  return (
    <Tooltip title={`端点设备：${device}`}>
      <span>
        {device}
        <Tag style={{ marginLeft: 6 }}>{haGroupName}</Tag>
      </span>
    </Tooltip>
  );
}

function configHealthTag(h?: Srv6TunnelRow['configHealth']) {
  if (h === 'ok') return <Tag color="green">健康</Tag>;
  if (h === 'drift') return <Tag color="orange">漂移</Tag>;
  if (h === 'missing_archive') return <Tag color="gold">缺档案</Tag>;
  if (h === 'endpoint_missing') return <Tag color="red">缺端点</Tag>;
  return <Tag>未检查</Tag>;
}

const SRv6Page: React.FC<IbrSectionEmbedProps> = ({ embedded = false, scopedVrUuid }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];
  const canWrite =
    user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.srv6:write');
  const scopedVr = String(scopedVrUuid || '').trim();
  const [tunnels, setTunnels] = useState<Srv6TunnelRow[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string[] | undefined>();

  // 列表页不再展示拓扑节点

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [healthModalOpen, setHealthModalOpen] = useState(false);
  const [healthRow, setHealthRow] = useState<Srv6TunnelRow | null>(null);
  const [vrNameMap, setVrNameMap] = useState<Record<string, string>>({});
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileLoading, setReconcileLoading] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<import('../../../../services/api').Srv6ReconcileReport | null>(null);

  const vrLabel = (uuid?: string | null) => {
    const id = String(uuid || '').trim();
    if (!id) return '—';
    return vrNameMap[id] || id;
  };

  const openReconcileModal = () => {
    setReconcileReport(null);
    setReconcileOpen(true);
  };

  const loadGenRef = useRef(0);
  const loadSrv6Tunnels = useCallback(async (force?: boolean) => {
    const gen = ++loadGenRef.current;
    setListLoading(true);
    let shellPainted = false;
    try {
      const { fetchSrv6Tunnels } = await import('../../../../services/api');
      const list = await fetchSrv6Tunnels({ skipCache: !!force, includeHealth: false });
      if (gen !== loadGenRef.current) return;
      setTunnels((Array.isArray(list) ? list : []).map(mapSrv6TunnelRow));
      shellPainted = true;
      setListLoading(false);
      try {
        const withHealth = await fetchSrv6Tunnels({ skipCache: true, includeHealth: true });
        if (gen !== loadGenRef.current) return;
        setTunnels((Array.isArray(withHealth) ? withHealth : []).map(mapSrv6TunnelRow));
      } catch (he: any) {
        if (gen !== loadGenRef.current) return;
        console.warn('SRv6 配置健康 enrich 失败:', he);
        message.warning(`配置健康暂不可用：${he?.message || '请稍后刷新'}`);
      }
    } catch (e: any) {
      if (gen !== loadGenRef.current) return;
      console.error('加载 SRv6 隧道失败:', e);
      message.error(`加载 SRv6 隧道失败：${e?.message || '请稍后重试'}`);
      if (!shellPainted) setTunnels([]);
      setListLoading(false);
    }
  }, []);

  const runReconcile = useCallback(async (repair: boolean) => {
    setReconcileLoading(true);
    try {
      const { fetchSrv6Reconcile, repairSrv6Reconcile } = await import('../../../../services/api');
      const vrUuid = scopedVr || undefined;
      const report = repair
        ? await repairSrv6Reconcile({ repair: true, vrUuid })
        : await fetchSrv6Reconcile(vrUuid);
      setReconcileReport(report);
      if (repair) {
        if (report.repaired > 0) {
          message.success(`对账完成：已修复 ${report.repaired} 个 VR（仅平台账本，未下发设备）`);
          await loadSrv6Tunnels(true);
        } else if (report.withIssues > 0) {
          message.warning(
            `对账完成：仍有 ${report.withIssues} 个 VR 无法自动修复（如缺基线），请查看问题列`,
          );
        } else {
          message.success('对账完成：未发现需修复项');
        }
      } else if (report.withIssues === 0) {
        message.success('对账完成：未发现配置漂移');
      } else {
        message.warning(`对账完成：发现 ${report.withIssues} 个 VR 存在漂移`);
      }
    } catch (e: any) {
      message.error(`对账失败：${e?.message || '请稍后重试'}`);
    } finally {
      setReconcileLoading(false);
    }
  }, [loadSrv6Tunnels, scopedVr]);

  const handleBatchDelete = () => {
    if (!canWrite || selectedRowKeys.length === 0) return;
    const selected = tunnels.filter((t) => selectedRowKeys.includes(t.id));
    const names = selected.map((t) => t.name).filter(Boolean);
    let revertPlatform = true;
    let revertDevice = true;
    Modal.confirm({
      title: '确认批量删除隧道？',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            确定删除选中的 {selectedRowKeys.length} 条 SRv6 隧道
            {names.length ? `：${names.slice(0, 5).join('、')}${names.length > 5 ? '…' : ''}` : ''}
            ？
          </p>
          <Checkbox
            defaultChecked
            onChange={(e) => {
              revertPlatform = e.target.checked;
            }}
          >
            回退平台库中的隧道注入项
          </Checkbox>
          <br />
          <Checkbox
            defaultChecked
            onChange={(e) => {
              revertDevice = e.target.checked;
            }}
          >
            同步回退到底层设备
          </Checkbox>
          <p style={{ marginTop: 12, marginBottom: 0, color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
            将逐条删除；历史隧道若创建时未保存配置变更记录，勾选回退可能失败——可取消「回退平台库」后仅删档案。
          </p>
        </div>
      ),
      okText: '批量删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const { deleteSrv6Tunnel } = await import('../../../../services/api');
        let ok = 0;
        const errors: string[] = [];
        const warnings: string[] = [];
        for (const key of selectedRowKeys) {
          const id = String(key);
          const label = selected.find((t) => t.id === id)?.name || id;
          try {
            const res: any = await deleteSrv6Tunnel(id, { revertPlatform, revertDevice });
            ok += 1;
            if (Array.isArray(res?.warnings) && res.warnings.length) {
              warnings.push(`${label}：${res.warnings.join('；')}`);
            }
          } catch (e: any) {
            errors.push(`${label}：${e?.message || '删除失败'}`);
          }
        }
        setSelectedRowKeys([]);
        await loadSrv6Tunnels(true);
        if (warnings.length) message.warning(warnings.slice(0, 3).join('；'));
        if (errors.length === 0) {
          message.success(`已删除 ${ok} 条隧道`);
        } else if (ok > 0) {
          message.warning(`成功 ${ok} 条，失败 ${errors.length} 条：${errors.slice(0, 3).join('；')}`);
        } else {
          message.error(`批量删除失败：${errors.slice(0, 3).join('；')}`);
        }
      },
    });
  };

  const getActionMenu = (_row: Srv6TunnelRow): MenuProps['items'] => {
    const items: MenuProps['items'] = [
      { key: 'topology', label: '架构拓扑' },
      ...(canWrite ? [{ key: 'update', label: '更新SRv6配置' }] : []),
      { key: 'health', label: '健康巡检' },
    ];
    if (canWrite) {
      items.push({ type: 'divider' }, { key: 'delete', label: '删除隧道', danger: true });
    }
    return items;
  };

  const handleRowActionClick = (row: Srv6TunnelRow): MenuProps['onClick'] => ({ key }) => {
    switch (key) {
      case 'topology':
        navigate(
          `/admin/interconnect/srv6/architecture?tunnelId=${encodeURIComponent(row.id)}`,
        );
        break;
      case 'update':
        navigate(`/admin/interconnect/srv6/create?editId=${encodeURIComponent(row.id)}`);
        break;
      case 'health':
        setHealthRow(row);
        setHealthModalOpen(true);
        break;
      case 'delete': {
        let revertPlatform = true;
        let revertDevice = true;
        Modal.confirm({
          title: '确认删除该隧道？',
          content: (
            <div>
              <p style={{ marginBottom: 8 }}>确定删除：{row.name}</p>
              <Checkbox
                defaultChecked
                onChange={(e) => {
                  revertPlatform = e.target.checked;
                }}
              >
                回退平台库中的隧道注入项
              </Checkbox>
              <br />
              <Checkbox
                defaultChecked
                onChange={(e) => {
                  revertDevice = e.target.checked;
                }}
              >
                同步回退到底层设备
              </Checkbox>
              <p style={{ marginTop: 12, marginBottom: 0, color: 'rgba(0,0,0,.45)', fontSize: 12 }}>
                历史隧道若创建时未保存配置变更记录，勾选回退将无法删除；请取消「回退平台库」后仅删除隧道记录，再手工清理四端配置。
              </p>
            </div>
          ),
          okText: '删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: async () => {
            try {
              const { deleteSrv6Tunnel } = await import('../../../../services/api');
              const res: any = await deleteSrv6Tunnel(row.id, { revertPlatform, revertDevice });
              if (Array.isArray(res?.warnings) && res.warnings.length) {
                message.warning(res.warnings.join('；'));
              }
              message.success('隧道已删除');
              setSelectedRowKeys((keys) => keys.filter((k) => k !== row.id));
              await loadSrv6Tunnels(true);
            } catch (e: any) {
              message.error(`删除失败：${e?.message || '请稍后重试'}`);
            }
          },
        });
        break;
      }
      default:
        break;
    }
  };

  const vrTunnelRefCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tunnels) {
      for (const id of [t.peA, t.peB, t.ceA, t.ceB]) {
        if (!id) continue;
        m.set(id, (m.get(id) || 0) + 1);
      }
    }
    return m;
  }, [tunnels]);

  const tunnelUsesHubVr = (row: Srv6TunnelRow) =>
    row.tunnelTopology === 'H' ||
    [row.peA, row.peB, row.ceA, row.ceB].some((id) => (vrTunnelRefCount.get(id) || 0) > 1);

  const hubSlotLabel = (row: Srv6TunnelRow) => {
    if (row.tunnelTopology !== 'H' || !row.hubPeSlot) return '-';
    const slot = row.hubPeSlot === 'peA' ? 'PE-A' : 'PE-B';
    const vrId = row.hubPeSlot === 'peA' ? row.peA : row.peB;
    return `中心 ${slot}（${vrId}）`;
  };

  const hubTooltip = (row: Srv6TunnelRow) => {
    const b = row.hubBindings;
    if (!b) return undefined;
    const parts = [
      b.wanIf ? `WAN: ${b.wanIf}` : '',
      b.peerPublicNeighbor ? `→ Spoke ${b.peerPublicNeighbor}` : '',
      row.rdRtMeta?.rtCommon ? `RT: ${row.rdRtMeta.rtCommon}` : '',
    ].filter(Boolean);
    return parts.length ? parts.join('；') : undefined;
  };

  // 初始列
  const fullColumns: ColumnsType<Srv6TunnelRow> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      fixed: 'left',
      render: (name: string, row) => (
        <Space size={6}>
          <span>{name}</span>
          {tunnelUsesHubVr(row) ? <Tag color="purple">Hub</Tag> : null}
        </Space>
      ),
    },
    {
      title: '类型',
      key: 'tunnelTopology',
      render: (_: unknown, row) =>
        row.tunnelTopology === 'H' ? (
          <Tag color="geekblue">Spoke – Hub</Tag>
        ) : (
          <Tag>点对点</Tag>
        ),
    },
    {
      title: 'Hub',
      key: 'hub',
      render: (_: unknown, row) => {
        const tip = hubTooltip(row);
        const label = hubSlotLabel(row);
        return tip ? (
          <Tooltip title={tip}>
            <span>{label}</span>
          </Tooltip>
        ) : (
          label
        );
      },
    },
    { title: 'PE-A', dataIndex: 'peA', key: 'peA', render: (id: string) => vrLabel(id) },
    { title: 'PE-B', dataIndex: 'peB', key: 'peB', render: (id: string) => vrLabel(id) },
    {
      title: 'CE-A',
      key: 'ceA',
      render: (_: unknown, row) => renderSrv6ListCeCell(row.ceA, row.ceAHaGroupName, vrLabel),
    },
    {
      title: 'CE-B',
      key: 'ceB',
      render: (_: unknown, row) => renderSrv6ListCeCell(row.ceB, row.ceBHaGroupName, vrLabel),
    },
    {
      title: '生命周期',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => {
        const tag =
          s === 'available' ? (
            <Tag color="green">可用</Tag>
          ) : s === 'degraded' ? (
            <Tag color="orange">已降级</Tag>
          ) : s === 'error' ? (
            <Tag color="red">异常</Tag>
          ) : s === 'deploying' ? (
            <Tag color="blue">下发中</Tag>
          ) : (
            <Tag color="blue">创建中</Tag>
          );
        return <Tooltip title="平台档案生命周期，不等于线路已通">{tag}</Tooltip>;
      },
    },
    {
      title: '配置健康',
      key: 'configHealth',
      render: (_: unknown, row) => {
        const isDrift = row.configHealth === 'drift';
        const tip = [
          row.configHealthMessage || '刷新列表可重新对账',
          row.configHealthCheckedAt
            ? `检查于 ${new Date(row.configHealthCheckedAt).toLocaleString()}`
            : '',
          '比较平台账本与「向导基线 + 存活隧道」公式，不是线路是否已通，也不是设备 FRR。',
          isDrift ? '点击打开「配置对账」查看差异；「扫描并修复」只重写平台账本，不会下发设备。' : '',
        ]
          .filter(Boolean)
          .join('\n');
        return (
          <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>}>
            <span
              role={isDrift ? 'button' : undefined}
              style={isDrift ? { cursor: 'pointer' } : undefined}
              onClick={
                isDrift
                  ? () => {
                      openReconcileModal();
                      void runReconcile(false);
                    }
                  : undefined
              }
            >
              {configHealthTag(row.configHealth)}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '流量',
      key: 'traffic',
      render: () => (
        <Tooltip title="设备/CSMCTL 暂无 SRv6 隧道级字节·报文；CE 侧 IPsec 见 IPsecVPN 列表或 IBR Console → SA">
          <span style={{ color: '#86909c' }}>—</span>
        </Tooltip>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', key: 'time', render: (d: string) => new Date(d).toLocaleString() },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_: any, row: Srv6TunnelRow) => (
        <ResourceActionsDropdown
          items={getActionMenu(row)}
          onClick={handleRowActionClick(row) as any}
          buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
        />
      ),
    }
  ];

  const columns = fullColumns;

  // 过滤后的隧道
  const filteredTunnels = useMemo(() => {
    return tunnels.filter((t) => {
      if (scopedVr) {
        const endpoints = [t.peA, t.peB, t.ceA, t.ceB].map((x) => String(x || '').trim());
        if (!endpoints.includes(scopedVr)) return false;
      }
      const nameLower = (t.name || '').toLowerCase();
      if (keyword && !nameLower.includes(keyword.toLowerCase())) return false;
      if (statusFilter && statusFilter.length && !statusFilter.includes(t.status)) return false;
      return true;
    });
  }, [tunnels, keyword, statusFilter, scopedVr]);

  useEffect(() => {
    void loadSrv6Tunnels(true);
    void (async () => {
      try {
        const catalog = await loadIbrVrCatalog({ force: true });
        setVrNameMap(catalog.nameMap || {});
      } catch {
        /* 名称缺失时拓扑仍显示 UUID */
      }
    })();
  }, [loadSrv6Tunnels]);

  const forceRefresh = async () => {
    message.loading({ content: '正在同步 VR 与隧道数据...', key: 'srv6_refresh' });
    try {
      await apiPost('/api/vr-instances/refresh', {});
      await loadSrv6Tunnels(true);
      message.success({ content: '同步完成', key: 'srv6_refresh' });
    } catch {
      message.error({ content: '同步失败，请稍后重试', key: 'srv6_refresh' });
    }
  };

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      hideHeader={embedded}
      pagePadding={embedded ? 0 : undefined}
      primaryAction={
        canWrite
          ? {
              text: '创建SRv6隧道',
              onClick: () => navigate('/admin/interconnect/srv6/create'),
              type: 'primary',
            }
          : undefined
      }
      secondaryActions={
        <Button
          onClick={() => {
            openReconcileModal();
            void runReconcile(false);
          }}
        >
          配置对账
        </Button>
      }
      moreMenuItems={
        canWrite
          ? [
              {
                key: 'batchDelete',
                label: selectedRowKeys.length
                  ? `批量删除（${selectedRowKeys.length}）`
                  : '批量删除',
                danger: true,
                disabled: selectedRowKeys.length === 0,
                onClick: handleBatchDelete,
              },
            ]
          : undefined
      }
      onRefresh={() => {
        void forceRefresh();
      }}
      defaultHiddenColumns={[]}
      toolbarLeft={(
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status || undefined);
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="名称"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="status" style={{ marginBottom: 0 }}>
            <Select mode="multiple" allowClear placeholder="状态" className="toolbar-filter">
              <Select.Option value="creating">创建中</Select.Option>
              <Select.Option value="available">可用</Select.Option>
            </Select>
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setKeyword('');
              setStatusFilter(undefined);
            }}
          >
            重置
          </button>
        </Form>
      )}
      tableProps={{
        className: 'vr-table std-table',
        ...(canWrite
          ? {
              rowSelection: {
                selectedRowKeys,
                onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
                preserveSelectedRowKeys: true,
              },
            }
          : {}),
        columns: columns,
        dataSource: filteredTunnels,
        rowKey: (r: Srv6TunnelRow) => r.id,
        pagination: {
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        },
        loading: listLoading,
        scroll: { x: 'max-content' },
        bordered: false,
      }}
    >
      <Modal
        title="SRv6 配置对账"
        open={reconcileOpen}
        onCancel={() => {
          setReconcileOpen(false);
          setReconcileReport(null);
        }}
        width={900}
        footer={[
          <Button key="close" onClick={() => setReconcileOpen(false)}>
            关闭
          </Button>,
          <Button key="scan" loading={reconcileLoading} onClick={() => void runReconcile(false)}>
            重新扫描
          </Button>,
          ...(canWrite
            ? [
                <Button
                  key="repair"
                  type="primary"
                  loading={reconcileLoading}
                  onClick={() => void runReconcile(true)}
                >
                  扫描并修复
                </Button>,
              ]
            : []),
        ]}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="对账说明"
          description="比较平台账本（详情「本地配置 Cache」）是否等于「向导基线 + 存活隧道」公式。忽略 CSM 的 _id / 时间戳和字段顺序，不读设备 FRR、不表示线路已通。黄标仍在时，「扫描并修复」把账本重写成公式（不下发设备）；设备和意图对齐仍需走下发。"
        />
        {reconcileReport ? (
          <div style={{ marginBottom: 8, color: 'rgba(0,0,0,.65)' }}>
            扫描 {reconcileReport.scanned} 个 VR · 问题 {reconcileReport.withIssues} · 已修复{' '}
            {reconcileReport.repaired}
          </div>
        ) : null}
        <Table
          size="small"
          loading={reconcileLoading}
          rowKey="vrUuid"
          pagination={{ pageSize: 8, size: 'small' }}
          dataSource={reconcileReport?.items?.filter((i) => i.issues.length > 0 || i.repaired) ?? []}
          locale={{ emptyText: reconcileLoading ? '扫描中…' : '暂无漂移项' }}
          columns={[
            { title: 'VR UUID', dataIndex: 'vrUuid', key: 'vrUuid', ellipsis: true },
            { title: '名称', dataIndex: 'vrName', key: 'vrName', render: (v) => v || '-' },
            { title: '隧道数', dataIndex: 'tunnelCount', key: 'tunnelCount', width: 72 },
            {
              title: '问题',
              key: 'issues',
              render: (_: unknown, row) =>
                row.issues.length
                  ? row.issues.map((iss) => (
                      <div key={`${iss.code}-${iss.message}`} style={{ marginBottom: 4 }}>
                        {iss.message}
                      </div>
                    ))
                  : row.repaired
                    ? <Tag color="green">已修复</Tag>
                    : '-',
            },
            {
              title: '修复动作',
              dataIndex: 'repairActions',
              key: 'repairActions',
              render: (acts: string[]) => (acts?.length ? acts.join('；') : '-'),
            },
          ]}
        />
      </Modal>

      <Srv6HealthCheckModal
        open={healthModalOpen}
        tunnel={healthRow}
        vrLabel={vrLabel}
        onClose={() => {
          setHealthModalOpen(false);
          setHealthRow(null);
        }}
      />

    </PageContainer>
  );
};

export default SRv6Page;
