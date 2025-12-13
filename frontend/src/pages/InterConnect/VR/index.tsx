import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Button, Divider, Form, Input, Select, Space, Table, message, Dropdown, Modal, Tabs, Row, Col, Card, Tag } from 'antd';
import type { MenuProps } from 'antd';
import { PlusOutlined, ReloadOutlined, EllipsisOutlined, CheckCircleFilled, ExclamationCircleFilled, CloseCircleFilled, QuestionCircleFilled, ApiOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { vrApi } from '../../../services/vrApi';
import PageContainer from '../../../components/PageContainer';
import type { ColumnsType } from 'antd/es/table';
import { getVRRoles, setVRRole, getVRConfig, saveVRConfig } from '../../../services/vrConfigApi';
import { listInfoDomains } from '../../../services/infoDomainApi';
import { netClassLabel, netClassColor } from '../../../utils/netClass';
import '../../common/filters.css';


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
  [key: string]: any;
}

// 英文字段到中文标题的映射
const LABELS: Record<string, string> = {
  uuid: 'UUID',
  id: 'ID',
  vm_id: '虚拟机ID',
  name: '名称',
  status: '状态',
  pool_id: '资源池ID',
  pool_name: '资源池',
  cpu: 'CPU(核)',
  memory: '内存(MB)',
  mac: 'MAC',
  version: '版本',
  create_time: '创建时间',
  region: '区域',
  cloud: '云名称',
  type: '类型',
  health_status: '状态',
  healthStatus: '状态',
};

const VRPage: React.FC = () => {
  const navigate = useNavigate();
  const [vrs, setVrs] = useState<VRRow[]>([]);
  const [columns, setColumns] = useState<ColumnsType<VRRow>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [netClassFilter, setNetClassFilter] = useState<'vpc' | 'flat' | 'unbound' | undefined>();
  const [rolesMap, setRolesMap] = useState<Record<string, string>>({});
  const rolesMapRef = useRef<Record<string, string>>({});
  const [netClassMap, setNetClassMap] = useState<Record<string, 'vpc' | 'flat' | 'unbound'>>({});
  const netClassMapRef = useRef<Record<string, 'vpc' | 'flat' | 'unbound'>>({});

  const [currentVrId, setCurrentVrId] = useState<string | null>(null);
  // CE配置弹窗
  const [ceModalOpen, setCeModalOpen] = useState(false);
  const [ceForm] = Form.useForm();
  const [tunnelModalOpen, setTunnelModalOpen] = useState(false);
  const [tunnelForm] = Form.useForm();
  // 添加VR实例弹窗
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm] = Form.useForm();
  // 设备信息编辑弹窗
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);
  const getActionMenu = (row: VRRow): MenuProps['items'] => ([
    { key: 'detail', label: '查看设备详情' },
    { key: 'editDevice', label: '编辑设备信息' },
    { key: 'roleWizard', label: '设置角色' },
    { key: 'editConfig', label: '专家模式' },
  ]);

  const handleRowActionClick = (row: VRRow): MenuProps['onClick'] => ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === 'editConfig') {
      const id = row.uuid || row.id || row.vm_id;
      if (id) {
        navigate(`/admin/interconnect/vr/${id}/config`);
      } else {
        message.warning('该行缺少可识别的UUID/ID');
      }
    } else if (key === 'detail') {
      message.info('查看设备详情（功能待设计）');
    } else if (key === 'roleWizard') {
      const id = row.uuid || row.id || row.vm_id;
      if (!id) return message.warning('该行缺少可识别的UUID/ID');
      navigate(`/admin/interconnect/vr/${id}/role`);
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
    }
  };



  const submitCEConfig = async () => {
    try {
      const values = await ceForm.validateFields();
      const id = currentVrId as string;
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

  const fetchVRInstances = async (pageNum: number = 1, pageSize: number = 10) => {
    console.log('[VR_DEBUG] 开始获取VR实例数据（远端直连），页码:', pageNum, '页大小:', pageSize);
    setLoading(true);
    try {
      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/ctcontrol/VR1/pagelist';
      const method = 'GET';
      const other = `page_size=${pageSize}&page_num=${pageNum}`;

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      console.log('[VR_DEBUG] 认证URL:', authUrl);
      const signResp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '' });
      const signJson = await signResp.json();
      const info = (signJson && signJson.data) ? signJson.data : signJson;
      if (!info || !info.Authorization || !info.tonce) {
        throw new Error('[VR_DEBUG_ERROR] 认证响应数据缺少 Authorization 或 tonce');
      }

      const listUrl = `/api-proxy${path}?${other}`;
      console.log('[VR_DEBUG] 列表URL:', listUrl);
      const res = await fetch(listUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': info.Authorization,
          'tonce': String(info.tonce)
        }
      });

      const response = await res.json();
      if (!res.ok) throw new Error(response?.msg || `HTTP ${res.status}`);

      console.log('[VR_DEBUG] 远端列表响应:', response);
      const data = response?.data ?? response;
      const list: VRRow[] = Array.isArray(data?.page)
        ? data.page
        : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data)
        ? (data as VRRow[])
        : [];

      setVrs(list);
      const first = list[0] || {};
      const cols: ColumnsType<VRRow> = Object.keys(first).map((k) => ({ title: LABELS[k] || k, dataIndex: k, key: k }));

      // 移除可能存在的原始状态列，统一用自定义渲染
      ['status','health_status','healthStatus'].forEach((key)=>{
        const idx = cols.findIndex((c:any)=> c.dataIndex===key || c.key===key);
        if(idx>=0) cols.splice(idx,1);
      });

      // 自定义状态列（图标 + 中文标签），从 health_status/healthStatus/status 读取
      const renderStatus = (raw:any)=>{
        const v = String(raw||'').toLowerCase();
        if(['healthy','running','ok','online'].includes(v)) return <div className="status-badge success">Success</div>;
        if(['warning','degraded'].includes(v)) return <div className="status-badge warning">Pending</div>;
        if(['error','failed','unhealthy','offline','stopped'].includes(v)) return <div className="status-badge error">Pending</div>;
        return <div className="status-badge unknown">Unknown</div>;
      };
      const statusCol = {
        title: '状态',
        key: 'health_status',
        dataIndex: 'health_status',
        render: (_:any,row:VRRow)=> renderStatus(row.health_status ?? row.healthStatus ?? row.status)
      } as any;

      // 新增：将ID列改为序号并缩窄宽度；若无ID列则添加序号列
      const idIdx = cols.findIndex((c: any) => c.dataIndex === 'id' || c.key === 'id');
      const indexBase = (pagination.current - 1) * pagination.pageSize;
      const indexCol = {
        title: '序号',
        key: 'id',
        dataIndex: 'id',
        width: 70,
        render: (_: any, __: VRRow, index: number) => indexBase + index + 1,
      } as any;
      if (idIdx >= 0) {
        cols.splice(idIdx, 1, { ...cols[idIdx], ...indexCol });
      } else {
        cols.unshift(indexCol);
      }

      // 追加角色列（基于本地rolesMap渲染）
      const roleCol = {
        title: '角色',
        key: 'role',
        dataIndex: 'role',
        render: (_: any, row: VRRow) => {
          const id = row.uuid || row.id || row.vm_id;
          const m = rolesMapRef.current;
          return (id && m[id]) ? m[id] : '未设置';
        }
      } as any;

      // 追加信息域网络分类列（基于信息域绑定）
      const netClassCol = {
        title: '信息域分类',
        key: 'netClass',
        dataIndex: 'netClass',
        render: (_: any, row: VRRow) => {
          const id = row.uuid || row.id || row.vm_id;
          const cls = id ? netClassMapRef.current[id] || 'unbound' : 'unbound';
          const label = cls === 'unbound' ? '未绑定' : netClassLabel(cls as any);
          const color = cls === 'unbound' ? 'default' : netClassColor(cls as any);
          return <Tag color={color}>{label}</Tag>;
        }
      } as any;

      // 重新排列列顺序：将“状态”、“名称”、“角色”放到“MAC”列之前（状态在名称前）
      let macIdx = cols.findIndex((c: any) => c.dataIndex === 'mac' || c.key === 'mac');
      if (macIdx < 0) macIdx = 0;

      // 提取并移除名称列（如果存在）
      const nameIdx = cols.findIndex((c: any) => c.dataIndex === 'name' || c.key === 'name');
      let nameCol: any | null = null;
      if (nameIdx >= 0) {
        [nameCol] = cols.splice(nameIdx, 1);
      }

      // 插入状态列、名称列与角色列到 MAC 前
      // 重新定位 MAC 索引（因为数组可能已改变）
      macIdx = cols.findIndex((c: any) => c.dataIndex === 'mac' || c.key === 'mac');
      if (macIdx < 0) macIdx = cols.length;
      // 依次插入：状态 -> 名称 -> 角色
      cols.splice(macIdx, 0, statusCol);
      macIdx = macIdx + 1;
      if (nameCol) {
        cols.splice(macIdx, 0, nameCol);
        macIdx = macIdx + 1;
      }
      cols.splice(macIdx, 0, roleCol);
      macIdx = macIdx + 1;
      cols.splice(macIdx, 0, netClassCol);

      // 追加操作列
      cols.push({
        title: '操作',
        key: 'actions',
        fixed: 'right',
        width: 160,
        render: (_: any, row: VRRow) => (
          <Dropdown menu={{ items: getActionMenu(row), onClick: handleRowActionClick(row) }} trigger={["click"]}>
            <Button type="text" icon={<EllipsisOutlined />} />
          </Dropdown>
        )
      });
      setColumns(cols);

      // 拉取角色映射
      const ids = list.map(r => r.uuid || r.id || r.vm_id).filter(Boolean) as string[];
      try {
        const roles = await getVRRoles(ids);
        setRolesMap(roles || {});
        rolesMapRef.current = roles || {};
      } catch (e: any) {
        console.warn('获取角色映射失败:', e?.message || e);
        setRolesMap({});
        rolesMapRef.current = {};
      }

      setPagination({ current: pageNum, pageSize, total: Number((data as any)?.total || list.length) });
    } catch (error: any) {
      console.error('[VR_DEBUG_ERROR] 远端直连失败:', error);
      message.error(`远端直连失败: ${error.message || '请稍后重试'}`);
      setVrs([]);
      setColumns([]);
      setPagination((prev) => ({ ...prev, total: 0 }));
    } finally {
      setLoading(false);
    }
  };

  // 提交新增VR实例
  const submitAddVR = async () => {
    try {
      const values = await addForm.validateFields();
      setLoading(true);

      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/vrcontrol/VR1/register';
      const method = 'POST';
      const other = '';

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
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
        body: JSON.stringify(values)
      });
      const json = await res.json().catch(async () => ({ raw: await res.text() }));
      if (!res.ok || (json && typeof json === 'object' && 'code' in json && json.code !== 200)) {
        throw new Error((json as any)?.msg || `HTTP ${res.status}`);
      }
      message.success((json as any)?.msg || 'VR虚机注册成功');
      setAddModalOpen(false);
      addForm.resetFields();
      // 刷新列表
      await fetchVRInstances(pagination.current, pagination.pageSize);
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

      const accesskey = 'Cloudmap%23123';
      const secretkey = 'Cloudmap%23123';
      const path = '/V2/vrcontrol/VR1/register';
      const method = 'POST';
      const other = '';

      const authUrl = `/api-proxy/api/sign?` +
        `url=${encodeURIComponent(path)}&` +
        `method=${method}&` +
        `other=${encodeURIComponent(other)}&` +
        `accessKey=${accesskey}&` +
        `secretKey=${secretkey}`;

      const signResp = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
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
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(async () => ({ raw: await res.text() }));
      if (!res.ok || (json && typeof json === 'object' && 'code' in json && (json as any).code !== 200)) {
        throw new Error((json as any)?.msg || `HTTP ${res.status}`);
      }
      message.success((json as any)?.msg || '设备信息更新成功');
      setEditModalOpen(false);
      editForm.resetFields();
      await fetchVRInstances(pagination.current, pagination.pageSize);
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验错误
      message.error(`更新失败: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // 新增：远端拉取并入库，再刷新缓存显示
  const syncRemoteToCache = async (pageNum: number = 1, pageSize: number = 10) => {
    console.log('========== 远端拉取并入库 ==========');
    console.log(`使用分页参数: pageSize=${pageSize}, pageNum=${pageNum}`);
    setLoading(true);
    try {
      // 通过前端代理调用远端接口获取列表
      const remoteResponse = await vrApi.getVRInstances(pageSize, pageNum);
      console.log('[VR_DEBUG] 远端响应:', remoteResponse);

      // 写入数据库缓存
      const upsertRes = await fetch('/api/vr-cache/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_size: pageSize, page_num: pageNum, data: remoteResponse })
      });
      const upsertJson = await upsertRes.json();
      if (!upsertRes.ok || upsertJson.code !== 200) {
        throw new Error(upsertJson?.msg || `HTTP ${upsertRes.status}`);
      }
      message.success(`远端数据已入库（记录ID=${upsertJson.data?.saved_id || '-'}，条目数=${upsertJson.data?.count || 0}）`);

      // 再次读取缓存并刷新表格
      await fetchVRInstances(pageNum, pageSize);
    } catch (error: any) {
      console.error('[VR_DEBUG_ERROR] 远端同步入库失败:', error);
      message.error(`同步入库失败: ${error.message || '请稍后重试'}`);
    } finally {
      setLoading(false);
    }
  };

  // 页面加载时：先远端拉取并入库一次
  useEffect(() => {
    fetchVRInstances(pagination.current, pagination.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载信息域并构建 VR → 网络分类 映射
  useEffect(() => {
    (async () => {
      try {
        const domains: any[] = await listInfoDomains();
        const map: Record<string, 'vpc' | 'flat' | 'unbound'> = {};
        (domains || []).forEach((d: any) => {
          const uuid = d?.vrUuid || d?.vr_id || d?.vrId || d?.vrUUID;
          if (uuid) {
            map[uuid] = d?.type === 'VPC' ? 'vpc' : 'flat';
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

  // 页面组件挂载时直接输出调试信息
  console.log('VR页面组件已加载');
  console.log('vrApi服务:', typeof vrApi);
  console.log('vrApi.getVRInstances方法:', typeof vrApi.getVRInstances);

  // 处理分页变化（远端直连）
  const handleTableChange = (newPagination: any) => {
    console.log('========== 处理分页变化（远端直连） ==========');
    console.log(`新的分页参数: current=${newPagination.current}, pageSize=${newPagination.pageSize}`);
    fetchVRInstances(newPagination.current, newPagination.pageSize);
  };

  // 刷新（远端直连）
  const forceRefresh = () => {
    console.log('========== 刷新（远端直连） ==========');
    console.log(`当前分页参数: pageSize=${pagination.pageSize}, pageNum=${pagination.current}`);
    fetchVRInstances(pagination.current, pagination.pageSize);
  };

  const filteredVRs = useMemo(() => {
    return vrs.filter((v) => {
      const nameLower = (v.name || '').toLowerCase();
      if (keyword && !nameLower.includes(keyword.toLowerCase())) return false;
      if (statusFilter && (v.status || '') !== statusFilter) return false;
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
      // 信息域网络分类筛选
      if (netClassFilter) {
        const id = (v.uuid || v.id || v.vm_id) as string;
        const cls = netClassMap[id] || 'unbound';
        if (netClassFilter === 'unbound') {
          if (cls !== 'unbound') return false;
        } else {
          if (cls !== netClassFilter) return false;
        }
      }
      return true;
    });
  }, [vrs, keyword, statusFilter, roleFilter, rolesMap, netClassFilter, netClassMap]);

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
      const payload = {
        name: values.tunnelName,
        pe: [values.peA, values.peB],
        ce: [values.ceA, values.ceB],
      };
      console.log('SRv6 tunnel create payload:', payload);
      message.success('SRv6 隧道已创建（前端校验与占位，后续可接后端）');
      setTunnelModalOpen(false);
      tunnelForm.resetFields();
    } catch (e) {
      // 表单校验失败不处理
    }
  };

  return (
    <PageContainer
      icon={<ApiOutlined style={{ fontSize: 24, color: '#1890ff' }} />}
      title="VR实例管理"
      titleLevel={3}
      subtitle="VR（Virtual Router）实例用于在多云与异构网络之间提供路由与互联能力，支持跨区域连通、BGP/静态路由、策略与监控，帮助实现稳定、安全、高效的网络连接。"
      asCard={false}
      toolbarLeft={(
        <Form
          className="filter-tools filter-tools--center"
          form={filterForm}
          layout="vertical"
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(_, all) => {
            setKeyword(all.keyword || '');
            setStatusFilter(all.status || undefined);
            setRoleFilter(all.role);
            setNetClassFilter(all.netClass || undefined);
          }}
        >
          <Form.Item name="keyword" label="名称">
            <Input allowClear placeholder="搜索名称" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select allowClear placeholder="选择状态" style={{ width: 200 }}>
              <Select.Option value="running">运行中</Select.Option>
              <Select.Option value="stopped">已停止</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select allowClear placeholder="选择角色" style={{ width: 200 }}>
              <Select.Option value="标准">标准（虚拟路由）</Select.Option>
              <Select.Option value="SASE">SASE（安全网关）</Select.Option>
              <Select.Option value="PE">PE（BGP公网互联）</Select.Option>
              <Select.Option value="CE">CE（私网接入）</Select.Option>
              <Select.Option value="未设置">未设置</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="netClass" label="网络分类">
            <Select allowClear placeholder="全部" style={{ width: 200 }}>
              <Select.Option value="vpc">VPC网络</Select.Option>
              <Select.Option value="flat">扁平网络</Select.Option>
              <Select.Option value="unbound">未绑定</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      )}
      primaryAction={{ text: '新增VR实例', onClick: () => setAddModalOpen(true) }}
      moreMenuItems={[
        { key: 'refresh', label: '刷新', onClick: () => forceRefresh() },
      ]}
      actionsSize="middle"
    >
      

      

       <Table
         className="vr-table"
         columns={columns}
         dataSource={filteredVRs}
         rowKey={(r: VRRow) => r.uuid || r.id || r.vm_id || Math.random().toString(36).slice(2)}
         pagination={{
           current: pagination.current,
           pageSize: pagination.pageSize,
           total: pagination.total,
           showSizeChanger: true,
           pageSizeOptions: ['10', '20', '50'],
         }}
         loading={loading}
         onChange={handleTableChange}
         scroll={{ x: 'max-content' }}
         bordered
       />

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
      </Modal
      >
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
      <Modal
        title="设备信息编辑"
        open={editModalOpen}
        onOk={submitEditVR}
        onCancel={() => { setEditModalOpen(false); editForm.resetFields(); }}
        confirmLoading={loading}
        destroyOnClose
        width={640}
      >
        <Form form={editForm} layout="vertical">
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="ID">
                <Input value={currentEditId || ''} disabled placeholder="当前设备ID" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}
                extra="名称需唯一，用于区分资源池">
                <Input placeholder="例如：VR1" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="uuid" label="UUID" rules={[{ required: true, message: '请输入UUID' }]}>
                <Input placeholder="例如：54060500FFFB8B0F-5254004a4161" addonAfter={<Button size="small" onClick={() => editForm.setFieldsValue({ uuid: (window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2)) })}>生成</Button>} />
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
    </PageContainer>
  );
};

export default VRPage;
