import React, { useState, useMemo, useCallback } from 'react';
import {
  KUBE_OVN_PUBLIC_VPC,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  isBuiltInKubeOvnVpc,
} from '../lib/kubeOvnSubnetConstants';
import { buildBusinessVpcPickerRows } from '../lib/kubeOvnUiHelpers';
import { Table, Modal, Form, Input, Select, message, Alert, MenuProps, Badge, Button, Tooltip, Space, Radio } from 'antd';
import { ApiTwoTone, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnEip, deleteCloudProviderOvnEip } from '../../../../../../services/harvesterApi';
import MetadataModal from '../modals/MetadataModal';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { generateHarvesterCrMetadataName } from '../../../../../../utils/harvesterUtils';
import { ovnDisplayName, ovnKeywordMatches } from '../lib/ovnResourceDisplay';
import {
  buildPublicSubnetNameToVpcNameMap,
  getOvnEipBoundVpcName,
} from '../lib/kubeOvnEipVpcHelpers';

function ipv4ToInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = [m[1], m[2], m[3], m[4]].map((x) => Number(x));
  if (p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

/** 判断 IPv4 是否在 CIDR 内（仅 IPv4） */
function ipv4InCidr(ip: string, cidr: string): boolean {
  const parts = cidr.trim().split('/');
  if (parts.length !== 2) return false;
  const prefix = ipv4ToInt(parts[0]);
  const bits = Number(parts[1]);
  if (prefix === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const host = ipv4ToInt(ip);
  if (host === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (host & mask) === (prefix & mask);
}

function subnetCidrOf(s: any): string {
  return String(s?.spec?.cidrBlock ?? s?.spec?.cidr ?? s?.cidr ?? '').trim();
}

function normalizeExcludeIps(s: any): string[] {
  const raw = s?.spec?.excludeIps ?? s?.excludeIps ?? [];
  return Array.isArray(raw) ? raw.map((x) => String(x).trim()).filter(Boolean) : [];
}

function ipv4InRange(ip: string, start: string, end: string): boolean {
  const a = ipv4ToInt(start);
  const b = ipv4ToInt(end);
  const x = ipv4ToInt(ip);
  if (a === null || b === null || x === null) return false;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return x >= lo && x <= hi;
}

function ipv4ExcludedBy(entries: string[], ip: string): boolean {
  for (const e of entries) {
    const v = String(e || '').trim();
    if (!v) continue;
    if (v.includes('/')) {
      if (ipv4InCidr(ip, v)) return true;
      continue;
    }
    if (v.includes('..')) {
      const parts = v.split('..').map((s) => s.trim());
      if (parts.length === 2 && ipv4InRange(ip, parts[0], parts[1])) return true;
      continue;
    }
    const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v);
    if (isIp && v === ip) return true;
  }
  return false;
}

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean) => void;
  bordered?: boolean;
}

interface EipSectionProps extends BaseSectionProps {
  eips: any[];
  subnets: any[]; // Needed for creating EIP (external subnets)
  /** VPC 分域创建/列表展示：传 Kube-OVN VPC 列表 */
  vpcs?: any[];
  networkScope?: 'flat' | 'vpc';
}

export const EipSection: React.FC<EipSectionProps> = ({
  cloudId,
  eips,
  subnets,
  vpcs,
  loading,
  onRefresh,
  bordered = true,
  networkScope,
}) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasVpcsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.vpcs:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const hasEipWrite = useMemo(() => {
    if (networkScope === 'flat') {
      return (
        hasPermissionForAction(perms, 'clouds.eips.flat:write') ||
        hasPermissionForAction(perms, 'clouds.subnets.flat:write') ||
        hasPermissionForAction(perms, 'clouds:write')
      );
    }
    if (networkScope === 'vpc') {
      return (
        hasPermissionForAction(perms, 'clouds.eips.vpc:write') ||
        hasPermissionForAction(perms, 'clouds.vpcs:write') ||
        hasPermissionForAction(perms, 'clouds:write')
      );
    }
    return hasVpcsWrite;
  }, [networkScope, perms, hasVpcsWrite]);
  const [isCreateVisible, setIsCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form] = Form.useForm();
  const [metadataRecord, setMetadataRecord] = useState<any>(null);
  
  // 筛选条件
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  /**
   * OvnEip.spec.externalSubnet 填 Subnet 名；与产品「公共子网」一致：注解 tower.io/subnet-type=public，挂在 ovn-cluster。
   * 内置子网 external 由集群维护，不在此列表中供选择（与 Underlay 公共子网列表一致）。
   */
  const externalSubnets = useMemo(() => {
    const subnetTypeOf = (s: any) =>
      String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] ?? '').trim().toLowerCase();
    return subnets.filter((s: any) => {
      if (String(s?.metadata?.name || '').trim() === 'external') return false;
      if (subnetTypeOf(s) !== 'public') return false;
      const vpc = String(s.spec?.vpc || s.vpc || '').trim() || KUBE_OVN_PUBLIC_VPC;
      return vpc === KUBE_OVN_PUBLIC_VPC;
    });
  }, [subnets]);

  const vpcOptionsForCreate = useMemo(() => {
    if (networkScope !== 'vpc') return [];
    return buildBusinessVpcPickerRows(vpcs);
  }, [networkScope, vpcs]);

  const vpcDisplayByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const v of vpcs || []) {
      const id = String(v?.name || v?.metadata?.name || '').trim();
      if (!id) continue;
      const alias = String(v?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
      m[id] = alias || id;
    }
    return m;
  }, [vpcs]);

  const publicSubnetDisplayByName = useMemo(() => {
    const m: Record<string, { display: string; cidr: string }> = {};
    for (const s of externalSubnets) {
      const name = String(s?.metadata?.name || s?.name || '').trim();
      if (!name) continue;
      const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
      const cidr = subnetCidrOf(s);
      m[name] = { display: alias || name, cidr };
    }
    return m;
  }, [externalSubnets]);

  const publicSubnetToVpcName = useMemo(
    () => buildPublicSubnetNameToVpcNameMap(vpcs ?? []),
    [vpcs],
  );

  // 筛选数据并按创建时间倒序排序
  const filteredData = useMemo(() => {
    const filtered = eips.filter((item: any) => {
      const ip = item.spec?.v4Ip || '';
      const type = item.spec?.type || '';
      const ready = item.status?.ready;
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (!ovnKeywordMatches(item, kw) && !ip.toLowerCase().includes(kw)) {
          return false;
        }
      }
      
      // 状态筛选
      if (statusFilter) {
        const isReady = ready ? 'ready' : 'notready';
        if (isReady !== statusFilter) return false;
      }
      
      // 类型筛选
      if (typeFilter && type !== typeFilter) {
        return false;
      }
      
      return true;
    });
    
    // 按创建时间倒序排序
    return filtered.sort((a: any, b: any) => {
      const timeA = a?.metadata?.creationTimestamp || a?.createdAt || '';
      const timeB = b?.metadata?.creationTimestamp || b?.createdAt || '';
      return timeB.localeCompare(timeA);
    });
  }, [eips, keyword, statusFilter, typeFilter]);

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    eips.forEach((item: any) => {
      const type = item.spec?.type;
      if (type) set.add(type);
    });
    return Array.from(set);
  }, [eips]);

  const handleCreate = async () => {
    if (!hasEipWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      const v4 = String(values.v4Ip ?? '').trim();
      if (v4) {
        const owner = (Array.isArray(eips) ? eips : []).find((ex: any) => {
          const ip = String(ex?.spec?.v4Ip ?? ex?.status?.v4Ip ?? '').trim();
          return ip && ip === v4;
        });
        if (owner) {
          const disp = ovnDisplayName(owner);
          message.error(`该公网 IP 已被 「${disp}」占用，请更换其它地址或留空由系统分配`);
          return;
        }
      }
      setCreateLoading(true);
      const scope = networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
      const displayName = String(values.displayName ?? '').trim();
      const vpc = String(values.vpc ?? '').trim();
      const routeScope = values.routeScope as string | undefined;
      const accessRouteCidr =
        networkScope === 'vpc'
          ? routeScope === 'custom'
            ? String(values.accessRouteCidr ?? '').trim()
            : '0.0.0.0/0'
          : undefined;

      const payload = {
        name: generateHarvesterCrMetadataName('kubeOvnEip'),
        ...(displayName ? { alias: displayName } : {}),
        externalSubnet: values.externalSubnet,
        ...(networkScope === 'vpc' ? { vpc } : {}),
        ...(networkScope === 'vpc' && accessRouteCidr ? { accessRouteCidr } : {}),
        ...(v4 ? { v4Ip: v4 } : {}),
        type: 'nat',
      };
      await createCloudProviderOvnEip(cloudId, payload, scope);
      message.success(networkScope === 'flat' ? '公网 IP 创建成功' : 'EIP 创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      onRefresh(true);
    } catch (e: any) {
      let errMsg = e.message || '创建失败';
      try {
        const errObj = JSON.parse(errMsg);
        if (errObj && typeof errObj === 'object') {
          errMsg = errObj.message || errMsg;
          if (errObj.error) errMsg += `: ${errObj.error}`;
        }
      } catch (parseError) {
        // ignore
      }
      const rd = e?.responseData;
      if (rd?.details != null) {
        const ds = typeof rd.details === 'string' ? rd.details : JSON.stringify(rd.details);
        if (ds && !errMsg.includes(ds.slice(0, 40))) {
          errMsg = `${errMsg} | ${ds.length > 400 ? `${ds.slice(0, 400)}…` : ds}`;
        }
      }
      errMsg = errMsg
        .replace(/该公网 IP 已被\s*EIP「/g, '该公网 IP 已被 「')
        .replace(/已被\s*EIP「/g, '已被 「');
      message.error(errMsg);
    } finally {
      setCreateLoading(false);
    }
  };

  const handleMenuClick = useCallback(
    async (key: string, record: any) => {
      if (key === 'metadata') {
        setMetadataRecord(record);
      } else if (key === 'delete') {
        if (!hasEipWrite) {
          message.error('无权限执行该操作');
          return;
        }
        Modal.confirm({
          title: '确认删除',
          content: `确定要删除 公网ip [ ${ovnDisplayName(record)} ]吗？`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            try {
              const apiScope =
                networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
              await deleteCloudProviderOvnEip(cloudId, record.metadata?.name, apiScope);
              message.success('删除成功');
              onRefresh(true);
            } catch (e: any) {
              message.error(`删除失败: ${e.message}`);
            }
          },
        });
      }
    },
    [cloudId, hasEipWrite, networkScope, onRefresh],
  );

  const allColumns = useMemo(
    () => [
    {
      title: '名称',
      key: 'alias',
      fixed: 'left' as const,
      render: (_: any, r: any) => {
        const a = String(r?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
        const text = a || '—';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <ApiTwoTone/>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={text}>
              {text}
            </span>
          </span>
        );
      },
    },
    {
      title: 'ID',
      key: 'metadataName',
      render: (_: any, r: any) => {
        const n = r.metadata?.name || '—';
        return (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }} title={n}>
            {n}
          </span>
        );
      },
    },
    ...(networkScope === 'vpc'
      ? [
          {
            title: 'VPC',
            key: 'vpc',
            render: (_: any, r: any) => {
              const vpcName =
                networkScope !== 'vpc'
                  ? ''
                  : getOvnEipBoundVpcName(r, publicSubnetToVpcName);
              const display = vpcName ? (vpcDisplayByName[vpcName] || vpcName) : '-';
              return <span title={vpcName || undefined}>{display}</span>;
            },
          },
        ]
      : []),
    { 
      title: '所在公共子网', 
      key: 'externalSubnet', 
      render: (_: any, r: any) => {
        const name = String(r?.spec?.externalSubnet ?? '').trim();
        if (!name) return '-';
        const row = publicSubnetDisplayByName[name];
        if (!row) return name;
        return (
          <span title={name}>
            {row.display}
            {row.cidr ? <span style={{ color: '#8c8c8c' }}>（{row.cidr}）</span> : null}
          </span>
        );
      },
    },
    { 
      title: 'IP地址', 
      key: 'ip', 
      render: (_: any, r: any) => <span>{String(r?.status?.v4Ip || r?.spec?.v4Ip || '').trim() || '-'}</span> 
    },
    { 
      title: 'MAC地址', 
      key: 'mac', 
      render: (_: any, r: any) => r.spec?.macAddress || '-' 
    },
    { 
      title: '类型', 
      key: 'type', 
      render: (_: any, r: any) => r.spec?.type || '-' 
    },
    { 
      title: '状态', 
      key: 'status', 
      render: (_: any, r: any) => (
        <Badge 
          status={r.status?.ready ? 'success' : 'warning'} 
          text={r.status?.ready ? 'Ready' : 'Not Ready'} 
        />
      ) 
    },
    {
      title: '创建时间',
      key: 'createdAt',
      render: (_: any, r: any) => {
        const c = r?.metadata?.creationTimestamp || r?.createdAt || '';
        try {
          if (!c) return '-';
          const d = new Date(c);
          if (!isNaN(d.getTime())) {
            const txt = d.toLocaleString('zh-CN', { hour12: false });
            return txt;
          }
        } catch { }
        return c || '-';
      },
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right' as const,
      render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          { key: 'metadata', label: '查看元数据' },
          { type: 'divider' },
          { key: 'delete', label: '删除', danger: true, disabled: !hasEipWrite }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)}
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasEipWrite }}
          />
        );
      }
    },
    ],
    [
      hasEipWrite,
      handleMenuClick,
      networkScope,
      publicSubnetDisplayByName,
      publicSubnetToVpcName,
      vpcDisplayByName,
    ],
  );

  const eipTableSettingsKey = `harvester_ovn_eip_${networkScope ?? 'legacy'}`;
  const { displayColumns: columns } = useTableColumnSettings(allColumns, eipTableSettingsKey);

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input 
              allowClear 
              placeholder="名称/ID/IP" 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword} 
              onChange={(e) => setKeyword(e.target.value)} 
              className="toolbar-search"
            />
            <Select 
              allowClear 
              placeholder="状态" 
              value={statusFilter || undefined} 
              onChange={(v) => setStatusFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                { value: 'ready', label: 'Ready' },
                { value: 'notready', label: 'Not Ready' }
              ]} 
            />
            <Select 
              allowClear 
              placeholder="类型" 
              value={typeFilter || undefined} 
              onChange={(v) => setTypeFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...typeOptions.map(t => ({ value: t, label: t }))
              ]} 
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setStatusFilter('');
                setTypeFilter('');
              }}
            >
              重置
            </button>
          </>
        )}
        primaryAction={{
          label: '创建公网IP',
          onClick: () => { if (!hasEipWrite) return; setIsCreateVisible(true); },
          disabled: !hasEipWrite
        }}
        toolbarRight={
          <Space size={8}>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey={eipTableSettingsKey} />
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined />} onClick={() => onRefresh(true)} loading={loading} aria-label="刷新" />
            </Tooltip>
          </Space>
        }
      >
        <Table 
          className="std-table"
          dataSource={filteredData} 
          columns={columns} 
          loading={loading} 
          bordered={false}
          scroll={{ x: true }}
          rowKey={r => r.metadata?.uid}
          pagination={{
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </PageDetailSection>
      
      <MetadataModal visible={!!metadataRecord} record={metadataRecord} onClose={() => setMetadataRecord(null)} />

      <Modal
        title="创建公网IP"
        open={isCreateVisible}
        centered
        onCancel={() => {
          form.resetFields();
          setIsCreateVisible(false);
        }}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ routeScope: 'unlimited' }}>
          {networkScope === 'vpc' && vpcOptionsForCreate.length === 0 && (
            <Alert
              type="warning"
              message="没有可选的 VPC。请先在「VPC网络」中创建业务 VPC。"
              style={{ marginBottom: 16 }}
            />
          )}
          {externalSubnets.length === 0 && (
            <Alert
              type="warning"
              message="没有可选的公共子网。EIP 需使用注解 tower.io/subnet-type=public、且挂在内置 VPC ovn-cluster 下的子网；请先在「公共子网」入口创建。"
              style={{ marginBottom: 16 }}
            />
          )}
          
          <Form.Item
            name="displayName"
            label="名称"
            rules={[
              { required: true, message: '请输入名称' },
              {
                validator: async (_, value) => {
                  const s = String(value ?? '').trim();
                  if (!s) return Promise.resolve();
                  const dup = (Array.isArray(eips) ? eips : []).some((r: any) => {
                    const name = String(r?.metadata?.name ?? '').trim();
                    const alias = String(r?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                    return name === s || (alias.length > 0 && alias === s);
                  });
                  if (dup) return Promise.reject(new Error('名称已存在，请修改'));
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="展示名称，必填" />
          </Form.Item>

          {networkScope === 'vpc' && (
            <Form.Item name="vpc" label="VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
              <Select
                showSearch
                placeholder="请选择 VPC"
                allowClear
                optionFilterProp="data-search"
                optionLabelProp="label"
              >
                {vpcOptionsForCreate.map((v) => (
                  <Select.Option key={v.id} value={v.id} label={v.display} data-search={v.searchLabel}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{v.display}</span>
                      <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>{`命名空间: ${v.namespacesDisplay}`}</span>
                    </div>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}

          <Form.Item name="externalSubnet" label="公共子网" rules={[{ required: true, message: '请选择公共子网' }]}>
            <Select placeholder="请选择公共子网" allowClear>
              {externalSubnets.map((s) => {
                const name = String(s.metadata?.name || s.name || '');
                const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                const cidr = subnetCidrOf(s);
                const primary = alias || name;
                const secondary = alias ? name : '';
                return (
                  <Select.Option key={name} value={name}>
                    <span title={cidr ? `${primary} ${cidr}` : primary}>
                      {primary}
                      {secondary ? <span style={{ color: '#8c8c8c' }}>（{secondary}）</span> : null}
                      {cidr ? <span style={{ color: '#8c8c8c' }}> {cidr}</span> : null}
                    </span>
                  </Select.Option>
                );
              })}
            </Select>
          </Form.Item>

          {networkScope === 'vpc' && (
            <>
              <Form.Item
                name="routeScope"
                label="可访问的范围"
                tooltip="写入所选业务 VPC 的 policyDst 静态路由：目的网段为下方范围，下一跳为所选公共子网的网关。"
              >
                <Radio.Group>
                  <Radio value="unlimited">不限（0.0.0.0/0）</Radio>
                  <Radio value="custom">指定 IP 范围（CIDR）</Radio>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                noStyle
                shouldUpdate={(prev, cur) => prev.routeScope !== cur.routeScope}
              >
                {({ getFieldValue }) =>
                  getFieldValue('routeScope') === 'custom' ? (
                    <Form.Item
                      name="accessRouteCidr"
                      label="CIDR"
                      rules={[
                        { required: true, message: '请填写 CIDR' },
                        {
                          pattern: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/,
                          message: '格式如 10.0.0.0/8 或 192.168.0.0/16',
                        },
                        {
                          validator: async (_, v) => {
                            const raw = String(v ?? '').trim();
                            const p = Number(raw.split('/')[1]);
                            if (!Number.isInteger(p) || p < 0 || p > 32) {
                              throw new Error('前缀长度须在 0–32 之间');
                            }
                          },
                        },
                      ]}
                    >
                      <Input placeholder="例如 10.0.0.0/8" />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
            </>
          )}
          <Form.Item
            name="v4Ip"
            label="指定 IP（可选）"
            dependencies={['externalSubnet']}
            rules={[
              ({ getFieldValue }) => ({
                validator: async (_, v) => {
                  const raw = String(v ?? '').trim();
                  if (!raw) return;
                  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) {
                    throw new Error('请输入合法 IPv4 地址');
                  }
                  const subnetName = getFieldValue('externalSubnet');
                  if (!subnetName) {
                    throw new Error('请先选择公共子网');
                  }
                  const s = externalSubnets.find((x) => String(x.metadata?.name || x.name) === String(subnetName));
                  const cidr = s ? subnetCidrOf(s) : '';
                  if (!cidr || !cidr.includes('/')) {
                    throw new Error('无法解析该子网的 CIDR');
                  }
                  if (!ipv4InCidr(raw, cidr)) {
                    throw new Error(`IP 须落在公共子网网段 ${cidr} 内`);
                  }
                  const excluded = s ? normalizeExcludeIps(s) : [];
                  if (excluded.length > 0 && ipv4ExcludedBy(excluded, raw)) {
                    throw new Error('IP 位于该公共子网的排除列表/范围内，请选择其它地址');
                  }
                },
              }),
            ]}
          >
            <Input placeholder="留空由系统分配；填写时须在所选子网 CIDR 内" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default EipSection;
