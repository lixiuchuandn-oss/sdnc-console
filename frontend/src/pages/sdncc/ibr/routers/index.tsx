import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MenuProps } from 'antd';
import {
  Button,
  Dropdown,
  Form,
  Input,
  message,
  Modal,
  Radio,
  Select,
  Space,
} from 'antd';
import { EllipsisOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';

import PageContainer from '../../../../components/PageContainer';
import TableColumnSettingsButton from '../../../../components/TableColumnSettingsButton';
import { useAuth } from '../../../../contexts/AuthContext';
import { useTableColumnSettings } from '../../../../hooks/useTableColumnSettings';
import {
  apiPost,
} from '../../../../services/api';
import { getSystemSetting, updateSystemSetting } from '../../../../services/systemApi';
import {
  fetchVrCacheMergedAll,
  vrApi,
} from '../../../../services/virtualRouterApi';
import {
  applyIbrVrRolesToRows,
  buildIbrVrRolesMapFromVr2,
  ibrVrRowId,
  ibrVrRowRole,
} from '../lib/ibrVrCatalog';
import {
  buildVrRolesMapFromRows,
  getVrHealthStatusKey,
  matchVrListRoleFilter,
  vrRowMatchesKeyword,
} from './vrListDisplay';
import { useVrListColumns, type VrListRow } from './useVrListColumns';

import { VrDetailDrawer } from './VrDetailDrawer';
import type { IbrSectionEmbedProps } from '../lib/embedProps';
import { useIbrEmbedContext } from '../lib/useIbrEmbedContext';
import { openIbrConsole } from '../lib/ibrLocalWebUrl';
import { hasPermissionForAction } from '../../../../utils/accessMapping';

/** 与 useTableColumnSettings / TableColumnSettingsButton 的默认隐藏列一致 */
const VR_TABLE_COL_SETTINGS_DEFAULT_HIDDEN = ['mac', 'type'];

type VRRow = VrListRow;

const VRPage: React.FC<IbrSectionEmbedProps> = (props) => {
  const embed = useIbrEmbedContext(props);
  const navigate = useNavigate();
  const { user } = useAuth();
  const perms = Array.isArray(user?.permissions) ? user?.permissions ?? [] : [];
  const canWrite =
    user?.role === 'super_admin' || hasPermissionForAction(perms, 'networks.vr-config:write');
  const scopedVr = String(embed.scopedVrUuid || '').trim();
  const [vrs, setVrs] = useState<VRRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [filterForm] = Form.useForm();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<VRRow | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm] = Form.useForm();
  const [currentEditId, setCurrentEditId] = useState<string | null>(null);
  /** 打开弹窗时从当前行快照，提交时与名称一并发往注册接口 */
  const editRegisterPayloadRef = useRef<Record<string, unknown>>({});
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settingsForm] = Form.useForm();
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [selectedRoleType, setSelectedRoleType] = useState('标准');
  const [roleVrUuid, setRoleVrUuid] = useState<string | null>(null);

  const getActionMenu = useCallback((row: VRRow): MenuProps['items'] => {
    const vrUuid = String(row.uuid || row.vr_unique_id || row.vm_id || '').trim();
    const items: MenuProps['items'] = [
      { key: 'detail', label: '查看详情' },
      { key: 'console', label: '运维控制台', disabled: !vrUuid },
    ];
    if (canWrite) {
      items.push(
      { key: 'editDevice', label: '修改名称' },
      { type: 'divider' },
      { key: 'role', label: '设置角色', danger: true },
      { key: 'editConfig', label: '专家模式', danger: true },
      { type: 'divider' },
      { key: 'delete', label: '删除实例', danger: true },
      );
    }
    return items;
  }, [canWrite]);

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
    if (key === 'console') {
      if (!vrUuid) return message.warning('该行缺少可识别的 UUID');
      if (!openIbrConsole(vrUuid)) {
        message.error('无法打开运维控制台');
      }
      return;
    }
    if (key === 'detail' || key === 'metadata') {
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
    } else if (key === 'role') {
      if (!vrUuid) return message.warning('该行缺少可识别的UUID');
      setRoleVrUuid(vrUuid);
      
      // Default selection logic
      if (row.role && ['SPOKE_PE','HUB_PE','CE','SASE','标准'].includes(row.role)) {
         setSelectedRoleType(row.role);
      } else if (row.role === 'PE') {
         setSelectedRoleType('SPOKE_PE');
      } else {
         setSelectedRoleType('标准');
      }
      setRoleModalOpen(true);
    } else if (key === 'editDevice') {
      const onlyId = row.id;
      setCurrentEditId(onlyId || null);
      const uuid = String(row.uuid || row.id || row.vm_id || '').trim();
      const mac = String(row.mac || '').trim();
      const version = String(row.version || '').trim();
      const type = String((row as any).type || 'VR');
      editRegisterPayloadRef.current = {
        uuid,
        mac,
        version,
        type,
        ...((row.pool_id !== undefined && row.pool_id !== null && String(row.pool_id).trim() !== '')
          ? { pool_id: String(row.pool_id) }
          : {}),
        ...(row.pool_name != null && String(row.pool_name).trim() !== ''
          ? { pool_name: String(row.pool_name) }
          : {}),
        ...(row.vm_id != null && String(row.vm_id).trim() !== '' ? { vm_id: String(row.vm_id) } : {}),
      };
      editForm.setFieldsValue({ name: row.name || '' });
      setEditModalOpen(true);
    } else if (key === 'delete') {
      const rid = String(row.id || '').trim();
      const ruuid = String(row.uuid || row.vr_unique_id || '').trim();
      const rvmid = String(row.vm_id || '').trim();
      /** 接口文档：注销仅支持 Query `uuid`（与注册时 uuid 一致），不用 id/vm_id */
      if (!ruuid) {
        message.warning('该行缺少 uuid（与 CSM 注册时 uuid 一致），无法按规范注销');
        return;
      }
      const label = String(row.name || rid || ruuid || rvmid).trim();
      Modal.confirm({
        title: '删除 IBR实例',
        content: `确定从 CSM 控制面注销「${label}」吗？将调用 DELETE /V2/vrcontrol/VR1/unregister?uuid=… ，此操作不可恢复。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            setLoading(true);
            const json = await vrApi.deleteVRInstance(ruuid);
            const j = json as { msg?: string };
            message.success(j?.msg || '已删除');
            await apiPost('/api/vr-instances/refresh', {});
            await fetchVRInstances(true);
          } catch (e: any) {
            message.error(e?.message || '删除失败');
            throw e;
          } finally {
            setLoading(false);
          }
        },
      });
    }
  };

  const handleManualRefresh = async () => {
    setLoading(true);
    message.loading({ content: '正在同步 IBR 数据（VR1/VR3/VR2）…', key: 'vr_sync' });
    try {
      await apiPost('/api/vr-instances/refresh', {});
      message.loading({ content: '正在加载列表与角色…', key: 'vr_sync' });
      await fetchVRInstances(true);
      message.success({ content: '同步完成', key: 'vr_sync' });
    } catch (e) {
      message.error({ content: '同步失败，请稍后重试', key: 'vr_sync' });
    } finally {
      setLoading(false);
    }
  };

  const listLoadGenRef = useRef(0);

  const fetchVRInstances = async (forceList?: boolean) => {
    const gen = ++listLoadGenRef.current;
    setLoading(true);
    let mergedList: VRRow[] = [];
    try {
      mergedList = await fetchVrCacheMergedAll({ skipCache: !!forceList });
      if (gen !== listLoadGenRef.current) return;
      setVrs(mergedList);
    } catch (error: unknown) {
      if (gen !== listLoadGenRef.current) return;
      console.error('[VR_DEBUG_ERROR] 远端直连失败:', error);
      const msg = error instanceof Error ? error.message : '请稍后重试';
      message.error(`加载 IBR 列表失败: ${msg}`);
      setVrs([]);
    } finally {
      if (gen === listLoadGenRef.current) setLoading(false);
    }

    if (mergedList.length === 0 || gen !== listLoadGenRef.current) return;

    setRolesLoading(true);
    try {
      const roleMap = await buildIbrVrRolesMapFromVr2(mergedList, { skipCache: true });
      if (gen !== listLoadGenRef.current) return;
      const applied = applyIbrVrRolesToRows(mergedList, roleMap);
      setVrs(applied);
      const resolved = Object.keys(roleMap).length;
      if (forceList && resolved < mergedList.length) {
        console.info(`[VR] 角色回读：${resolved}/${mergedList.length}（VR2 优先，无 VR2 时回退平台库）`);
      }
    } catch (error: unknown) {
      if (gen !== listLoadGenRef.current) return;
      console.warn('[VR] 角色回读失败', error);
      if (forceList) {
        message.warning('角色回读失败，列表仅显示缓存数据');
      }
    } finally {
      if (gen === listLoadGenRef.current) setRolesLoading(false);
    }
  };

  // 提交设备信息编辑（注册接口支持更新已注册设备）
  const submitEditVR = async () => {
    try {
      const values = await editForm.validateFields();
      const payload = {
        ...editRegisterPayloadRef.current,
        name: values.name,
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
      message.success((json as any)?.msg || '设备名称已更新');
      setEditModalOpen(false);
      editForm.resetFields();
      await fetchVRInstances(true);
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

  const rolesMap = useMemo(() => buildVrRolesMapFromRows(vrs), [vrs]);

  const columns = useVrListColumns({
    rolesLoading,
    getActionMenu,
    onRowAction: handleRowActionClick,
  });
  const { displayColumns: vrDisplayColumns } = useTableColumnSettings(
    columns,
    'interconnect_vr_instances',
    VR_TABLE_COL_SETTINGS_DEFAULT_HIDDEN,
  );

  const filteredVRs = useMemo(() => {
    const tenantScope = String(embed.tenantId || '').trim();
    return vrs.filter((v) => {
      const rowId = ibrVrRowId(v);
      if (scopedVr && rowId !== scopedVr) return false;
      if (tenantScope && String(v.tenant_id || '') !== tenantScope) return false;
      if (!vrRowMatchesKeyword(v, keyword)) return false;

      if (statusFilter) {
        const key = getVrHealthStatusKey(v.health_status ?? v.healthStatus ?? v.status);
        if (key !== statusFilter) return false;
      }

      if (roleFilter && !matchVrListRoleFilter(ibrVrRowRole(v), roleFilter)) {
        return false;
      }
      return true;
    });
  }, [vrs, keyword, statusFilter, roleFilter, scopedVr, embed.tenantId]);

  return (
      <PageContainer
        titleLevel={3}
        asCard={false}
        hideHeader={embed.embedded}
        pagePadding={embed.embedded ? 0 : undefined}
        externalColumnControl
        toolbarRight={(
          <div className="toolbar-actions">
            <Space size={8} wrap>
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
          </div>
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
          }}
        >
          <Form.Item name="keyword" style={{ marginBottom: 0 }}>
            <Input
              allowClear
              placeholder="名称 / UUID / 角色"
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
          <button
            type="button"
            className="toolbar-reset-btn"
            onClick={() => {
              filterForm.resetFields();
              setKeyword('');
              setStatusFilter(undefined);
              setRoleFilter(undefined);
            }}
          >
            重置
          </button>
        </Form>
      )}
      tableProps={{
        className: 'std-table',
        columns: vrDisplayColumns,
        dataSource: filteredVRs,
        loading,
        rowKey: (r: VRRow) => ibrVrRowId(r) || Math.random().toString(36).slice(2),
        pagination: {
          size: 'small',
          showTotal: (total: number) => `共 ${total} 条`,
        },
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
        title="修改名称"
        open={editModalOpen}
        onOk={submitEditVR}
        onCancel={() => {
          setEditModalOpen(false);
          editForm.resetFields();
        }}
        confirmLoading={loading}
        destroyOnHidden
        width={480}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="name" label="设备名称" rules={[{ required: true, message: '请输入设备名称' }]}>
            <Input  placeholder="请输入设备名称" allowClear />
          </Form.Item>
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
           else if (selectedRoleType === 'SPOKE_PE' || selectedRoleType === 'HUB_PE') path = 'role-pe';
           else if (selectedRoleType === 'CE') path = 'role-ce';
           else if (selectedRoleType === 'SASE') path = 'role-sase';
           
           if (path) {
              navigate(`/admin/interconnect/vr/${roleVrUuid}/${path}`, {
                state:
                  selectedRoleType === 'SPOKE_PE' || selectedRoleType === 'HUB_PE'
                    ? { peRole: selectedRoleType }
                    : undefined,
              });
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
                <span style={{ color: '#999', fontSize: 12 }}>基础 IBR 功能，支持静态路由与接口配置</span>
              </Space>
            </Radio>
            <Radio value="SPOKE_PE">
              <Space direction="vertical" size={0}>
                <span>Spoke PE（边缘）</span>
                <span style={{ color: '#999', fontSize: 12 }}>Spoke 点对点或 Hub 组网的 Spoke 侧；支持 MP-BGP 与 SRv6</span>
              </Space>
            </Radio>
            <Radio value="HUB_PE">
              <Space direction="vertical" size={0}>
                <span>Hub PE（中心）</span>
                <span style={{ color: '#999', fontSize: 12 }}>Hub–Spoke 组网中心节点；可承载多条 Spoke 隧道</span>
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
