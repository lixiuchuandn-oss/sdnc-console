import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Table, Space, Modal, Form, Input, Select, message, MenuProps, Button, Tooltip, Alert, Row, Col } from 'antd';
import { InteractionTwoTone, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnDnatRule, deleteCloudProviderOvnDnatRule } from '../../../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import MetadataModal from '../modals/MetadataModal';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { generateHarvesterCrMetadataName } from '../../../../../../utils/harvesterUtils';
import {
  KUBE_OVN_FLAT_VPC,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  isBuiltInKubeOvnVpc,
  isFlatKubeOvnSubnetForFlatNatSelector,
} from '../lib/kubeOvnSubnetConstants';
import {
  buildBusinessVpcPickerRows,
  kubeSubnetChoiceLabel,
  vpcDisplayMapFromVpcs,
} from '../lib/kubeOvnUiHelpers';
import { ovnDisplayName, ovnKeywordMatches } from '../lib/ovnResourceDisplay';
import {
  buildPublicSubnetNameToVpcNameMap,
  getOvnEipBoundVpcName,
} from '../lib/kubeOvnEipVpcHelpers';
import {
  buildVmNicIpOptions,
  subnetCidrOf,
  vmUsesSubnet,
} from '../lib/subnetVmPicker';

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean, silent?: boolean) => void;
  bordered?: boolean;
}

interface DnatSectionProps extends BaseSectionProps {
  dnatRules: any[];
  eips: any[];
  vpcs: any[];
  /** 与 FIP/SNAT 同源；用于子网 → 虚拟机 → 网卡选择内部 IP */
  subnets?: any[];
  networkScope?: 'flat' | 'vpc';
}

export const DnatSection: React.FC<DnatSectionProps> = ({
  cloudId,
  dnatRules,
  eips,
  vpcs,
  subnets = [],
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
  const hasNatWrite = useMemo(() => {
    if (networkScope === 'flat') {
      return (
        hasPermissionForAction(perms, 'clouds.dnat.flat:write') ||
        hasPermissionForAction(perms, 'clouds.subnets.flat:write') ||
        hasPermissionForAction(perms, 'clouds:write')
      );
    }
    if (networkScope === 'vpc') {
      return (
        hasPermissionForAction(perms, 'clouds.dnat.vpc:write') ||
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

  const eipsForCreate = useMemo(() => {
    return (Array.isArray(eips) ? eips : []).filter((e: any) => {
      const t = String(e?.spec?.type ?? e?.type ?? '').trim().toLowerCase();
      return t !== 'lrp';
    });
  }, [eips]);

  const eipIpv4ByName = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(eips) ? eips : []).forEach((e: any) => {
      const name = String(e?.metadata?.name || e?.name || '').trim();
      if (!name) return;
      const ip = String(e?.spec?.v4Ip || e?.status?.v4Ip || '').trim();
      if (ip) map.set(name, ip);
    });
    return map;
  }, [eips]);

  const subnetChoicesForDnat = useMemo(() => {
    if (!networkScope) return subnets;
    return subnets.filter((s: any) => {
      if (networkScope === 'flat') {
        return isFlatKubeOvnSubnetForFlatNatSelector(s);
      }
      const vpc = String(s?.spec?.vpc || s?.vpc || '').trim();
      return vpc && !isBuiltInKubeOvnVpc(vpc);
    });
  }, [subnets, networkScope]);

  const vpcNameWatch = Form.useWatch('vpcName', form);
  const publicSubnetToVpcForEip = useMemo(() => buildPublicSubnetNameToVpcNameMap(vpcs), [vpcs]);

  const eipsForCreateByVpcSelection = useMemo(() => {
    if (networkScope !== 'vpc') return eipsForCreate;
    const vpcId = String(vpcNameWatch ?? '').trim();
    if (!vpcId) return [];
    return eipsForCreate.filter(
      (e: any) => getOvnEipBoundVpcName(e, publicSubnetToVpcForEip) === vpcId,
    );
  }, [eipsForCreate, networkScope, vpcNameWatch, publicSubnetToVpcForEip]);

  const subnetChoicesForDnatByVpc = useMemo(() => {
    if (networkScope !== 'vpc') return subnetChoicesForDnat;
    const vpc = String(vpcNameWatch ?? '').trim();
    if (!vpc) return [];
    return subnetChoicesForDnat.filter(
      (s: any) => String(s?.spec?.vpc || s?.vpc || '').trim() === vpc,
    );
  }, [subnetChoicesForDnat, networkScope, vpcNameWatch]);

  const subnetNameWatch = Form.useWatch('subnetName', form);

  const selectedSubnet = useMemo(() => {
    if (!subnetNameWatch) return null;
    const list = networkScope === 'vpc' ? subnetChoicesForDnatByVpc : subnetChoicesForDnat;
    return (
      list.find((s: any) => String(s?.metadata?.name || s?.name || '') === String(subnetNameWatch)) || null
    );
  }, [subnetChoicesForDnat, subnetChoicesForDnatByVpc, networkScope, subnetNameWatch]);

  const vpcChoicesForDnat = useMemo(() => {
    const rows = buildBusinessVpcPickerRows(vpcs);
    if (rows.length > 0 || networkScope !== 'vpc') return rows;
    const ids = new Set<string>();
    for (const s of subnetChoicesForDnat) {
      const vn = String(s?.spec?.vpc || s?.vpc || '').trim();
      if (vn && !isBuiltInKubeOvnVpc(vn)) ids.add(vn);
    }
    return Array.from(ids).map((id) => ({
      id,
      display: id,
      namespacesDisplay: '-',
      searchLabel: id,
    }));
  }, [vpcs, networkScope, subnetChoicesForDnat]);

  const vpcDisplayById = useMemo(() => vpcDisplayMapFromVpcs(vpcs), [vpcs]);

  const renderDnatSubnetSelect = () => {
    const list =
      networkScope === 'vpc'
        ? subnetChoicesForDnatByVpc
        : subnetChoicesForDnat;
    const disabled = networkScope === 'vpc' && !String(vpcNameWatch || '').trim();
    return (
      <Form.Item
        name="subnetName"
        label="子网"
        rules={[{ required: true, message: '请选择子网' }]}
      >
        <Select
          placeholder={
            networkScope === 'vpc'
              ? !String(vpcNameWatch || '').trim()
                ? '请先选择 VPC'
                : '请选择子网'
              : '请选择子网（扁平 / VPC）'
          }
          allowClear
          showSearch
          disabled={disabled}
          filterOption={(input, option) => {
            const v = String((option as { value?: string })?.value ?? '');
            const s = list.find((x: any) => String(x?.metadata?.name || x?.name || '') === v);
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
          {list.map((s: any) => {
            const name = String(s?.metadata?.name || s?.name || '');
            const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
            const cidr = subnetCidrOf(s);
            if (networkScope === 'flat') {
              const primary = alias || name;
              const searchBlob = [primary, name, cidr].filter(Boolean).join(' ');
              return (
                <Select.Option key={name} value={name} title={searchBlob}>
                  <span title={cidr ? `${primary} ${cidr}` : primary}>
                    {primary}
                    {cidr ? <span style={{ color: '#8c8c8c' }}> {cidr}</span> : null}
                  </span>
                </Select.Option>
              );
            }
            const searchBlob = [kubeSubnetChoiceLabel(s), name, cidr].filter(Boolean).join(' ');
            return (
              <Select.Option key={name} value={name} title={searchBlob}>
                <span title={cidr ? `${kubeSubnetChoiceLabel(s)} ${cidr}` : kubeSubnetChoiceLabel(s)}>
                  {kubeSubnetChoiceLabel(s)}
                  {cidr ? <span style={{ color: '#8c8c8c' }}> {cidr}</span> : null}
                </span>
              </Select.Option>
            );
          })}
        </Select>
      </Form.Item>
    );
  };

  const vmsOnSubnet = useMemo(() => {
    if (!selectedSubnet) return [];
    return vmsList.filter((vm) => {
      // 过滤回收站虚拟机：与 `VmSection.tsx` 一致
      const finalizers = (vm?.metadata?.finalizers || vm?.finalizers || []) as any[];
      const labels = (vm?.metadata?.labels || vm?.labels || {}) as Record<string, any>;
      if (Array.isArray(finalizers) && finalizers.includes('tower.io/recycle-bin')) return false;
      if (String(labels?.['tower.io/recycle-bin'] ?? '').toLowerCase() === 'true') return false;
      return vmUsesSubnet(vm, selectedSubnet);
    });
  }, [vmsList, selectedSubnet]);

  useEffect(() => {
    if (!isCreateVisible || !cloudId) return;
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
  }, [isCreateVisible, cloudId]);

  // 筛选条件
  const [keyword, setKeyword] = useState<string>('');
  const [vpcFilter, setVpcFilter] = useState<string>('');
  const [protocolFilter, setProtocolFilter] = useState<string>('');

  // 筛选数据
  const filteredData = useMemo(() => {
    return dnatRules.filter((item: any) => {
      const eipName = String(item?.spec?.ovnEip || item?.status?.ovnEip || '').trim();
      const eip =
        String(
          item?.status?.v4Eip ||
            item?.metadata?.labels?.['ovn.kubernetes.io/eip_v4_ip'] ||
            eipIpv4ByName.get(eipName) ||
            eipName,
        ).trim();
      const internalIp = String(item?.spec?.v4Ip || item?.status?.v4Ip || item?.spec?.internalIp || '').trim();
      const vpc = item.spec?.vpc || '';
      const protocol = item.spec?.protocol || '';
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (
          !ovnKeywordMatches(item, kw) &&
          !eip.toLowerCase().includes(kw) &&
          !internalIp.toLowerCase().includes(kw)
        ) {
          return false;
        }
      }
      
      if (vpcFilter && networkScope !== 'flat' && vpc !== vpcFilter) {
        return false;
      }
      
      // 协议筛选
      if (protocolFilter && protocol !== protocolFilter) {
        return false;
      }
      
      return true;
    });
  }, [dnatRules, keyword, vpcFilter, protocolFilter, eipIpv4ByName, networkScope]);

  // 筛选选项
  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    dnatRules.forEach((item: any) => {
      const vpc = item.spec?.vpc;
      if (vpc) set.add(vpc);
    });
    return Array.from(set);
  }, [dnatRules]);

  const protocolOptions = useMemo(() => {
    const set = new Set<string>();
    dnatRules.forEach((item: any) => {
      const protocol = item.spec?.protocol;
      if (protocol) set.add(protocol);
    });
    return Array.from(set);
  }, [dnatRules]);

  const handleCreate = async () => {
    if (!hasNatWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      if (networkScope === 'vpc') {
        const vpcSel = String(values.vpcName ?? '').trim();
        if (vpcSel) {
          const avail = eipsForCreate.filter(
            (e: any) => getOvnEipBoundVpcName(e, publicSubnetToVpcForEip) === vpcSel,
          );
          if (avail.length === 0) {
            message.error(
              '当前所选 VPC 下没有可用的弹性公网 IP（EIP）。请先到「VPC 网络 → 弹性公网 IP」中为该 VPC 创建 EIP，再创建 DNAT。',
            );
            return;
          }
          const picked = String(values.ovnEip ?? '').trim();
          if (
            picked &&
            !avail.some((e: any) => String(e?.metadata?.name || e?.name || '').trim() === picked)
          ) {
            message.error('所选公网 IP 不属于当前 VPC，请重新选择');
            return;
          }
        }
      }
      const eipName = String(values.ovnEip ?? '').trim();
      const proto = String(values.protocol || 'tcp').trim().toLowerCase();
      const extPort = String(values.externalPort ?? '').trim();
      const dupTriple = (Array.isArray(dnatRules) ? dnatRules : []).some((r: any) => {
        const re = String(r?.spec?.ovnEip ?? r?.status?.ovnEip ?? '').trim();
        const rp = String(r?.spec?.protocol ?? r?.status?.protocol ?? '')
          .trim()
          .toLowerCase();
        const rex = String(r?.spec?.externalPort ?? r?.status?.externalPort ?? '').trim();
        return re === eipName && rp === proto && rex === extPort;
      });
      if (dupTriple) {
        message.error(
          '已存在公网 IP、协议、公网端口相同的 DNAT 规则；同一组条件下仅允许一条内部端口映射，请修改规则。',
        );
        return;
      }
      const scope = networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
      const displayName = String(values.displayName ?? '').trim();
      const subnetName = String(values.subnetName || '').trim();
      const subnetList = networkScope === 'vpc' ? subnetChoicesForDnatByVpc : subnetChoicesForDnat;
      const subnet = subnetList.find(
        (s: any) => String(s?.metadata?.name || s?.name || '') === subnetName,
      );
      const selectedVpc = String(values.vpcName ?? '').trim();
      const subnetVpc = String(subnet?.spec?.vpc || subnet?.vpc || '').trim();
      if (networkScope === 'vpc' && selectedVpc && subnetVpc && selectedVpc !== subnetVpc) {
        message.error('所选子网不属于当前 VPC，请重新选择');
        return;
      }
      const vpc =
        networkScope === 'vpc'
          ? selectedVpc || subnetVpc || KUBE_OVN_FLAT_VPC
          : String(subnet?.spec?.vpc || subnet?.vpc || '').trim() || KUBE_OVN_FLAT_VPC;
      let nic: { v4Ip?: string } | null = null;
      try {
        const raw = String(values.nicAttach || '');
        if (raw) nic = JSON.parse(raw) as { v4Ip?: string };
      } catch {}
      if (!nic) {
        try {
          const vmKey = String(values.vmKey || '');
          const vm = vmsOnSubnet.find(
            (x: any) =>
              `${String(x.namespace || x.metadata?.namespace || 'default')}/${String(x.name || x.metadata?.name || '')}` ===
              vmKey,
          );
          const opts = vm ? buildVmNicIpOptions(vm, subnet) : [];
          if (opts.length > 0) {
            nic = JSON.parse(String(opts[0]?.value || '')) as { v4Ip?: string };
          }
        } catch {}
      }
      const internalIp = String(nic?.v4Ip || '').trim();
      if (!internalIp) {
        message.error('未解析到网卡 IPv4，无法创建 DNAT');
        return;
      }
      const payload: Record<string, unknown> = {
        name: generateHarvesterCrMetadataName('kubeOvnDnat'),
        ovnEip: values.ovnEip,
        protocol: values.protocol || 'tcp',
        externalPort: values.externalPort,
        internalPort: values.internalPort,
        v4Ip: internalIp,
        internalIp,
        vpc,
      };
      if (displayName) payload.alias = displayName;
      setCreateLoading(true);
      await createCloudProviderOvnDnatRule(cloudId, payload, scope);
      message.success('DNAT 规则创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      onRefresh(true, true);
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
        if (!hasNatWrite) {
          message.error('无权限执行该操作');
          return;
        }
        Modal.confirm({
          title: '确认删除',
          content: `确定要删除 DNAT 规则「${ovnDisplayName(record)}」吗？`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            try {
              const apiScope =
                networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
              await deleteCloudProviderOvnDnatRule(cloudId, record.metadata?.name, apiScope);
              message.success('删除成功');
              onRefresh(true);
            } catch (e: any) {
              message.error(`删除失败: ${e.message}`);
            }
          },
        });
      }
    },
    [cloudId, hasNatWrite, networkScope, onRefresh],
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
            <InteractionTwoTone/>
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
      title: '公网IP', 
      key: 'eip', 
      render: (_: any, r: any) => {
        const eipName = String(r?.spec?.ovnEip || r?.status?.ovnEip || '').trim();
        return (
          String(
            r?.status?.v4Eip ||
              r?.metadata?.labels?.['ovn.kubernetes.io/eip_v4_ip'] ||
              eipIpv4ByName.get(eipName) ||
              eipName,
          ).trim() || '-'
        );
      }
    },
    { 
      title: '公网端口', 
      key: 'externalPort', 
      render: (_: any, r: any) => String(r?.spec?.externalPort || r?.status?.externalPort || '').trim() || '-' 
    },
    { 
      title: '协议', 
      key: 'protocol', 
      render: (_: any, r: any) => String(r?.spec?.protocol || r?.status?.protocol || '-').toUpperCase() 
    },
    { 
      title: '内部IP', 
      key: 'ip', 
      render: (_: any, r: any) => String(r?.spec?.v4Ip || r?.status?.v4Ip || r?.spec?.internalIp || '').trim() || '-' 
    },
    { 
      title: '内部端口', 
      key: 'internalPort', 
      render: (_: any, r: any) => String(r?.spec?.internalPort || r?.status?.internalPort || '').trim() || '-' 
    },
    ...(networkScope === 'flat'
      ? []
      : [
          { 
            title: 'VPC', 
            key: 'vpc', 
            render: (_: any, r: any) => {
              const id = String(r?.spec?.vpc || r?.status?.vpc || '').trim();
              return (id && vpcDisplayById.get(id)) || id || '-';
            },
          },
        ]),
    {
      title: '操作', 
      key: 'action', 
      width: 80, 
      render: (_: any, r: any) => {
        const menuItems: MenuProps['items'] = [
          { key: 'metadata', label: '查看元数据' },
          { type: 'divider' },
          { key: 'delete', label: '删除', danger: true, disabled: !hasNatWrite }
        ];
        return (
          <ResourceActionsDropdown 
            items={menuItems} 
            onClick={({ key }) => handleMenuClick(key, r)}
            buttonProps={{ className: 'row-actions-trigger', disabled: !hasNatWrite }}
          />
        );
      }
    },
    ],
    [hasNatWrite, handleMenuClick, eipIpv4ByName, networkScope, vpcDisplayById],
  );

  const dnatTableSettingsKey = `harvester_ovn_dnat_${networkScope ?? 'legacy'}`;
  const { displayColumns: columns } = useTableColumnSettings(allColumns, dnatTableSettingsKey);

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
            {networkScope !== 'flat' ? (
              <Select
                allowClear
                placeholder="VPC"
                value={vpcFilter || undefined}
                onChange={(v) => setVpcFilter(v || '')}
                className="toolbar-filter-sm"
                options={[
                  { value: '', label: '全部' },
                  ...vpcOptions.map((v) => ({ value: v, label: vpcDisplayById.get(v) || v })),
                ]}
              />
            ) : null}
            <Select 
              allowClear 
              placeholder="协议" 
              value={protocolFilter || undefined} 
              onChange={(v) => setProtocolFilter(v || '')} 
              className="toolbar-filter-sm"
              options={[
                { value: '', label: '全部' },
                ...protocolOptions.map(p => ({ value: p, label: p.toUpperCase() }))
              ]} 
            />
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setVpcFilter('');
                setProtocolFilter('');
              }}
            >
              重置
            </button>
          </>
        )}
        primaryAction={{
          label: '创建DNAT规则',
          onClick: () => {
            if (!hasNatWrite) return;
            form.resetFields();
            form.setFieldsValue({ protocol: 'tcp', ...(networkScope === 'vpc' ? { vpcName: undefined } : {}) });
            setIsCreateVisible(true);
          },
          disabled: !hasNatWrite
        }}
        toolbarRight={
          <Space size={8}>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey={dnatTableSettingsKey} />
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
        title="创建 DNAT 规则"
        open={isCreateVisible}
        centered
        destroyOnClose
        width={networkScope === 'vpc' ? 640 : 520}
        onCancel={() => {
          setIsCreateVisible(false);
          form.resetFields();
        }}
        onOk={handleCreate}
        confirmLoading={createLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="displayName"
            label="名称"
            rules={[
              {
                validator: async (_, value) => {
                  const s = String(value ?? '').trim();
                  if (!s) return Promise.resolve();
                  const dup = (Array.isArray(dnatRules) ? dnatRules : []).some((r: any) => {
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
            <Input placeholder="可选，支持中文；留空则列表仅显示自动生成的资源名" />
          </Form.Item>
          {networkScope === 'vpc' && (
            <Row gutter={12}>
              <Col span={24}>
                <Form.Item name="vpcName" label="VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
                  <Select
                    showSearch
                    placeholder="请选择 VPC"
                    allowClear
                    optionFilterProp="data-search"
                    optionLabelProp="label"
                    onChange={() => {
                      form.setFieldsValue({
                        ovnEip: undefined,
                        subnetName: undefined,
                        vmKey: undefined,
                        nicAttach: undefined,
                      });
                    }}
                  >
                    {vpcChoicesForDnat.map((v) => (
                      <Select.Option key={v.id} value={v.id} label={v.display} data-search={v.searchLabel}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{v.display}</span>
                          <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>{`命名空间: ${v.namespacesDisplay}`}</span>
                        </div>
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            </Row>
          )}
          {networkScope === 'vpc' &&
            String(vpcNameWatch ?? '').trim() &&
            eipsForCreateByVpcSelection.length === 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="当前 VPC 下暂无可用 EIP"
                description='请先到「VPC 网络 → 弹性公网 IP」中为该 VPC 创建弹性公网 IP，再创建 DNAT。'
              />
            )}
          <Row gutter={12}>
            <Col span={9}>
              <Form.Item name="ovnEip" label="公网IP" rules={[{ required: true, message: '请选择公网IP' }]}>
                <Select
                  placeholder={
                    networkScope !== 'vpc'
                      ? '请选择公网IP'
                      : !String(vpcNameWatch || '').trim()
                        ? '请先选择 VPC'
                        : eipsForCreateByVpcSelection.length > 0
                          ? '请选择公网IP'
                          : '当前 VPC 下暂无 EIP，请先创建'
                  }
                  allowClear
                  optionLabelProp="label"
                  disabled={networkScope === 'vpc' && !String(vpcNameWatch || '').trim()}
                >
                  {(networkScope === 'vpc' ? eipsForCreateByVpcSelection : eipsForCreate).map((e) => {
                    const nm = String(e?.metadata?.name ?? '').trim();
                    const alias = String(e?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                    const v4 = String(
                      e?.status?.v4Eip ??
                        e?.spec?.v4Ip ??
                        e?.status?.v4Ip ??
                        e?.metadata?.labels?.['ovn.kubernetes.io/eip_v4_ip'] ??
                        '',
                    ).trim();
                    const extSub = String(e?.spec?.externalSubnet ?? '').trim();
                    const label = `${ovnDisplayName(e)}${v4 ? ` (${v4})` : ''}`;
                    const tip = [
                      alias && `展示名: ${alias}`,
                      nm && `资源名: ${nm}`,
                      v4 && `公网 IPv4: ${v4}`,
                      extSub && `公共子网: ${extSub}`,
                    ]
                      .filter(Boolean)
                      .join('\n');
                    return (
                      <Select.Option key={nm || alias} value={nm} label={label} title={tip}>
                        <span title={tip}>{label}</span>
                      </Select.Option>
                    );
                  })}
                </Select>
              </Form.Item>
            </Col>
            <Col span={9}>
              <Form.Item name="protocol" label="协议" initialValue="tcp">
                <Select>
                  <Select.Option value="tcp">TCP</Select.Option>
                  <Select.Option value="udp">UDP</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="externalPort" label="公网端口" rules={[{ required: true, message: '请输入公网端口' }]}>
                <Input placeholder="例如: 80" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={24}>{renderDnatSubnetSelect()}</Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
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
                          const nicOpts = buildVmNicIpOptions(vm, selectedSubnet);
                          const ips = nicOpts
                            .map((opt: any) => {
                              try {
                                return String(JSON.parse(String(opt?.value || '{}'))?.v4Ip || '').trim();
                              } catch {
                                return '';
                              }
                            })
                            .filter((x: string) => !!x);
                          const ipText = ips.join(', ');
                          const label = ipText ? `${ovnDisplayName(vm)} (${ipText})` : ovnDisplayName(vm);
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
            </Col>
            <Col span={12}>
              <Form.Item name="internalPort" label="内部端口" rules={[{ required: true, message: '请输入内部端口' }]}>
                <Input placeholder="例如: 8080" />
              </Form.Item>
            </Col>
          </Row>
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
              const opts = vm ? buildVmNicIpOptions(vm, selectedSubnet) : [];
              if (!vmKey) return null;
              if (!opts.length) {
                return (
                  <>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="未解析到网卡 IP"
                      description="请确认虚拟机已运行且 VMI 已分配 IP。"
                    />
                    <Form.Item
                      name="nicAttach"
                      rules={[
                        {
                          validator: () =>
                            Promise.reject(new Error('当前虚拟机无可用网卡 IP，无法创建 DNAT')),
                        },
                      ]}
                      hidden
                    >
                      <Input type="hidden" />
                    </Form.Item>
                  </>
                );
              }
              try {
                const first = String(opts[0]?.value || '');
                if (first) form.setFieldsValue({ nicAttach: first });
              } catch {}
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

export default DnatSection;
