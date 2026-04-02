import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, Dropdown, message, Table, Input, Select, Modal, Popover, Checkbox, Form, Typography, Progress } from 'antd';
import { CloudUploadOutlined, SafetyCertificateOutlined, DeploymentUnitOutlined, NodeIndexOutlined, ArrowLeftOutlined, UnorderedListOutlined, ReloadOutlined, DesktopOutlined, SearchOutlined, EllipsisOutlined, SettingOutlined, AppstoreOutlined, HomeOutlined, LoginOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import SharedToolbar from '../../../components/SharedToolbar';
import { fetchClouds, fetchCsmVirtualElements, fetchCsmPhysicalElements, fetchCsmElementGroups, fetchCsmServiceChains, operateCsmVm, getCsmVmConsole, fetchCsmVRouters, fetchCsmAssets, createCsmAsset, deleteCsmAsset, csmSsoLogin } from '../../../services/api';
import CsmVmDetailModal from './modals/CsmVmDetailModal';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import CsmServiceChainSection from './sections/CsmServiceChainSection';

interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

// Helpers to reduce redundancy
const getColumnOptions = (columns: any[]) =>
  columns
    .filter((c: any) => c.key !== 'action')
    .map((c: any) => ({ label: c.title, value: c.key }));

const getDisplayColumns = (columns: any[], visibleKeys: string[]) => {
  const keys = new Set(visibleKeys);
  return columns.filter((c: any) => c.key === 'action' || keys.has(c.key));
};

const createRowSelection = (selectedRowKeys: React.Key[], onChange: (keys: React.Key[]) => void, extraProps?: any) => ({
  selectedRowKeys,
  onChange,
  ...extraProps,
});

const CloudDetailCsm: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const navigate = useNavigate();
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [virtualElements, setVirtualElements] = useState<any[]>([]);
  const [physicalElements, setPhysicalElements] = useState<any[]>([]);
  const [elementGroups, setElementGroups] = useState<any[]>([]);
  const [serviceChains, setServiceChains] = useState<any[]>([]);
  const [vRouters, setVRouters] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [showLog, setShowLog] = useState<boolean>(false);
  const [rawVirtual, setRawVirtual] = useState<any | null>(null);
  const [rawPhysical, setRawPhysical] = useState<any | null>(null);
  const [rawGroups, setRawGroups] = useState<any | null>(null);
  const [rawVRouters, setRawVRouters] = useState<any | null>(null);
  const [rawAssets, setRawAssets] = useState<any | null>(null);
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [currentVm, setCurrentVm] = useState<any | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [vendorFilter, setVendorFilter] = useState<string>('');
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);
  const [assetSearch, setAssetSearch] = useState<string>('');
  const [assetType, setAssetType] = useState<string | undefined>(undefined);
  const [assetIpType, setAssetIpType] = useState<string | undefined>(undefined);
  const [assetPort, setAssetPort] = useState<string>('');
  const [assetSelectedRowKeys, setAssetSelectedRowKeys] = useState<React.Key[]>([]);
  const [assetVisibleColumnKeys, setAssetVisibleColumnKeys] = useState<string[]>(['id','type','ip_type','value','port','action']);
  const [assetCreateOpen, setAssetCreateOpen] = useState(false);
  const [assetEditOpen, setAssetEditOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any | null>(null);
  const [assetForm] = Form.useForm();
  const [assetEditForm] = Form.useForm();

  // VRouter States
  const [vRouterSearch, setVRouterSearch] = useState<string>('');
  const [vRouterSelectedRowKeys, setVRouterSelectedRowKeys] = useState<React.Key[]>([]);
  const [vRouterVisibleColumnKeys, setVRouterVisibleColumnKeys] = useState<string[]>(['id', 'ip', 'host_ip', 'status', 'vm_count', 'port_count', 'action']);

  // Physical Hosts States
  const [physicalSearch, setPhysicalSearch] = useState<string>('');
  const [physicalSelectedRowKeys, setPhysicalSelectedRowKeys] = useState<React.Key[]>([]);
  const [physicalVisibleColumnKeys, setPhysicalVisibleColumnKeys] = useState<string[]>(['name', 'ip', 'status', 'cpu', 'memory', 'disk', 'action']);

  // Groups States
  const [groupSearch, setGroupSearch] = useState<string>('');
  const [groupTypeFilter, setGroupTypeFilter] = useState<string>('');
  const [groupVendorFilter, setGroupVendorFilter] = useState<string>('');
  const [groupDefendFilter, setGroupDefendFilter] = useState<string>('');
  const [groupSelectedRowKeys, setGroupSelectedRowKeys] = useState<React.Key[]>([]);
  const [groupVisibleColumnKeys, setGroupVisibleColumnKeys] = useState<string[]>(['name', 'id', 'type', 'vendor', 'defend_type', 'count', 'members', 'action']);
  
  const rowSelection = createRowSelection(selectedRowKeys, setSelectedRowKeys);

  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    return fromConfig || '-';
  }, [cloud]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cloudsRes = await fetchClouds();
      const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray((cloudsRes as any)?.data) ? (cloudsRes as any).data : []);
      setCloud((cloudList || []).find((c:any)=> String(c.id) === String(cloudId)) || null);
      const [virtualJson, physicalJson, groupsJson, chainsJson, vRoutersJson, assetsJson] = await Promise.all([
        fetchCsmVirtualElements(cloudId).catch(()=>null),
        fetchCsmPhysicalElements(cloudId).catch(()=>null),
        fetchCsmElementGroups(cloudId).catch(()=>null),
        fetchCsmServiceChains(cloudId).catch(()=>null),
        fetchCsmVRouters(cloudId).catch(()=>null),
        fetchCsmAssets(cloudId).catch(()=>null),
      ]);
      const vList: any[] = (virtualJson as any)?.data?.items || (virtualJson as any)?.items || (virtualJson as any)?.data || [];
      const pList: any[] = (physicalJson as any)?.data?.items || (physicalJson as any)?.items || (physicalJson as any)?.data || [];
      const gList: any[] = (groupsJson as any)?.data?.items || (groupsJson as any)?.items || (groupsJson as any)?.data || [];
      const cList: any[] = (chainsJson as any)?.data?.items || (chainsJson as any)?.items || (chainsJson as any)?.data || [];
      const vrList: any[] = (vRoutersJson as any)?.data?.items || (vRoutersJson as any)?.items || (vRoutersJson as any)?.data || [];
      const aList: any[] = (assetsJson as any)?.data?.items || (assetsJson as any)?.items || (assetsJson as any)?.data || [];
      setVirtualElements(Array.isArray(vList) ? vList : []);
      setPhysicalElements(Array.isArray(pList) ? pList : []);
      const groupsFinal = gList;
      setElementGroups(Array.isArray(groupsFinal) ? groupsFinal : []);
      setServiceChains(Array.isArray(cList) ? cList : []);
      setVRouters(Array.isArray(vrList) ? vrList : []);
      setAssets(Array.isArray(aList) ? aList : []);
      setRawVirtual(virtualJson || null);
      setRawPhysical(physicalJson || null);
      setRawGroups(groupsJson || null);
      setRawVRouters(vRoutersJson || null);
      setRawAssets(assetsJson || null);
    } catch (e:any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleBatchOperation = async (action: 'start' | 'stop' | 'reboot') => {
    if (!selectedRowKeys.length) return;
    
    Modal.confirm({
      title: `确定要${action === 'reboot' ? '重启' : action === 'start' ? '启动' : '停止'}选中的 ${selectedRowKeys.length} 台虚拟机吗？`,
      onOk: async () => {
        try {
          let successCount = 0;
          let failCount = 0;
          for (const key of selectedRowKeys) {
            try {
              await operateCsmVm(cloudId, String(key), action);
              successCount++;
            } catch (e) {
              console.error(`Failed to ${action} VM ${key}:`, e);
              failCount++;
            }
          }
          if (failCount === 0) {
            message.success(`批量操作成功`);
          } else {
            message.warning(`操作完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
          }
          loadAll();
          setSelectedRowKeys([]);
        } catch (e) {
          message.error('操作异常');
        }
      }
    });
  };

  const handleSingleOperation = useCallback(async (record: any, action: 'start' | 'stop' | 'reboot') => {
    const vmId = record.id || record.Id || record.uuid || record.vm_id;
    if (!vmId) return;
    try {
      await operateCsmVm(cloudId, vmId, action);
      message.success('指令已发送');
      loadAll();
    } catch (e: any) {
      message.error(`操作失败: ${e.message}`);
    }
  }, [cloudId, loadAll]);

  const handleConsole = useCallback(async (record: any) => {
    const vmId = record.id || record.Id || record.uuid || record.vm_id;
    if (!vmId) return;
    try {
      const res = await getCsmVmConsole(cloudId, vmId);
      const url = res?.data?.url || res?.url || (typeof res === 'string' ? res : null);
      if (url) {
        window.open(url, '_blank');
      } else {
        message.warning('未获取到有效的控制台地址');
      }
    } catch (e: any) {
      message.error(`获取控制台失败: ${e.message}`);
    }
  }, [cloudId]);

  const filteredVirtualElements = useMemo(() => {
    return virtualElements.filter(item => {
      // Filter by Status
      if (filterStatus !== 'all') {
        const s = item.status;
        const k = String(s || '').toLowerCase();
        let statusMatch = false;
        // Map common status to simple keys
        if (filterStatus === 'running') statusMatch = (s === 1 || k.includes('run') || k.includes('正常'));
        else if (filterStatus === 'stopped') statusMatch = (s === 0 || k.includes('stop') || k.includes('关闭'));
        else if (filterStatus === 'error') statusMatch = (s === 2 || k.includes('error') || k.includes('fail') || k.includes('失败'));
        else if (filterStatus === 'other') statusMatch = !((s === 1 || k.includes('run')) || (s === 0 || k.includes('stop')) || (s === 2 || k.includes('error')));
        
        if (!statusMatch) return false;
      }

      if (typeFilter) {
        const t = String(item.vm_type || item.Type || '').trim();
        if (t !== typeFilter) return false;
      }

      if (vendorFilter) {
        const v = String(item.vm_vendor || '').trim();
        if (v !== vendorFilter) return false;
      }

      // Filter by Search Text
      if (searchText) {
        const lower = searchText.toLowerCase();
        const name = String(item.vm_name || item.name || '').toLowerCase();
        const ip = String(item.manage_ip || '').toLowerCase();
        const type = String(item.vm_type || item.type || '').toLowerCase();
        const vendor = String(item.vm_vendor || '').toLowerCase();
        return name.includes(lower) || ip.includes(lower) || type.includes(lower) || vendor.includes(lower);
      }

      return true;
    });
  }, [virtualElements, searchText, filterStatus, typeFilter, vendorFilter]);

  const filteredPhysicalElements = useMemo(() => {
    return physicalElements.filter(item => {
      if (physicalSearch) {
        const lower = physicalSearch.toLowerCase();
        const name = String(item.host_name || item.name || '').toLowerCase();
        const ip = String(item.host_manage_ip || '').toLowerCase();
        return name.includes(lower) || ip.includes(lower);
      }
      return true;
    });
  }, [physicalElements, physicalSearch]);

  const columnsHosts = React.useMemo(() => [
    { title: '主机名称', dataIndex: 'host_name', key: 'name', width: 120, ellipsis: true, render: (t: any, r: any) => t || r?.Name || '-' },
    { title: '管理IP', dataIndex: 'host_manage_ip', key: 'ip', width: 120, render: (t: any) => t || '-' },
    { title: '状态', dataIndex: 'host_active_status', key: 'status', width: 80, render: (s: any) => {
      const map: any = { 0: '存活', 1: '非存活' };
      const colorMap: any = { 0: 'green', 1: 'red' };
      return <Tag color={colorMap[s] || 'default'}>{map[s] || s}</Tag>;
    }},
    { title: '厂商', dataIndex: 'vendor_name', key: 'vendor', width: 100, ellipsis: true, render: (t: any) => t || '-' },
    { title: '型号', dataIndex: 'machine_type', key: 'model', width: 100, ellipsis: true, render: (t: any) => t || '-' },
    { title: 'CPU', key: 'cpu', width: 160, render: (_: any, r: any) => {
      const total = r.cpu || 0;
      const usageRaw = parseFloat(r.cpu_usage || 0);
      const pct = Math.max(0, Math.min(100, Number(usageRaw - 100)));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>{total}核</span>
          <Progress percent={pct} size="small" status={pct > 90 ? 'exception' : 'active'} showInfo={false} />
        </div>
      );
    }},
    { title: '内存', key: 'memory', width: 160, render: (_: any, r: any) => {
      const total = r.memory_total ? `${r.memory_total}GB` : '-';
      const usageRaw = parseFloat(r.mem_usage || 0);
      const pct = Math.max(0, Math.min(100, Number(usageRaw)));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>{total}</span>
          <Progress percent={pct} size="small" status={pct > 90 ? 'exception' : 'active'} showInfo={false} />
        </div>
      );
    }},
    { title: '大页内存', key: 'huge_mem', width: 160, render: (_: any, r: any) => {
      const total = r.huge_mem_total ? `${r.huge_mem_total}GB` : '0';
      const usage = parseFloat(r.huge_mem_usage || 0).toFixed(1);
      if (!r.huge_mem_total) return '-';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>{total}</span>
          <Progress percent={Number(usage)} size="small" showInfo={false} />
        </div>
      );
    }},
    { title: '磁盘', key: 'disk', width: 160, render: (_: any, r: any) => {
      const total = r.disk_total ? `${r.disk_total}GB` : '-';
      const usageRaw = parseFloat(r.disk_usage || 0);
      const pct = Math.max(0, Math.min(100, Number(usageRaw)));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>{total}</span>
          <Progress percent={pct} size="small" showInfo={false} />
        </div>
      );
    }},
    { title: 'Ceph磁盘', key: 'ceph', width: 160, render: (_: any, r: any) => {
      const total = r.ceph_disk_total ? `${r.ceph_disk_total}GB` : '-';
      const usage = parseFloat(r.ceph_disk_usage || 0).toFixed(1);
      if (!r.ceph_disk_total) return '-';
      return (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12 }}>
          <span>{total}</span>
          <Progress percent={Number(usage)} size="small" showInfo={false} />
        </div>
      );
    }},
    { title: '架构', dataIndex: 'cpu_architecture', key: 'arch', width: 80, render: (t: any) => t || '-' },
    { title: '故障迁移', dataIndex: 'migrate', key: 'migrate', width: 90, render: (t: boolean) => t ? <Tag color="green">支持</Tag> : <Tag>不支持</Tag> },
    { title: '引流', dataIndex: 'is_drainage', key: 'drainage', width: 80, render: (t: any) => String(t) === '1' ? <Tag color="blue">是</Tag> : '否' },
    { title: '绑定CPU', dataIndex: 'bindCpu', key: 'bindCpu', width: 90, render: (t: any) => (t ? <Tag color="purple">绑定</Tag> : <Tag>不绑定</Tag>) },
    { title: '可绑定CPU', dataIndex: 'availiable_bind_cpu', key: 'bindCpuAvail', width: 110, render: (n: any) => (typeof n === 'number' ? n : '-') },
    { title: 'DHCP', dataIndex: 'dhcpEnable', key: 'dhcp', width: 80, render: (t: boolean) => t ? <Tag color="green">开启</Tag> : '关闭' },
    { title: '防御类型', dataIndex: 'host_defend_type', key: 'defend_type', width: 100, render: (t: any) => {
       const m:any = { 1:'非流量型', 2:'流量型', 3:'通用' };
       return m[t] || t || '-';
    }},
    { title: '描述', dataIndex: 'host_description', key: 'desc', ellipsis: true, render: (t: any) => t || '-' },
    { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
      <ResourceActionsDropdown
        items={[
          { key: 'detail', label: '查看元数据' },
        ]}
        onClick={({ key }) => {
          if (key === 'detail') {
            Modal.info({
              title: '物理主机元数据',
              width: 600,
              content: (
                <div style={{ maxHeight: 420, overflow: 'auto', background: '#f7f7f7', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
                  <pre style={{ margin: 0, fontSize: 12, lineHeight: '20px', fontFamily: 'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace' }}>
{JSON.stringify(record, null, 2)}
                  </pre>
                </div>
              )
            });
          }
        }}
        icon={<EllipsisOutlined />}
        size="small"
        buttonProps={{ style: { padding: 0 } }}
      />
    ) },
  ], []);

  const physicalColumnOptions = React.useMemo(() => getColumnOptions(columnsHosts), [columnsHosts]);

  const columnsHostsDisplay = React.useMemo(() => getDisplayColumns(columnsHosts, physicalVisibleColumnKeys), [columnsHosts, physicalVisibleColumnKeys]);

  const physicalRowSelection = createRowSelection(physicalSelectedRowKeys, setPhysicalSelectedRowKeys);

  const filteredGroups = useMemo(() => {
    return elementGroups.filter(item => {
      if (groupTypeFilter && item.vm_type !== groupTypeFilter) return false;
      if (groupVendorFilter && item.vendor_name !== groupVendorFilter) return false;
      if (groupDefendFilter && String(item.defend_type) !== groupDefendFilter) return false;
      
      if (groupSearch) {
        const lower = groupSearch.toLowerCase();
        const name = String(item.vm_group_name || item.name || '').toLowerCase();
        return name.includes(lower);
      }
      return true;
    });
  }, [elementGroups, groupSearch, groupTypeFilter, groupVendorFilter, groupDefendFilter]);

  const columnsGroups = React.useMemo(() => [
    { title: '名称', dataIndex: 'vm_group_name', key: 'name', render: (t:any,r:any)=> t || r?.name || '-' },
    { title: 'ID', dataIndex: 'vm_group_id', key: 'id', render: (t:any,r:any)=> t || r?.id || '-' },
    { title: '类型', dataIndex: 'vm_type', key: 'type', render: (t:any) => {
      const color = t === 'waf' ? 'blue' : t === 'ids' ? 'cyan' : t === 'fw' ? 'purple' : 'default';
      return <Tag color={color}>{t?.toUpperCase() || '-'}</Tag>;
    }},
    { title: '厂商', dataIndex: 'vendor_name', key: 'vendor', render: (t:any)=> t || '-' },
    { title: '防御类型', dataIndex: 'defend_type', key: 'defend_type', render: (t:any)=> {
      const map: any = { 1: '非流量型', 2: '流量型' };
      return map[t] || t || '-';
    }},
    { title: '网元数量', dataIndex: 'count', key: 'count', render: (t:any,r:any)=> {
      const c = t ?? r?.Count;
      if (c !== undefined) return c;
      return Array.isArray(r?.elements) ? r.elements.length : '-';
    }},
    { title: '成员列表', dataIndex: 'vm_id_list', key: 'members', width: 200, render: (t:any,r:any)=> {
      const list = t || (Array.isArray(r?.elements) ? r.elements.join(';') : '');
      if (!list) return '-';
      return (
        <Typography.Text style={{ width: 180 }} ellipsis={{ tooltip: list }} copyable={{ text: list }}>
          {list}
        </Typography.Text>
      );
    }},
    { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
      <ResourceActionsDropdown
        items={[
          { key: 'detail', label: '查看元数据' },
        ]}
        onClick={({ key }) => {
          if (key === 'detail') {
            Modal.info({
              title: '安全网元组元数据',
              width: 600,
              content: (
                <div style={{ maxHeight: 420, overflow: 'auto', background: '#f7f7f7', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
                  <pre style={{ margin: 0, fontSize: 12, lineHeight: '20px', fontFamily: 'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace' }}>
{JSON.stringify(record, null, 2)}
                  </pre>
                </div>
              )
            });
          }
        }}
        icon={<EllipsisOutlined />}
        size="small"
        buttonProps={{ style: { padding: 0 } }}
      />
    ) },
  ], []);

  const groupColumnOptions = React.useMemo(() => getColumnOptions(columnsGroups), [columnsGroups]);

  const columnsGroupsDisplay = React.useMemo(() => getDisplayColumns(columnsGroups, groupVisibleColumnKeys), [columnsGroups, groupVisibleColumnKeys]);

  const groupRowSelection = createRowSelection(groupSelectedRowKeys, setGroupSelectedRowKeys);

  const filteredVRouters = useMemo(() => {
    return vRouters.filter(item => {
      if (vRouterSearch) {
        const lower = vRouterSearch.toLowerCase();
        const id = String(item.vrouter_id || item.id || '').toLowerCase();
        const ip = String(item.vrouter_ip || '').toLowerCase();
        const hostIp = String(item.vrouter_host_ip || '').toLowerCase();
        return id.includes(lower) || ip.includes(lower) || hostIp.includes(lower);
      }
      return true;
    });
  }, [vRouters, vRouterSearch]);

  const columnsVRouters = React.useMemo(() => [
    { title: 'VSW ID', dataIndex: 'vrouter_id', key: 'id', render: (t: any, r: any) => t || r?.id || '-' },
    { title: 'IP地址', dataIndex: 'vrouter_ip', key: 'ip', render: (t: any) => t || '-' },
    { title: '宿主机IP', dataIndex: 'vrouter_host_ip', key: 'host_ip', render: (t: any) => t || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: any) => {
      const map: any = { 0: '正常', 1: '异常' };
      const colorMap: any = { 0: 'green', 1: 'red' };
      return <Tag color={colorMap[s] || 'default'}>{map[s] || s}</Tag>;
    }},
    { title: '虚机数量', key: 'vm_count', render: (_: any, r: any) => Array.isArray(r.vm_list) ? r.vm_list.length : 0 },
    { title: '端口数量', key: 'port_count', render: (_: any, r: any) => Array.isArray(r.vrouter_port_list) ? r.vrouter_port_list.length : 0 },
    { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
      <ResourceActionsDropdown
        items={[
          { key: 'detail', label: '查看详情' },
        ]}
        onClick={({ key }) => {
          if (key === 'detail') {
            Modal.info({
              title: 'VSW 详情',
              width: 600,
              content: (
                <div style={{ maxHeight: 420, overflow: 'auto', background: '#f7f7f7', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
                  <pre style={{ margin: 0, fontSize: 12, lineHeight: '20px', fontFamily: 'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace' }}>
{JSON.stringify(record, null, 2)}
                  </pre>
                </div>
              )
            });
          }
        }}
        icon={<EllipsisOutlined />}
        size="small"
        buttonProps={{ style: { padding: 0 } }}
      />
    ) },
  ], []);

  const vRouterColumnOptions = React.useMemo(() => getColumnOptions(columnsVRouters), [columnsVRouters]);

  const columnsVRoutersDisplay = React.useMemo(() => getDisplayColumns(columnsVRouters, vRouterVisibleColumnKeys), [columnsVRouters, vRouterVisibleColumnKeys]);

  const vRouterRowSelection = createRowSelection(vRouterSelectedRowKeys, setVRouterSelectedRowKeys);

  const columnsAssets = React.useMemo(() => [
    { title: '防护对象', dataIndex: 'value', key: 'value', render: (t: any) => t || '-' },
    { title: '资产ID', dataIndex: 'network_id', key: 'id', render: (t: any, r: any) => t || r?.id || r?.Id || r?.uuid || '-' },
    { title: '对象类型', dataIndex: 'type', key: 'type', render: (t: any) => {
      const map: any = { 'subnet': '子网', 'ip': 'IP', 'vpc': 'VPC' };
      return <Tag color="blue">{map[t] || t}</Tag>;
    }},
    { title: 'IP类型', dataIndex: 'ip_type', key: 'ip_type', render: (t: any) => t || '-' },
    { title: 'IP范围', dataIndex: 'value', key: 'value', render: (t: any) => t || '-' },
    { title: '端口范围', dataIndex: 'port', key: 'port', render: (t: any) => t || '-' },
    { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
      <ResourceActionsDropdown
        items={[
          { key: 'edit', label: '编辑' },
          { type: 'divider' as any },
          { key: 'delete', label: '删除', danger: true },
        ]}
        onClick={({ key }) => {
          const assetId = record.network_id || record.id || record.Id || record.uuid;
          if (key === 'edit') {
            setEditingAsset(record);
            assetEditForm.setFieldsValue({
              type: (record.type || 'ip'),
              ip_type: (record.ip_type || 'ipv4'),
              value: (record.value || ''),
              port: (record.port || '')
            });
            setAssetEditOpen(true);
            return;
          }
          if (key === 'delete') {
            Modal.confirm({
              title: '删除资产',
              content: `确定删除资产 ${assetId || ''} 吗？`,
              okText: '删除',
              okType: 'danger',
              cancelText: '取消',
              onOk: async () => {
                try {
                  if (!assetId) { message.warning('缺少资产ID'); return; }
                  await deleteCsmAsset(cloudId, String(assetId));
                  message.success('删除成功');
                  await loadAll();
                } catch (e:any) {
                  message.error(e.message || '删除失败');
                }
              }
            });
          }
        }}
        icon={<EllipsisOutlined />}
        size="small"
        buttonProps={{ style: { padding: 0 } }}
      />
    ) },
  ], [cloudId, setEditingAsset, assetEditForm, setAssetEditOpen, loadAll]);

  const columnsVirtual = React.useMemo(() => [
    { title: '名称', dataIndex: 'name', key: 'name', render: (t: any, r: any) => (
      <Button type="link" style={{ padding: 0 }} onClick={() => { setCurrentVm(r); setVmModalOpen(true); }}>
        {t || r?.vm_name || r?.Name || r?.displayName || '-'}
      </Button>
    )},
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: any) => {
      // Handle integer status from Table 26
      if (typeof s === 'number') {
        const map: any = { 0: '已关闭', 1: '正常', 2: '启动失败', 3: '启动中', 4: '部署中' };
        const colorMap: any = { 0: 'default', 1: 'green', 2: 'red', 3: 'blue', 4: 'processing' };
        return <Tag color={colorMap[s] || 'default'}>{map[s] || s}</Tag>;
      }
      const k = String(s || '').toLowerCase();
      const color = k.includes('run') ? 'green' : k.includes('stop') ? 'orange' : (k.includes('error') ? 'red' : 'blue');
      return <Tag color={color}>{s || '-'}</Tag>;
    } },
    { title: '管理IP', dataIndex: 'manage_ip', key: 'ip', width: 140, render: (t: any) => t || '-' },
    { title: '规格', key: 'spec', width: 120, render: (_: any, r: any) => {
      if (r.vm_summary) return r.vm_summary;
      const cpu = r.cpu ? `${r.cpu}C` : '';
      const mem = r.memory ? `${r.memory}G` : '';
      if (cpu || mem) return `${cpu} ${mem}`.trim();
      return '-';
    } },
    { title: '类型', dataIndex: 'vm_type', key: 'type', width: 100, render: (t: any, r: any) => t || r?.Type || '-' },
    { title: '版本', dataIndex: 'vm_version', key: 'version', width: 120, render: (t: any) => t || '-' },
    { title: '厂商', dataIndex: 'vm_vendor', key: 'vendor', width: 100, render: (t: any) => t || '-' },
    { title: '模板', dataIndex: 'template_name', key: 'template', ellipsis: true, render: (t: any) => t || '-' },
    { title: '宿主机ID', dataIndex: 'host_id', key: 'host', ellipsis: true, render: (t: any) => t || '-' },
    { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
      <ResourceActionsDropdown
        items={[
          { key: 'detail', label: '查看元数据' },
          { key: 'start', label: '开机' },
          { key: 'reboot', label: '重启' },
          { key: 'console', label: '控制台' },
          { key: 'sso', label: 'SSO登录' },
          { type: 'divider' as any },
          { key: 'stop', label: '关机', danger: true },
        ]}
        onClick={({ key }) => {
          if (key === 'detail') {
            Modal.info({
              title: '虚拟安全网元元数据',
              width: 600,
              content: (
                <div style={{ maxHeight: 420, overflow: 'auto', background: '#f7f7f7', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
                  <pre style={{ margin: 0, fontSize: 12, lineHeight: '20px', fontFamily: 'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace' }}>
{JSON.stringify(record, null, 2)}
                  </pre>
                </div>
              )
            });
            return;
          }
          if (key === 'start') return handleSingleOperation(record, 'start');
          if (key === 'stop') return handleSingleOperation(record, 'stop');
          if (key === 'reboot') return handleSingleOperation(record, 'reboot');
          if (key === 'console') return handleConsole(record);
          if (key === 'sso') {
            const vmId = record.id || record.Id || record.uuid || record.vm_id;
            if (!vmId) { message.warning('未找到虚机ID'); return; }
            const port = '8011';
            const hide = message.loading('正在发起 SSO 登录...', 0);
            csmSsoLogin(cloudId, String(vmId), port).then((res: any) => {
              hide();
              const raw = res?.data?.data?.url || res?.data?.url || res?.url || '';
              const url = String(raw || '').trim().replace(/^[`'"]|[`'"]$/g, '');
              const steps = res?.data?.steps || res?.steps || {};
              const authStep = steps?.auth;
              const adminStep = steps?.getAdmin;
              const ssoStep = steps?.sso;
              if (url) {
                const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                window.open(url, 'csm-sso', features);
              }
              Modal.info({
                title: 'SSO 返回',
                width: '90vw',
                centered: true,
                styles: {
                  content: { height: '90vh', display: 'flex', flexDirection: 'column' },
                  body: { flex: 1, overflow: 'auto' }
                },
                content: (
                  <div>
                    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%' }}>
                      {url ? (
                        <div style={{ marginBottom: 12 }}>
                          <a href={url} target="_blank" rel="noreferrer">{url}</a>
                        </div>
                      ) : null}
                      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 12, height: '100%' }}>
                        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 0 }}>
                          <div style={{ fontWeight: 600 }}>步骤1 · 鉴权（请求体 / 返回值）</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                            <pre style={{ height: 240, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(authStep?.request ?? null, null, 2)}</pre>
                            <pre style={{ height: 240, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(authStep?.response ?? null, null, 2)}</pre>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 0 }}>
                          <div style={{ fontWeight: 600 }}>步骤2 · 管理员信息（请求体 / 返回值）</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                            <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(adminStep?.request ?? null, null, 2)}</pre>
                            <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(adminStep?.response ?? null, null, 2)}</pre>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 0 }}>
                          <div style={{ fontWeight: 600 }}>步骤3 · SSO返回（请求体 / 返回值）</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                            <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(ssoStep?.request ?? null, null, 2)}</pre>
                            <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(ssoStep?.response ?? null, null, 2)}</pre>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              });
            }).catch((e: any) => {
              hide();
              message.error(e?.message || 'SSO 登录失败');
            });
          }
        }}
        icon={<EllipsisOutlined />}
        size="small"
        buttonProps={{ style: { padding: 0 } }}
      />
    ) },
  ], [cloudId, setCurrentVm, setVmModalOpen, handleSingleOperation, handleConsole]);

  React.useEffect(() => {
    const initKeys = columnsVirtual.map((c: any) => c.key).filter((k: string) => k !== 'action');
    setVisibleColumnKeys(initKeys);
  }, [columnsVirtual]);

  const columnOptions = React.useMemo(() => getColumnOptions(columnsVirtual), [columnsVirtual]);

  const columnsVirtualDisplay = React.useMemo(() => getDisplayColumns(columnsVirtual, visibleColumnKeys), [columnsVirtual, visibleColumnKeys]);

  const filteredAssets = useMemo(() => {
    return (assets || []).filter((item: any) => {
      if (assetType) {
        const t = String(item.type || '').trim();
        if (t !== assetType) return false;
      }
      if (assetIpType) {
        const ipt = String(item.ip_type || '').trim();
        if (ipt !== assetIpType) return false;
      }
      if (assetPort && String(assetPort).trim().length > 0) {
        const pt = String(item.port ?? '').trim();
        if (pt !== String(assetPort).trim()) return false;
      }
      if (assetSearch) {
        const lower = assetSearch.toLowerCase();
        const id = String(item.network_id || item.id || item.uuid || '').toLowerCase();
        const value = String(item.value || '').toLowerCase();
        const type = String(item.type || '').toLowerCase();
        return id.includes(lower) || value.includes(lower) || type.includes(lower);
      }
      return true;
    });
  }, [assets, assetType, assetIpType, assetPort, assetSearch]);

  const assetColumnOptions = React.useMemo(() => getColumnOptions(columnsAssets), [columnsAssets]);

  const columnsAssetsDisplay = React.useMemo(() => getDisplayColumns(columnsAssets, assetVisibleColumnKeys), [columnsAssets, assetVisibleColumnKeys]);

  const assetRowSelection = createRowSelection(assetSelectedRowKeys, setAssetSelectedRowKeys, {
    getCheckboxProps: (record: any) => ({
      value: record.network_id || record.id || record.Id || record.uuid
    })
  });

  const handleBatchDeleteAssets = async () => {
    if (!assetSelectedRowKeys.length) return;
    Modal.confirm({
      title: '批量删除资产',
      content: `确定删除选中的 ${assetSelectedRowKeys.length} 项资产吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          let ok = 0; let fail = 0;
          for (const k of assetSelectedRowKeys) {
            try {
              await deleteCsmAsset(cloudId, String(k));
              ok++;
            } catch {
              fail++;
            }
          }
          if (fail === 0) message.success('批量删除成功');
          else message.warning(`删除完成：成功 ${ok}，失败 ${fail}`);
          setAssetSelectedRowKeys([]);
          await loadAll();
        } catch (e:any) {
          message.error(e.message || '批量删除失败');
        }
      }
    });
  };

  const handleCreateAsset = async () => {
    try {
      const values = await assetForm.validateFields();
      const payload: any = {
        type: values.type,
        ip_type: values.ip_type,
        value: values.value
      };
      if (values.port) payload.port = String(values.port).trim();
      await createCsmAsset(cloudId, payload);
      message.success('创建成功');
      setAssetCreateOpen(false);
      assetForm.resetFields();
      await loadAll();
    } catch (e:any) {
      if (e?.errorFields) return;
      message.error(e.message || '创建失败');
    }
  };

  const handleEditAsset = async () => {
    try {
      const values = await assetEditForm.validateFields();
      const assetId = editingAsset?.network_id || editingAsset?.id || editingAsset?.uuid;
      if (!assetId) { message.warning('缺少资产ID'); return; }
      await deleteCsmAsset(cloudId, String(assetId));
      const payload: any = { type: values.type, ip_type: values.ip_type, value: values.value };
      if (values.port) payload.port = String(values.port).trim();
      await createCsmAsset(cloudId, payload);
      message.success('更新成功');
      setAssetEditOpen(false);
      setEditingAsset(null);
      await loadAll();
    } catch (e:any) {
      if (e?.errorFields) return;
      message.error(e.message || '更新失败');
    }
  };

  return (
    <PageDetailContainer
      breadcrumbs={[
        { title: <HomeOutlined />, href: '/' },
        { title: '资源控制台' },
        { title: '资源池管理', href: '/admin/clouds' },
        { title: `CSM ${cloud?.name || '-'}` }
      ]}
      icon={<CloudUploadOutlined />}
      title={`CSM ${cloud?.name || '-'}`}
      titleLevel={3}
      extra={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/clouds')}></Button>
          <Dropdown
            menu={{
              items: [
                { key: 'refresh', label: '资源刷新' },
                { key: 'toggleLog', label: (showLog ? '隐藏日志' : '显示日志') },
              ],
              onClick: ({ key }) => {
                if (key === 'refresh') { loadAll(); return; }
                if (key === 'toggleLog') { setShowLog(v => !v); return; }
              },
            }}
          >
            <Button icon={<UnorderedListOutlined />} />
          </Dropdown>
        </Space>
      }
      asCard={false}
      subtitle="CSM 详情（独立页面），汇总平台内资源与网络"
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">CSM</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">{cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Endpoint">
            <Space>
              {cloud?.endpoint || '-'}
              {cloud?.endpoint && (
                <Button
                  type="link"
                  size="small"
                  icon={<LoginOutlined />}
                  style={{ padding: 0 }}
                  title="在新窗口打开"
                  onClick={() => {
                    let url = cloud.endpoint || '';
                    if (url.endsWith('/v3')) {
                      url = url.substring(0, url.length - 3);
                    } else if (url.endsWith('/v3/')) {
                      url = url.substring(0, url.length - 4);
                    }
                    window.open(url, '_blank');
                  }}
                >
                  打开
                </Button>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="版本">{versionText}</Descriptions.Item>
          <Descriptions.Item label="TLS 忽略">{tlsIgnored ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}
    >
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16 }} showIcon />
      )}
      <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: (
              <Space size={4}>
                <AppstoreOutlined />
                <span>资源总览</span>
              </Space>
            ),
            children: (
              <>
                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><DeploymentUnitOutlined style={{ color:'#1677ff', marginRight:8 }} />虚拟安全网元</span>} value={virtualElements.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />物理主机</span>} value={physicalElements.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><SafetyCertificateOutlined style={{ color:'#1677ff', marginRight:8 }} />安全网元组</span>} value={elementGroups.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><UnorderedListOutlined style={{ color:'#1677ff', marginRight:8 }} />服务链</span>} value={serviceChains.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><DeploymentUnitOutlined style={{ color:'#1677ff', marginRight:8 }} />VSW 集群</span>} value={vRouters.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={6}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><DesktopOutlined style={{ color:'#1677ff', marginRight:8 }} />资产列表</span>} value={assets.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                </Row>
              </>
            )
          },
          {
            key: 'physical',
            label: (
              <Space size={4}>
                <NodeIndexOutlined />
                <span>物理主机</span>
                <span>({physicalElements.length})</span>
              </Space>
            ),
            children: (
              <>
                <SharedToolbar
                  left={
                    <Input
                      placeholder="搜索主机名称/管理IP"
                      prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                      value={physicalSearch}
                      onChange={(e) => setPhysicalSearch(e.target.value)}
                      style={{ width: 220 }}
                      allowClear
                    />
                  }
                  right={
                    <Space size={8}>
                      <Popover
                        trigger="click"
                        placement="bottomRight"
                        content={(
                          <div style={{ width: 720 }}>
                            <Checkbox.Group
                              value={physicalVisibleColumnKeys.filter(k => k !== 'action')}
                              onChange={(vals) => setPhysicalVisibleColumnKeys([...(vals as string[]), 'action'])}
                            >
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {physicalColumnOptions.map((opt: any) => (
                                  <Checkbox key={String(opt.value)} value={opt.value}>{opt.label}</Checkbox>
                                ))}
                              </div>
                            </Checkbox.Group>
                          </div>
                        )}
                      >
                        <Button icon={<SettingOutlined />} />
                      </Popover>
                      <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading} />
                    </Space>
                  }
                />
                <Table
                  bordered
                  rowSelection={physicalRowSelection}
                  rowKey={(r:any)=> r.host_id || r.id || r.Id || r.uuid}
                  columns={columnsHostsDisplay as any}
                  dataSource={filteredPhysicalElements}
                  loading={loading}
                  pagination={{
                    size: 'small',
                    showTotal: (total) => `共 ${total} 条`,
                  }}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawPhysical, null, 2)}</pre></div>)}
              </>
            )
          },
          {
            key: 'vrouters',
            label: (
              <Space size={4}>
                <DeploymentUnitOutlined />
                <span>VSW 集群</span>
                <span>({vRouters.length})</span>
              </Space>
            ),
            children: (
              <>
                <SharedToolbar
                  left={
                    <Input
                      placeholder="搜索ID/IP/宿主机IP"
                      prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                      value={vRouterSearch}
                      onChange={(e) => setVRouterSearch(e.target.value)}
                      style={{ width: 220 }}
                      allowClear
                    />
                  }
                  right={
                    <Space size={8}>
                      <Popover
                        trigger="click"
                        placement="bottomRight"
                        content={(
                          <div style={{ width: 720 }}>
                            <Checkbox.Group
                              value={vRouterVisibleColumnKeys.filter(k => k !== 'action')}
                              onChange={(vals) => setVRouterVisibleColumnKeys([...(vals as string[]), 'action'])}
                            >
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {vRouterColumnOptions.map((opt: any) => (
                                  <Checkbox key={String(opt.value)} value={opt.value}>{opt.label}</Checkbox>
                                ))}
                              </div>
                            </Checkbox.Group>
                          </div>
                        )}
                      >
                        <Button icon={<SettingOutlined />} />
                      </Popover>
                      <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading} />
                    </Space>
                  }
                />
                <Table
                  bordered
                  rowSelection={vRouterRowSelection}
                  columns={columnsVRoutersDisplay as any}
                  dataSource={filteredVRouters}
                  rowKey={(r: any) => r.vrouter_id || r.id || r.Id || r.uuid || Math.random().toString()}
                  pagination={{
                    size: 'small',
                    showTotal: (total) => `共 ${total} 条`,
                  }}
                  loading={loading}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVRouters, null, 2)}</pre></div>)}
              </>
            )
          },
          {
            key: 'assets',
            label: (
              <Space size={4}>
                <DesktopOutlined />
                <span>资产列表</span>
                <span>({assets.length})</span>
              </Space>
            ),
            children: (
              <>
                <SharedToolbar
                  left={
                    <>
                      <Input
                        placeholder="搜索资产ID/值/类型"
                        prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                        value={assetSearch}
                        onChange={(e)=> setAssetSearch(e.target.value)}
                        style={{ width: 220 }}
                        allowClear
                      />
                      <Select
                        allowClear
                        placeholder="类型"
                        value={assetType}
                        onChange={(v)=> setAssetType(v || undefined)}
                        style={{ width: 140 }}
                        options={[
                          { label: 'IP', value: 'ip' },
                          { label: '子网', value: 'subnet' },
                          { label: 'VPC', value: 'vpc' },
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="IP类型"
                        value={assetIpType}
                        onChange={(v)=> setAssetIpType(v || undefined)}
                        style={{ width: 140 }}
                        options={[
                          { label: 'IPv4', value: 'ipv4' },
                          { label: 'IPv6', value: 'ipv6' },
                        ]}
                      />
                      <Input
                        placeholder="端口"
                        value={assetPort}
                        onChange={(e)=> setAssetPort(e.target.value)}
                        style={{ width: 100 }}
                        allowClear
                      />
                    </>
                  }
                  right={
                    <Space size={8}>
                      <Button type="primary" onClick={()=> setAssetCreateOpen(true)}>创建资产</Button>
                      <ResourceActionsDropdown
                        items={[
                          { key: 'batch_delete', label: '批量删除', danger: true, disabled: assetSelectedRowKeys.length === 0 },
                        ]}
                        onClick={({ key }) => {
                          if (key === 'batch_delete') handleBatchDeleteAssets();
                        }}
                        buttonType="default"
                        icon={<EllipsisOutlined />}
                      />
                      <Popover
                        trigger="click"
                        placement="bottomRight"
                        content={(
                          <div style={{ width: 720 }}>
                            <Checkbox.Group
                              value={assetVisibleColumnKeys.filter(k=> k!=='action')}
                              onChange={(vals) => setAssetVisibleColumnKeys([...(vals as string[]), 'action'])}
                            >
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {assetColumnOptions.map((opt: any) => (
                                  <Checkbox key={String(opt.value)} value={opt.value}>{opt.label}</Checkbox>
                                ))}
                              </div>
                            </Checkbox.Group>
                          </div>
                        )}
                      >
                        <Button icon={<SettingOutlined />} />
                      </Popover>
                      <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading} />
                    </Space>
                  }
                />
                <Table
                  bordered
                  rowSelection={assetRowSelection}
                  columns={columnsAssetsDisplay as any}
                  dataSource={filteredAssets}
                  rowKey={(r: any) => r.network_id || r.id || r.Id || r.uuid || Math.random().toString()}
                  pagination={{
                    size: 'small',
                    showTotal: (total) => `共 ${total} 条`,
                  }}
                  loading={loading}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawAssets, null, 2)}</pre></div>)}
                <Modal
                  title="创建资产"
                  open={assetCreateOpen}
                  onCancel={()=> setAssetCreateOpen(false)}
                  onOk={handleCreateAsset}
                  okText="创建"
                >
                  <Form form={assetForm} layout="vertical">
                    <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                      <Select options={[{label:'IP', value:'ip'}, {label:'子网', value:'subnet'}, {label:'VPC', value:'vpc'}]} />
                    </Form.Item>
                    <Form.Item name="ip_type" label="IP类型" initialValue="ipv4" rules={[{ required: true }]}>
                      <Select options={[{label:'IPv4', value:'ipv4'}, {label:'IPv6', value:'ipv6'}]} />
                    </Form.Item>
                    <Form.Item name="value" label="值" rules={[{ required: true }]}>
                      <Input placeholder="如 10.0.0.1 或 10.0.0.0/24" />
                    </Form.Item>
                    <Form.Item name="port" label="端口" tooltip="可选">
                      <Input placeholder="可选：端口号" />
                    </Form.Item>
                  </Form>
                </Modal>
                <Modal
                  title="编辑资产"
                  open={assetEditOpen}
                  onCancel={()=> { setAssetEditOpen(false); setEditingAsset(null); }}
                  onOk={handleEditAsset}
                  okText="保存"
                >
                  <Form form={assetEditForm} layout="vertical">
                    <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                      <Select options={[{label:'IP', value:'ip'}, {label:'子网', value:'subnet'}, {label:'VPC', value:'vpc'}]} />
                    </Form.Item>
                    <Form.Item name="ip_type" label="IP类型" rules={[{ required: true }]}>
                      <Select options={[{label:'IPv4', value:'ipv4'}, {label:'IPv6', value:'ipv6'}]} />
                    </Form.Item>
                    <Form.Item name="value" label="值" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="port" label="端口" tooltip="可选">
                      <Input />
                    </Form.Item>
                  </Form>
                </Modal>
              </>
            )
          },
          {
            key: 'virtual',
            label: (
              <Space size={4}>
                <DeploymentUnitOutlined />
                <span>虚拟安全网元</span>
                <span>({virtualElements.length})</span>
              </Space>
            ),
            children: (
              <>
                <SharedToolbar
                  left={
                    <>
                      <Input
                        placeholder="搜索名称/IP/类型/厂商"
                        prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        style={{ width: 200 }}
                        allowClear
                      />
                      <Select
                        value={filterStatus}
                        onChange={setFilterStatus}
                        style={{ width: 120 }}
                        options={[
                          { label: '全部状态', value: 'all' },
                          { label: '运行中', value: 'running' },
                          { label: '已停止', value: 'stopped' },
                          { label: '故障', value: 'error' },
                          { label: '其他', value: 'other' },
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="类型"
                        value={typeFilter || undefined}
                        onChange={(v) => setTypeFilter(v || '')}
                        style={{ width: 140 }}
                        options={[
                          ...Array.from(new Set((virtualElements || []).map((r: any) => String(r?.vm_type || r?.Type || '').trim()).filter(Boolean))).map(t => ({ label: t, value: t }))
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="厂商"
                        value={vendorFilter || undefined}
                        onChange={(v) => setVendorFilter(v || '')}
                        style={{ width: 140 }}
                        options={[
                          ...Array.from(new Set((virtualElements || []).map((r: any) => String(r?.vm_vendor || '').trim()).filter(Boolean))).map(v => ({ label: v, value: v }))
                        ]}
                      />
                      
                    </>
                  }
                  right={
                    <Space size={8}>
                      <ResourceActionsDropdown
                        items={[
                          { key: 'batch_start', label: '批量开机', disabled: selectedRowKeys.length === 0 },
                          { key: 'batch_stop', label: '批量关机', danger: true, disabled: selectedRowKeys.length === 0 },
                          { key: 'batch_reboot', label: '批量重启', disabled: selectedRowKeys.length === 0 },
                          { type: 'divider' as any },
                          { key: 'single_console', label: '打开控制台（单选）', disabled: selectedRowKeys.length !== 1 },
                        ]}
                        onClick={({ key }) => {
                          if (key === 'batch_start') return handleBatchOperation('start');
                          if (key === 'batch_stop') return handleBatchOperation('stop');
                          if (key === 'batch_reboot') return handleBatchOperation('reboot');
                          if (key === 'single_console') {
                            const r = filteredVirtualElements.find(v => (v.id || v.Id || v.uuid || v.vm_id) === selectedRowKeys[0]);
                            if (r) handleConsole(r);
                          }
                        }}
                        buttonType="default"
                        icon={<EllipsisOutlined />}
                      />
                      <Popover
                        trigger="click"
                        placement="bottomRight"
                        content={(
                          <div style={{ width: 720 }}>
                            <Checkbox.Group
                              value={visibleColumnKeys}
                              onChange={(vals) => setVisibleColumnKeys(vals as string[])}
                            >
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {columnOptions.map((opt: any) => (
                                  <Checkbox key={String(opt.value)} value={opt.value}>{opt.label}</Checkbox>
                                ))}
                              </div>
                            </Checkbox.Group>
                          </div>
                        )}
                      >
                        <Button icon={<SettingOutlined />} />
                      </Popover>
                      <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading} />
                    </Space>
                  }
                />
                <Table
                  bordered
                  rowSelection={rowSelection}
                  rowKey={(r:any)=> r.id || r.Id || r.uuid || r.vm_id}
                  columns={columnsVirtualDisplay as any}
                  dataSource={filteredVirtualElements}
                  loading={loading}
                  pagination={{
                    size: 'small',
                    showTotal: (total) => `共 ${total} 条`,
                  }}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVirtual, null, 2)}</pre></div>)}
              </>
            )
          },
          {
            key: 'groups',
            label: (
              <Space size={4}>
                <SafetyCertificateOutlined />
                <span>安全网元组</span>
                <span>({elementGroups.length})</span>
              </Space>
            ),
            children: (
              <>
                <SharedToolbar
                  left={
                    <>
                      <Input
                        placeholder="搜索网元组名称"
                        prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
                        value={groupSearch}
                        onChange={(e) => setGroupSearch(e.target.value)}
                        style={{ width: 220 }}
                        allowClear
                      />
                      <Select
                        allowClear
                        placeholder="类型"
                        value={groupTypeFilter || undefined}
                        onChange={(v) => setGroupTypeFilter(v || '')}
                        style={{ width: 140 }}
                        options={[
                          ...Array.from(new Set((elementGroups || []).map((r: any) => r?.vm_type).filter(Boolean))).map(t => ({ label: t, value: t }))
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="厂商"
                        value={groupVendorFilter || undefined}
                        onChange={(v) => setGroupVendorFilter(v || '')}
                        style={{ width: 140 }}
                        options={[
                          ...Array.from(new Set((elementGroups || []).map((r: any) => r?.vendor_name).filter(Boolean))).map(v => ({ label: v, value: v }))
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="防御类型"
                        value={groupDefendFilter || undefined}
                        onChange={(v) => setGroupDefendFilter(v || '')}
                        style={{ width: 140 }}
                        options={[
                          { label: '非流量型', value: '1' },
                          { label: '流量型', value: '2' },
                        ]}
                      />
                    </>
                  }
                  right={
                    <Space size={8}>
                      <Popover
                        trigger="click"
                        placement="bottomRight"
                        content={(
                          <div style={{ width: 720 }}>
                            <Checkbox.Group
                              value={groupVisibleColumnKeys.filter(k => k !== 'action')}
                              onChange={(vals) => setGroupVisibleColumnKeys([...(vals as string[]), 'action'])}
                            >
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {groupColumnOptions.map((opt: any) => (
                                  <Checkbox key={String(opt.value)} value={opt.value}>{opt.label}</Checkbox>
                                ))}
                              </div>
                            </Checkbox.Group>
                          </div>
                        )}
                      >
                        <Button icon={<SettingOutlined />} />
                      </Popover>
                      <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading} />
                    </Space>
                  }
                />
                <Table
                  bordered
                  rowSelection={groupRowSelection}
                  rowKey={(r:any)=> r.id || r.Id || r.uuid}
                  columns={columnsGroupsDisplay as any}
                  dataSource={filteredGroups}
                  loading={loading}
                  pagination={{
                    size: 'small',
                    showTotal: (total) => `共 ${total} 条`,
                  }}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawGroups, null, 2)}</pre></div>)}
              </>
            )
          },
          {
            key: 'serviceChains',
            label: (
              <Space size={4}>
                <UnorderedListOutlined />
                <span>服务链</span>
                <span>({serviceChains.length})</span>
              </Space>
            ),
            children: <CsmServiceChainSection cloudId={cloudId} showLog={showLog} />
          },
        ]}
      />
      <CsmVmDetailModal
        open={vmModalOpen}
        onClose={() => setVmModalOpen(false)}
        vm={currentVm}
        cloudId={cloudId}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailCsm;
