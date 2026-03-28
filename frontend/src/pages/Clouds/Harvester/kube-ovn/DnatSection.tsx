import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Table, Tag, Space, Modal, Form, Input, Select, message, MenuProps, Button, Tooltip, Alert } from 'antd';
import { InteractionTwoTone, SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import PageDetailSection from '../../../../components/PageDetailSection';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { createCloudProviderOvnDnatRule, deleteCloudProviderOvnDnatRule } from '../../../../services/harvesterApi';
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
  void vpcs;
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

  const subnetChoicesForDnat = useMemo(
    () => subnetChoicesForOvnAttach(subnets, networkScope),
    [subnets, networkScope],
  );

  const subnetNameWatch = Form.useWatch('subnetName', form);

  const selectedSubnet = useMemo(() => {
    if (!subnetNameWatch) return null;
    return (
      subnetChoicesForDnat.find(
        (s: any) => String(s?.metadata?.name || s?.name || '') === String(subnetNameWatch),
      ) || null
    );
  }, [subnetChoicesForDnat, subnetNameWatch]);

  const vmsOnSubnet = useMemo(() => {
    if (!selectedSubnet) return [];
    return vmsList.filter((vm) => vmUsesSubnet(vm, selectedSubnet));
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
      const eip = item.spec?.ovnEip || '';
      const internalIp = item.spec?.internalIp || '';
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
      
      // VPC筛选
      if (vpcFilter && vpc !== vpcFilter) {
        return false;
      }
      
      // 协议筛选
      if (protocolFilter && protocol !== protocolFilter) {
        return false;
      }
      
      return true;
    });
  }, [dnatRules, keyword, vpcFilter, protocolFilter]);

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
      const scope = networkScope === 'flat' ? 'flat' : networkScope === 'vpc' ? 'vpc' : 'legacy';
      const displayName = String(values.displayName ?? '').trim();
      const subnetName = String(values.subnetName || '').trim();
      const subnet = subnetChoicesForDnat.find(
        (s: any) => String(s?.metadata?.name || s?.name || '') === subnetName,
      );
      const vpc = String(subnet?.spec?.vpc || subnet?.vpc || '').trim() || KUBE_OVN_FLAT_VPC;
      let nic: { v4Ip?: string };
      try {
        nic = JSON.parse(String(values.nicAttach || '')) as { v4Ip?: string };
      } catch {
        message.error('内部 IP 选项无效，请重新选择网卡');
        return;
      }
      const internalIp = String(nic?.v4Ip || '').trim();
      if (!internalIp) {
        message.error('请选择网卡 IP');
        return;
      }
      const payload: Record<string, unknown> = {
        name: generateHarvesterEntityId('dnat'),
        ovnEip: values.ovnEip,
        protocol: values.protocol || 'tcp',
        externalPort: values.externalPort,
        internalPort: values.internalPort,
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
              await deleteCloudProviderOvnDnatRule(cloudId, record.metadata?.name);
              message.success('删除成功');
              onRefresh(true);
            } catch (e: any) {
              message.error(`删除失败: ${e.message}`);
            }
          },
        });
      }
    },
    [cloudId, hasNatWrite, onRefresh],
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
            <InteractionTwoTone twoToneColor={['#1677ff', '#91caff']} style={{ fontSize: 16, flexShrink: 0 }} />
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
      render: (_: any, r: any) => r.spec?.ovnEip || '-' 
    },
    { 
      title: '端口', 
      key: 'port', 
      render: (_: any, r: any) => `${r.spec?.protocol} ${r.spec?.externalPort} -> ${r.spec?.internalPort}` 
    },
    { 
      title: '内部IP', 
      key: 'ip', 
      render: (_: any, r: any) => r.spec?.internalIp || '-' 
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
    [hasNatWrite, handleMenuClick],
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
            form.setFieldsValue({ protocol: 'tcp' });
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
        width={520}
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
          {subnetChoicesForDnat.length === 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="缺少可选子网"
              description="请同步子网列表。扁平 DNAT 选 flat 子网；VPC DNAT 选业务 VPC 下的 vpc 子网（与创建 FIP 一致）。"
            />
          )}
          <Form.Item name="displayName" label="名称">
            <Input placeholder="可选，支持中文；留空则列表仅显示自动生成的资源名" />
          </Form.Item>
          <Form.Item name="ovnEip" label="EIP" rules={[{ required: true, message: '请选择 EIP' }]}>
            <Select placeholder="请选择 EIP" allowClear>
              {eips.map((e) => (
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
              placeholder="请选择子网（扁平 / VPC）"
              allowClear
              showSearch
              filterOption={(input, option) => {
                const v = String((option as { value?: string })?.value ?? '');
                const s = subnetChoicesForDnat.find(
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
              {subnetChoicesForDnat.map((s: any) => {
                const name = String(s?.metadata?.name || s?.name || '');
                const alias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                const cidr = subnetCidrOf(s);
                const vpc = String(s?.spec?.vpc || s?.vpc || '').trim() || KUBE_OVN_FLAT_VPC;
                const primary = alias || name;
                const secondary = alias ? name : '';
                const searchBlob = [primary, secondary, name, cidr, vpc].filter(Boolean).join(' ');
                return (
                  <Select.Option key={name} value={name} title={searchBlob}>
                    <span title={cidr ? `${primary} ${cidr} VPC:${vpc}` : `${primary} VPC:${vpc}`}>
                      {primary}
                      {secondary ? <span style={{ color: '#8c8c8c' }}>（{secondary}）</span> : null}
                      {cidr ? <span style={{ color: '#8c8c8c' }}> {cidr}</span> : null}
                      <span style={{ color: '#8c8c8c' }}> · {vpc}</span>
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
              if (!vmKey) {
                return (
                  <Form.Item label="内部 IP（网卡）">
                    <Select placeholder="请先选择虚拟机" disabled />
                  </Form.Item>
                );
              }
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
                      label="内部 IP（网卡）"
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
              return (
                <Form.Item
                  name="nicAttach"
                  label="内部 IP（网卡）"
                  rules={[{ required: true, message: '请选择网卡 IP' }]}
                  extra="与创建 FIP 相同：按子网筛选 VM，再选网卡 IP 作为 DNAT 目标内网地址"
                >
                  <Select placeholder="请选择网卡与 IP" allowClear options={opts} />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item name="protocol" label="协议" initialValue="tcp">
            <Select>
              <Select.Option value="tcp">TCP</Select.Option>
              <Select.Option value="udp">UDP</Select.Option>
              <Select.Option value="sctp">SCTP</Select.Option>
            </Select>
          </Form.Item>
          <Space>
            <Form.Item name="externalPort" label="外部端口" rules={[{ required: true, message: '请输入外部端口' }]}>
              <Input placeholder="例如: 80" />
            </Form.Item>
            <Form.Item name="internalPort" label="内部端口" rules={[{ required: true, message: '请输入内部端口' }]}>
              <Input placeholder="例如: 8080" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
};

export default DnatSection;
