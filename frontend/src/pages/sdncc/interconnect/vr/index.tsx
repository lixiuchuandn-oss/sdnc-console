import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MenuProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Dropdown,
  Form,
  Input,
  message,
  Modal,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Tabs,
  Tag,
  Tooltip,
  TreeSelect,
  Typography,
} from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageContainer from '../../../../components/PageContainer';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import StdFormModal from '../../../../components/StdFormModal';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import {
  apiPost,
  bindTenantVR,
  fetchAvailableResourcePools,
  fetchCloudProviderEcs,
  fetchCloudVpcs,
  fetchOrganizationsByTenant,
  fetchOrganizationResourcePools,
  fetchTenants,
} from '../../../../services/api';
import { listSecurityDomains } from '../../../../services/securityDomainApi';
import { getSystemSetting, updateSystemSetting } from '../../../../services/systemApi';
import {
  fetchVrCachePageList,
  getVRConfig,
  saveVRConfig,
  setVRRole,
} from '../../../../services/virtualRouterApi';
import { getDomainClass, netClassColor, netClassLabel } from '../../../../utils/netClass';
import { commonBadgeStyles, commonTableStyles, commonTagStyles } from '../../../../utils/tableStyles';

import { VrDetailDrawer } from './VrDetailDrawer';

interface VRRow {
  id?: string;
  vm_id?: string;
  name?: string;
  status?: string;
  pool_id?: string | number;
  pool_name?: string;
  cpu?: number;
  memory?: number;
  mac?: string;
  uuid?: string;
  version?: string;
  create_time?: string;
  vr_unique_id?: string;
  tenant_id?: string;
  org_id?: string;
  bind_status?: string;
  [key: string]: any;
}

/** 解析行内 JSON 字符串字段；解析失败返回 null */
function parseJsonField(val: unknown): unknown {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return val;
}

function formatTrafficRateBps(bps: number): string {
  if (!bps) return '0 bps';
  if (bps >= 1000 * 1000) return `${(bps / 1000 / 1000).toFixed(2)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(2)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

type VrHealthStatusKey = 'running' | 'warning' | 'stopped' | 'unknown';

function getVrHealthStatusKey(raw: unknown): VrHealthStatusKey {
  const v = String(raw || '').toLowerCase();
  if (['healthy', 'running', 'ok', 'online', 'active'].includes(v)) return 'running';
  if (['warning', 'degraded'].includes(v)) return 'warning';
  if (['error', 'failed', 'unhealthy', 'offline', 'stopped'].includes(v)) return 'stopped';
  return 'unknown';
}

/** 与 useTableColumnSettings / TableColumnSettingsButton 的默认隐藏列一致 */
const VR_TABLE_COL_SETTINGS_DEFAULT_HIDDEN = [
  'mac',
  'type',
  'pool_name',
  'pool_id',
  'vm_id',
  'tenant_id',
  'org_id',
];

const VRPage: React.FC = () => {
  const navigate = useNavigate();
  const [vrs, setVrs] = useState<VRRow[]>([]);
  const [columns, setColumns] = useState<ColumnsType<VRRow>>([]);
  const { displayColumns: vrDisplayColumns } = useTableColumnSettings(
    columns,
    'interconnect_vr_instances',
    VR_TABLE_COL_SETTINGS_DEFAULT_HIDDEN,
  );

  const [loading, setLoading] = useState<boolean>(false);
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [tenantFilter, setTenantFilter] = useState<string | undefined>();
  const [rolesMap, setRolesMap] = useState<Record<string, string>>({});
  const rolesMapRef = useRef<Record<string, string>>({});
  const [netClassMap, setNetClassMap] = useState<Record<string, any>>({});
  const netClassMapRef = useRef<Record<string, any>>({});
  const [tenantOptions, setTenantOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [tenantLoading, setTenantLoading] = useState<boolean>(false);
  const [orgNameMap, setOrgNameMap] = useState<Record<string, string>>({});
  const orgTenantLoadedRef = useRef<Record<string, boolean>>({});
  const tenantOptionsRef = useRef<any[]>([]);
  const orgNameMapRef = useRef<Record<string, string>>({});
  /** CE 配置弹窗提交时使用的 VR UUID（打开弹窗时应写入） */
  const ceTargetVrUuidRef = useRef<string | null>(null);

  // —— 弹窗与抽屉状态（集中声明，便于对照） ——
  const [ceModalOpen, setCeModalOpen] = useState(false);
  const [ceForm] = Form.useForm();
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<VRRow | null>(null);
  const [tunnelModalOpen, setTunnelModalOpen] = useState(false);
  const [tunnelForm] = Form.useForm();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsForm] = Form.useForm();
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [bindForm] = Form.useForm();
  const [currentBindVr, setCurrentBindVr] = useState<VRRow | null>(null);
  const [orgTreeData, setOrgTreeData] = useState<any[]>([]);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [selectedRoleType, setSelectedRoleType] = useState('标准');
  const [roleVrUuid, setRoleVrUuid] = useState<string | null>(null);
  const [resourcePoolOptions, setResourcePoolOptions] = useState<any[]>([]);
  const [vmOptions, setVmOptions] = useState<any[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editMode, setEditMode] = useState<string>('manual');
  const [selectedSyncPool, setSelectedSyncPool] = useState<string | undefined>();
  const [selectedSyncVpc, setSelectedSyncVpc] = useState<string | undefined>();
  const [selectedSyncVm, setSelectedSyncVm] = useState<string | undefined>();
  const [vpcOptions, setVpcOptions] = useState<any[]>([]);
  const [rawVms, setRawVms] = useState<any[]>([]);

  const loadTenants = async () => {
    setTenantLoading(true);
    try {
      const res = await fetchTenants();
      const list = (res?.data || res || []) as any[];
      const opts = Array.isArray(list)
        ? list.map(t => ({ value: String((t as any).id || (t as any)._id || ''), label: String((t as any).name || (t as any).username || '未命名租户') }))
        : [];
      setTenantOptions(opts);
      tenantOptionsRef.current = opts;
    } catch (e) {
      setTenantOptions([]);
      tenantOptionsRef.current = [];
    } finally {
      setTenantLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  useEffect(() => {
    tenantOptionsRef.current = tenantOptions;
  }, [tenantOptions]);

  useEffect(() => {
    orgNameMapRef.current = orgNameMap;
  }, [orgNameMap]);

  useEffect(() => {
    (async () => {
      if (!tenantOptions.length) return;
      const newOrgMap: Record<string, string> = {};
      const tasks = tenantOptions
        .map(t => String(t.value))
        .filter(tid => !!tid && !orgTenantLoadedRef.current[tid])
        .map(async tid => {
          try {
            const tree = await fetchOrganizationsByTenant(tid);
            const list = Array.isArray(tree) ? tree : (Array.isArray((tree as any)?.data) ? (tree as any).data : []);
            const flat: any[] = [];
            const recur = (nodes: any[]) => {
              nodes.forEach((n: any) => {
                if (!n) return;
                flat.push(n);
                if (Array.isArray(n.children) && n.children.length) recur(n.children);
              });
            };
            recur(list);
            flat.forEach((o: any) => {
              const id = String(o.id || '');
              if (!id) return;
              const name = String(o.name || id);
              newOrgMap[id] = name;
            });
            orgTenantLoadedRef.current[tid] = true;
          } catch {
          }
        });
      if (tasks.length) {
        await Promise.all(tasks);
        if (Object.keys(newOrgMap).length > 0) {
          setOrgNameMap(prev => ({ ...prev, ...newOrgMap }));
        }
      }
    })();
  }, [tenantOptions]);

  const loadResourcePools = async (orgId?: string) => {
    try {
      let res;
      if (orgId) {
        res = await fetchOrganizationResourcePools(orgId);
      } else {
        res = await fetchAvailableResourcePools();
      }
      const list = Array.isArray(res) ? res : (res?.data || []);
      setResourcePoolOptions(list.map((p: any) => {
        const pool = p.cloud || p;
        return { 
          label: `${pool.name} (${pool.id})`, 
          value: pool.id,
          originalName: pool.name
        };
      }));
    } catch (e) {
      console.error('Failed to load resource pools', e);
      setResourcePoolOptions([]);
    }
  };

  const loadVms = async (poolId: string) => {
    try {
      const res = await fetchCloudProviderEcs(poolId);
      const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
      setRawVms(list);
      setVmOptions(list.map((v: any) => ({ label: v.name || v.id, value: v.id })));
    } catch (e) {
      console.error('Failed to load VMs', e);
      setRawVms([]);
      setVmOptions([]);
    }
  };

  const loadVpcs = async (poolId: string) => {
    try {
      const res = await fetchCloudVpcs(poolId);
      // Harvester/KubeOVN returns { data: { items: [] } } or { items: [] }
      const list = Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.data) ? res.data : (Array.isArray(res?.items) ? res.items : []));
      setVpcOptions(list.map((v: any) => ({
         label: v.spec?.name || v.metadata?.name || v.name || v.id,
         value: v.metadata?.name || v.name || v.id
      })));
    } catch (e) {
      console.error('Failed to load VPCs', e);
      setVpcOptions([]);
    }
  };

  const getActionMenu = (row: VRRow): MenuProps['items'] => ([
    { key: 'metadata', label: '查看详情' },
    { key: 'editDevice', label: '编辑设备信息' },
    { key: 'bindOrg', label: '绑定组织' },
    { type: 'divider' },
    { key: 'role', label: '设置角色', danger: true },
    { key: 'editConfig', label: '专家模式', danger: true },
  ]);

  const handleSettingsOpen = async () => {
    setSettingsModalOpen(true);
    setSettingsLoading(true);
    try {
      const res = await getSystemSetting('CSMCTL_ADDRESS');
      if (res && res.value) {
        settingsForm.setFieldsValue({ address: res.value });
      } else {
         // Default value
         settingsForm.setFieldsValue({ address: 'https://10.20.255.93:8016' });
      }
    } catch (e) {
      console.error('Failed to load settings', e);
      // Fallback default
      settingsForm.setFieldsValue({ address: 'https://10.20.255.93:8016' });
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleSettingsSave = async () => {
    try {
      const values = await settingsForm.validateFields();
      setSettingsLoading(true);
      await updateSystemSetting('CSMCTL_ADDRESS', values.address);
      message.success('设置已保存');
      setSettingsModalOpen(false);
    } catch (e: any) {
      message.error(`保存失败: ${e.message || e}`);
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleRowActionClick = (row: VRRow): MenuProps['onClick'] => ({ key, domEvent }) => {
    domEvent?.stopPropagation?.();
    // CSMCTL/VRConfig 相关接口使用的是 VR 的 uuid（而不是数据库自增 id）
    const vrUuid = String(row.uuid || row.vr_unique_id || row.vm_id || '').trim();
    if (key === 'metadata') {
      setDetailRow(row);
      setDetailDrawerOpen(true);
      return;
    }
    if (key === 'editConfig') {
      if (vrUuid) {
        navigate(`/admin/interconnect/vr/${vrUuid}/config`);
      } else {
        message.warning('该行缺少可识别的UUID');
      }
    } else if (key === 'detail') {
      message.info('查看设备详情（功能待设计）');
    } else if (key === 'role') {
      if (!vrUuid) return message.warning('该行缺少可识别的UUID');
      setRoleVrUuid(vrUuid);
      
      // Default selection logic
      if (row.role && ['PE','CE','SASE','标准'].includes(row.role)) {
         setSelectedRoleType(row.role);
      } else {
         setSelectedRoleType('标准');
      }
      setRoleModalOpen(true);
    } else if (key === 'editDevice') {
      // 仅展示接口返回的设备 ID（与 uuid 区分开）
      const onlyId = row.id;
      setCurrentEditId(onlyId || null);
      // 预填当前行的设备信息
      editForm.setFieldsValue({
        name: row.name || '',
        uuid: row.uuid || row.id || row.vm_id || '',
        mac: row.mac || '',
        version: row.version || '',
        type: (row as any).type || 'VR',
        pool_id: (row.pool_id !== undefined && row.pool_id !== null) ? String(row.pool_id) : undefined,
        pool_name: row.pool_name || undefined,
        vm_id: row.vm_id || undefined,
      });
      setEditModalOpen(true);
      // 默认选中 "manual"
      setEditMode('manual');
      // 重置同步相关状态
      setSelectedSyncPool(undefined);
      setSelectedSyncVpc(undefined);
      setSelectedSyncVm(undefined);
      setVpcOptions([]);
      setVmOptions([]);
      
      // 如果已有 pool_id，尝试自动匹配 Sync 模式的初始值（可选，暂时不自动切换）
      // Async load options
      (async () => {
         setEditLoading(true);
         try {
             await loadResourcePools(row.org_id);
         } finally {
             setEditLoading(false);
         }
      })();
    } else if (key === 'bindOrg') {
      setCurrentBindVr(row);
      const tid = row.tenant_id;
      const oid = row.org_id;
      
      bindForm.setFieldsValue({
        tenant_id: tid ? String(tid) : undefined,
        org_id: oid ? String(oid) : undefined,
        vr_type: row.role || undefined,
      });

      if (tid) {
        handleBindTenantChange(String(tid), false); // 加载组织树但不重置 org_id
      } else {
        setOrgTreeData([]);
      }
      setBindModalOpen(true);
    }
  };

  const handleBindTenantChange = async (tenantId: string, resetOrg: boolean = true) => {
    if (resetOrg) {
      bindForm.setFieldsValue({ org_id: undefined });
    }
    if (!tenantId) {
      setOrgTreeData([]);
      return;
    }
    try {
      const tree = await fetchOrganizationsByTenant(tenantId);
      const list = Array.isArray(tree) ? tree : (Array.isArray((tree as any)?.data) ? (tree as any).data : []);
      
      const mapTree = (nodes: any[]): any[] => {
        return nodes.map(n => ({
          value: String(n.id),
          title: n.name || n.id,
          children: (n.children && n.children.length) ? mapTree(n.children) : undefined,
        }));
      };
      
      setOrgTreeData(mapTree(list));
    } catch (e) {
      console.error('加载组织失败', e);
      setOrgTreeData([]);
    }
  };

  const submitBind = async () => {
    try {
      const values = await bindForm.validateFields();
      if (!currentBindVr) return;
      
      setLoading(true);
      const vrUuid = currentBindVr.uuid || currentBindVr.id || currentBindVr.vm_id;
      if (!vrUuid) throw new Error('无法识别VR UUID');

      const payload = {
        vr_uuid: vrUuid,
        vm_id: currentBindVr.vm_id,
        tenant_id: values.tenant_id,
        org_id: values.org_id,
        display_name: currentBindVr.name,
        vr_type: values.vr_type,
      };

      await bindTenantVR(payload);
      
      message.success('绑定组织成功');
      setBindModalOpen(false);
      fetchVRInstances(); // 刷新列表
    } catch (e: any) {
      message.error(`绑定失败: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const submitCEConfig = async () => {
    try {
      const values = await ceForm.validateFields();
      const id = ceTargetVrUuidRef.current;
      if (!id) {
        message.warning('未选择 VR');
        return;
      }
      setLoading(true);
      // 合并已有配置
      const existing = await getVRConfig(id);
      const newCfg = { ...(existing || {}), role: 'CE', ce: { ...values } };
      await saveVRConfig(id, newCfg);
      await setVRRole(id, 'CE');
      setRolesMap(prev => ({ ...prev, [id]: 'CE' }));
      rolesMapRef.current = { ...rolesMapRef.current, [id]: 'CE' };
      message.success('CE角色与必要参数已保存');
      setCeModalOpen(false);
      ceForm.resetFields();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(`保存失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    setLoading(true);
    message.loading({ content: '正在同步 VR 数据...', key: 'vr_sync' });
    try {
      await apiPost('/api/vr-instances/refresh', {});
      await fetchVRInstances(true);
      message.success({ content: '同步完成', key: 'vr_sync' });
    } catch (e) {
      message.error({ content: '同步失败，请稍后重试', key: 'vr_sync' });
      setLoading(false);
    }
  };

  const fetchVRInstances = async (forceList?: boolean) => {
    setLoading(true);
    try {
      const cacheRes = await fetchVrCachePageList(1000, 1, { skipCache: !!forceList });
      const cacheData = cacheRes?.data || cacheRes;
      const mergedList = Array.isArray(cacheData?.page) ? cacheData.page : Array.isArray(cacheData?.list) ? cacheData.list : [];
      
      setVrs(mergedList);

      // 尝试从缓存恢复 rolesMap
      const newRolesMap = { ...rolesMapRef.current };
      mergedList.forEach((r: any) => {
         const id = r.uuid || r.id || r.vm_id;
         if (id && r.role) newRolesMap[id] = r.role;
      });
      setRolesMap(newRolesMap);
      rolesMapRef.current = newRolesMap;

      const renderStatus = (raw: unknown) => {
        const key = getVrHealthStatusKey(raw);
        if (key === 'running') return <Badge status={commonBadgeStyles.statusMap.success.status} text={<span style={commonBadgeStyles.text}>运行中</span>} />;
        if (key === 'warning') return <Badge status={commonBadgeStyles.statusMap.warning.status} text={<span style={commonBadgeStyles.text}>警告</span>} />;
        if (key === 'stopped') return <Badge status={commonBadgeStyles.statusMap.error.status} text={<span style={commonBadgeStyles.text}>已停止</span>} />;
        return <Badge status={commonBadgeStyles.statusMap.default.status} text={<span style={commonBadgeStyles.text}>未知</span>} />;
      };

      const newCols: ColumnsType<VRRow> = [
        {
          title: '名称',
          dataIndex: 'name',
          key: 'name',
          fixed: 'left',
          ellipsis: true,
          render: (text: any, row: VRRow) => {
            const label = text != null && String(text).trim() !== '' ? text : '—';
            return (
              <Typography.Link
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailRow(row);
                  setDetailDrawerOpen(true);
                }}
              >
                {label}
              </Typography.Link>
            );
          },
        },
        {
          title: 'UUID',
          key: 'uuid',
          ellipsis: { showTitle: false },
          render: (_: any, row: VRRow) => {
            const id = String(row.uuid || row.id || row.vm_id || '').trim();
            if (!id) return '—';
            return <Typography.Text copyable={{ text: id }}>{id}</Typography.Text>;
          },
        },
        { 
          title: '状态', 
          key: 'status', 
          dataIndex: 'status', 
          render: (_: any, row: VRRow) => renderStatus(row.health_status ?? row.healthStatus ?? row.status) 
        },
        {
          title: '角色',
          key: 'role',
          dataIndex: 'role',
          render: (_: any, row: VRRow) => {
            const id = row.uuid || row.id || row.vm_id;
            const m = rolesMapRef.current;
            const role = id && m[id] ? m[id] : '未设置';
            if (role === '未设置') {
              return <Typography.Text type="secondary">{role}</Typography.Text>;
            }
            return <Typography.Text>{role}</Typography.Text>;
          },
        },
        {
            title: '归属信息',
            key: 'affiliation',
            render: (_: any, row: VRRow) => {
               // 1. 租户与组织
               const tid = row.tenant_id;
               const oid = row.org_id;
               const tName = tid ? (tenantOptionsRef.current.find(t => String(t.value) === String(tid))?.label || tid) : '未绑定租户';
               const oName = oid ? (orgNameMapRef.current[String(oid)] || oid) : '未绑定组织';
               
               // 2. 安全域
               const id = row.uuid || row.id || row.vm_id;
               const domain = id ? netClassMapRef.current[String(id)] : undefined;
               const cls = domain ? getDomainClass(domain) : 'unbound';
               const label = domain?.name || netClassLabel(cls);
               
               // 3. 组合显示
               // 格式：
               // Cloudmap / Cloudmap-根组织
               // [底层密基安全域] (或者 <a>无安全域 绑定</a>)
               
               return (
                 <div style={commonTableStyles.cellContainer}>
                   <div style={commonTableStyles.primaryText}>
                     {tid ? `${tName} / ${oName}` : <span style={commonTableStyles.secondaryText}>{tName}</span>}
                   </div>
                   <div>
                      {cls === 'unbound' ? (
                        <span>
                          <span style={commonTableStyles.secondaryText}>无安全域 </span>
                          <Button
                            type="link"
                            size="small"
                            style={{ ...commonTableStyles.linkText, fontSize: '12px', padding: 0, height: 'auto' }}
                            onClick={(e) => {
                            e.stopPropagation();
                            // 触发绑定组织/安全域的逻辑，这里暂时复用绑定组织弹窗
                            const menu = getActionMenu(row) as any[];
                            const bindItem = menu.find((i: any) => i.key === 'bindOrg');
                            if (bindItem) {
                                const action = handleRowActionClick(row);
                                if (action) {
                                    action({ key: 'bindOrg', domEvent: e } as any);
                                }
                            }
                          }}
                          >
                            绑定
                          </Button>
                        </span>
                      ) : (
                        <Tag color={netClassColor(cls)} style={{ ...commonTagStyles.base, margin: 0 }}>{label}</Tag>
                      )}
                    </div>
                 </div>
               );
            }
          },
        {
          title: 'WAN IP',
          key: 'wan_ip',
          render: (_: any, row: VRRow) => {
             // Only try interfaces
             const interfaces = parseJsonField(row.interfaces);
             if (Array.isArray(interfaces)) {
                 // Filter physical interfaces (usually starting with GigabitEthernet)
                 const physical = interfaces.filter((iface: any) => {
                     const name = String(iface.name || '').toLowerCase();
                     return name.startsWith('gigabitethernet') || name.startsWith('ge');
                 });
                 
                 // Sort by name
                 physical.sort((a: any, b: any) => {
                     const na = String(a.name || '');
                     const nb = String(b.name || '');
                     return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
                 });

                 // First one is WAN
                 if (physical.length > 0) {
                     const wan = physical[0];
                     // Try ipv4_static first, then fallback to other common fields
                     const v4 = wan.ipv4_static || wan.ip_address || wan.ipAddress || wan.ip || '-';
                     const v6 = wan.ipv6_static || '-';
                     
                     return (
                         <div style={commonTableStyles.cellMultiLineStack}>
                            IPv4: {v4}<br/>
                            IPv6: {v6}<br/>
                         </div>
                     );
                 }
             }
             return '-';
          }
        },
        {
          title: 'CPU',
          key: 'cpu',
          width: 250,
          render: (_: any, row: any) => {
            const resourceIndicators = parseJsonField(row.resourceIndicators) as Record<string, unknown> | null;
            if (!resourceIndicators) return '-';
            const total = Number(resourceIndicators.cpuTotal ?? 0);
            const pctRaw = Number(resourceIndicators.cpuUsed ?? 0);
            const pct = Math.max(0, Math.min(100, isFinite(pctRaw) ? pctRaw : 0));
            const used = total > 0 ? (total * pct) / 100 : 0;
            if (!isFinite(total) || total <= 0) {
              return (
                <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, lineHeight: '18px' }}>-</div>
              );
            }
            const highUtil = pct > 80;
            return (
              <div style={{ maxWidth: 200, lineHeight: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '20px' }}>
                  <div style={{ flex: 1, minWidth: 0, maxWidth: 132 }}>
                    <Progress
                      percent={pct}
                      size="small"
                      showInfo={false}
                      strokeColor={highUtil ? '#ff4d4f' : '#1890ff'}
                    />
                  </div>
                  <span style={{ flexShrink: 0, color: highUtil ? '#ff4d4f' : undefined }}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, lineHeight: '18px' }}>
                  {used.toFixed(2)} core / {total.toFixed(2)} core
                </div>
              </div>
            );
          },
        },
        {
          title: '内存',
          key: 'memory',
          width: 250,
          render: (_: any, row: any) => {
            const resourceIndicators = parseJsonField(row.resourceIndicators) as Record<string, unknown> | null;
            if (!resourceIndicators) return '-';
            const total = Number(resourceIndicators.memoryTotal ?? 0);
            const pctRaw = Number(resourceIndicators.memoryUsed ?? 0);
            const pct = Math.max(0, Math.min(100, isFinite(pctRaw) ? pctRaw : 0));
            const used = total > 0 ? (total * pct) / 100 : 0;
            if (!isFinite(total) || total <= 0) {
              return (
                <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, lineHeight: '18px' }}>-</div>
              );
            }
            const highUtil = pct > 80;
            return (
              <div style={{ maxWidth: 200, lineHeight: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, lineHeight: '20px' }}>
                  <div style={{ flex: 1, minWidth: 0, maxWidth: 132 }}>
                    <Progress
                      percent={pct}
                      size="small"
                      showInfo={false}
                      strokeColor={highUtil ? '#ff4d4f' : '#1890ff'}
                    />
                  </div>
                  <span style={{ flexShrink: 0, color: highUtil ? '#ff4d4f' : undefined }}>{pct.toFixed(1)}%</span>
                </div>
                <div style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, lineHeight: '18px' }}>
                  {used.toFixed(2)} GiB / {total.toFixed(2)} GiB
                </div>
              </div>
            );
          },
        },
        {
          title: '接收（总）',
          key: 'rx_total',
          render: (_: any, row: any) => {
            const interfaces = parseJsonField(row.interfaces);
            let rx_pps = 0;
            let rx_bps = 0;
            const details: string[] = [];

            if (interfaces && Array.isArray(interfaces)) {
                interfaces.forEach((iface: any) => {
                    const name = String(iface.name || '').trim();
                    if (name.toLowerCase().startsWith('gigabitethernet')) {
                        const pps = Number(iface.receivePacketsPerSecond || 0);
                        const bps = Number(iface.receiveRateBps || 0);
                        rx_pps += pps;
                        rx_bps += bps;
                        if (bps > 0 || pps > 0) {
                             details.push(`${name}: ${formatTrafficRateBps(bps)} / ${pps} pps`);
                        }
                    }
                });
            }

            const tooltipTitle = details.length > 0 
                ? <div style={{ fontSize: 12 }}>{details.map((d, i) => <div key={i}>{d}</div>)}</div>
                : '无流量或无GigabitEthernet接口数据';

            return (
               <Tooltip title={tooltipTitle}>
                   <div style={commonTableStyles.cellMultiLineStack}>
                     <div>{rx_pps} pps</div>
                     <div>{formatTrafficRateBps(rx_bps)}</div>
                   </div>
               </Tooltip>
            );
          }
        },
        {
          title: '发送（总）',
          key: 'tx_total',
          render: (_: any, row: any) => {
            const interfaces = parseJsonField(row.interfaces);
            let tx_pps = 0;
            let tx_bps = 0;
            const details: string[] = [];

            if (interfaces && Array.isArray(interfaces)) {
                interfaces.forEach((iface: any) => {
                    const name = String(iface.name || '').trim();
                    if (name.toLowerCase().startsWith('gigabitethernet')) {
                        const pps = Number(iface.transmitPacketsPerSecond || 0);
                        const bps = Number(iface.transmitRateBps || 0);
                        tx_pps += pps;
                        tx_bps += bps;
                        if (bps > 0 || pps > 0) {
                             details.push(`${name}: ${formatTrafficRateBps(bps)} / ${pps} pps`);
                        }
                    }
                });
            }

            const tooltipTitle = details.length > 0 
                ? <div style={{ fontSize: 12 }}>{details.map((d, i) => <div key={i}>{d}</div>)}</div>
                : '无流量或无GigabitEthernet接口数据';

            return (
               <Tooltip title={tooltipTitle}>
                   <div style={commonTableStyles.cellMultiLineStack}>
                     <div>{tx_pps} pps</div>
                     <div>{formatTrafficRateBps(tx_bps)}</div>
                   </div>
               </Tooltip>
            );
          }
        },
        { title: 'MAC', dataIndex: 'mac', key: 'mac'},
        { title: '版本', dataIndex: 'version', key: 'version'},
        { title: '类型', dataIndex: 'type', key: 'type'},
        { title: '资源池', dataIndex: 'pool_name', key: 'pool_name'},
        { title: '资源池ID', dataIndex: 'pool_id', key: 'pool_id'},
        { title: '虚拟机ID', dataIndex: 'vm_id', key: 'vm_id' },
        { title: '租户ID', dataIndex: 'tenant_id', key: 'tenant_id'},

        { title: '组织ID', dataIndex: 'org_id', key: 'org_id'},
        {
          title: '操作',
          key: 'actions',
          width: 80,
          fixed: 'right',
          render: (_: any, row: VRRow) => (
            <ResourceActionsDropdown
              items={getActionMenu(row)}
              onClick={handleRowActionClick(row) as any}
              buttonProps={{ className: 'row-actions-trigger', style: { margin: 0 } }}
            />
          ),
        }
      ];

      setColumns(newCols);
    } catch (error: any) {
      console.error('[VR_DEBUG_ERROR] 远端直连失败:', error);
      message.error(`远端直连失败: ${error.message || '请稍后重试'}`);
      setVrs([]);
      setColumns([]);
    } finally {
      setLoading(false);
    }
  };

  // 提交新增VR实例
  const submitAddVR = async () => {
    try {
      const values = await addForm.validateFields();
      setLoading(true);

      const accesskey = 'Cloudmap#123';
      const secretkey = 'Cloudmap#123';
      const path = '/V2/vrcontrol/VR1/register';
      const method = 'POST';
      const other = '';

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${encodeURIComponent(accesskey)}&` +
        `secretKey=${encodeURIComponent(secretkey)}`;

      const bodyStr = JSON.stringify(values);

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr
      });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('认证响应数据缺少 Authorization 或 tonce');
      }

      const registerUrl = `/api-proxy${path}`;
      const res = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce)
        },
        body: bodyStr
      });
      const json = await res.json().catch(async () => ({ raw: await res.text() }));
      if (!res.ok || (json && typeof json === 'object' && 'code' in json && json.code !== 200)) {
        throw new Error((json as any)?.msg || `HTTP ${res.status}`);
      }
      message.success((json as any)?.msg || 'VR虚机注册成功');
      setAddModalOpen(false);
      addForm.resetFields();
      // 刷新列表
      await fetchVRInstances();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(`注册失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // 提交设备信息编辑（注册接口支持更新已注册设备）
  const submitEditVR = async () => {
    try {
      const values = await editForm.validateFields();
      // 将设备 ID 一并提交（与 uuid 区分开）
      const payload = {
        ...values,
        ...(currentEditId ? { id: currentEditId } : {}),
      };
      setLoading(true);

      const accesskey = 'Cloudmap#123';
      const secretkey = 'Cloudmap#123';
      const path = '/V2/vrcontrol/VR1/register';
      const method = 'POST';
      const other = '';

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${encodeURIComponent(accesskey)}&` +
        `secretKey=${encodeURIComponent(secretkey)}`;

      const bodyStr = JSON.stringify(payload);

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr
      });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('认证响应数据缺少 Authorization 或 tonce');
      }

      const registerUrl = `/api-proxy${path}`;
      const res = await fetch(registerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce)
        },
        body: bodyStr
      });
      const json = await res.json().catch(async () => ({ raw: await res.text() }));
      if (!res.ok || (json && typeof json === 'object' && 'code' in json && (json as any).code !== 200)) {
        throw new Error((json as any)?.msg || `HTTP ${res.status}`);
      }
      message.success((json as any)?.msg || '设备信息更新成功');
      setEditModalOpen(false);
      editForm.resetFields();
      await fetchVRInstances();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(`更新失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // 页面加载时：先远端拉取并入库一次
  useEffect(() => {
    fetchVRInstances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载安全域并构建 VR → 安全域对象 映射
  useEffect(() => {
    (async () => {
      try {
        const domains: any[] = await listSecurityDomains();
        const map: Record<string, any> = {};
        (domains || []).forEach((d: any) => {
          const uuid = d?.vrUuid || d?.vr_id || d?.vrId || d?.vrUUID;
          if (uuid) {
            // 存储完整的安全域对象，以便展示名称等
            map[uuid] = d;
          }
        });
        setNetClassMap(map);
        netClassMapRef.current = map;
      } catch (e) {
        setNetClassMap({});
        netClassMapRef.current = {};
      }
    })();
  }, []);

  const filteredVRs = useMemo(() => {
    return vrs.filter((v) => {
      const nameLower = (v.name || '').toLowerCase();
      if (keyword && !nameLower.includes(keyword.toLowerCase())) return false;
      
      // 状态筛选：统一使用 getVrHealthStatusKey 转换后比较
      if (statusFilter) {
        const key = getVrHealthStatusKey(v.health_status ?? v.healthStatus ?? v.status);
        if (key !== statusFilter) return false;
      }

      if (tenantFilter) {
        const id = (v.uuid || v.vr_unique_id || v.id || v.vm_id) as string;
        const dom = id ? netClassMap[String(id)] : undefined;
        const effectiveTenant = v.tenant_id || (dom ? dom.tenantId : undefined);
        if (String(effectiveTenant || '') !== String(tenantFilter)) return false;
      }
      // 角色筛选
      if (roleFilter) {
        const id = (v.uuid || v.id || v.vm_id) as string;
        const r = rolesMap[id];
        if (roleFilter === '未设置') {
          if (r) return false;
        } else {
          if (r !== roleFilter) return false;
        }
      }
      return true;
    });
  }, [vrs, keyword, statusFilter, roleFilter, rolesMap, tenantFilter, netClassMap]);

  const peOptions = useMemo(() => (
    (vrs || []).filter((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return rolesMap[id] === 'PE';
    }).map((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return { value: id, label: r.name || id };
    })
  ), [vrs, rolesMap]);

  const ceOptions = useMemo(() => (
    (vrs || []).filter((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return rolesMap[id] === 'CE';
    }).map((r: any) => {
      const id = (r.uuid || r.id || r.vm_id) as string;
      return { value: id, label: r.name || id };
    })
  ), [vrs, rolesMap]);

  const submitTunnel = async () => {
    try {
      const values = await tunnelForm.validateFields();
      if (values.peA === values.peB) {
        message.error('PE-A 与 PE-B 不能相同');
        return;
      }
      if (values.ceA === values.ceB) {
        message.error('CE-A 与 CE-B 不能相同');
        return;
      }
      const _reservedTunnelPayload = {
        name: values.tunnelName,
        pe: [values.peA, values.peB],
        ce: [values.ceA, values.ceB],
      };
      void _reservedTunnelPayload;
      message.success('SRv6 隧道已创建（前端校验与占位，后续可接后端）');
      setTunnelModalOpen(false);
      tunnelForm.resetFields();
    } catch (e) {
      // 表单校验失败不处理
    }
  };

  return (
      <PageContainer
        titleLevel={3}
        externalColumnControl
        toolbarRight={(
          <Space size={8} wrap>
            <Button type="primary" onClick={() => setAddModalOpen(true)}>
              新增VR实例
            </Button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'csmctl',
                    label: '配置 CSMCTL 地址',
                    onClick: handleSettingsOpen,
                  },
                ],
              }}
            >
              <Button icon={<EllipsisOutlined />} />
            </Dropdown>
            <TableColumnSettingsButton<VRRow>
              allColumns={columns}
              settingsKey="interconnect_vr_instances"
              defaultHiddenColumns={VR_TABLE_COL_SETTINGS_DEFAULT_HIDDEN}
            />
            <Button icon={<ReloadOutlined />} onClick={() => { void handleManualRefresh(); }} />
          </Space>
        )}
      toolbarLeft={(
        <Form
          className="toolbar-container"
          form={filterForm}
          layout="inline"
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status || undefined);
            setRoleFilter(all.role);
            setTenantFilter(all.tenant || undefined);
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="名称 / ID"
              className="toolbar-search"
              suffix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            />
          </Form.Item>
          <Form.Item name="status" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="状态" className="toolbar-filter-sm">
              <Select.Option value="running">运行中</Select.Option>
              <Select.Option value="stopped">已停止</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="role" style={{ marginBottom: 0 }}>
            <Select allowClear placeholder="角色" className="toolbar-filter-sm">
              <Select.Option value="标准">标准</Select.Option>
              <Select.Option value="SASE">SASE</Select.Option>
              <Select.Option value="PE">PE</Select.Option>
              <Select.Option value="CE">CE</Select.Option>
              <Select.Option value="未设置">未设置</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="tenant" style={{ marginBottom: 0 }}>
            <Select
              allowClear
              placeholder="租户"
              className="toolbar-filter"
              showSearch
              optionFilterProp="label"
              loading={tenantLoading}
              options={tenantOptions}
            />
          </Form.Item>
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setKeyword('');
              setStatusFilter(undefined);
              setRoleFilter(undefined);
              setTenantFilter(undefined);
            }}
          >
            重置
          </button>
        </Form>
      )}
      tableProps={{
        className: "std-table",
        columns: vrDisplayColumns,
        dataSource: filteredVRs,
        rowKey: (r: VRRow) => r.uuid || r.id || r.vm_id || Math.random().toString(36).slice(2),
        pagination: {
          size: 'small',
          showTotal: (total: number) => `共 ${total} 条`,
        },
        loading: loading,
        scroll: { 
          x: 'max-content',
        },
        bordered: false
      }}
    >

      <VrDetailDrawer
        open={detailDrawerOpen}
        onClose={() => {
          setDetailDrawerOpen(false);
          setDetailRow(null);
        }}
        row={detailRow}
        rolesMap={rolesMap}
        orgNameMap={orgNameMap}
      />

      {/* CSMCTL Settings Modal */}
      <Modal
        title="CSMCTL 服务地址设置"
        open={settingsModalOpen}
        onOk={handleSettingsSave}
        onCancel={() => setSettingsModalOpen(false)}
        confirmLoading={settingsLoading}
      >
        <Form form={settingsForm} layout="vertical">
          <Form.Item
            name="address"
            label="CSMCTL 服务地址"
            rules={[{ required: true, message: '请输入 CSMCTL 地址' }]}
            extra="例如: https://10.20.255.93:8016"
          >
            <Input placeholder="https://ip:port" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建 SRv6 隧道"
        open={tunnelModalOpen}
        onOk={submitTunnel}
        onCancel={() => { setTunnelModalOpen(false); tunnelForm.resetFields(); }}
        destroyOnHidden
        width={720}
      >
        <Form form={tunnelForm} layout="vertical">
          <Form.Item name="tunnelName" label="隧道名称" rules={[{ required: true, message: '请输入隧道名称' }]}>
            <Input placeholder="例如：beijing-to-shanghai" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="peA" label="PE-A" rules={[{ required: true, message: '请选择 PE-A' }]}>
                <Select options={peOptions} showSearch optionFilterProp="label" placeholder="选择 PE-A" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="peB"
                label="PE-B"
                dependencies={["peA"]}
                rules={[
                  { required: true, message: '请选择 PE-B' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || value !== getFieldValue('peA')) return Promise.resolve();
                      return Promise.reject(new Error('PE-A 与 PE-B 不能相同'));
                    }
                  })
                ]}
              >
                <Select options={peOptions} showSearch optionFilterProp="label" placeholder="选择 PE-B" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="ceA" label="CE-A" rules={[{ required: true, message: '请选择 CE-A' }]}>
                <Select options={ceOptions} showSearch optionFilterProp="label" placeholder="选择 CE-A" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="ceB"
                label="CE-B"
                dependencies={["ceA"]}
                rules={[
                  { required: true, message: '请选择 CE-B' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || value !== getFieldValue('ceA')) return Promise.resolve();
                      return Promise.reject(new Error('CE-A 与 CE-B 不能相同'));
                    }
                  })
                ]}
              >
                <Select options={ceOptions} showSearch optionFilterProp="label" placeholder="选择 CE-B" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
      {/* 添加VR实例弹窗 */}
      <Modal
        title="添加VR实例"
        open={addModalOpen}
        onOk={submitAddVR}
        onCancel={() => { setAddModalOpen(false); addForm.resetFields(); }}
        confirmLoading={loading}
        destroyOnHidden
        width={640}
      >
        <Form form={addForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}
                extra="名称需唯一，用于区分资源池">
                <Input placeholder="例如：VR1" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="uuid" label="UUID" rules={[{ required: true, message: '请输入UUID' }]}>
                <Input placeholder="例如：54060500FFFB8B0F-5254004a4161" addonAfter={<Button size="small" onClick={() => addForm.setFieldsValue({ uuid: (window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2)) })}>生成</Button>} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="mac" label="MAC地址" rules={[
                { required: true, message: '请输入MAC地址' },
                { pattern: /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}$/,
                  message: '格式示例：00:50:56:C0:00:08 或 00-50-56-C0-00-08' }
              ]}>
                <Input placeholder="例如：00-50-56-C0-00-08" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="version" label="设备版本号" rules={[{ required: true, message: '请输入设备版本号' }]}> 
                <Input placeholder="例如：V1.0" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="type" label="类型" initialValue="VR">
                <Select options={[{ value: 'VR', label: 'VR' }]} disabled />
              </Form.Item>
            </Col>
          </Row>
          <Divider orientation="left">资源池（可选）</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="pool_id" label="资源池ID">
                <Input placeholder="例如：f1c3dc08-..." />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="pool_name" label="资源池名称">
                <Input placeholder="例如：资源池名称" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="vm_id" label="虚机ID">
                <Input placeholder="例如：e1c3dc08-..." />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 设备信息编辑弹窗 */}
      <StdFormModal
        title="设备信息编辑"
        open={editModalOpen}
        form={editForm}
        onFinish={submitEditVR}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        confirmLoading={loading}
        destroyOnHidden
        width={720}
      >
        <div style={{ overflowX: 'hidden' }}>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item label="ID">
              <Input value={currentEditId || ''} disabled placeholder="当前设备ID" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="例如：VR1" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item name="uuid" label="UUID" rules={[{ required: true, message: '请输入UUID' }]}>
              <Input placeholder="例如：54060500FFFB8B0F-5254004a4161" addonAfter={<Button size="small" onClick={() => editForm.setFieldsValue({ uuid: (window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2)) })}>生成</Button>} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="mac" label="MAC地址" rules={[
              { required: true, message: '请输入MAC地址' },
              { pattern: /^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5}$/,
                message: '格式示例：00:50:56:C0:00:08 或 00-50-56-C0-00-08' }
            ]}>
              <Input placeholder="例如：00-50-56-C0-00-08" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item name="version" label="设备版本号" rules={[{ required: true, message: '请输入设备版本号' }]}> 
              <Input placeholder="例如：V1.0" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="type" label="类型" initialValue="VR">
              <Select options={[{ value: 'VR', label: 'VR' }]} disabled />
            </Form.Item>
          </Col>
        </Row>

          <Divider orientation="left" style={{ margin: '12px 0', fontSize: '14px', fontWeight: 'normal', color: '#666' }}>资源设定</Divider>
          
          <Row gutter={24} style={{ marginBottom: 16 }}>
            <Col span={24}>
              <Radio.Group 
                value={editMode} 
                onChange={(e) => {
                  setEditMode(e.target.value);
                  if (e.target.value === 'sync') {
                    setSelectedSyncPool(undefined);
                    setSelectedSyncVpc(undefined);
                    setSelectedSyncVm(undefined);
                    setVpcOptions([]);
                    setVmOptions([]);
                    setRawVms([]);
                  }
                }}
                buttonStyle="solid"
              >
                <Radio value="manual">编辑配置</Radio>
                <Radio value="sync">从现有资源池同步</Radio>
              </Radio.Group>
            </Col>
          </Row>
          
          {editMode === 'manual' ? (
            <>
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item name="pool_id" label="资源池ID">
                    <Input placeholder="例如：f1c3dc08-..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="pool_name" label="资源池名称">
                    <Input placeholder="例如：资源池名称" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={24}>
                <Col span={24}>
                  <Form.Item name="vm_id" label="虚机ID">
                    <Input placeholder="例如：e1c3dc08-..." />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : (
            <>
              <Row gutter={24}>
                <Col span={12}>
                  <Form.Item label="选择资源池" required>
                    <Select
                      placeholder="选择资源池"
                      options={resourcePoolOptions}
                      loading={editLoading}
                      value={selectedSyncPool}
                      onChange={(val, opt: any) => {
                        setSelectedSyncPool(val);
                        setSelectedSyncVpc(undefined);
                        setSelectedSyncVm(undefined);
                        setVpcOptions([]);
                        setVmOptions([]);
                        setRawVms([]);
                        if (val) {
                          loadVpcs(val);
                          loadVms(val);
                        }
                      }}
                      allowClear
                      showSearch
                      optionFilterProp="label"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="选择 VPC" >
                    <Select
                      placeholder="选择 VPC (可选)"
                      options={vpcOptions}
                      loading={editLoading}
                      value={selectedSyncVpc}
                      onChange={(val) => {
                        setSelectedSyncVpc(val);
                        setSelectedSyncVm(undefined);
                        if (val && rawVms.length > 0) {
                          // 宽松匹配：匹配 VpcId 或 VpcName
                          const filtered = rawVms.filter(v => {
                            const vId = v.VpcId || v.vpcId || v.vpc_id;
                            const vName = v.VpcName || v.vpcName || v.vpc_name;
                            return vId === val || vName === val;
                          });
                          setVmOptions(filtered.map((v: any) => ({ 
                            label: v.name && v.id ? `${v.name} (${v.id})` : (v.name || v.id), 
                            value: v.id 
                          })));
                        } else if (!val && rawVms.length > 0) {
                           setVmOptions(rawVms.map((v: any) => ({ 
                             label: v.name && v.id ? `${v.name} (${v.id})` : (v.name || v.id), 
                             value: v.id 
                           })));
                        } else {
                           setVmOptions([]);
                        }
                      }}
                      allowClear
                      showSearch
                      optionFilterProp="label"
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={24}>
                <Col span={24}>
                  <Form.Item label="选择虚拟机" required>
                    <Select
                      placeholder="选择虚拟机"
                      options={vmOptions}
                      loading={editLoading}
                      value={selectedSyncVm}
                      onChange={(val) => {
                         setSelectedSyncVm(val);
                         if (val) {
                           const poolOpt = resourcePoolOptions.find(p => p.value === selectedSyncPool);
                           editForm.setFieldsValue({
                             pool_id: selectedSyncPool,
                             pool_name: poolOpt?.originalName || poolOpt?.label?.split('(')[0]?.trim(),
                             vm_id: val
                           });
                         }
                      }}
                      allowClear
                      showSearch
                      optionFilterProp="label"
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
        </div>
      </StdFormModal>

      {/* 绑定组织弹窗 */}
      <Modal
        title="绑定组织"
        open={bindModalOpen}
        onOk={submitBind}
        onCancel={() => { setBindModalOpen(false); bindForm.resetFields(); }}
        confirmLoading={loading}
        destroyOnHidden
        width={480}
      >
        <Form form={bindForm} layout="vertical">
          <Form.Item name="tenant_id" label="租户" rules={[{ required: true, message: '请选择租户' }]}>
            <Select
              showSearch
              placeholder="选择租户"
              optionFilterProp="label"
              options={tenantOptions}
              onChange={(val) => handleBindTenantChange(val, true)}
            />
          </Form.Item>
          <Form.Item name="org_id" label="组织" rules={[{ required: true, message: '请选择组织' }]}>
            <TreeSelect
              showSearch
              style={{ width: '100%' }}
              dropdownStyle={{ maxHeight: 400, overflow: 'auto' }}
              placeholder="选择组织"
              allowClear
              treeDefaultExpandAll
              treeData={orgTreeData}
              treeNodeFilterProp="title"
            />
          </Form.Item>
          <Form.Item name="vr_type" label="VR类型">
            <Select placeholder="选择VR类型（可选）" allowClear>
              <Select.Option value="标准">标准</Select.Option>
              <Select.Option value="PE">PE</Select.Option>
              <Select.Option value="CE">CE</Select.Option>
              <Select.Option value="SASE">SASE</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>


      {/* CE配置弹窗 */}
      <Modal
        title="配置为 CE"
        open={ceModalOpen}
        onOk={submitCEConfig}
        onCancel={() => { setCeModalOpen(false); ceForm.resetFields(); }}
        confirmLoading={loading}
        forceRender
        width={720}
      >
        <Form form={ceForm} layout="vertical" scrollToFirstError>
          <Tabs
            defaultActiveKey="base"
            items={[
              {
                key: 'base',
                label: '基本信息',
                children: (
                  <Card size="small" variant="outlined">
                    <Form.Item
                      name="locatorName"
                      label="本地 Locator 名称"
                      rules={[{ required: true, message: '请输入 Locator 名称' }]}
                      extra="用于区分此站点的 SRv6 Locator 名称"
                    >
                      <Input placeholder="例如：beijing-locator" />
                    </Form.Item>
                    <Form.Item
                      name="sidPrefix"
                      label="SID 前缀"
                      rules={[
                        { required: true, message: '请输入 SID 前缀' },
                        { pattern: /^[0-9a-fA-F:]+\/\d{1,3}$/, message: '格式示例：2400:1234::/64' }
                      ]}
                      extra="建议为 IPv6 前缀，例如 2400:1234::/64"
                    >
                      <Input placeholder="例如：2400:1234::/64" />
                    </Form.Item>
                  </Card>
                )
              },
              {
                key: 'private',
                label: '私网',
                children: (
                  <Card size="small" variant="outlined">
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item name="privateInterface" label="私网接口" rules={[{ required: true, message: '请输入私网接口名称' }]} extra="连接到私网的接口">
                          <Input placeholder="例如：eth1" />
                        </Form.Item>
                        <Form.Item name="privateBgpInstance" label="私网 BGP 实例" rules={[{ required: true, message: '请输入私网 BGP 实例名' }]} extra="用于私网邻居的 BGP 进程名">
                          <Input placeholder="例如：bgp-private-1" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item
                          name="privateRouterId"
                          label="私网 Router-ID"
                          rules={[
                            { required: true, message: '请输入私网 Router-ID' },
                            { pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }
                          ]}
                          extra="BGP 的 Router-ID（IPv4）"
                        >
                          <Input placeholder="例如：2.2.2.2" />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                )
              }
            ]}
          />
        </Form>
      </Modal>
      {/* 角色设置向导 - 步骤1：选择类型 */}
      <Modal
        title="设置角色 - 选择类型"
        open={roleModalOpen}
        onCancel={() => setRoleModalOpen(false)}
        onOk={() => {
           if (!roleVrUuid) return;
           let path = '';
           if (selectedRoleType === '标准') path = 'role-standard';
           else if (selectedRoleType === 'PE') path = 'role-pe';
           else if (selectedRoleType === 'CE') path = 'role-ce';
           else if (selectedRoleType === 'SASE') path = 'role-sase';
           
           if (path) {
              navigate(`/admin/interconnect/vr/${roleVrUuid}/${path}`);
              setRoleModalOpen(false);
           } else {
              message.info('该角色类型的向导暂未开放');
           }
        }}
        okText="下一步"
        destroyOnHidden
      >
        <div style={{ padding: '24px 0' }}>
          <Radio.Group 
            value={selectedRoleType} 
            onChange={(e) => setSelectedRoleType(e.target.value)}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <Radio value="标准">
              <Space direction="vertical" size={0}>
                <span>标准模式 (Standard)</span>
                <span style={{ color: '#999', fontSize: 12 }}>基础虚拟路由功能，支持静态路由与接口配置</span>
              </Space>
            </Radio>
            <Radio value="PE">
              <Space direction="vertical" size={0}>
                <span>PE 模式 (Provider Edge)</span>
                <span style={{ color: '#999', fontSize: 12 }}>作为骨干网边缘设备，支持 MP-BGP 与公网互联</span>
              </Space>
            </Radio>
            <Radio value="CE">
              <Space direction="vertical" size={0}>
                <span>CE 模式 (Customer Edge)</span>
                <span style={{ color: '#999', fontSize: 12 }}>作为租户侧接入设备，通过 BGP/OSPF 接入骨干网</span>
              </Space>
            </Radio>
            <Radio value="SASE">
              <Space direction="vertical" size={0}>
                <span>SASE 模式</span>
                <span style={{ color: '#999', fontSize: 12 }}>安全访问服务边缘，提供统一的安全接入与策略控制</span>
              </Space>
            </Radio>

          </Radio.Group>
        </div>
      </Modal>
    </PageContainer>
  );
};

export default VRPage;
