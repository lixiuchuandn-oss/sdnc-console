import React, { useEffect, useState } from 'react';
import { Button, Table, Segmented, Modal, Form, Input, Select, message, Tag, Space, Popconfirm, Card, Alert, Tooltip, Badge } from 'antd';
import { ReloadOutlined, PlusOutlined, DeleteOutlined, InfoCircleOutlined, ThunderboltOutlined, PartitionOutlined, CloudServerOutlined } from '@ant-design/icons';
import { useParams } from 'react-router-dom';
import { 
    createKubeOvnSubnet, 
    deleteKubeOvnSubnet, 
    fetchKubeOvnSubnets,
    fetchKubeOvnProviderNetworks, 
    createKubeOvnProviderNetwork,
    fetchKubeOvnVlans,
    createKubeOvnVlan,
    fetchHarvesterNodes,
    fetchHarvesterClusterNetworks
} from '../../../../services/harvesterApi';

const { Option } = Select;

// ====================================================================================================
// 文件路径: frontend/src/pages/Clouds/Harvester/kube-ovn/PubnetSection.tsx
// 组件名称: Harvester Public Network Management (Harvester 公共网络管理)
// 功能描述: 提供基于 Kube-OVN 的物理直通网络管理界面，支持三层架构配置。
// 
// [核心逻辑]
// 1. 三层架构视图: 通过 Tabs 分离 Subnet (L3), VLAN (L2), Provider Network (L1) 管理。
// 2. 物理接口映射: 在 Provider Network 创建时，支持统一设置 (Default Interface) 和 节点级自定义 (Custom Interfaces)。
// 3. 动态网卡发现: 自动聚合集群所有节点的物理网卡名称，过滤虚拟接口，辅助用户选择。
// 4. 异构节点支持: 通过动态二维表格展示每个节点的网卡配置，直观管理异构硬件环境。
//
// [API 引用]
// - GET/POST /apis/kubeovn.io/v1/subnets (子网管理)
// - GET/POST /apis/kubeovn.io/v1/vlans (VLAN 管理)
// - GET/POST /apis/kubeovn.io/v1/provider-networks (物理接口映射)
// - GET /v1/nodes (节点信息，用于提取物理网卡)
// ====================================================================================================

/**
 * 公共网络主入口组件
 * [功能描述]
 * 容器组件，使用 Segmented 分段切换组织三个维度的网络资源管理。
 */
const PubnetSection: React.FC = () => {
    const { id: cloudId } = useParams<{ id: string }>();
    const [activeTab, setActiveTab] = useState<string>('subnets');

    return (
        <div>
            <div style={{ marginBottom: 16 }}>
                <Segmented
                    value={activeTab}
                    onChange={(value) => setActiveTab(value as string)}
                    options={[
                        { label: '公共子网', value: 'subnets' },
                        { label: 'VLANs', value: 'vlans' },
                        { label: '物理接口 (Provider Networks)', value: 'providers' },
                    ]}
                    size="middle"
                />
            </div>
            {activeTab === 'subnets' && (
                <SubnetList cloudId={cloudId || ''} isActive={true} />
            )}
            {activeTab === 'vlans' && (
                <VlanList cloudId={cloudId || ''} isActive={true} />
            )}
            {activeTab === 'providers' && (
                <ProviderNetworkList cloudId={cloudId || ''} isActive={true} />
            )}
        </div>
    );
};

// ====================================================================================================
// Subnet List Component (子网列表)
// [功能描述]
// 管理 Kube-OVN Subnet 资源，定义 IP CIDR、网关和 VLAN 绑定关系。
// [业务规则]
// - CIDR 必须唯一且不冲突。
// - 必须绑定 VLAN 才能通往物理网络 (否则为 Overlay)。
// - 支持排除 IP 范围 (excludeIps) 以保留特定地址。
// ====================================================================================================
const SubnetList: React.FC<{ cloudId: string; isActive: boolean }> = ({ cloudId, isActive }) => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [form] = Form.useForm();
    const [vlans, setVlans] = useState<any[]>([]);
    const [keyword, setKeyword] = useState('');
    const [vlanFilter, setVlanFilter] = useState<string | undefined>(undefined); // New State

    // [逻辑: 数据加载]
    // 获取子网列表，不进行复杂的客户端过滤，依靠 API 返回。
    const fetchData = async (force = false, skipSync = false) => {
        setLoading(true);
        try {
            const res = await fetchKubeOvnSubnets(cloudId, force, skipSync);
            const items = Array.isArray(res?.data?.items) ? res.data.items : [];
            
            // 过滤出属于公共网络的子网 (必须绑定 VLAN 或 Provider，排除纯 Overlay/VPC 子网)
            const publicSubnets = items.filter((item: any) => {
                // 1. spec.vlan 必须存在且非空字符串
                const vlan = item.spec?.vlan;
                const hasVlan = vlan && vlan.trim() !== '';
                
                // 2. spec.provider 必须存在且非空字符串，且不能是默认的 'ovn' 或以 '.ovn' 结尾
                // Kube-OVN 的 Overlay 子网会自动生成类似 "subnet-name.default.ovn" 的 provider
                const provider = item.spec?.provider;
                const hasProvider = provider && 
                                   provider.trim() !== '' && 
                                   provider !== 'ovn' && 
                                   !provider.endsWith('.ovn');
                
                // 3. 排除 join 子网 (通常是 Kube-OVN 内部使用的)
                const isJoin = item.metadata?.name === 'join';
                
                // 逻辑: (有有效 VLAN 或 有有效 Provider) 且 不是内部子网
                // 注意: 默认情况下，如果没有指定 vlan/provider，或者 provider='ovn'，Kube-OVN 会创建 Overlay 网络。
                // 我们只展示物理网络 (Underlay)，即必须显式绑定了 VLAN 或 物理 Provider。
                return (hasVlan || hasProvider) && !isJoin;
            });
            
            setData(publicSubnets);
        } catch (error: any) {
            message.error(`获取子网列表失败: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // [逻辑: 关联资源获取]
    // 获取 VLAN 列表以供创建子网时选择。
    const fetchVlanOptions = async () => {
        try {
            const res = await fetchKubeOvnVlans(cloudId);
            setVlans(Array.isArray(res?.data?.items) ? res.data.items : []);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        if (isActive) {
            fetchData();
            fetchVlanOptions();
        }
    }, [cloudId, isActive]);

    // [逻辑: 创建提交]
    // 处理 excludeIps 的格式转换 (换行符 -> 数组)，并设置默认协议为 IPv4。
    const handleCreate = async (values: any) => {
        try {
            // excludeIps 处理：将换行符分隔的字符串转换为数组
            const excludeIps = values.excludeIps 
                ? values.excludeIps.split('\n').map((s: string) => s.trim()).filter((s: string) => s)
                : [];
            
            const payload = {
                ...values,
                excludeIps,
                protocol: 'IPv4', // 默认 IPv4
            };
            
            await createKubeOvnSubnet(cloudId, payload);
            message.success('创建子网成功');
            setIsModalVisible(false);
            form.resetFields();
            // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，skipSync=true 跳过后端全量同步）
            fetchData(true, true);
        } catch (error: any) {
            message.error(`创建失败: ${error.message}`);
        }
    };

    const handleDelete = async (name: string) => {
        try {
            await deleteKubeOvnSubnet(cloudId, name);
            message.success('删除成功');
            fetchData();
        } catch (error: any) {
            message.error(`删除失败: ${error.message}`);
        }
    };

    const columns = [
        {
            title: '名称',
            dataIndex: ['metadata', 'name'],
            key: 'name',
        },
        {
            title: 'CIDR',
            dataIndex: ['spec', 'cidrBlock'],
            key: 'cidr',
        },
        {
            title: '网关',
            dataIndex: ['spec', 'gateway'],
            key: 'gateway',
        },
        {
            title: 'VLAN',
            dataIndex: ['spec', 'vlan'],
            key: 'vlan',
            render: (vlan: string) => vlan ? <Tag color="blue">{vlan}</Tag> : <Tag>Default (Overlay)</Tag>,
        },
        {
            title: 'Provider',
            dataIndex: ['spec', 'provider'],
            key: 'provider',
            render: (provider: string) => provider ? <Tag color="geekblue">{provider}</Tag> : '-',
        },
        {
            title: '可用 IP',
            key: 'usage',
            render: (_: any, record: any) => {
                const available = record.status?.availableIPs || 0;
                const using = record.status?.usingIPs || 0;
                const total = available + using;
                return <span>{using} / {total}</span>;
            }
        },
        {
            title: '操作',
            key: 'action',
            render: (_: any, record: any) => (
                <Popconfirm title="确定删除该子网吗？这将同时删除关联的 NAD。" onConfirm={() => handleDelete(record.metadata.name)}>
                    <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
            ),
        },
    ];

    // === JSX Structure ===
    return (
        <div>
            <Alert 
                message="仅展示绑定了 VLAN 或 Provider Network 的公共子网。" 
                type="info" 
                showIcon 
                style={{ marginBottom: 16 }} 
            />
            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <div className="toolbar-container">
                    <Input 
                        allowClear 
                        placeholder="关键字" 
                        value={keyword} 
                        onChange={(e) => setKeyword(e.target.value)} 
                        className="toolbar-search" 
                    />
                    <Select
                        allowClear
                        placeholder="筛选 VLAN"
                        style={{ width: 180, marginRight: 8 }}
                        value={vlanFilter}
                        onChange={setVlanFilter}
                    >
                        {vlans.map(v => (
                            <Option key={v.metadata.name} value={v.metadata.name}>
                                {v.metadata.name}
                            </Option>
                        ))}
                    </Select>
                    <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setVlanFilter(undefined); fetchData(); }}>重置</a>
                </div>
                <div className="toolbar-actions">
                    <Button type="primary" onClick={() => setIsModalVisible(true)}>新建子网</Button>
                    <Button icon={<ReloadOutlined />} onClick={() => fetchData()} loading={loading} />
                </div>
            </div>
            
            {/* Data Table */}
            <Table 
                className="std-table"
                columns={columns} 
                bordered={false}
                dataSource={data.filter(d => {
                    const matchKeyword = !keyword || d.metadata.name.includes(keyword);
                    const matchVlan = !vlanFilter || d.spec.vlan === vlanFilter;
                    return matchKeyword && matchVlan;
                })} 
                rowKey={(r) => r.metadata.name} 
                loading={loading}
                pagination={{ size: 'small', showQuickJumper: false }}
            />

            {/* Create Modal */}
            <Modal
                title="创建公共子网"
                visible={isModalVisible}
                onOk={form.submit}
                onCancel={() => setIsModalVisible(false)}
                width={600}
            >
                <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
                    <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                        <Input placeholder="例如: public-net-1" />
                    </Form.Item>
                    <Form.Item name="cidrBlock" label="CIDR" rules={[{ required: true }]}>
                        <Input placeholder="192.168.1.0/24" />
                    </Form.Item>
                    <Form.Item name="gateway" label="网关" rules={[{ required: true }]}>
                        <Input placeholder="192.168.1.1" />
                    </Form.Item>
                    <Form.Item name="vlan" label="绑定 VLAN" tooltip="选择一个已存在的 VLAN 资源。这将决定该子网使用哪个物理接口。">
                        <Select placeholder="选择 VLAN (留空则为 Overlay)" allowClear>
                            {vlans.map(v => (
                                <Option key={v.metadata.name} value={v.metadata.name}>
                                    {v.metadata.name} (ID: {v.spec.id}, Provider: {v.spec.provider})
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item name="excludeIps" label="排除 IP (可选)">
                        <Input.TextArea rows={3} placeholder="每行一个 IP 或 IP 范围 (e.g. 192.168.1.1..192.168.1.10)" />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

// ====================================================================================================
// VLAN List Component (VLAN 列表)
// [功能描述]
// 管理 Kube-OVN VLAN 资源，将 Provider Network (物理接口) 划分为多个逻辑网络。
// [核心逻辑]
// - VLAN ID 0 表示 Flat Network (无 Tag)。
// - VLAN ID 1-4095 表示带 Tag 的网络。
// - 必须绑定一个 Provider Network 才能生效。
// ====================================================================================================
const VlanList: React.FC<{ cloudId: string; isActive: boolean }> = ({ cloudId, isActive }) => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [form] = Form.useForm();
    const [providers, setProviders] = useState<any[]>([]);
    const [keyword, setKeyword] = useState('');
    const [providerFilter, setProviderFilter] = useState<string | undefined>(undefined); // New State

    const fetchData = async (force = false, skipSync = false) => {
        setLoading(true);
        try {
            const res = await fetchKubeOvnVlans(cloudId, force, skipSync);
            setData(Array.isArray(res?.data?.items) ? res.data.items : []);
        } catch (error: any) {
            message.error(`获取 VLAN 列表失败: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // [逻辑: 关联资源获取]
    // 获取 Provider Network 列表，用于 VLAN 绑定。
    const fetchProviderOptions = async () => {
        try {
            const res = await fetchKubeOvnProviderNetworks(cloudId);
            setProviders(Array.isArray(res?.data?.items) ? res.data.items : []);
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        if (isActive) {
            fetchData();
            fetchProviderOptions();
        }
    }, [cloudId, isActive]);

    const handleCreate = async (values: any) => {
        try {
            await createKubeOvnVlan(cloudId, values);
            message.success('创建 VLAN 成功');
            setIsModalVisible(false);
            form.resetFields();
            // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，skipSync=true 跳过后端全量同步）
            fetchData(true, true);
        } catch (error: any) {
            message.error(`创建失败: ${error.message}`);
        }
    };

    const columns = [
        {
            title: '名称',
            dataIndex: ['metadata', 'name'],
            key: 'name',
            render: (text: string) => <b>{text}</b>,
        },
        {
            title: 'VLAN ID',
            dataIndex: ['spec', 'id'],
            key: 'id',
            render: (id: number) => <Tag color="purple">{id}</Tag>,
        },
        {
            title: 'Provider Network',
            dataIndex: ['spec', 'provider'],
            key: 'provider',
            render: (provider: string) => <Tag color="geekblue">{provider}</Tag>,
        },
        {
            title: '创建时间',
            dataIndex: ['metadata', 'creationTimestamp'],
            key: 'created',
            render: (text: string) => new Date(text).toLocaleString(),
        },
    ];

    // === JSX Structure ===
    return (
        <div>
            <Alert message="VLAN 资源用于将 Provider Network (物理接口) 划分为多个逻辑网络。" type="info" showIcon style={{ marginBottom: 16 }} />
            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <div className="toolbar-container">
                    <Input 
                        allowClear 
                        placeholder="关键字" 
                        value={keyword} 
                        onChange={(e) => setKeyword(e.target.value)} 
                        className="toolbar-search" 
                    />
                    <Select
                        allowClear
                        placeholder="筛选 Provider"
                        style={{ width: 180, marginRight: 8 }}
                        value={providerFilter}
                        onChange={setProviderFilter}
                    >
                        {providers.map(p => (
                            <Option key={p.metadata.name} value={p.metadata.name}>
                                {p.metadata.name}
                            </Option>
                        ))}
                    </Select>
                    <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); setProviderFilter(undefined); fetchData(); }}>重置</a>
                </div>
                <div className="toolbar-actions">
                    <Button type="primary" onClick={() => setIsModalVisible(true)}>创建 VLAN</Button>
                    <Button icon={<ReloadOutlined />} onClick={() => fetchData()} loading={loading} />
                </div>
            </div>
            {/* Data Table */}
            <Table 
                className="std-table"
                columns={columns} 
                bordered={false}
                dataSource={data.filter(d => {
                    const matchKeyword = !keyword || d.metadata.name.includes(keyword) || d.spec.id?.toString().includes(keyword);
                    const matchProvider = !providerFilter || d.spec.provider === providerFilter;
                    return matchKeyword && matchProvider;
                })} 
                rowKey={(r) => r.metadata.name} 
                loading={loading}
                pagination={{ size: 'small', showQuickJumper: false }}
            />

            {/* Create Modal */}
            <Modal
                title="创建 VLAN"
                visible={isModalVisible}
                onOk={form.submit}
                onCancel={() => setIsModalVisible(false)}
            >
                <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
                    <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                        <Input placeholder="例如: vlan-100" />
                    </Form.Item>
                    <Form.Item name="id" label="VLAN ID" rules={[{ required: true }]}>
                        <Input type="number" placeholder="0 表示 Flat Network (无 Tag), 1-4095 为 VLAN Tag" />
                    </Form.Item>
                    <Form.Item name="provider" label="Provider Network" rules={[{ required: true }]}>
                        <Select placeholder="选择物理接口映射">
                            {providers.map(p => (
                                <Option key={p.metadata.name} value={p.metadata.name}>{p.metadata.name}</Option>
                            ))}
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

// ====================================================================================================
// Provider Network List Component (物理接口列表)
// [功能描述]
// 管理 Kube-OVN Provider Network 资源，定义物理网卡到逻辑网络的映射。
// 支持异构集群的节点级网卡自定义 (Custom Interfaces)。
// [核心逻辑]
// 1. [网卡发现] 自动扫描所有节点的物理网卡，并过滤掉虚拟接口 (veth, ovn, docker, etc.)。
// 2. [集群网络过滤] 自动过滤掉已被集群网络 (ClusterNetwork) 使用的网卡，避免冲突。
// 3. [状态过滤] 自动过滤掉 down 状态的网卡，仅显示可用 (up) 的网卡。
// 4. [配置分离] 将配置分为"统一设置 (Default)"和"节点自定义 (Custom)"。
// 5. [动态映射] 实时维护 node -> interface 的映射表，并可视化展示差异。
// ====================================================================================================
const ProviderNetworkList: React.FC<{ cloudId: string; isActive: boolean }> = ({ cloudId, isActive }) => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [form] = Form.useForm();
    const [nodeInterfaces, setNodeInterfaces] = useState<string[]>([]);
    const [nodes, setNodes] = useState<any[]>([]); // 保存完整节点对象
    const [nodesLoading, setNodesLoading] = useState(false);
    
    // [状态管理] interfaceMap
    // 存储节点名称到网卡名称的映射。
    // key=nodeName, value=interfaceName
    const [interfaceMap, setInterfaceMap] = useState<Record<string, string>>({});
    const [keyword, setKeyword] = useState('');

    const fetchData = async (force = false, skipSync = false) => {
        setLoading(true);
        try {
            const res = await fetchKubeOvnProviderNetworks(cloudId, force, skipSync);
            setData(Array.isArray(res?.data?.items) ? res.data.items : []);
        } catch (error: any) {
            message.error(`获取 Provider Network 列表失败: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    // [逻辑: 节点网卡发现与聚合]
    // 1. 获取所有节点信息 (包含 physicalInterfaces)。
    // 2. 提取并去重所有物理网卡名称。
    // 3. 过滤掉已知的虚拟网卡前缀 (veth, ovn, docker, etc.)。
    // 4. 过滤掉集群网络使用的网卡。
    // 5. 过滤掉 down 状态的网卡。
    const fetchNodesAndInterfaces = async () => {
        setNodesLoading(true);
        try {
            // [并发获取] 同时获取节点数据和集群网络数据
            const [nodesRes, clusterNetworksRes] = await Promise.all([
                fetchHarvesterNodes(cloudId, true),
                fetchHarvesterClusterNetworks(cloudId, true).catch((e: any) => {
                    // 如果获取集群网络失败，不影响主流程，返回空数组
                    console.warn('Failed to fetch cluster networks:', e);
                    return { data: { items: [] } };
                })
            ]);
            
            const items = nodesRes?.data?.items || [];
            setNodes(items);
            
            // [提取集群网络使用的网卡] 从所有集群网络的 uplinks.nics 中提取
            const clusterNetworkNics = new Set<string>();
            const clusterNetworks = clusterNetworksRes?.data?.items || [];
            clusterNetworks.forEach((cn: any) => {
                const uplinks = cn.uplinks || cn.rawData?.uplinks;
                if (uplinks?.nics && Array.isArray(uplinks.nics)) {
                    uplinks.nics.forEach((nic: string) => {
                        if (nic && typeof nic === 'string') {
                            clusterNetworkNics.add(nic.trim());
                        }
                    });
                }
                // 兼容处理：直接从 rawData 中提取（如果 uplinks 字段不存在）
                if (!uplinks && cn.rawData) {
                    const vlanConfigs = cn.vlanConfigs || [];
                    vlanConfigs.forEach((vc: any) => {
                        const vcUplinks = vc.uplink || vc.rawData?.uplink;
                        if (vcUplinks?.nics && Array.isArray(vcUplinks.nics)) {
                            vcUplinks.nics.forEach((nic: string) => {
                                if (nic && typeof nic === 'string') {
                                    clusterNetworkNics.add(nic.trim());
                                }
                            });
                        }
                    });
                }
            });
            
            // 提取并聚合所有节点上的物理网卡名称，用于 Default Interface 的建议列表
            const allInterfaces = new Set<string>();
            const interfaceStatusMap: Record<string, string> = {}; // 聚合所有节点的网卡状态
            
            items.forEach((node: any) => {
                const phys = node.physicalInterfaces || [];
                if (Array.isArray(phys) && phys.length > 0) {
                    phys.forEach((p: string) => {
                        allInterfaces.add(p);
                        // 收集网卡状态信息（如果后端提供了）
                        if (node.interfaceStatusMap && node.interfaceStatusMap[p]) {
                            interfaceStatusMap[p] = node.interfaceStatusMap[p];
                        }
                    });
                } else {
                    const links = node.status?.nodeInfo?.networkInfo?.links || [];
                    links.forEach((l: any) => {
                        const linkName = l.name || l;
                        if (linkName) {
                            allInterfaces.add(linkName);
                            // 尝试从 link 对象中提取状态
                            if (l.operState || l.state) {
                                interfaceStatusMap[linkName] = String(l.operState || l.state).toLowerCase();
                            }
                        }
                    });
                }
            });

            // [多层过滤] 应用所有过滤规则
            const ifaces = Array.from(allInterfaces)
                .filter((n: string) => {
                    // 1. 过滤虚拟接口
                    if (n.startsWith('veth') || 
                        n.startsWith('ovn') || 
                        n.startsWith('docker') ||
                        n.startsWith('flannel') || 
                        n.startsWith('cni') || 
                        n.startsWith('calico') ||
                        n.includes('br-') ||
                        n === 'lo') {
                        return false;
                    }
                    
                    // 2. 过滤集群网络使用的网卡
                    if (clusterNetworkNics.has(n)) {
                        return false;
                    }
                    
                    // 3. 过滤 down 状态的网卡
                    // 检查状态：operState/state 为 "down"、"down" 或类似值
                    const status = interfaceStatusMap[n];
                    if (status) {
                        const statusLower = status.toLowerCase();
                        // 排除 down 状态（包括 "down", "downed", "disabled" 等）
                        if (statusLower === 'down' || 
                            statusLower === 'downed' || 
                            statusLower === 'disabled' ||
                            statusLower === 'lowerlayerdown' ||
                            statusLower.includes('down')) {
                            return false;
                        }
                    }
                    
                    return true;
                })
                .sort();
            
            setNodeInterfaces(ifaces);
            
        } catch (error: any) {
            console.error('Failed to fetch nodes:', error);
        } finally {
            setNodesLoading(false);
        }
    };

    // [逻辑: 统一设置联动]
    // 监听 Default Interface 变化，将所有节点的映射值重置为该默认值。
    // 用户可以在此之后单独修改特定节点，从而产生 Custom Interface。
    const onDefaultInterfaceChange = (value: string) => {
        const newMap = { ...interfaceMap };
        nodes.forEach(node => {
            newMap[node.metadata.name] = value;
        });
        setInterfaceMap(newMap);
    };

    const handleInterfaceChange = (nodeName: string, value: string) => {
        setInterfaceMap(prev => ({ ...prev, [nodeName]: value }));
    };

    useEffect(() => {
        if (isActive) {
            fetchData();
        }
    }, [cloudId, isActive]);

    useEffect(() => {
        if (isModalVisible) {
            fetchNodesAndInterfaces();
            setInterfaceMap({});
            form.resetFields();
        }
    }, [isModalVisible, cloudId]);

    // [逻辑: 创建提交]
    // 计算 Default Interface 和 Custom Interfaces。
    // 任何与 Default Interface 不一致的节点配置都将被记录为 Custom Interface。
    const handleCreate = async (values: any) => {
        try {
            const defaultIf = values.defaultInterface;
            
            // 计算 customInterfaces
            // 逻辑：遍历所有节点，如果其 interfaceMap 中的值与 defaultIf 不同，则生成 custom 条目
            const customConfig: Record<string, string[]> = {}; // interface -> [nodes]
            
            nodes.forEach(node => {
                const iface = interfaceMap[node.metadata.name];
                if (iface && iface !== defaultIf) {
                    if (!customConfig[iface]) customConfig[iface] = [];
                    customConfig[iface].push(node.metadata.name);
                }
            });

            const customInterfaces = Object.keys(customConfig).map(iface => ({
                interface: iface,
                nodes: customConfig[iface]
            }));

            const payload = {
                name: values.name,
                spec: {
                    defaultInterface: defaultIf,
                    customInterfaces: customInterfaces,
                    exchangeLinkName: false 
                }
            };

            await createKubeOvnProviderNetwork(cloudId, payload);
            message.success('创建 Provider Network 成功');
            setIsModalVisible(false);
            // 刷新数据列表（创建后已直接入库，使用 force=true 跳过前端缓存，skipSync=true 跳过后端全量同步）
            fetchData(true, true);
        } catch (error: any) {
            let errorMsg = error.message || '创建失败';
            // 尝试提取更详细的错误信息
            if (error.response?.data) {
                const errorData = error.response.data;
                if (errorData.error) {
                    errorMsg = errorData.error;
                } else if (errorData.message) {
                    errorMsg = errorData.message;
                } else if (errorData.details) {
                    errorMsg = typeof errorData.details === 'string' 
                        ? errorData.details 
                        : JSON.stringify(errorData.details);
                }
            }
            message.error(`创建失败: ${errorMsg}`);
        }
    };

    // [配置: 节点表格列定义]
    // 用于在 Modal 中展示每个节点的网卡选择状态。
    const nodeColumns = [
        {
            title: <span style={{ fontWeight: 'normal' }}>节点名称 (Node)</span>,
            dataIndex: ['metadata', 'name'],
            key: 'name',
            width: 250, // 指定宽度以确保表头对齐
        },
        {
            title: <span style={{ fontWeight: 'normal' }}>物理接口 (Interface)</span>,
            key: 'interface',
            render: (_: any, record: any) => {
                const nodeName = record.metadata.name;
                const currentVal = interfaceMap[nodeName];
                const defaultVal = form.getFieldValue('defaultInterface');
                const isCustom = currentVal && currentVal !== defaultVal;
                
                // 获取当前节点的可用网卡列表
                const phys = record.physicalInterfaces || [];
                let options = phys.length > 0 ? phys : nodeInterfaces; // 如果该节点没有物理网卡数据，回退到全局列表
                
                // 确保选项里包含当前值 (即使用户手动输入了非标准值)
                let isInvalid = false;
                if (currentVal) {
                    // 如果该节点有物理网卡数据，且当前值不在其中，则视为无效/不存在
                    if (phys.length > 0 && !phys.includes(currentVal)) {
                        isInvalid = true;
                    }
                    if (!options.includes(currentVal)) {
                        options = [...options, currentVal];
                    }
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
                            <Tooltip title={`警告: 网卡 "${currentVal}" 在节点 "${nodeName}" 上似乎不存在。请确认拼写或从下拉列表选择。`}>
                                <Tag color="error" style={{ cursor: 'help' }}>无效接口</Tag>
                            </Tooltip>
                        )}
                    </Space>
                );
            }
        }
    ];

    const columns = [
        {
            title: '名称',
            dataIndex: ['metadata', 'name'],
            key: 'name',
            render: (text: string) => <b>{text}</b>,
        },
        {
            title: '默认接口',
            dataIndex: ['spec', 'defaultInterface'],
            key: 'defaultInterface',
            render: (text: string) => <Tag>{text}</Tag>,
        },
        {
            title: '自定义接口 (Custom Interfaces)',
            dataIndex: ['spec', 'customInterfaces'],
            key: 'customInterfaces',
            render: (items: any[]) => (
                items && items.length > 0 
                ? items.map((i, idx) => <div key={idx}><Tag color="orange">{i.interface}</Tag> @ {i.nodes.join(', ')}</div>)
                : <span style={{ color: '#ccc' }}>无</span>
            ),
        },
        {
            title: '状态',
            key: 'status',
            render: (_: any, record: any) => {
                const conditions = record.status?.conditions || [];
                const ready = conditions.find((c: any) => c.type === 'Ready' && c.status === 'True');
                return ready ? <Badge status="success" text="Ready" /> : <Badge status="error" text="Not Ready" />;
            }
        }
    ];

    // === JSX Structure ===
    return (
        <div>
            <Alert message="Provider Network 定义了集群节点上的物理网卡映射关系。如果集群节点网卡命名不一致，请使用“自定义接口”进行特定配置。" type="info" showIcon style={{ marginBottom: 16 }} />
            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <div className="toolbar-container">
                    <Input 
                        allowClear 
                        placeholder="关键字" 
                        value={keyword} 
                        onChange={(e) => setKeyword(e.target.value)} 
                        className="toolbar-search" 
                    />
                    <a className="toolbar-reset-btn" onClick={() => { setKeyword(''); fetchData(); }}>重置</a>
                </div>
                <div className="toolbar-actions">
                    <Button type="primary" onClick={() => setIsModalVisible(true)}>创建 Provider</Button>
                    <Button icon={<ReloadOutlined />} onClick={() => fetchData()} loading={loading} />
                </div>
            </div>
            {/* Data Table */}
            <Table 
                className="std-table"
                columns={columns} 
                dataSource={data.filter(d => !keyword || d.metadata.name.includes(keyword))} 
                rowKey={(r) => r.metadata.name} 
                loading={loading}
                bordered={false}
                pagination={{ size: 'small', showQuickJumper: false }}
            />

            {/* Create Modal */}
            <Modal
                title="创建 Provider Network"
                visible={isModalVisible}
                onOk={form.submit}
                onCancel={() => setIsModalVisible(false)}
                width={700}
            >
                <Form form={form} layout="vertical" onFinish={handleCreate} className="std-form">
                    <Form.Item name="name" label="名称" rules={[{ required: true }]}>
                        <Input placeholder="例如: macvlan" />
                    </Form.Item>
                    
                    <Form.Item 
                        name="defaultInterface" 
                        label="物理接口名称 (Default Interface)" 
                        rules={[{ required: true }]} 
                        extra="选择一个物理网卡名称，将批量应用到下方所有节点（作为基准配置）。"
                        style={{ marginBottom: 0 }}
                    >
                        <Select 
                            placeholder="选择或输入物理网卡 (e.g. eth0)" 
                            loading={nodesLoading}
                            showSearch
                            allowClear
                            onChange={onDefaultInterfaceChange}
                        >
                            {nodeInterfaces.map(iface => (
                                <Option key={iface} value={iface}>{iface}</Option>
                            ))}
                        </Select>
                    </Form.Item>

                    
                        <Alert 
                            message="您可以在此微调特定节点的网卡映射。如果与统一设置不同，将被视为自定义接口。" 
                            type="info" 
                            showIcon 
                            style={{ marginBottom: 16 }} 
                        />
                        <Table 
                            columns={nodeColumns} 
                            dataSource={nodes} 
                            rowKey={(r) => r.metadata.name} 
                            pagination={false} 
                            size="small"
                            bordered={false}
                            scroll={nodes.length > 6 ? { y: 240 } : undefined}
                        />
                    
                </Form>
            </Modal>
        </div>
    );
};

export default PubnetSection;
