import React, { useState, useMemo, useCallback } from 'react';
import {
  TOWER_ALIAS_ANNOTATION,
  isBuiltInKubeOvnVpc,
  isFlatKubeOvnSubnetForFlatNatSelector,
} from '../lib/kubeOvnSubnetConstants';
import {
  buildBusinessVpcPickerRows,
  kubeSubnetChoiceLabel,
  vpcDisplayMapFromVpcs,
} from '../lib/kubeOvnUiHelpers';
import { Table, Space, Modal, Form, Input, Select, message, Alert, MenuProps, Button, Tooltip } from 'antd';
import { InteractionTwoTone, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../../../components/ResourceActionsDropdown';
import {
  createCloudProviderOvnSnatRule,
  deleteCloudProviderOvnSnatRule,
  uiNetworkScopeToCloudOvn,
} from '../../../../../../services/harvesterApi';
import MetadataModal from '../modals/MetadataModal';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { generateHarvesterCrMetadataName } from '../../../../../../utils/harvesterUtils';
import { ovnDisplayName, ovnKeywordMatches } from '../lib/ovnResourceDisplay';
import {
  buildPublicSubnetNameToVpcNameMap,
  getOvnEipBoundVpcName,
} from '../lib/kubeOvnEipVpcHelpers';
import {
  createHarvesterToolbarRefresh,
  runHarvesterSectionRefresh,
  type HarvesterSectionOnRefresh,
} from '../lib/kubeOvnSectionRefresh';

function subnetCidrOf(s: any): string {
  return String(s?.spec?.cidrBlock ?? s?.spec?.cidr ?? s?.cidr ?? '').trim();
}

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh?: HarvesterSectionOnRefresh;
}

interface SnatSectionProps extends BaseSectionProps {
  snatRules: any[];
  eips: any[];
  vpcs: any[]; // Used to filter subnets or context
  subnets: any[];
  /** flat/vpc：走分域 API 与写权限；不传则 Harvester 未分域行为 */
  networkScope?: 'flat' | 'vpc';
}

export const SnatSection: React.FC<SnatSectionProps> = ({
  cloudId,
  snatRules,
  eips,
  vpcs,
  subnets,
  loading,
  onRefresh,
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
        hasPermissionForAction(perms, 'clouds.snat.flat:write') ||
        hasPermissionForAction(perms, 'clouds.subnets.flat:write') ||
        hasPermissionForAction(perms, 'clouds:write')
      );
    }
    if (networkScope === 'vpc') {
      return (
        hasPermissionForAction(perms, 'clouds.snat.vpc:write') ||
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
  const selectedVpcWatch = Form.useWatch('vpc', form);
  
  // 筛选条件
  const [keyword, setKeyword] = useState<string>('');
  const [vpcFilter, setVpcFilter] = useState<string>('');

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

  // 筛选数据并按创建时间倒序排序
  const filteredData = useMemo(() => {
    const filtered = snatRules.filter((item: any) => {
      const eipName = String(item?.spec?.ovnEip || '').trim();
      const eip = String(
        item?.status?.v4Eip ||
          item?.metadata?.labels?.['ovn.kubernetes.io/eip_v4_ip'] ||
          eipIpv4ByName.get(eipName) ||
          eipName,
      ).trim();
      const vpcSubnet = String(item?.status?.v4IpCidr || item?.spec?.vpcSubnet || '').trim();
      const vpc = String(item?.status?.vpc || item?.spec?.vpc || '').trim();
      
      // 关键字搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (
          !ovnKeywordMatches(item, kw) &&
          !eip.toLowerCase().includes(kw) &&
          !vpcSubnet.toLowerCase().includes(kw)
        ) {
          return false;
        }
      }
      
      if (vpcFilter && networkScope !== 'flat' && vpc !== vpcFilter) {
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
  }, [snatRules, keyword, vpcFilter, eipIpv4ByName, networkScope]);

  // 筛选选项
  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    snatRules.forEach((item: any) => {
      const vpc = item?.status?.vpc || item?.spec?.vpc;
      if (vpc) set.add(vpc);
    });
    return Array.from(set);
  }, [snatRules]);

  const eipsForCreate = useMemo(() => {
    return (Array.isArray(eips) ? eips : []).filter((e: any) => {
      const t = String(e?.spec?.type ?? e?.type ?? '').trim().toLowerCase();
      return t !== 'lrp';
    });
  }, [eips]);

  const eipIpv4Of = useCallback((e: any) => {
    return String(
      e?.status?.v4Eip ||
      e?.spec?.v4Ip ||
      e?.status?.v4Ip ||
      e?.metadata?.labels?.['ovn.kubernetes.io/eip_v4_ip'] ||
      '',
    ).trim();
  }, []);

  const subnetChoices = useMemo(() => {
    if (!networkScope) return subnets;
    return subnets.filter((s: any) => {
      if (networkScope === 'flat') {
        return isFlatKubeOvnSubnetForFlatNatSelector(s);
      }
      const vpc = String(s.spec?.vpc || s.vpc || '').trim();
      return vpc && !isBuiltInKubeOvnVpc(vpc);
    });
  }, [subnets, networkScope]);

  const vpcPickerRows = useMemo(() => {
    const rows = buildBusinessVpcPickerRows(vpcs);
    if (rows.length > 0 || networkScope !== 'vpc') return rows;
    const ids = new Set<string>();
    for (const s of subnetChoices) {
      const vn = String(s?.spec?.vpc || s?.vpc || '').trim();
      if (vn && !isBuiltInKubeOvnVpc(vn)) ids.add(vn);
    }
    return Array.from(ids).map((id) => ({
      id,
      display: id,
      namespacesDisplay: '-',
      searchLabel: id,
    }));
  }, [vpcs, networkScope, subnetChoices]);

  const subnetChoicesForSelectedVpc = useMemo(() => {
    if (networkScope !== 'vpc') return subnetChoices;
    const v = String(selectedVpcWatch ?? '').trim();
    if (!v) return [];
    return subnetChoices.filter((s: any) => String(s?.spec?.vpc || s?.vpc || '').trim() === v);
  }, [subnetChoices, networkScope, selectedVpcWatch]);

  const vpcDisplayById = useMemo(() => vpcDisplayMapFromVpcs(vpcs), [vpcs]);

  const publicSubnetToVpcForEip = useMemo(() => buildPublicSubnetNameToVpcNameMap(vpcs), [vpcs]);

  const eipsForCreateInSelectedVpc = useMemo(() => {
    if (networkScope !== 'vpc') return eipsForCreate;
    const vpcId = String(selectedVpcWatch ?? '').trim();
    if (!vpcId) return [];
    return eipsForCreate.filter(
      (e: any) => getOvnEipBoundVpcName(e, publicSubnetToVpcForEip) === vpcId,
    );
  }, [eipsForCreate, networkScope, selectedVpcWatch, publicSubnetToVpcForEip]);

  const handleCreate = async () => {
    if (!hasNatWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      if (!cloudId) {
        message.error('缺少云平台 ID');
        return;
      }
      if (networkScope === 'vpc') {
        const vpcSel = String(values.vpc ?? '').trim();
        if (vpcSel) {
          const avail = eipsForCreate.filter(
            (e: any) => getOvnEipBoundVpcName(e, publicSubnetToVpcForEip) === vpcSel,
          );
          if (avail.length === 0) {
            message.error(
              '当前所选 VPC 下没有可用的弹性公网 IP（EIP）。请先到「VPC 网络 → 弹性公网 IP」中为该 VPC 创建 EIP，再创建 SNAT。',
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
      if (networkScope === 'vpc') {
        const selVpc = String(values.vpc ?? '').trim();
        const snName = String(values.vpcSubnet ?? '').trim();
        const sn = subnetChoices.find((s: any) => String(s?.metadata?.name || s?.name || '') === snName);
        const snVpc = String(sn?.spec?.vpc || sn?.vpc || '').trim();
        if (selVpc && snVpc && selVpc !== snVpc) {
          message.error('所选子网不属于当前 VPC，请重新选择');
          return;
        }
      }
      const eipName = String(values.ovnEip ?? '').trim();
      const subnetCrName = String(values.vpcSubnet ?? '').trim();
      if (eipName && subnetCrName) {
        const duplicate = (Array.isArray(snatRules) ? snatRules : []).some((r: any) => {
          const exEip = String(r?.spec?.ovnEip ?? '').trim();
          const exSubnet = String(r?.spec?.vpcSubnet ?? '').trim();
          return exEip === eipName && exSubnet === subnetCrName;
        });
        if (duplicate) {
          message.error('该公网 IP 与所选子网的组合已存在 SNAT 规则，请勿重复创建');
          return;
        }
      }
      setCreateLoading(true);
      const scope = uiNetworkScopeToCloudOvn(networkScope);
      const displayName = String(values.displayName ?? '').trim();
      const payload = {
        ...values,
        name: generateHarvesterCrMetadataName('kubeOvnSnat'),
        ...(displayName ? { alias: displayName } : {}),
      };
      delete (payload as any).displayName;
      delete (payload as any).vpc;
      await createCloudProviderOvnSnatRule(cloudId, payload, scope);
      message.success('SNAT 规则创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      runHarvesterSectionRefresh(onRefresh, { force: true });
    } catch (e: any) {
      if (e?.errorFields?.length) return;
      let errMsg = e?.message || '创建失败';
      let parsed: Record<string, unknown> | null = null;
      if (typeof errMsg === 'string') {
        try {
          parsed = JSON.parse(errMsg) as Record<string, unknown>;
        } catch {
          parsed = null;
        }
      }
      if (parsed && typeof parsed === 'object') {
        const d = parsed.details as Record<string, unknown> | undefined;
        const kubeMsg = d?.message;
        if (typeof kubeMsg === 'string' && kubeMsg.trim()) {
          errMsg = kubeMsg.trim();
        } else {
          errMsg = String(parsed.message || errMsg);
          if (parsed.error) errMsg += `: ${parsed.error}`;
        }
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
          content: `确定要删除 SNAT 规则「${ovnDisplayName(record)}」吗？`,
          okText: '删除',
          okType: 'danger',
          cancelText: '取消',
          onOk: async () => {
            try {
              await deleteCloudProviderOvnSnatRule(
                cloudId,
                record.metadata?.name,
                uiNetworkScopeToCloudOvn(networkScope),
              );
              message.success('删除成功');
              runHarvesterSectionRefresh(onRefresh, { force: true });
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
      fixed: 'left' as const,
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
      title: networkScope === 'flat' ? '扁平子网/CIDR' : 'CIDR',
      key: 'cidr',
      render: (_: any, r: any) => {
        if (networkScope !== 'flat') {
          return (
            <span>{String(r?.status?.v4IpCidr || r?.spec?.vpcSubnet || '').trim() || '-'}</span>
          );
        }
        const snName = String(r?.spec?.vpcSubnet ?? '').trim();
        const sn = snName
          ? subnets.find((s: any) => String(s?.metadata?.name || s?.name || '') === snName)
          : null;
        const alias = String(sn?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
        const crName = String(sn?.metadata?.name ?? snName ?? '').trim();
        const label = alias || crName;
        const cidr = sn ? subnetCidrOf(sn) : String(r?.status?.v4IpCidr ?? '').trim();
        if (!label && !cidr) return '-';
        if (!cidr) return label;
        if (!label) return cidr;
        return `${label}/${cidr}`;
      },
    },
    ...(networkScope === 'flat'
      ? []
      : [
          { 
            title: 'VPC', 
            key: 'vpc', 
            render: (_: any, r: any) => {
              const id = String(r?.status?.vpc || r?.spec?.vpc || '').trim();
              return (id && vpcDisplayById.get(id)) || id || '-';
            },
          },
        ]),
    { 
      title: '公网IP', 
      key: 'eip', 
      render: (_: any, r: any) => {
        const eipName = String(r?.spec?.ovnEip || '').trim();
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
    [hasNatWrite, handleMenuClick, networkScope, eipIpv4ByName, vpcDisplayById, subnets],
  );

  const snatTableSettingsKey = `harvester_ovn_snat_${networkScope ?? 'legacy'}`;
  const { displayColumns: columns } = useTableColumnSettings(allColumns, snatTableSettingsKey);

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
            <button
              type="button"
              className="toolbar-reset-btn"
              onClick={() => {
                setKeyword('');
                setVpcFilter('');
              }}
            >
              重置
            </button>
          </>
        )}
        primaryAction={{
          label: '创建 SNAT 网关',
          onClick: () => {
            if (!hasNatWrite) return;
            form.resetFields();
            setIsCreateVisible(true);
          },
          disabled: !hasNatWrite
        }}
        toolbarRight={
          <Space size={8}>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey={snatTableSettingsKey} />
            <Tooltip title="刷新">
              <Button
                icon={<ReloadOutlined />}
                onClick={createHarvesterToolbarRefresh(onRefresh)}
                loading={loading}
                aria-label="刷新"
              />
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
        title="创建 SNAT 网关"
        centered
        open={isCreateVisible}
        onCancel={() => setIsCreateVisible(false)}
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
                  const dup = (Array.isArray(snatRules) ? snatRules : []).some((r: any) => {
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
            <Form.Item name="vpc" label="选择VPC" rules={[{ required: true, message: '请选择VPC' }]}>
              <Select
                showSearch
                placeholder="请选择VPC"
                allowClear
                optionFilterProp="data-search"
                optionLabelProp="label"
                onChange={() => form.setFieldsValue({ vpcSubnet: undefined, ovnEip: undefined })}
              >
                {vpcPickerRows.map((v) => (
                  <Select.Option key={v.id} value={v.id} label={v.display} data-search={v.searchLabel}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span>{v.display}</span>
                      <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>{`项目: ${v.namespacesDisplay}`}</span>
                    </div>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
          {networkScope === 'vpc' &&
            String(selectedVpcWatch ?? '').trim() &&
            eipsForCreateInSelectedVpc.length === 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                message="当前 VPC 下暂无可用 EIP"
                description="请先到「VPC 网络 → 弹性公网 IP」中为该 VPC 创建弹性公网 IP，再创建 SNAT。"
              />
            )}
          <Form.Item
            name="ovnEip"
            label="选择公网IP"
            rules={[{ required: true, message: '请选择公网IP' }]}
          >
            <Select
              placeholder={
                networkScope === 'flat'
                  ? '请选择公网IP'
                  : !String(selectedVpcWatch || '').trim()
                    ? '请先选择 VPC'
                    : eipsForCreateInSelectedVpc.length > 0
                      ? '请选择公网IP'
                      : '当前 VPC 下暂无 EIP，请先创建'
              }
              disabled={networkScope === 'vpc' && !String(selectedVpcWatch || '').trim()}
            >
              {(networkScope === 'vpc' ? eipsForCreateInSelectedVpc : eipsForCreate).map((e) => (
                <Select.Option key={e.metadata?.name} value={e.metadata?.name}>
                  {ovnDisplayName(e)} ({eipIpv4Of(e) || '-'})
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="vpcSubnet"
            label={networkScope === 'flat' ? '选择扁平子网' : '选择 VPC 子网'}
            rules={[
              {
                required: true,
                message: networkScope === 'flat' ? '请选择扁平子网' : '请选择 VPC 子网',
              },
            ]}
          >
            <Select
              placeholder={
                networkScope === 'flat'
                  ? '请选择扁平子网'
                  : networkScope === 'vpc' && !String(selectedVpcWatch || '').trim()
                    ? '请先选择VPC'
                    : '请选择子网'
              }
              disabled={networkScope === 'vpc' && !String(selectedVpcWatch || '').trim()}
              showSearch
              optionFilterProp="label"
            >
              {(networkScope === 'vpc' ? subnetChoicesForSelectedVpc : subnetChoices).map((s) => {
                const name = String(s.metadata?.name || s.name || '');
                const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                const cidr = subnetCidrOf(s);
                if (networkScope === 'flat') {
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
                }
                const label = `${kubeSubnetChoiceLabel(s)} ${cidr}`.trim();
                return (
                  <Select.Option key={name} value={name} label={label}>
                    <span title={cidr ? `${kubeSubnetChoiceLabel(s)} ${cidr}` : kubeSubnetChoiceLabel(s)}>
                      {kubeSubnetChoiceLabel(s)}
                      {alias ? <span style={{ color: '#8c8c8c' }}>（{name}）</span> : null}
                      {cidr ? <span style={{ color: '#8c8c8c' }}> {cidr}</span> : null}
                    </span>
                  </Select.Option>
                );
              })}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SnatSection;
