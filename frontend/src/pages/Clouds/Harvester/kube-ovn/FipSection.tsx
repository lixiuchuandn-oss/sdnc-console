import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Table, Tag, Modal, Form, Input, Select, message, MenuProps, Button, Tooltip, Space, Alert } from 'antd';
import { SearchOutlined, ShareAltOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnFip, deleteCloudProviderOvnFip } from '../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../services/api';
import MetadataModal from './MetadataModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { generateHarvesterEntityId } from '../../../../utils/harvesterUtils';
import { KUBE_OVN_FLAT_VPC, TOWER_ALIAS_ANNOTATION } from './underlay-subnet/constants';
import { ovnDisplayName, ovnKeywordMatches } from './ovnResourceDisplay';
import {
  buildVmNicIpOptions,
  subnetChoicesForOvnAttach,
  subnetCidrOf,
  vmUsesSubnet,
} from './subnetVmPicker';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean) => void;
  bordered?: boolean;
}

interface FipSectionProps extends BaseSectionProps {
  fips: any[];
  eips: any[];
  vpcs: any[];
  /** Kube-OVN 子网列表（与 EIP/SNAT 同源），用于创建 FIP 时选子网并筛选 VM */
  subnets?: any[];
  networkScope?: 'flat' | 'vpc';
}

function eipNameToResourceMap(eips: any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const e of eips || []) {
    const n = String(e?.metadata?.name ?? '').trim();
    if (n) m.set(n, e);
  }
  return m;
}

/** OvnEip CR 上的公网 IPv4（与 EIP 列表列一致，兼容 status） */
function ovnEipResourceV4(eip: any): string {
  return String(eip?.spec?.v4Ip ?? eip?.status?.v4Ip ?? '').trim();
}

/** FIP 对应的外网地址：优先从关联 OvnEip 解析，其次 FIP status/spec */
function fipExternalV4ForDisplay(fip: any, eipByName: Map<string, any>): string {
  const ref = String(fip?.spec?.ovnEip ?? '').trim();
  if (ref) {
    const hit = eipByName.get(ref);
    const v = hit ? ovnEipResourceV4(hit) : '';
    if (v) return v;
  }
  return String(fip?.status?.v4Eip ?? fip?.spec?.v4Eip ?? '').trim();
}

/** FIP 绑定的内网 IPv4 */
function fipInternalV4ForDisplay(fip: any): string {
  return String(fip?.spec?.v4Ip ?? fip?.status?.v4Ip ?? '').trim();
}

/** EIP 列：优先 OvnEip 的 tower.io/alias，否则 CR 名；返回 id 用于 title 悬停 */
function fipEipAliasOrId(refName: string, eipByName: Map<string, any>): { display: string; id: string } {
  const id = refName;
  if (!refName) return { display: '', id: '' };
  const eip = eipByName.get(refName);
  const alias = String(eip?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
  return { display: alias || refName, id };
}

/** 内部 IP 列：按 ipName(ns.vm.iface) 匹配 VM，优先 tower.io/alias，否则 VM 名，否则整段 ipName；id 恒为完整 ipName 供悬停 */
function fipInternalNicAliasOrId(ipName: string, vmsList: any[]): { display: string; id: string } {
  if (!ipName) return { display: '', id: '' };
  const parts = ipName.split('.');
  if (parts.length >= 3) {
    const ns = String(parts[0] || 'default').trim();
    const vmName = String(parts[1] || '').trim();
    if (vmName) {
      const vm = vmsList.find((v: any) => {
        const n = String(v?.metadata?.name ?? v?.name ?? '').trim();
        const vns = String(v?.metadata?.namespace ?? v?.namespace ?? 'default').trim();
        return n === vmName && vns === ns;
      });
      const vmAlias = String(vm?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
      return { display: vmAlias || vmName, id: ipName };
    }
  }
  return { display: ipName, id: ipName };
}

export const FipSection: React.FC<FipSectionProps> = ({
  cloudId,
  fips,
  eips,
  vpcs,
  subnets = [],
  loading,
  onRefresh,
  bordered = true,
  networkScope,
}) => {
  void vpcs;
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasVpcsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.vpcs:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const hasFipWrite = useMemo(() => {
    if (networkScope === 'flat') {
      return (
        hasPermissionForAction(perms, 'clouds.fips.flat:write') ||
        hasPermissionForAction(perms, 'clouds.subnets.flat:write') ||
        hasPermissionForAction(perms, 'clouds:write')
      );
    }
    if (networkScope === 'vpc') {
      return (
        hasPermissionForAction(perms, 'clouds.fips.vpc:write') ||
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
  const [vmsList, setVmsList] = useState<any[]>([]);
  const [vmsLoading, setVmsLoading] = useState(false);

  const eipByName = useMemo(() => eipNameToResourceMap(eips), [eips]);
  const eipsForCreate = useMemo(() => {
    return (Array.isArray(eips) ? eips : []).filter((e: any) => {
      const t = String(e?.spec?.type ?? e?.type ?? '').trim().toLowerCase();
      return t !== 'lrp';
    });
  }, [eips]);

  const subnetChoicesForFip = useMemo(
    () => {
      const base = subnetChoicesForOvnAttach(subnets, networkScope);
      if (networkScope === 'flat') {
        return base.filter((s: any) => !String(s?.spec?.vlan || '').trim());
      }
      return base;
    },
    [subnets, networkScope],
  );

  const subnetNameWatch = Form.useWatch('subnetName', form);

  const selectedSubnet = useMemo(() => {
    if (!subnetNameWatch) return null;
    return (
      subnetChoicesForFip.find(
        (s: any) => String(s?.metadata?.name || s?.name || '') === String(subnetNameWatch),
      ) || null
    );
  }, [subnetChoicesForFip, subnetNameWatch]);

  const vmsOnSubnet = useMemo(() => {
    if (!selectedSubnet) return [];
    return vmsList.filter((vm) => vmUsesSubnet(vm, selectedSubnet));
  }, [vmsList, selectedSubnet]);

  useEffect(() => {
    if (!cloudId) return;
    let cancelled = false;
    setVmsLoading(true);
    fetchCloudProviderEcs(cloudId, true)
      .then((json: any) => {
        if (cancelled) return;
        const list = Array.isArray(json?.data) ? json.data : [];
        setVmsList(list);
      })
      .catch(() => {
        if (!cancelled) setVmsList([]);
      })
      .finally(() => {
        if (!cancelled) setVmsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cloudId]);
  
  // 筛选条件
  const [keyword, setKeyword] = useState<string>('');
  const [vpcFilter, setVpcFilter] = useState<string>('');
  const [ipTypeFilter, setIpTypeFilter] = useState<string>('');

  // 筛选数据
  const filteredData = useMemo(() => {
    return fips.filter((item: any) => {
      const eip = item.spec?.ovnEip || '';
      const ipName = item.spec?.ipName || '';
      const vpc = item.spec?.vpc || '';
      const ipType = item.spec?.ipType || '';
      const extV4 = fipExternalV4ForDisplay(item, eipByName);
      const intV4 = fipInternalV4ForDisplay(item);
      const { display: eipAliasOrName } = fipEipAliasOrId(eip, eipByName);
      const { display: nicAliasOrName } = fipInternalNicAliasOrId(ipName, vmsList);
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (
          !ovnKeywordMatches(item, kw) &&
          !eip.toLowerCase().includes(kw) &&
          !ipName.toLowerCase().includes(kw) &&
          !extV4.toLowerCase().includes(kw) &&
          !intV4.toLowerCase().includes(kw) &&
          !(eipAliasOrName && eipAliasOrName.toLowerCase().includes(kw)) &&
          !(nicAliasOrName && nicAliasOrName.toLowerCase().includes(kw))
        ) {
          return false;
        }
      }
      
      // VPC筛选
      if (vpcFilter && vpc !== vpcFilter) {
        return false;
      }
      
      // IP类型筛选
      if (ipTypeFilter && ipType !== ipTypeFilter) {
        return false;
      }
      
      return true;
    });
  }, [fips, keyword, vpcFilter, ipTypeFilter, eipByName, vmsList]);

  // 筛选选项
  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    fips.forEach((item: any) => {
      const vpc = item.spec?.vpc;
      if (vpc) set.add(vpc);
    });
    return Array.from(set);
  }, [fips]);

  const ipTypeOptions = useMemo(() => {
    const set = new Set<string>();
    fips.forEach((item: any) => {
      const ipType = item.spec?.ipType;
      if (ipType) set.add(ipType);
    });
    return Array.from(set);
  }, [fips]);

  const handleCreate = async () => {
    if (!hasFipWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      const scope = networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
      const displayName = String(values.displayName ?? '').trim();
      const subnetName = String(values.subnetName || '').trim();
      const subnet = subnetChoicesForFip.find(
        (s: any) => String(s?.metadata?.name || s?.name || '') === subnetName,
      );
      const vpc = String(subnet?.spec?.vpc || subnet?.vpc || '').trim() || KUBE_OVN_FLAT_VPC;
      let nic: { ipName: string; v4Ip?: string } | null = null;
      try {
        const raw = String(values.nicAttach || '');
        if (raw) nic = JSON.parse(raw) as { ipName: string; v4Ip?: string };
      } catch {}
      if (!nic) {
        const vmKey = String(values.vmKey || '');
        const vm = vmsOnSubnet.find(
          (x: any) =>
            `${String(x.namespace || x.metadata?.namespace || 'default')}/${String(x.name || x.metadata?.name || '')}` ===
            vmKey,
        );
        const opts = vm ? buildVmNicIpOptions(vm) : [];
        if (opts.length > 0) {
          try {
            nic = JSON.parse(String(opts[0]?.value || '')) as { ipName: string; v4Ip?: string };
          } catch {}
        }
      }
      if (!nic?.v4Ip) {
        message.error('未解析到网卡 IPv4，无法创建 FIP');
        return;
      }
      const payload: Record<string, unknown> = {
        name: generateHarvesterEntityId('fip'),
        ovnEip: values.ovnEip,
        vpc,
        ipType: 'eip',
      };
      if (displayName) payload.alias = displayName;
      payload.v4Ip = nic.v4Ip;
      setCreateLoading(true);
      await createCloudProviderOvnFip(cloudId, payload, scope);
      message.success('FIP 创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      onRefresh(true);
    } catch (e: any) {
      if (e?.errorFields) return;
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
        if (!hasFipWrite) {
          message.error('无权限执行该操作');
          return;
        }
        Modal.confirm({
          title: '确认删除',
          content: `确定要删除 FIP「${ovnDisplayName(record)}」吗？`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            try {
              await deleteCloudProviderOvnFip(cloudId, record.metadata?.name);
              message.success('删除成功');
              onRefresh(true);
            } catch (e: any) {
              message.error(`删除失败: ${e.message}`);
            }
          },
        });
      }
    },
    [cloudId, hasFipWrite, onRefresh],
  );

  const allColumns = useMemo(
    () => [
    {
      title: '名称',
      key: 'alias',
      render: (_: any, r: any) => {
        const alias = String(r?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
        const text = alias || '—';
        return (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
            <ShareAltOutlined style={{ color: '#1677ff', fontSize: 16, flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={text}>
              {text}
            </span>
          </span>
        );
      },
    },
    {
      title: 'ID',
      key: 'id',
      render: (_: any, r: any) => {
        const id = String(r?.metadata?.name ?? '').trim() || '—';
        return (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }} title={id}>
            {id}
          </span>
        );
      },
    },
    {
      title: 'EIP',
      key: 'eip',
      render: (_: any, r: any) => {
        const refName = String(r.spec?.ovnEip ?? '').trim();
        const v4 = fipExternalV4ForDisplay(r, eipByName);
        const { display: eipLine2, id: eipId } = fipEipAliasOrId(refName, eipByName);
        const showEipSub = eipLine2 && eipLine2 !== v4;
        if (v4) {
          return (
            <span style={{ display: 'block', maxWidth: '100%' }}>
              <Tag color="blue">{v4}</Tag>
              {showEipSub ? (
                <span
                  className="std-time"
                  style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#8c8c8c' }}
                  title={eipId !== eipLine2 ? eipId : undefined}
                >
                  {eipLine2}
                </span>
              ) : null}
            </span>
          );
        }
        return eipLine2 ? (
          <span title={eipId !== eipLine2 ? eipId : undefined}>{eipLine2}</span>
        ) : (
          '—'
        );
      },
    },
    {
      title: '内部IP',
      key: 'ip',
      render: (_: any, r: any) => {
        const v4 = fipInternalV4ForDisplay(r);
        const ipName = String(r.spec?.ipName ?? '').trim();
        const { display: nicLine2, id: nicId } = fipInternalNicAliasOrId(ipName, vmsList);
        const showNicSub = nicLine2 && nicLine2 !== v4;
        if (v4) {
          return (
            <span style={{ display: 'block', maxWidth: '100%' }}>
              <Tag color="geekblue">{v4}</Tag>
              {showNicSub ? (
                <span
                  className="std-time"
                  style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#8c8c8c' }}
                  title={nicId !== nicLine2 ? nicId : undefined}
                >
                  {nicLine2}
                </span>
              ) : null}
            </span>
          );
        }
        return nicLine2 ? (
          <Tag title={nicId !== nicLine2 ? nicId : undefined}>{nicLine2}</Tag>
        ) : (
          '—'
        );
      },
    },
    { 
      title: '类型', 
      key: 'type', 
      render: (_: any, r: any) => r.spec?.ipType || '-' 
    },
    { 
      title: 'VPC', 
      key: 'vpc', 
      render: (_: any, r: any) => r.spec?.vpc || '-' 
    },
    {
      title: '操作', 
      key: 'action', 
      width: 80, 
      render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          { key: 'metadata', label: '查看元数据' },
          { type: 'divider' },
          { key: 'delete', label: '删除', danger: true, disabled: !hasFipWrite }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)}
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasFipWrite }}
          />
        );
      }
    },
    ],
    [hasFipWrite, handleMenuClick, eipByName, vmsList],
  );

  const fipTableSettingsKey = `harvester_ovn_fip_${networkScope ?? 'legacy'}`;
  const { displayColumns: columns } = useTableColumnSettings(allColumns, fipTableSettingsKey);

  return (
    <>
      <PageDetailSection
        asCard={false}
        toolbarLeft={(
          <>
            <Input 
              allowClear 
              placeholder="名称/ID" 
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              value={keyword} 
              onChange={(e) => setKeyword(e.target.value)} 
              className="toolbar-search"
            />
            <Select 
              allowClear 
              placeholder="VPC" 
              value={vpcFilter || undefined} 
              onChange={(v) => setVpcFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...vpcOptions.map(v => ({ value: v, label: v }))
              ]} 
            />
            <Select 
              allowClear 
              placeholder="IP类型" 
              value={ipTypeFilter || undefined} 
              onChange={(v) => setIpTypeFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...ipTypeOptions.map(t => ({ value: t, label: t }))
              ]} 
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setVpcFilter('');
                setIpTypeFilter('');
              }}
            >
              重置
            </button>
          </>
        )}
        primaryAction={{
          label: '创建FIP',
          onClick: () => {
            if (!hasFipWrite) return;
            form.resetFields();
            setIsCreateVisible(true);
          },
          disabled: !hasFipWrite
        }}
        toolbarRight={
          <Space size={8}>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey={fipTableSettingsKey} />
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
        title="创建 FIP"
        open={isCreateVisible}
        centered
        destroyOnClose
        onCancel={() => {
          setIsCreateVisible(false);
          form.resetFields();
        }}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
        width={520}
      >
        <Form form={form} layout="vertical">
          {subnetChoicesForFip.length === 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="缺少可选子网"
              description="请先在当前云同步子网列表，或确认本页已加载 Kube-OVN 子网；扁平 FIP 需 flat 子网，VPC FIP 需业务 VPC 下的 vpc 子网。"
            />
          )}
          <Form.Item name="displayName" label="名称">
            <Input placeholder="可选，支持中文；留空则列表仅显示自动生成的资源名" />
          </Form.Item>
          <Form.Item name="ovnEip" label="EIP" rules={[{ required: true, message: '请选择 EIP' }]}>
            <Select placeholder="请选择 EIP" allowClear>
              {eipsForCreate.map((e) => (
                <Select.Option key={e.metadata?.name} value={e.metadata?.name}>
                  {ovnDisplayName(e)} ({e.spec?.v4Ip})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="subnetName"
            label="子网"
            rules={[{ required: true, message: '请选择子网' }]}
          >
            <Select
              placeholder="请选择子网"
              allowClear
              showSearch
              filterOption={(input, option) => {
                const v = String((option as { value?: string })?.value ?? '');
                const s = subnetChoicesForFip.find(
                  (x: any) => String(x?.metadata?.name || x?.name || '') === v,
                );
                if (!s) return v.toLowerCase().includes(input.toLowerCase());
                const aliasT = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                const nm = String(s?.metadata?.name || s?.name || '');
                const blob = [aliasT, nm, subnetCidrOf(s), s?.spec?.vpc || s?.vpc || '']
                  .join(' ')
                  .toLowerCase();
                return blob.includes(input.toLowerCase());
              }}
              onChange={() => {
                form.setFieldsValue({ vmKey: undefined, nicAttach: undefined });
              }}
            >
              {subnetChoicesForFip.map((s: any) => {
                const name = String(s?.metadata?.name || s?.name || '');
                const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                const cidr = subnetCidrOf(s);
                const primary = alias || name;
                const secondary = alias ? name : '';
                const searchBlob = [primary, secondary, name, cidr, s?.spec?.vpc || s?.vpc || ''].filter(Boolean).join(' ');
                return (
                  <Select.Option key={name} value={name} title={searchBlob}>
                    <span title={cidr ? `${primary} ${cidr}` : `${primary}`}>
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
            noStyle
            shouldUpdate={(prev, cur) => prev.subnetName !== cur.subnetName}
          >
            {() => {
              const sn = form.getFieldValue('subnetName');
              if (!sn) {
                return (
                  <Form.Item label="虚拟机">
                    <Select placeholder="请先选择子网" disabled />
                  </Form.Item>
                );
              }
              return (
                <Form.Item
                  name="vmKey"
                  label="虚拟机"
                  rules={[{ required: true, message: '请选择虚拟机' }]}
                >
                  <Select
                    placeholder={vmsLoading ? '加载虚拟机…' : '请选择挂接该子网的虚拟机'}
                    loading={vmsLoading}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    onChange={() => form.setFieldsValue({ nicAttach: undefined })}
                    notFoundContent={vmsLoading ? '加载中…' : '该子网下暂无虚拟机或网卡未挂此子网'}
                  >
                    {vmsOnSubnet.map((vm: any) => {
                      const ns = String(vm.namespace || vm.metadata?.namespace || 'default');
                      const n = String(vm.name || vm.metadata?.name || '');
                      const key = `${ns}/${n}`;
                      const label = `${ovnDisplayName(vm)} (${key})`;
                      return (
                        <Select.Option key={key} value={key} label={label}>
                          {label}
                        </Select.Option>
                      );
                    })}
                  </Select>
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.vmKey !== cur.vmKey || prev.subnetName !== cur.subnetName}
          >
            {() => {
              const vmKey = form.getFieldValue('vmKey');
              const vm = vmsOnSubnet.find(
                (x: any) =>
                  `${String(x.namespace || x.metadata?.namespace || 'default')}/${String(x.name || x.metadata?.name || '')}` ===
                  String(vmKey || ''),
              );
              const opts = vm ? buildVmNicIpOptions(vm) : [];
              if (!vmKey) return null;
              if (!opts.length) {
                return (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="未解析到网卡 IP"
                      description="请确认虚拟机已运行且 VMI 已分配 IP；仍无法显示时可联系管理员核对 Kube-OVN IP 资源命名。"
                    />
                    <Form.Item
                      name="nicAttach"
                      rules={[
                        {
                          validator: () =>
                            Promise.reject(new Error('当前虚拟机无可用网卡 IP，无法创建 FIP')),
                        },
                      ]}
                      hidden
                    >
                      <Input type="hidden" />
                    </Form.Item>
                  </>
                );
              }
              const current = form.getFieldValue('nicAttach');
              if (!current && opts.length) {
                form.setFieldsValue({ nicAttach: opts[0].value });
              }
              return null;
            }}
          </Form.Item>
          <Form.Item name="nicAttach" hidden>
            <Input type="hidden" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default FipSection;
