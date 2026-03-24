import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Table, List, Modal, Form, Input, Select, message, Tag, Space, Alert, Tooltip, Badge, Segmented } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import HarvesterResourceDrawer from '../components/HarvesterOpsinfoDrawer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import dayjs from 'dayjs';
import {
  createKubeOvnProviderNetwork,
  deleteKubeOvnProviderNetwork,
  fetchKubeOvnProviderNetworks,
  fetchHarvesterNodes,
  fetchHarvesterClusterNetworks,
} from '../../../../services/harvesterApi';
import { clearCache } from '../../../../utils/requestManager';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import VlanPlanDrawer from './VlanPlanDrawer';
import { TOWER_IO_ALIES_ANNOTATION, generateKubeOvnTwelveCharName } from '../../../../utils/towerKubeOvnNames';

const { Option } = Select;

type Props = {
  cloudId: string;
};

const ProviderNetworksSection: React.FC<Props> = ({ cloudId }) => {
  const { user } = useAuth();
  const canWriteVlan = hasPermissionForAction(user?.permissions || [], 'clouds.vlans:write');
  const [createMode, setCreateMode] = useState<'centralized' | 'node_specific'>('centralized');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm();
  const [nodeInterfaces, setNodeInterfaces] = useState<string[]>([]);
  const [nodeInterfaceMap, setNodeInterfaceMap] = useState<Record<string, string[]>>({});
  const [nodes, setNodes] = useState<any[]>([]);
  const [nodesLoading, setNodesLoading] = useState(false);
  const [interfaceMap, setInterfaceMap] = useState<Record<string, string>>({});
  const [targetNodes, setTargetNodes] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [readyFilter, setReadyFilter] = useState<string>('');
  const [vlanFilter, setVlanFilter] = useState<string>('');
  const [customFilter, setCustomFilter] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<any>(null);
  const [drawerTab, setDrawerTab] = useState('detail');
  const [vlanPlanOpen, setVlanPlanOpen] = useState(false);
  const [vlanPlanLockProvider, setVlanPlanLockProvider] = useState<string | null>(null);

  const openVlanPlanForProvider = useCallback((pnName: string) => {
    setVlanPlanLockProvider(pnName);
    setVlanPlanOpen(true);
  }, []);

  const closeVlanPlanDrawer = useCallback(() => {
    setVlanPlanOpen(false);
    setVlanPlanLockProvider(null);
  }, []);

  const openDrawer = (record: any, tab: string = 'detail') => {
    const raw = record?.raw || record?.rawData || record;
    setDrawerRecord({ ...raw, kind: 'ProviderNetwork' });
    setDrawerTab(tab);
    setDrawerOpen(true);
  };

  const fetchData = async (force = false, skipSync = false) => {
    setLoading(true);
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId, force, skipSync);
      setData(Array.isArray(res?.data?.items) ? res.data.items : []);
      if (force && cloudId) {
        clearCache(`/api/clouds/${cloudId}/resources/providernetworks`, 'GET');
      }
    } catch (error: any) {
      message.error(`获取物理网络列表失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchNodesAndInterfaces = async () => {
    setNodesLoading(true);
    try {
      const [nodesRes, clusterNetworksRes] = await Promise.all([
        fetchHarvesterNodes(cloudId, true),
        fetchHarvesterClusterNetworks(cloudId, true).catch(() => ({ data: { items: [] } })),
      ]);

      const items = nodesRes?.data?.items || [];
      setNodes(items);

      const clusterNetworkNics = new Set<string>();
      const clusterNetworks = clusterNetworksRes?.data?.items || [];
      clusterNetworks.forEach((cn: any) => {
        const uplinks = cn.uplinks || cn.rawData?.uplinks;
        if (uplinks?.nics && Array.isArray(uplinks.nics)) {
          uplinks.nics.forEach((nic: string) => nic && clusterNetworkNics.add(nic.trim()));
        }
      });

      const allInterfaces = new Set<string>();
      const nodeIfMap: Record<string, string[]> = {};

      const isVirtualOrLoopback = (n: string) => (
        n.startsWith('veth') ||
        n.startsWith('ovn') ||
        n.startsWith('docker') ||
        n.startsWith('flannel') ||
        n.startsWith('cni') ||
        n.startsWith('calico') ||
        n.includes('br-') ||
        n === 'lo'
      );

      items.forEach((node: any) => {
        const nodeName = String(node?.metadata?.name || '');
        if (!nodeName) return;
        const phys = node.physicalInterfaces || [];
        const filtered: string[] = [];
        if (Array.isArray(phys) && phys.length > 0) {
          phys.forEach((p: string) => {
            const iface = String(p || '').trim();
            if (!iface) return;
            if (isVirtualOrLoopback(iface)) return;
            if (clusterNetworkNics.has(iface)) return;
            const status = String(node.interfaceStatusMap?.[iface] || '').toLowerCase();
            if (status && (status === 'down' || status.includes('down') || status === 'disabled')) return;
            filtered.push(iface);
            allInterfaces.add(iface);
          });
        }
        nodeIfMap[nodeName] = Array.from(new Set(filtered)).sort();
      });

      const ifaces = Array.from(allInterfaces).sort();

      setNodeInterfaceMap(nodeIfMap);
      setNodeInterfaces(ifaces);
    } catch {
      message.warning('获取节点网卡失败');
    } finally {
      setNodesLoading(false);
    }
  };

  const onDefaultInterfaceChange = (value: string) => {
    const newMap = { ...interfaceMap };
    const applyNodes = createMode === 'node_specific'
      ? nodes.filter(node => targetNodes.includes(node.metadata.name))
      : nodes;
    applyNodes.forEach(node => {
      newMap[node.metadata.name] = value;
    });
    setInterfaceMap(newMap);
  };

  const handleInterfaceChange = (nodeName: string, value: string) => {
    setInterfaceMap(prev => ({ ...prev, [nodeName]: value }));
  };

  useEffect(() => {
    if (cloudId) fetchData();
  }, [cloudId]);

  useEffect(() => {
    if (!isModalVisible) return;
    fetchNodesAndInterfaces();
    setCreateMode('centralized');
    setTargetNodes([]);
    setInterfaceMap({});
    form.resetFields();
  }, [isModalVisible, cloudId]);

  const handleCreate = async (values: any) => {
    try {
      const customConfig: Record<string, string[]> = {};
      let defaultIf = String(values.defaultInterface || '');
      const selectedNodesFromForm: string[] = Array.isArray(values.targetNodes) ? values.targetNodes : targetNodes;

      if (createMode === 'node_specific') {
        if (!selectedNodesFromForm.length) {
          message.warning('请至少选择一台物理机');
          return;
        }
        const selectedMappings = selectedNodesFromForm
          .map((nodeName) => ({ nodeName, iface: String(interfaceMap[nodeName] || '').trim() }))
          .filter((item) => !!item.iface);
        if (!selectedMappings.length) {
          message.warning('请至少为一台物理机选择网卡');
          return;
        }
        if (!defaultIf) defaultIf = selectedMappings[0].iface;
        selectedMappings.forEach(({ nodeName, iface }) => {
          if (!customConfig[iface]) customConfig[iface] = [];
          customConfig[iface].push(nodeName);
        });
      } else {
        nodes.forEach(node => {
          const iface = interfaceMap[node.metadata.name];
          if (iface && iface !== defaultIf) {
            if (!customConfig[iface]) customConfig[iface] = [];
            customConfig[iface].push(node.metadata.name);
          }
        });
      }

      if (!defaultIf) {
        message.warning('请选择默认网卡');
        return;
      }

      if (createMode === 'node_specific' && !Object.keys(customConfig).length) {
        // 指定模式下至少需要保留一条节点映射，确保支持“单节点单网卡”创建。
        const fallbackNode = selectedNodesFromForm[0];
        if (fallbackNode) {
          if (!customConfig[defaultIf]) customConfig[defaultIf] = [];
          customConfig[defaultIf].push(fallbackNode);
        }
      }

      const towerAlies = String(values.towerAlies ?? '').trim();
      if (!towerAlies) {
        message.warning('请输入物理网络名称');
        return;
      }

      const resourceName = generateKubeOvnTwelveCharName();
      const payload = {
        name: resourceName,
        annotations: { [TOWER_IO_ALIES_ANNOTATION]: towerAlies },
        spec: {
          defaultInterface: defaultIf,
          customInterfaces: Object.keys(customConfig).map(iface => ({ interface: iface, nodes: customConfig[iface] })),
          exchangeLinkName: false,
        },
      };

      await createKubeOvnProviderNetwork(cloudId, payload);
      message.success('创建物理网络成功');
      setIsModalVisible(false);
      fetchData(true, true);
    } catch (error: any) {
      message.error(`创建失败: ${error?.message || '未知错误'}`);
    }
  };

  const handleDelete = (record: any) => {
    const raw = record?.raw || record?.rawData || record;
    const name = String(
      record?.name ||
        raw?.metadata?.name ||
        record?.metadata?.name ||
        '',
    ).trim();
    if (!name || name === '-') {
      message.error('删除失败：无效的物理网络名称');
      return;
    }
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除物理网络 ${name} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteKubeOvnProviderNetwork(cloudId, name);
          message.success('删除成功');
          fetchData(true, true);
        } catch (e: any) {
          message.error(e?.message || '删除失败');
        }
      },
    });
  };

  /** 创建弹窗内「节点网卡映射」列表：物理接口列 */
  const renderModalNodeInterfaceCell = (record: any) => {
    const nodeName = String(record?.metadata?.name || '');
    const currentVal = interfaceMap[nodeName];
    const defaultVal = form.getFieldValue('defaultInterface');
    const isCustom = currentVal && currentVal !== defaultVal;
    const nodeOptions = nodeInterfaceMap[nodeName] || [];
    let options = nodeOptions.length > 0 ? nodeOptions : nodeInterfaces;
    let isInvalid = false;
    if (currentVal) {
      if (!options.includes(currentVal)) isInvalid = true;
      if (!options.includes(currentVal)) options = [...options, currentVal];
    }
    if (createMode === 'centralized') {
      return (
        <Space>
          <Input
            style={{ width: 200 }}
            value={currentVal || defaultVal || ''}
            placeholder="未配置"
            disabled
          />
          {!currentVal && !defaultVal && <Tag color="red">未配置</Tag>}
          {isInvalid && (
            <Tooltip title={`警告: 网卡 "${currentVal}" 在节点 "${nodeName}" 上似乎不存在。`}>
              <Tag color="error" style={{ cursor: 'help' }}>无效接口</Tag>
            </Tooltip>
          )}
        </Space>
      );
    }
    return (
      <Space>
        <Select
          style={{ width: 200 }}
          value={currentVal}
          onChange={(val) => handleInterfaceChange(nodeName, val)}
          placeholder="选择接口"
          status={isInvalid ? 'error' : ''}
        >
          {options.map((iface: string) => (
            <Option key={iface} value={iface}>{iface}</Option>
          ))}
        </Select>
        {isCustom && <Tag color="orange">自定义</Tag>}
        {!currentVal && <Tag color="red">未配置</Tag>}
        {isInvalid && (
          <Tooltip title={`警告: 网卡 "${currentVal}" 在节点 "${nodeName}" 上似乎不存在。`}>
            <Tag color="error" style={{ cursor: 'help' }}>无效接口</Tag>
          </Tooltip>
        )}
      </Space>
    );
  };

  const modalNodesList =
    createMode === 'node_specific' ? nodes.filter((n) => targetNodes.includes(n.metadata.name)) : nodes;

  const allColumns = useMemo(() => [
    {
      title: '名称',
      dataIndex: 'displayAlias',
      key: 'displayAlias',
      ellipsis: true,
      render: (text: string) => {
        const s = String(text || '').trim();
        return s ? <span>{s}</span> : <span style={{ color: '#ccc' }}>—</span>;
      },
    },
    {
      title: 'ID',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      width: 140,
      render: (text: string) => <span style={{ fontFamily: 'ui-monospace, monospace' }}>{text ?? '—'}</span>,
    },
    { title: '默认接口', dataIndex: 'defaultInterface', key: 'defaultInterface', render: (text: string) => <Tag>{text}</Tag> },
    {
      title: '自定义接口',
      dataIndex: 'customInterfaces',
      key: 'customInterfaces',
      render: (items: any[]) => {
        if (!items?.length) return <span style={{ color: '#ccc' }}>无</span>;
        return (
          <Space size={[4, 4]} wrap>
            {items.map((i, idx) => (
              <Tooltip key={idx} title={(i?.nodes || []).join(', ') || '-'}>
                <Tag color="orange">{i.interface} ({(i?.nodes || []).length})</Tag>
              </Tooltip>
            ))}
          </Space>
        );
      },
    },
    {
      title: '关联 VLAN',
      dataIndex: 'vlans',
      key: 'vlans',
      render: (vlans: string[]) => {
        if (!vlans?.length) return <span style={{ color: '#ccc' }}>无</span>;
        return (
          <Space size={[4, 4]} wrap>
            {vlans.map((vlan) => <Tag key={vlan} color="blue">{vlan}</Tag>)}
          </Space>
        );
      },
    },
    {
      title: '就绪节点',
      dataIndex: 'readyNodes',
      key: 'readyNodes',
      render: (nodes: string[]) => {
        if (!nodes?.length) return <span style={{ color: '#ccc' }}>0</span>;
        return (
          <Tooltip title={nodes.join(', ')}>
            <span>{nodes.length}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, record: any) => {
        const ready = !!record?.ready;
        return ready
          ? <Badge status="success" text="已就绪" />
          : <Badge status="warning" text="未就绪" />;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'creationTimestamp',
      key: 'creationTimestamp',
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 88,
      align: 'left' as const,
      render: (_: any, record: any) => {
        const items: any[] = [
          {
            key: 'view',
            label: '运维信息',
            onClick: () => openDrawer(record, 'detail'),
          },
        ];
        if (canWriteVlan) {
          items.push({
            key: 'vlan-plan',
            label: 'VLAN 规划',
            onClick: () => openVlanPlanForProvider(String(record.name || '').trim()),
          });
        }
        items.push({ type: 'divider' });
        items.push({
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => handleDelete(record),
        });
        return <ResourceActionsDropdown items={items} />;
      },
    },
  ], [openDrawer, handleDelete, canWriteVlan, openVlanPlanForProvider]);

  const { displayColumns: tableColumns } = useTableColumnSettings(allColumns, 'harvester_provider_networks_table');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div className="toolbar-container">
          <Input allowClear placeholder="名称" value={keyword} onChange={(e) => setKeyword(e.target.value)} className="toolbar-search" />
          <Select
            allowClear
            placeholder="就绪状态"
            value={readyFilter || undefined}
            onChange={(v) => setReadyFilter(String(v || ''))}
            className="toolbar-filter-sm"
            options={[
              { label: '已就绪', value: 'ready' },
              { label: '未就绪', value: 'not_ready' },
            ]}
          />
          <Select
            allowClear
            placeholder="VLAN 关联"
            value={vlanFilter || undefined}
            onChange={(v) => setVlanFilter(String(v || ''))}
            className="toolbar-filter-sm"
            options={[
              { label: '已关联 VLAN', value: 'has_vlans' },
              { label: '无关联 VLAN', value: 'no_vlans' },
            ]}
          />
          <Select
            allowClear
            placeholder="自定义接口"
            value={customFilter || undefined}
            onChange={(v) => setCustomFilter(String(v || ''))}
            className="toolbar-filter-sm"
            options={[
              { label: '有自定义接口', value: 'has_custom' },
              { label: '无自定义接口', value: 'no_custom' },
            ]}
          />
          <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setReadyFilter(''); setVlanFilter(''); setCustomFilter(''); fetchData(); }}>重置</a>
        </div>
        <div className="toolbar-actions">
          <Button type="primary" onClick={() => setIsModalVisible(true)}>创建物理网络</Button>
          <TableColumnSettingsButton
            allColumns={allColumns}
            settingsKey="harvester_provider_networks_table"
          />
          <Button icon={<ReloadOutlined />} onClick={() => fetchData(true, false)} loading={loading} title="从集群重新同步" />
        </div>
      </div>

      <Table
        className="std-table"
        bordered={false}
        rowKey={(r) => r.key || r.name}
        loading={loading}
        dataSource={(data || [])
          .map((item: any) => {
            const rawBase = item?.rawData || item;
            const mergedLinks = {
              ...(rawBase?.links || {}),
              ...(item?.links || {}),
            };
            const raw = {
              ...rawBase,
              ...(Object.keys(mergedLinks).length ? { links: mergedLinks } : {}),
            };
            const ann = raw?.metadata?.annotations || {};
            const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
            return {
              key: raw?.metadata?.uid || raw?.metadata?.name,
              name: raw?.metadata?.name || '-',
              displayAlias,
              defaultInterface: raw?.spec?.defaultInterface || '-',
              customInterfaces: raw?.spec?.customInterfaces || [],
              status: raw?.status,
              ready: !!raw?.status?.ready,
              readyNodes: Array.isArray(raw?.status?.readyNodes) ? raw.status.readyNodes : [],
              vlans: Array.isArray(raw?.status?.vlans) ? raw.status.vlans : [],
              creationTimestamp: raw?.metadata?.creationTimestamp,
              raw,
            };
          })
          .filter((d: any) => {
            const matchKeyword =
              !keyword ||
              String(d.name || '').includes(keyword) ||
              String(d.displayAlias || '').includes(keyword);
            if (!matchKeyword) return false;
            if (readyFilter === 'ready' && !d.ready) return false;
            if (readyFilter === 'not_ready' && d.ready) return false;
            if (vlanFilter === 'has_vlans' && (d.vlans || []).length === 0) return false;
            if (vlanFilter === 'no_vlans' && (d.vlans || []).length > 0) return false;
            if (customFilter === 'has_custom' && (d.customInterfaces || []).length === 0) return false;
            if (customFilter === 'no_custom' && (d.customInterfaces || []).length > 0) return false;
            return true;
          })}
        columns={tableColumns}
        pagination={{ size: 'small', showTotal: (total) => `共 ${total} 条` }}
      />

      <Modal
        title="创建物理网络"
        open={isModalVisible}
        onOk={form.submit}
        onCancel={() => setIsModalVisible(false)}
        width={700}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
          <Form.Item
            name="towerAlies"
            label="物理网络名称"
            rules={[{ required: true, message: '请输入物理网络名称' }]}
          >
            <Input placeholder="例如：生产业务网、macvlan-uplink" allowClear />
          </Form.Item>

          <Form.Item label="网卡选择方式">
            <Segmented
              value={createMode}
              onChange={(val) => {
                const mode = val as 'centralized' | 'node_specific';
                setCreateMode(mode);
                setInterfaceMap({});
                setTargetNodes([]);
                form.setFieldsValue({ defaultInterface: undefined, targetNodes: [] });
              }}
              options={[
                { label: '集中式选择网卡', value: 'centralized' },
                { label: '指定物理机的指定网卡', value: 'node_specific' },
              ]}
            />
          </Form.Item>

          {createMode === 'node_specific' && (
            <Form.Item name="targetNodes" label="指定物理机" rules={[{ required: true, message: '请选择至少一台物理机' }]}>
              <Select
                mode="multiple"
                placeholder="选择一台或多台物理机"
                loading={nodesLoading}
                value={targetNodes}
                onChange={(vals) => {
                  const next = vals as string[];
                  setTargetNodes(next);
                  form.setFieldsValue({ targetNodes: next });
                }}
                allowClear
              >
                {nodes.map((node) => (
                  <Option key={node.metadata.name} value={node.metadata.name}>{node.metadata.name}</Option>
                ))}
              </Select>
            </Form.Item>
          )}

          {createMode === 'centralized' && (
            <Form.Item
              name="defaultInterface"
              label="物理接口名称 (Default Interface)"
              rules={[{ required: true }]}
            >
              <Select placeholder="选择物理网卡 (e.g. eth0)" loading={nodesLoading} showSearch allowClear onChange={onDefaultInterfaceChange}>
                {nodeInterfaces.map(iface => <Option key={iface} value={iface}>{iface}</Option>)}
              </Select>
            </Form.Item>
          )}

          <Form.Item label="节点网卡映射" style={{ marginBottom: 0 }}>
            <div
              style={
                modalNodesList.length > 6
                  ? { maxHeight: 240, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }
                  : { border: '1px solid #f0f0f0', borderRadius: 6 }
              }
            >
              <List
                size="small"
                split
                dataSource={modalNodesList}
                renderItem={(record) => (
                  <List.Item key={record.metadata?.name} style={{ padding: '8px 12px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, width: '100%' }}>
                      <span style={{ minWidth: 200, flexShrink: 0, wordBreak: 'break-all' }}>
                        {record?.metadata?.name ?? '—'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>{renderModalNodeInterfaceCell(record)}</div>
                    </div>
                  </List.Item>
                )}
              />
            </div>
          </Form.Item>
        </Form>
      </Modal>

      <VlanPlanDrawer
        open={vlanPlanOpen}
        onClose={closeVlanPlanDrawer}
        cloudId={cloudId}
        lockProviderName={vlanPlanLockProvider}
        onSuccess={() => fetchData(true, true)}
      />

      <HarvesterResourceDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerRecord(null); }}
        resourceType="物理网络 (ProviderNetwork)"
        record={drawerRecord}
        activeTab={drawerTab}
        onTabChange={setDrawerTab}
        cloudId={cloudId}
      />
    </div>
  );
};

export default ProviderNetworksSection;

