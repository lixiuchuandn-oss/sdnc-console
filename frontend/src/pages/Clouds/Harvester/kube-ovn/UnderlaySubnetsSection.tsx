import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography, message } from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import {
  createKubeOvnSubnet,
  deleteKubeOvnSubnet,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnSubnets,
  fetchKubeOvnVlans,
  updateKubeOvnSubnet,
} from '../../../../services/harvesterApi';
import SubnetAclFormItems, { normalizeAclRowForForm, normalizeAclsForApi } from './SubnetAclFormItems';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import { generateHarvesterEntityId } from '../../../../utils/harvesterUtils';

const { Option } = Select;

const TOWER_ALIAS_ANNOTATION = 'tower.io/alias';

/**
 * =============================================================================
 * 网络概念区分（与 NAD、其它子网页对照）
 * =============================================================================
 *
 * 【NAD 网络】NetworkAttachmentDefinition（见 sections/NadsSection）
 *   - Multus 侧「多网卡接哪条网络」：bridge / kube-ovn / macvlan 等由 spec.config 决定。
 *   - VM 选附加网络时常选 NAD。旧式扁平多为 bridge；Kube-OVN 子网会配套同名 NAD（type=kube-ovn）。
 *
 * 【扁平子网】本组件 mode=flat，注解 tower.io/subnet-type=flat
 *   - 挂在默认 VPC（如 ovn-cluster）下的 Kube-OVN underlay 子网，常绑 VLAN + ProviderNetwork。
 *   - 用途：二层直通类场景，一般 natOutgoing=false。物理 Provider 名记在注解 tower.io/provider-network。
 *
 * 【公共子网】本组件 mode=public，注解 tower.io/subnet-type=public
 *   - 仍在默认 VPC 下，产品侧用于 EIP/NAT/浮动 IP 等南北向能力常用网段，一般 natOutgoing=true。
 *
 * 【VPC 子网】见 SubnetsSection / VpcsSection，注解 tower.io/subnet-type=vpc
 *   - 挂在用户业务 VPC（非 ovn-cluster）内，租户隔离网段。
 *
 * =============================================================================
 */
type Props = {
  cloudId: string;
  mode?: 'flat' | 'public';
};

const SUBNET_TYPE_ANNOTATION_KEY = 'tower.io/subnet-type';
const SUBNET_FINALIZER = 'tower.io/managed';

const UnderlaySubnetsSection: React.FC<Props> = ({ cloudId, mode = 'flat' }) => {
  const isFlatMode = mode === 'flat';
  const subnetKindLabel = isFlatMode ? '扁平子网' : '公共子网';
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [aclModalVisible, setAclModalVisible] = useState(false);
  const [aclSubnetName, setAclSubnetName] = useState<string | null>(null);
  /** 弹窗标题展示用：注解别名，无则回退为 metadata.name */
  const [aclSubnetTitleLabel, setAclSubnetTitleLabel] = useState<string | null>(null);
  const [aclSubmitting, setAclSubmitting] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [form] = Form.useForm();
  const [aclForm] = Form.useForm();
  const [vlans, setVlans] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [vlanFilter, setVlanFilter] = useState<string | undefined>(undefined);

  const filteredData = useMemo(() => {
    const k = keyword.trim().toLowerCase();
    return data.filter((item: any) => {
      const idName = String(item?.metadata?.name ?? '').toLowerCase();
      const alias = String(item?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').toLowerCase();
      const cidr = String(item?.spec?.cidrBlock ?? '').toLowerCase();
      if (k && !idName.includes(k) && !alias.includes(k) && !cidr.includes(k)) return false;
      if (vlanFilter !== undefined && vlanFilter !== null && String(vlanFilter) !== '') {
        const v = item?.spec?.vlan;
        if (v !== vlanFilter) return false;
      }
      return true;
    });
  }, [data, keyword, vlanFilter]);

  const fetchData = async (force = false, skipSync = false) => {
    setLoading(true);
    try {
      const res = await fetchKubeOvnSubnets(cloudId, force, skipSync);
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const expectType = isFlatMode ? 'flat' : 'public';
      const typed = items.filter((item: any) => {
        const t = String(item?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
        return t === expectType;
      });
      setData(typed);
    } catch (error: any) {
      message.error(`获取${subnetKindLabel}列表失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchVlanOptions = async () => {
    try {
      const res = await fetchKubeOvnVlans(cloudId);
      setVlans(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {}
  };
  const fetchProviderOptions = async () => {
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {}
  };

  useEffect(() => {
    if (!cloudId) return;
    fetchData();
    fetchVlanOptions();
    fetchProviderOptions();
  }, [cloudId]);

  const handleForceRefresh = async () => {
    await Promise.all([
      fetchData(true, false),
      fetchVlanOptions(),
      fetchProviderOptions(),
    ]);
  };

  const handleCreate = async (values: any) => {
    try {
      const { alias, ...rest } = values;
      const aliasTrim = String(alias ?? '').trim();
      const subnetId = generateHarvesterEntityId('sn');
      const excludeIps = rest.excludeIps
        ? String(rest.excludeIps).split('\n').map((s: string) => s.trim()).filter((s: string) => s)
        : [];
      const payload: Record<string, unknown> = {
        ...rest,
        name: subnetId,
        excludeIps,
        protocol: 'IPv4',
        vpc: rest.vpc || 'ovn-cluster',
        gatewayType: rest.gatewayType || 'distributed',
        private: rest.private ?? false,
        natOutgoing: isFlatMode ? false : true,
        annotations: {
          ...(rest?.annotations || {}),
          [SUBNET_TYPE_ANNOTATION_KEY]: isFlatMode ? 'flat' : 'public',
          ...(aliasTrim ? { [TOWER_ALIAS_ANNOTATION]: aliasTrim } : {}),
        },
        finalizers: Array.from(new Set([...(Array.isArray(rest?.finalizers) ? rest.finalizers : []), SUBNET_FINALIZER])),
      };
      const createRes = await createKubeOvnSubnet(cloudId, payload);
      const createdSubnet = createRes?.data || createRes;
      const createdType = String(createdSubnet?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION_KEY] || '').trim().toLowerCase();
      const expectType = isFlatMode ? 'flat' : 'public';
      if (createdSubnet?.metadata?.name && createdType === expectType) {
        setData((prev) => {
          const next = prev.filter((i: any) => i?.metadata?.name !== createdSubnet.metadata.name);
          return [createdSubnet, ...next];
        });
      }
      message.success(`创建${subnetKindLabel}成功`);
      setIsModalVisible(false);
      form.resetFields();
      await fetchData(true, false);
    } catch (error: any) {
      message.error(`创建${subnetKindLabel}失败: ${error.message}`);
    }
  };

  const openAclEditor = (record: any) => {
    const name = record?.metadata?.name;
    if (!name) return;
    const spec = record?.spec || {};
    setAclSubnetName(name);
    const disp = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
    setAclSubnetTitleLabel(disp || name);
    aclForm.setFieldsValue({
      allowEWTraffic: spec.allowEWTraffic ?? false,
      acls: Array.isArray(spec.acls) ? spec.acls.map((a: any) => normalizeAclRowForForm({ ...a })) : [],
    });
    setAclModalVisible(true);
  };

  const handleAclSubmit = async () => {
    if (!aclSubnetName) return;
    try {
      const values = await aclForm.validateFields();
      setAclSubmitting(true);
      const patchBody: Record<string, unknown> = {
        allowEWTraffic: values.allowEWTraffic ?? false,
      };
      if (Array.isArray(values.acls)) {
        patchBody.acls = normalizeAclsForApi(values.acls);
      }
      await updateKubeOvnSubnet(cloudId, aclSubnetName, patchBody);
      message.success('ACL 已更新');
      setAclModalVisible(false);
      setAclSubnetName(null);
      setAclSubnetTitleLabel(null);
      aclForm.resetFields();
      await fetchData(true, false);
    } catch (e: any) {
      if (e?.errorFields) return;
      const msg = e?.response?.data?.message ?? e?.message ?? '未知错误';
      message.error(`更新 ACL 失败: ${typeof msg === 'object' ? JSON.stringify(msg) : msg}`);
    } finally {
      setAclSubmitting(false);
    }
  };

  const openOpsDrawer = useCallback((record: any) => {
    const name = record?.metadata?.name;
    if (!name) return;
    const viewLink = `/apis/kubeovn.io/v1/subnets/${encodeURIComponent(name)}`;
    setDrawerRecord({
      ...record,
      kind: record?.kind || 'Subnet',
      links: {
        ...(record?.links || {}),
        view: viewLink,
      },
    });
    setDrawerTab('detail');
    setDrawerVisible(true);
  }, []);

  const handleDelete = async (name: string) => {
    try {
      await deleteKubeOvnSubnet(cloudId, name);
      message.success('删除成功');
      await fetchData(true, false);
    } catch (error: any) {
      const raw =
        error?.response?.data?.message ??
        error?.response?.data?.error ??
        error?.response?.data ??
        error?.data?.message ??
        error?.data ??
        error?.message ??
        '未知错误';
      const detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      message.error(`删除失败: ${detail}`);
    }
  };

  const allColumns = useMemo(
    () => [
      {
        title: '名称',
        key: 'displayName',
        ellipsis: true,
        render: (_: any, record: any) => {
          const alias = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
          return <span title={alias || undefined}>{alias || '—'}</span>;
        },
      },
      {
        title: 'ID',
        key: 'resourceId',
        ellipsis: true,
        render: (_: any, record: any) => {
          const id = String(record?.metadata?.name ?? '').trim() || '—';
          return <span className="std-time" title={id}>{id}</span>;
        },
      },
      { title: 'CIDR', dataIndex: ['spec', 'cidrBlock'], key: 'cidr' },
      { title: '网关', dataIndex: ['spec', 'gateway'], key: 'gateway' },
      {
        title: 'VLAN',
        dataIndex: ['spec', 'vlan'],
        key: 'vlan',
        render: (v: string) => (v ? <Tag color="blue">{v}</Tag> : <Tag>未打标签 (Untagged)</Tag>),
      },
      {
        title: '物理网络',
        key: 'provider',
        render: (_: any, record: any) => {
          const hint = record?.metadata?.annotations?.['tower.io/provider-network'];
          const specP = record?.spec?.provider;
          const v = hint || specP;
          return v ? <Tag color="geekblue">{v}</Tag> : '-';
        },
      },
      {
        title: '已用 / 总数',
        key: 'usage',
        render: (_: any, record: any) => {
          const st = record.status || {};
          // 集群 JSON 常为 v4availableIPs / v4usingIPs（小写 available），与文档 v4AvailableIPs 并存
          const available = Number(
            st.v4AvailableIPs ??
              st.v4availableIPs ??
              st.availableIPs ??
              st.availableIps ??
              0,
          ) || 0;
          const using = Number(
            st.v4UsingIPs ?? st.v4usingIPs ?? st.usingIPs ?? st.usingIps ?? 0,
          ) || 0;
          // 与 Kube-OVN status：已用 + 可用 = 控制器统计的分配池规模（如 0/253 表示未占用、池内共 253）
          return (
            <span title={`可用 ${available}（已用 ${using}）`}>
              {using} / {available + using}
            </span>
          );
        },
      },
      {
        title: '东西向',
        key: 'allowEW',
        width: 100,
        render: (_: any, record: any) => {
          const allow = record?.spec?.allowEWTraffic === true;
          return allow ? (
            <Tag color="success">允许互访</Tag>
          ) : (
            <Tag>禁止互访</Tag>
          );
        },
      },
      {
        title: 'ACL',
        key: 'acls',
        width: 72,
        render: (_: any, record: any) => {
          const acls = record?.spec?.acls;
          const n = Array.isArray(acls) ? acls.length : 0;
          return (
            <Typography.Link
              onClick={(e) => {
                e.preventDefault();
                openAclEditor(record);
              }}
            >
              {n} 条
            </Typography.Link>
          );
        },
      },
      {
        title: '操作',
        key: 'action',
        width: 80,
        align: 'left' as const,
        fixed: 'right' as const,
        render: (_: any, record: any) => {
          const name = record?.metadata?.name;
          return (
            <ResourceActionsDropdown
              items={[
                {
                  key: 'opsinfo',
                  label: '运维信息',
                  onClick: () => openOpsDrawer(record),
                },
                {
                  key: 'edit_acl',
                  label: '编辑 ACL',
                  onClick: () => openAclEditor(record),
                },
                { type: 'divider' },
                {
                  key: 'delete',
                  label: '删除',
                  danger: true,
                  onClick: () => {
                    if (!name) return;
                    const disp =
                      String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim() || name;
                    Modal.confirm({
                      title: '确认删除',
                      okType: 'danger',
                      content: `确定删除该${subnetKindLabel}「${disp}」吗？将同时删除关联的网络附加定义（NAD）。`,
                      onOk: () => handleDelete(name),
                    });
                  },
                },
              ]}
              buttonProps={{ className: 'row-actions-trigger' }}
            />
          );
        },
      },
    ],
    [subnetKindLabel, openOpsDrawer],
  );

  const underlaySubnetTableSettingsKey = `harvester_underlay_subnets_${mode}`;
  const { displayColumns: columns } = useTableColumnSettings(allColumns, underlaySubnetTableSettingsKey);

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-container">
          <Input
            allowClear
            placeholder="名称/网段/ID"
            suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="toolbar-search"
          />
          <Select allowClear placeholder="筛选 VLAN" className="toolbar-filter-sm" value={vlanFilter} onChange={setVlanFilter}>
            {vlans.map(v => <Option key={v.metadata.name} value={v.metadata.name}>{v.metadata.name}</Option>)}
          </Select>
          <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setVlanFilter(undefined); handleForceRefresh(); }}>重置</a>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => setIsModalVisible(true)}>
            {`创建${subnetKindLabel}`}
          </Button>
          <TableColumnSettingsButton allColumns={allColumns} settingsKey={underlaySubnetTableSettingsKey} />
          <Tooltip title="从集群重新同步子网列表，并刷新本地缓存">
            <Button icon={<ReloadOutlined />} onClick={handleForceRefresh} loading={loading} aria-label="刷新" />
          </Tooltip>
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        columns={columns}
        dataSource={filteredData}
        rowKey={(r) => r.metadata.name}
        loading={loading}
        scroll={{ x: 'max-content' }}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <HarvesterResourceDrawer
        resourceType={subnetKindLabel}
        record={drawerRecord}
        open={drawerVisible}
        onClose={() => {
          setDrawerVisible(false);
          setDrawerRecord(null);
        }}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />

      <Modal title={`创建${subnetKindLabel}`} open={isModalVisible} onOk={form.submit} onCancel={() => setIsModalVisible(false)} width={720}>
        <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
          <Form.Item
            name="alias"
            label={isFlatMode ? '名称' : '别名'}
            tooltip="展示名称，支持中文；写入注解 tower.io/alias。子网在集群中的资源名（metadata.name）为自动生成，格式 id-sn- 加 11 位随机字符。"
            rules={[
              { required: true, message: isFlatMode ? '请输入名称' : '请输入别名' },
              { max: 200, message: isFlatMode ? '名称不超过 200 字' : '别名不超过 200 字' },
              {
                validator: async (_, value) => {
                  const s = String(value ?? '').trim();
                  if (!s) return Promise.resolve();
                  const dup = data.some((item: any) => {
                    const a = String(item?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
                    return a.length > 0 && a === s;
                  });
                  if (dup) {
                    return Promise.reject(new Error(isFlatMode ? '名称已存在，请修改' : '别名已存在，请修改'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Input placeholder="显示名称（支持中文）" />
          </Form.Item>
          <Form.Item name="cidrBlock" label="CIDR" rules={[{ required: true }]}><Input placeholder="192.168.1.0/24" /></Form.Item>
          <Form.Item name="gateway" label="网关" rules={[{ required: true }]}><Input placeholder="192.168.1.1" /></Form.Item>
          <Form.Item
            name="vlan"
            label="VLAN"
            tooltip={
              isFlatMode
                ? '在物理线路上给流量打「几号 VLAN 标签」。请从集群里已经建好的 VLAN 里选；不选表示不打标签（裸二层 / Untagged）。'
                : '若需要给流量打 VLAN 标签，请从集群已有 VLAN 中选择；不选表示不打标签。'
            }
          >
            <Select placeholder={isFlatMode ? '可选；与「物理网络」至少填一项' : '可选'} allowClear>
              {vlans.map(v => <Option key={v.metadata.name} value={v.metadata.name}>{v.metadata.name} (ID: {v.spec.id}, Provider: {v.spec.provider})</Option>)}
            </Select>
          </Form.Item>
          <Form.Item
            name="provider"
            label="物理网络"
            tooltip={
              isFlatMode
                ? '指明子网接到哪条「物理上行」（对应集群里预先建好的物理网络，通常绑定某块网卡/某条链路）。扁平子网必须在本项与上面的「VLAN」里至少填一个，否则无法确定接到哪张物理网。所选名称会记在子网注解中便于对照。'
                : '指明子网主要关联哪条物理上行（选集群里预先建好的物理网络即可）。可选；需与运维在集群中的网络规划一致。'
            }
            rules={[
              {
                validator: async (_, value) => {
                  if (!isFlatMode) return Promise.resolve();
                  const vlan = form.getFieldValue('vlan');
                  if (!vlan && !value) {
                    return Promise.reject(new Error('扁平子网请至少选择「VLAN」或「物理网络」其中一项'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Select placeholder={isFlatMode ? '可选；与「VLAN」至少填一项' : '可选'} allowClear>
              {providers.map((p) => (
                <Option key={p.metadata.name} value={p.metadata.name}>{p.metadata.name}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="excludeIps" label="排除 IP (可选)">
            <Input.TextArea rows={3} placeholder="每行一个 IP 或 IP 范围 (e.g. 192.168.1.1..192.168.1.10)" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={aclSubnetName ? `编辑 ACL — ${aclSubnetTitleLabel || aclSubnetName}` : '编辑 ACL'}
        open={aclModalVisible}
        onOk={handleAclSubmit}
        onCancel={() => {
          setAclModalVisible(false);
          setAclSubnetName(null);
          setAclSubnetTitleLabel(null);
          aclForm.resetFields();
        }}
        confirmLoading={aclSubmitting}
        width={1120}
        destroyOnHidden
      >
        <Form form={aclForm} layout="vertical" className="std-form">
          <SubnetAclFormItems />
        </Form>
      </Modal>
    </div>
  );
};

export default UnderlaySubnetsSection;

