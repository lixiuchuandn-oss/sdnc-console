import React, { useMemo, useState, useEffect } from 'react';
import { Table, Tag, Space, Input, Select, Button, Modal, Form, message, Dropdown, MenuProps, Radio, Alert, Checkbox, Row, Col, Tabs } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import PageDetailSection from '../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { createKubeOvnSubnet, deleteKubeOvnSubnet, updateKubeOvnSubnet } from '../../../../services/harvesterApi';
import { fetchCloudProviderEcs } from '../../../../services/api';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

type Props = {
  subnets: any[];
  vpcList?: any[];
  loading: boolean;
  onRefresh?: (force?: boolean) => void;
  onRefreshNads?: (force?: boolean, silent?: boolean) => void;
  showYaml?: boolean;
};

const UNDERLAY_SYSTEM_VPC = 'ovn-cluster';
const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';
const SUBNET_FINALIZER = 'tower.io/managed';

const KubeOvnSubnetsSection: React.FC<Props> = ({ subnets, vpcList = [], loading, onRefresh, onRefreshNads, showYaml = true }) => {
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const hasVpcsWrite = useMemo(
    () => hasPermissionForAction(perms, 'clouds.vpcs:write') || hasPermissionForAction(perms, 'clouds:write'),
    [perms],
  );
  const { id: cloudId } = useParams<{ id: string }>();
  const [keyword, setKeyword] = useState<string>('');
  const [vpc, setVpc] = useState<string | undefined>(undefined);
  const [protocol, setProtocol] = useState<string | undefined>(undefined);
  const [nat, setNat] = useState<string | undefined>(undefined);
  const [dhcp, setDhcp] = useState<string | undefined>(undefined);

  // Create/Edit Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentSubnet, setCurrentSubnet] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  
  // Drawer State
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [currentDrawerResource, setCurrentDrawerResource] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');

  // Fetch VPCs logic removed - now using props


  const vpcOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subnets || []) {
      const v = String(s?.vpc || s?.spec?.vpc || UNDERLAY_SYSTEM_VPC).trim();
      if (v && v !== UNDERLAY_SYSTEM_VPC) set.add(v);
    }
    return Array.from(set).map((x) => ({ label: x, value: x }));
  }, [subnets]);

  const protocolOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of subnets || []) {
      const p = String(s?.protocol || s?.spec?.protocol || '').trim();
      if (p) set.add(p);
    }
    return Array.from(set).map((x) => ({ label: x, value: x }));
  }, [subnets]);

  const businessVpcList = useMemo(
    () => (vpcList || []).filter((v: any) => {
      const name = String(v?.name || v?.metadata?.name || '').trim();
      return name && name !== UNDERLAY_SYSTEM_VPC && name !== 'ovn-vpc-external-network';
    }),
    [vpcList]
  );

  const isBusinessSubnet = (r: any) => {
    const subnetType = String(r?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
    return subnetType === 'vpc';
  };

  const filtered = useMemo(() => {
    const kw = String(keyword || '').toLowerCase().trim();
    return (subnets || []).filter((r: any) => {
      const vpcVal = String(r?.vpc || r?.spec?.vpc || UNDERLAY_SYSTEM_VPC);
      const name = String(r?.name || r?.metadata?.name || '').toLowerCase();
      const cidr = String(r?.cidr || r?.cidrBlock || r?.spec?.cidrBlock || r?.spec?.cidr || '').toLowerCase();

      if (!isBusinessSubnet(r)) return false;

      // 'join' subnet is system reserved
      // if (name === 'join') return false;

      if (kw && !name.includes(kw) && !cidr.includes(kw) && !vpcVal.toLowerCase().includes(kw)) return false;
      if (vpc) {
        if (vpcVal !== vpc) return false;
      }
      if (protocol) {
        const p = String(r?.protocol || r?.spec?.protocol || '');
        if (p !== protocol) return false;
      }
      if (nat) {
        const isNat = r?.nat ?? r?.spec?.natOutgoing ?? false;
        const val = isNat ? 'on' : 'off';
        if (val !== nat) return false;
      }
      if (dhcp) {
        const isDhcp = r?.allowDhcp ?? r?.spec?.enableDhcp ?? true;
        const val = isDhcp ? 'on' : 'off';
        if (val !== dhcp) return false;
      }
      return true;
    });
  }, [subnets, keyword, vpc, protocol, nat, dhcp]);

  const handleSubmit = async () => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      
      // Process excludeIps
      if (values.excludeIps && typeof values.excludeIps === 'string') {
        values.excludeIps = values.excludeIps.split(/[\n,]/).map((s: string) => s.trim()).filter(Boolean);
      }
      
      if (isEditMode && currentSubnet) {
        const name = currentSubnet.name || currentSubnet.metadata?.name;
        
        // Check for VM usage before update
        let usingVms: string[] = [];
        try {
          const ecsRes = await fetchCloudProviderEcs(cloudId!, true);
          const vms: any[] = ecsRes?.data || ecsRes || [];
          const targetRef = `default/${name}`.toLowerCase();
          usingVms = vms
            .filter((vm: any) => Array.isArray(vm.networks)) // Use networks array directly from normalized object
            .filter((vm: any) =>
              vm.networks.some((n: string) => {
                const s = String(n || '').toLowerCase();
                const base = s.includes('@') ? s.split('@')[0] : s;
                return base === targetRef || base.endsWith(`/${name.toLowerCase()}`);
              }),
            )
            .map(
              (vm: any) =>
                vm?.metadata?.annotations?.['tower.io/alias'] ||
                vm.InstanceName ||
                vm.name ||
                vm.metadata?.name,
            )
            .filter(Boolean);
        } catch (e) {}

        if (usingVms.length > 0) {
            message.error(`当前子网 ${name} 正在被 ${usingVms.slice(0, 5).join('、')}${usingVms.length > 5 ? ' 等 VM 使用，无法更新' : ''}`);
            setSubmitting(false);
            return;
        }

        await updateKubeOvnSubnet(cloudId!, name, values);
        message.success('更新子网成功');
      } else {
        if (String(values?.vpc || '').trim() === UNDERLAY_SYSTEM_VPC) {
          message.error('业务 VPC 子网不允许使用 ovn-cluster，请选择业务 VPC');
          setSubmitting(false);
          return;
        }
        const createPayload = {
          ...values,
          annotations: {
            ...(values?.annotations || {}),
            [SUBNET_TYPE_ANNOTATION_KEY]: 'vpc',
          },
          finalizers: Array.from(new Set([...(Array.isArray(values?.finalizers) ? values.finalizers : []), SUBNET_FINALIZER])),
        };
        await createKubeOvnSubnet(cloudId!, createPayload);
        message.success('创建子网成功');
        onRefreshNads?.(true, true);
      }
      
      setIsModalOpen(false);
      setIsEditMode(false);
      setCurrentSubnet(null);
      form.resetFields();
      onRefresh?.(true);
    } catch (e: any) {
      console.error(e);
      const msg = e?.response?.data || e?.message || '未知错误';
      message.error(`${isEditMode ? '更新' : '创建'}失败: ${typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (record: any) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    setIsEditMode(true);
    setCurrentSubnet(record);
    
    const name = record.name || record.metadata?.name;
    const vpcVal = record.vpc || record.spec?.vpc;
    if (String(vpcVal || '').trim() === UNDERLAY_SYSTEM_VPC) {
      message.error('ovn-cluster 子网属于扁平/公共网络，不允许在业务 VPC 子网中编辑');
      return;
    }
    const cidr = record.cidr || record.cidrBlock || record.spec?.cidrBlock || record.spec?.cidr;
    const gateway = record.gateway || record.spec?.gateway;
    const protocol = record.protocol || record.spec?.protocol || 'IPv4';
    const excludeIps = record.excludeIps || record.spec?.excludeIps || [];
    
    // Check various locations for nat/dhcp as they might be flat or in spec
    const nat = record.nat ?? record.spec?.natOutgoing ?? true;
    const allowDhcp = record.allowDhcp ?? record.spec?.enableDhcp ?? true;

    form.setFieldsValue({
      name,
      vpc: vpcVal,
      cidrBlock: cidr,
      gateway,
      protocol,
      nat,
      allowDhcp,
      excludeIps: Array.isArray(excludeIps) ? excludeIps.join('\n') : excludeIps
    });
    
    setIsModalOpen(true);
  };

  const handleDelete = async (name: string) => {
    if (!hasVpcsWrite) {
      message.error('无权限执行该操作');
      return;
    }
    let usingVms: string[] = [];
    try {
      const ecsRes = await fetchCloudProviderEcs(cloudId!, true);
      const vms: any[] = ecsRes?.data || ecsRes || [];
      const targetRef = `default/${name}`.toLowerCase();
      usingVms = vms
        .filter((vm: any) => Array.isArray(vm.networks))
        .filter((vm: any) =>
          vm.networks.some((n: string) => {
            const s = String(n || '').toLowerCase();
            const base = s.includes('@') ? s.split('@')[0] : s;
            return base === targetRef || base.endsWith(`/${name.toLowerCase()}`);
          }),
        )
        .map(
          (vm: any) =>
            vm?.metadata?.annotations?.['tower.io/alias'] ||
            vm.InstanceName ||
            vm.name ||
            vm.metadata?.name,
        )
        .filter(Boolean);
    } catch (e) {}

    const blocked = usingVms.length > 0;

    Modal.confirm({
      title: '确认删除',
      content: (
        <>
          <div>{`确定要删除子网 ${name} 吗？此操作不可恢复。`}</div>
          {blocked && (
            <div style={{ color: '#ff4d4f', marginTop: 8 }}>
              {`无法删除子网，此子网正在被虚拟机使用 ${usingVms.slice(0, 5).join('、')}${usingVms.length > 5 ? ' 等' : ''}`}
            </div>
          )}
        </>
      ),
      okType: 'danger',
      okButtonProps: { disabled: blocked },
      onOk: blocked 
        ? undefined 
        : async () => {
            try {
              await deleteKubeOvnSubnet(cloudId!, name);
              message.success('删除成功');
              onRefresh?.(true);
              onRefreshNads?.(true, true);
            } catch (e: any) {
              const msg = e?.response?.data || e?.message || '未知错误';
              message.error(`删除失败: ${typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : msg}`);
            }
          }
    });
  };

  const handleShowYaml = (record: any) => {
    setCurrentDrawerResource(record);
    // Switch to view_link tab for YAML viewing, fallback to detail
    setDrawerTab(record?.links?.view ? 'view_link' : 'detail');
    setDrawerVisible(true);
  };

  const allColumns = useMemo(() => [
    { 
      title: '子网名称', 
      key: 'name', 
      render: (_: any, r: any) => (
        <span className={hasVpcsWrite ? "cell-link" : ""} onClick={() => { if (!hasVpcsWrite) return; handleEdit(r); }}>
          {r?.name || r?.metadata?.name}
        </span>
      )
    },
    { 
      title: 'CIDR', 
      key: 'cidr', 
      render: (_: any, r: any) => <span className="std-time">{r?.cidr || r?.cidrBlock || r?.spec?.cidrBlock || r?.spec?.cidr || '-'}</span> 
    },
    { 
      title: 'VPC', 
      key: 'vpc', 
      render: (_: any, r: any) => r?.vpc || r?.spec?.vpc || 'ovn-cluster' 
    },
    { 
      title: '网关', 
      key: 'gateway', 
      render: (_: any, r: any) => <span className="std-time">{r?.gateway || r?.spec?.gateway || '-'}</span> 
    },
    { 
      title: '协议', 
      key: 'protocol', 
      render: (_: any, r: any) => r?.protocol || r?.spec?.protocol || 'IPv4' 
    },
    { 
      title: 'NAT', 
      key: 'nat', 
      render: (_: any, r: any) => {
        const isOpen = r?.nat ?? r?.spec?.natOutgoing ?? false;
        return isOpen 
          ? <span className="std-badge std-badge-success">开启</span> 
          : <span className="std-badge std-badge-default">关闭</span>;
      }
    },
    { 
      title: 'DHCP', 
      key: 'dhcp', 
      render: (_: any, r: any) => {
        const isOpen = r?.allowDhcp ?? r?.spec?.enableDhcp ?? true;
        return isOpen 
          ? <span className="std-badge std-badge-success">开启</span> 
          : <span className="std-badge std-badge-default">关闭</span>;
      }
    },
    { 
      title: '操作', 
      key: 'actions',
      fixed: 'right' as const,
      width: 80,
      render: (_: any, r: any) => {
        const name = r?.name || r?.metadata?.name;
        return (
          <ResourceActionsDropdown items={[
            ...(showYaml ? [{ key: 'view_yaml', label: '查看YAML', onClick: () => handleShowYaml(r) }] : []),
            { 
              key: 'edit', 
              label: '编辑', 
              disabled: !hasVpcsWrite,
              onClick: () => handleEdit(r) 
            },
            { type: 'divider' },
            { 
              key: 'delete', 
              label: '删除', 
              danger: true, 
              disabled: !hasVpcsWrite,
              onClick: () => handleDelete(name) 
            }
          ]} buttonProps={{ className: 'row-actions-trigger', disabled: !hasVpcsWrite }} />
        );
      } 
    }
  ], [showYaml, hasVpcsWrite]);

  // 列显示设置（需要在 allColumns 定义之后）
  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_subnets_table');

  return (
    <PageDetailSection
      
      toolbarLeft={(
        <>
          <Input allowClear placeholder="名称/ID" value={keyword} onChange={(e)=> setKeyword(e.target.value)} className="toolbar-search" />
          <Select allowClear placeholder="VPC" options={vpcOptions} value={vpc} onChange={(v)=> setVpc(v)} className="toolbar-filter-sm" />
          <Select allowClear placeholder="协议" options={protocolOptions} value={protocol} onChange={(v)=> setProtocol(v)} className="toolbar-filter-sm" />
          <Select allowClear placeholder="NAT" options={[{ label:'启用', value:'on' }, { label:'关闭', value:'off' }]} value={nat} onChange={(v)=> setNat(v)} className="toolbar-filter-sm" />
          <Select allowClear placeholder="DHCP" options={[{ label:'启用', value:'on' }, { label:'关闭', value:'off' }]} value={dhcp} onChange={(v)=> setDhcp(v)} className="toolbar-filter-sm" />
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              setKeyword('');
              setVpc(undefined);
              setProtocol(undefined);
              setNat(undefined);
              setDhcp(undefined);
            }}
          >
            重置
          </button>
        </>
      )}
      toolbarRight={(
        <>
          <Button type="primary" disabled={!hasVpcsWrite} onClick={() => { if (!hasVpcsWrite) return; setIsEditMode(false); setCurrentSubnet(null); form.resetFields(); setIsModalOpen(true); }}>新建子网</Button>
          <TableColumnSettingsButton 
            allColumns={allColumns} 
            settingsKey="harvester_subnets_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => onRefresh?.(true)} />
        </>
      )}
    >
      <Table
        className="std-table"
        bordered={false}
        rowKey={(r:any)=> r?.name || r?.metadata?.name || Math.random().toString(36).slice(2)}
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <HarvesterResourceDrawer
        resourceType="Subnet"
        record={currentDrawerResource}
        open={drawerVisible}
        onClose={() => setDrawerVisible(false)}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />

      <Modal
        title={isEditMode ? "编辑业务私有子网" : "新建业务私有子网 (VPC Subnet)"}
        open={isModalOpen}
        onCancel={() => setIsModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        width={600}
        destroyOnHidden
      >
        {!isEditMode && <Alert 
            type="info" 
            showIcon 
            style={{ marginBottom: 16 }}
            message="创建业务私有子网"
            description="此操作将创建 VPC 内部的隔离网络，用于托管虚拟机并通过 NAT 访问外部网络。"
        />}

        <Form form={form} layout="vertical">
                <>
                    <Form.Item 
                        name="name" 
                        label="子网名称" 
                        rules={[
                            { required: true, message: '请输入子网名称' },
                            { pattern: /^[a-z][a-z0-9-]*$/, message: '名称必须以小写字母开头，且只能包含小写字母、数字和中划线' }
                        ]}
                    >
                        <Input placeholder="例如: web-subnet-01" style={{ width: '100%' }} disabled={isEditMode} />
                    </Form.Item>
                    
                    <Form.Item 
                        name="vpc" 
                        label="所属 VPC" 
                        rules={[{ required: true, message: '请选择 VPC' }]}
                    >
                        <Select placeholder="请选择 VPC" style={{ width: '100%' }} disabled={isEditMode}>
                            {businessVpcList.map(v => (
                                <Select.Option key={v.name} value={v.name}>
                                    {v.name} (UID: {v.uid})
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item 
                                name="cidrBlock" 
                                label="CIDR 网段" 
                                rules={[
                                    { required: true, message: '请输入 CIDR' },
                                    { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/, message: '格式错误' }
                                ]}
                            >
                                <Input placeholder="10.0.1.0/24" style={{ width: '100%' }} disabled={isEditMode} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item 
                                name="gateway" 
                                label="网关地址" 
                                rules={[
                                    { required: true, message: '请输入网关地址' },
                                    { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '格式错误' }
                                ]}
                            >
                                <Input placeholder="10.0.1.1" style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item name="protocol" label="IP 协议" initialValue="IPv4">
                        <Radio.Group disabled={isEditMode}>
                            <Radio value="IPv4">IPv4</Radio>
                            <Radio value="IPv6" disabled>IPv6 (暂不支持)</Radio>
                        </Radio.Group>
                    </Form.Item>

                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item name="nat" valuePropName="checked" initialValue={true}>
                                <Checkbox>启用 NAT 出网</Checkbox>
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="allowDhcp" valuePropName="checked" initialValue={true}>
                                <Checkbox>启用 DHCP 服务</Checkbox>
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item
                        name="excludeIps"
                        label="排除 IP 范围 (保留 IP)"
                        extra="这些 IP 将不会被分配给虚拟机。支持单 IP 或范围 (e.g. 10.0.1.1..10.0.1.10)，用逗号分隔。"
                    >
                        <Input.TextArea placeholder="10.0.1.1..10.0.1.10" rows={3} />
                    </Form.Item>
                </>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export default KubeOvnSubnetsSection;
