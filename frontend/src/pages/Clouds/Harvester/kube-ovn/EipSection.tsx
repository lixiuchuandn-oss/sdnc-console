import React, { useState, useMemo, useCallback } from 'react';
import {
  KUBE_OVN_PUBLIC_VPC,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
} from './underlay-subnet/constants';
import { Table, Modal, Form, Input, Select, message, Alert, MenuProps, Badge, Button, Tooltip, Space } from 'antd';
import { ApiTwoTone, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnEip, deleteCloudProviderOvnEip } from '../../../../services/harvesterApi';
import MetadataModal from './MetadataModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { generateHarvesterEntityId } from '../../../../utils/harvesterUtils';
import { ovnDisplayName, ovnKeywordMatches } from './ovnResourceDisplay';

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
  networkScope?: 'flat' | 'vpc';
}

export const EipSection: React.FC<EipSectionProps> = ({
  cloudId,
  eips,
  subnets,
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
   */
  const externalSubnets = useMemo(() => {
    const subnetTypeOf = (s: any) =>
      String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] ?? '').trim().toLowerCase();
    return subnets.filter((s: any) => {
      if (subnetTypeOf(s) !== 'public') return false;
      const vpc = String(s.spec?.vpc || s.vpc || '').trim() || KUBE_OVN_PUBLIC_VPC;
      return vpc === KUBE_OVN_PUBLIC_VPC;
    });
  }, [subnets]);

  // 筛选数据
  const filteredData = useMemo(() => {
    return eips.filter((item: any) => {
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
  }, [eips, keyword, statusFilter, typeFilter]);

  // 筛选选项
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    eips.forEach((item: any) => {
      if (item.status?.ready) {
        set.add('ready');
      } else {
        set.add('notready');
      }
    });
    return Array.from(set);
  }, [eips]);

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
      setCreateLoading(true);
      const scope = networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
      const v4 = String(values.v4Ip ?? '').trim();
      const displayName = String(values.displayName ?? '').trim();
      const payload = {
        name: generateHarvesterEntityId('eip'),
        ...(displayName ? { alias: displayName } : {}),
        externalSubnet: values.externalSubnet,
        ...(v4 ? { v4Ip: v4 } : {}),
        type: 'nat',
      };
      await createCloudProviderOvnEip(cloudId, payload, scope);
      message.success('EIP 创建成功');
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
          content: `确定要删除 EIP「${ovnDisplayName(record)}」吗？`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            try {
              await deleteCloudProviderOvnEip(cloudId, record.metadata?.name);
              message.success('删除成功');
              onRefresh(true);
            } catch (e: any) {
              message.error(`删除失败: ${e.message}`);
            }
          },
        });
      }
    },
    [cloudId, hasEipWrite, onRefresh],
  );

  const allColumns = useMemo(
    () => [
    {
      title: '名称',
      key: 'alias',
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
    { 
      title: '所在公共子网', 
      key: 'externalSubnet', 
      render: (_: any, r: any) => r.spec?.externalSubnet 
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
      title: '操作', 
      key: 'action', 
      width: 80, 
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
    [hasEipWrite, handleMenuClick],
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
          label: '创建EIP',
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
          rowKey={r => r.metadata?.uid}
          pagination={{
            size: 'small',
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </PageDetailSection>
      
      <MetadataModal visible={!!metadataRecord} record={metadataRecord} onClose={() => setMetadataRecord(null)} />

      <Modal
        title="创建 EIP"
        open={isCreateVisible}
        centered
        onCancel={() => setIsCreateVisible(false)}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          {externalSubnets.length === 0 && (
            <Alert
              type="warning"
              message="没有可选的公共子网。EIP 需使用注解 tower.io/subnet-type=public、且挂在内置 VPC ovn-cluster 下的子网；请先在「公共子网」入口创建。"
              style={{ marginBottom: 16 }}
            />
          )}
          
          <Form.Item name="displayName" label="名称">
            <Input placeholder="可选" />
          </Form.Item>

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
