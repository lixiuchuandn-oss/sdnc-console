import React, { useState, useMemo, useCallback } from 'react';
import {
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  isBuiltInKubeOvnVpc,
} from './underlay-subnet/constants';
import { Table, Space, Modal, Form, Input, Select, message, MenuProps, Button, Tooltip } from 'antd';
import { InteractionTwoTone, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnSnatRule, deleteCloudProviderOvnSnatRule } from '../../../../services/harvesterApi';
import MetadataModal from './MetadataModal';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { generateHarvesterEntityId } from '../../../../utils/harvesterUtils';
import { ovnDisplayName, ovnKeywordMatches } from './ovnResourceDisplay';

function subnetCidrOf(s: any): string {
  return String(s?.spec?.cidrBlock ?? s?.spec?.cidr ?? s?.cidr ?? '').trim();
}

interface BaseSectionProps {
  cloudId: string;
  loading: boolean;
  onRefresh: (force?: boolean, silent?: boolean) => void;
  bordered?: boolean;
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

  // 筛选数据
  const filteredData = useMemo(() => {
    return snatRules.filter((item: any) => {
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
      
      // VPC筛选
      if (vpcFilter && vpc !== vpcFilter) {
        return false;
      }
      
      return true;
    });
  }, [snatRules, keyword, vpcFilter, eipIpv4ByName]);

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
      const vpc = String(s.spec?.vpc || s.vpc || '').trim();
      const onFlatBuiltinVpc = !vpc || isBuiltInKubeOvnVpc(vpc);
      if (networkScope === 'flat') {
        const t = String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] ?? '')
          .trim()
          .toLowerCase();
        const hasVlan = !!String(s?.spec?.vlan || '').trim();
        const vpcNorm = vpc || KUBE_OVN_FLAT_VPC;
        return t === 'flat' && onFlatBuiltinVpc && !hasVlan && vpcNorm === KUBE_OVN_FLAT_VPC;
      }
      return vpc && !isBuiltInKubeOvnVpc(vpc);
    });
  }, [subnets, networkScope]);

  const handleCreate = async () => {
    if (!hasNatWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      setCreateLoading(true);
      const scope = networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
      const displayName = String(values.displayName ?? '').trim();
      const payload = {
        ...values,
        name: generateHarvesterEntityId('snat'),
        ...(displayName ? { alias: displayName } : {}),
      };
      delete (payload as any).displayName;
      await createCloudProviderOvnSnatRule(cloudId, payload, scope);
      message.success('SNAT 规则创建成功');
      setIsCreateVisible(false);
      form.resetFields();
      // 创建后刷新（silent=true）时，使用 skipSync=true 跳过全量同步
      onRefresh(true, true);
    } catch (e: any) {
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
              const apiScope =
                networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
              await deleteCloudProviderOvnSnatRule(cloudId, record.metadata?.name, apiScope);
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
      title: 'CIDR', 
      key: 'cidr', 
      render: (_: any, r: any) => <span>{String(r?.status?.v4IpCidr || r?.spec?.vpcSubnet || '').trim() || '-'}</span> 
    },
    ...(networkScope === 'flat'
      ? []
      : [
          { 
            title: 'VPC', 
            key: 'vpc', 
            render: (_: any, r: any) => String(r?.status?.vpc || r?.spec?.vpc || '').trim() || '-' 
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
    [hasNatWrite, handleMenuClick, networkScope, eipIpv4ByName],
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
          onClick: () => { if (!hasNatWrite) return; setIsCreateVisible(true); },
          disabled: !hasNatWrite
        }}
        toolbarRight={
          <Space size={8}>
            <TableColumnSettingsButton allColumns={allColumns} settingsKey={snatTableSettingsKey} />
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
          <Form.Item name="displayName" label="名称">
            <Input placeholder="可选，支持中文；留空则列表仅显示自动生成的资源名" />
          </Form.Item>
          <Form.Item name="ovnEip" label="选择公网IP" rules={[{ required: true, message: '请选择公网IP' }]}>
            <Select placeholder="请选择公网IP">
              {eipsForCreate.map((e) => (
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
            <Select placeholder={networkScope === 'flat' ? '请选择扁平子网' : '请选择子网'}>
              {subnetChoices.map((s) => {
                const name = String(s.metadata?.name || s.name || '');
                const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                const cidr = subnetCidrOf(s);
                const vpc =
                  String(s.spec?.vpc || s.vpc || '').trim() ||
                  (networkScope === 'flat' ? KUBE_OVN_FLAT_VPC : KUBE_OVN_PUBLIC_VPC);
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
                return (
                  <Select.Option key={name} value={name}>
                    {name} (VPC: {vpc})
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
