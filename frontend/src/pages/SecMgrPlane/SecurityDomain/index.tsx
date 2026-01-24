import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button, Descriptions, Dropdown, Form, Input, message, Modal, Select, Space, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { EllipsisOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import '../../common/filters.css';
import { vrApi } from '../../../services/vrApi';
import { fetchCsmVRPageList } from '../../../services/api';
import { fetchVrCachePageList } from '../../../services/vrCacheApi';
import { getVRRoles } from '../../../services/vrConfigApi';
import { fetchCloudProviderVpcs, fetchTenants, fetchOrganizationsByTenant } from '../../../services/api';
import { listSecurityDomains, createSecurityDomain, updateSecurityDomain, deleteSecurityDomain, SecurityDomainPayload } from '../../../services/securityDomainApi';
import { getDomainClass, netClassLabel, netClassColor } from '../../../utils/netClass';

export type SecurityDomainType = 'IDC' | 'VPC' | '虚拟化网络' | '办公网络';
export type SecurityDomainStatus = 'active' | 'inactive';

export interface SecurityDomain {
  id: string;
  name: string;
  type?: SecurityDomainType;
  category?: string;
  subType?: string;
  cloudId?: string;
  vpcId?: string;
  vpcMode?: 'existing' | 'new';
  newVpcName?: string;
  provider?: string;
  region?: string;
  cidr4?: string[];
  cidr6?: string[];
  cidr?: string;
  newVpcCidr?: string;
  vrUuid?: string;
  vrName?: string;
  tags?: string[];
  description?: string;
  status?: SecurityDomainStatus;
  createdAt?: string;
  updatedAt?: string;
  vrInstanceIds?: string;
  vrPublicEniIds?: string;
  vrPublicEip?: string;
  vrPublicIp?: string;
  vrPrivateIp?: string;
  vrPublicSubnetCidr?: string;
  vrPrivateSubnetCidr?: string;
  resourcePool?: string;
  purpose?: string;
  appInstances?: any[];
  cloudInstances?: any[];
  serviceChains?: any[];
  cascadeChannels?: any[];
  srv6Tunnels?: any[];
  natRules?: any[];
  aclRules?: any[];
  bypassPolicies?: any[];
  securityServiceIds?: string;
  securityServices?: any[];
  tenantId?: string;
  tenantName?: string;
  organizationId?: string;
  organizationName?: string;
}

interface SecurityDomainForm extends SecurityDomain {}

interface VRRowOpt {
  uuid: string;
  name: string;
}

const SecurityDomainPage: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<SecurityDomainStatus | undefined>();
  const [netClassFilter, setNetClassFilter] = useState<'vpc' | 'flat' | undefined>();

  const [domains, setDomains] = useState<SecurityDomain[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [vrOptions, setVrOptions] = useState<VRRowOpt[]>([]);
  const [vrCeOptions, setVrCeOptions] = useState<VRRowOpt[]>([]);
  // const [vrLoading, setVrLoading] = useState(false);

  const [tenants, setTenants] = useState<any[]>([]);
  const [tenantLoading, setTenantLoading] = useState<boolean>(false);
  const [orgOptions, setOrgOptions] = useState<{ value: string; label: string }[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SecurityDomain | null>(null);
  const [createForm] = Form.useForm<SecurityDomainForm>();

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<SecurityDomain | null>(null);
  const [resourcePoolMap, setResourcePoolMap] = useState<Record<string, string>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // VR Change/Unbind States
  const [changeVrOpen, setChangeVrOpen] = useState(false);
  const [selectedDomainForVr, setSelectedDomainForVr] = useState<SecurityDomain | null>(null);
  const [changeVrForm] = Form.useForm();
  const [changeVrLoading, setChangeVrLoading] = useState(false);

  const initializedRef = useRef(false);

  const loadVRList = async (tenantId?: string) => {
    // setVrLoading(true);
    try {
      // 无论安全域属于什么云，统一获取当前租户名下的所有 VR 实例
      // 这是一个管理动作，不受底层云厂商接口限制
      const res = await fetchVrCachePageList(1000, 1);
      
      let list: any[] = [];
      const data = res?.data || res;
      if (data && Array.isArray(data.page)) {
          list = data.page;
      } else if (data && Array.isArray(data.list)) {
          list = data.list;
      } else if (Array.isArray(data)) {
          list = data;
      }
      
      // Filter out deleted VRs
      list = list.filter((item: any) => !item.is_deleted);

      // If tenantId is provided, filter by it if the field exists
      if (tenantId) {
         list = list.filter((item: any) => {
             const tid = item.tenant_id || item.tenantId;
             return !tid || String(tid) === String(tenantId);
         });
      }

      const opts: VRRowOpt[] = list.map((item: any) => ({
        uuid: item.uuid || item.id || '',
        name: `${item.name || item.display_name || item.uuid || '未命名VR'}${item.health_status ? ` (${item.health_status})` : ''}`,
      })).filter(v => v.uuid);
      setVrOptions(opts);
      setVrCeOptions(opts);
    } catch (err: any) {
      console.warn('VR list fetch failed', err);
      const errMsg = typeof err === 'string' ? err : (err?.message || JSON.stringify(err));
      message.error(`加载 VR 列表失败: ${errMsg}`);
      setVrOptions([]);
      setVrCeOptions([]);
    } finally {
      // setVrLoading(false);
    }
  };

  const loadTenants = async () => {
    setTenantLoading(true);
    try {
      const res = await fetchTenants();
      const list = (res?.data || res || []);
      setTenants(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.warn('租户列表获取失败', e);
      setTenants([]);
    } finally { setTenantLoading(false); }
  };

  const fetchResourcePools = async () => {
    try {
      const res = await fetch('/api/clouds', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        const map: Record<string, string> = {};
        if (Array.isArray(data)) {
          data.forEach((c: any) => {
            map[c.id] = c.name;
          });
        }
        setResourcePoolMap(map);
      }
    } catch (e) {
      console.error('Failed to load resource pools', e);
    }
  };

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      loadVRList();
      reloadDomains();
      fetchResourcePools();
      loadTenants();
    }
  }, []);

  const reloadDomains = async () => {
    try {
      setLoading(true);
      const list = await listSecurityDomains();
      const needVpcCidrs = (Array.isArray(list) ? list : []).filter((it: any) => it?.category === 'vpc' && it?.vpcMode === 'existing' && it?.cloudId && it?.vpcId);
      const cloudIds = Array.from(new Set(needVpcCidrs.map((it: any) => String(it.cloudId)))).filter(Boolean);
      const vpcCache: Record<string, any[]> = {};
      for (const cid of cloudIds) {
        try {
          const res = await fetchCloudProviderVpcs(cid);
          const raw = (res?.data || res || []);
          const items =
            Array.isArray(raw?.Vpcs?.Vpc) ? raw.Vpcs.Vpc
            : Array.isArray(res?.Vpcs?.Vpc) ? res.Vpcs.Vpc
            : Array.isArray(raw?.vpcs?.vpcs) ? raw.vpcs.vpcs
            : Array.isArray(raw?.vpcs) ? raw.vpcs
            : Array.isArray(res?.vpcs) ? res.vpcs
            : Array.isArray(raw?.items) ? raw.items
            : Array.isArray(res?.items) ? res.items
            : Array.isArray(raw?.list) ? raw.list
            : Array.isArray(res?.list) ? res.list
            : (Array.isArray(raw) ? raw : []);
          vpcCache[cid] = items;
        } catch (e) {
          vpcCache[cid] = [];
        }
      }
      const normalized: SecurityDomain[] = (Array.isArray(list) ? list : []).map((item: any) => {
        let ipv4Cidrs: string[] = [];
        let ipv6Cidrs: string[] = [];
        if (item.newVpcCidr) {
          ipv4Cidrs = [item.newVpcCidr];
        } else if (item.category === 'vpc' && item.vpcMode === 'existing' && item.cloudId && item.vpcId) {
          const vpcs = vpcCache[String(item.cloudId)] || [];
          const v = vpcs.find((x: any) => String(x?.VpcId || x?.id || x?.uuid || x?.vpcId || x?.vpc_id || x?.Name || x?.name) === String(item.vpcId));
          let cidr = v?.CidrBlock || v?.Ipv4CidrBlock || v?.cidr || v?.Cidr || v?.VpcCidr || v?.CidrIpv4 || undefined;
          
          // Fallback to stored CIDR if realtime lookup fails or returns nothing
          if (!cidr && item.cidr) {
            cidr = item.cidr;
          }

          if (cidr) {
            const s = String(cidr);
            ipv4Cidrs = s.includes(',') ? s.split(',').map(x => x.trim()).filter(Boolean) : [s];
          }
          const cidr6 = v?.Ipv6CidrBlock || v?.CidrIpv6 || v?.Ipv6Cidr || undefined;
          if (cidr6) ipv6Cidrs = [String(cidr6)];
        } else if (item.cidr) {
          ipv4Cidrs = [String(item.cidr)];
        }
        return ({
          id: item.id,
          name: item.name,
          type: item.type,
          category: (item as any).category,
          subType: (item as any).subType,
          cloudId: item.cloudId,
          vpcId: item.vpcId,
          vpcMode: item.vpcMode,
          provider: item.provider,
          region: item.region,
          cidr4: ipv4Cidrs,
          cidr6: (() => {
            if (ipv6Cidrs.length) return ipv6Cidrs;
            if (typeof (item as any).cidr6 === 'string') {
              return (item as any).cidr6.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
            return ((item as any).cidr6 || []);
          })(),
          cidr: item.cidr,
          newVpcCidr: item.newVpcCidr,
          vrUuid: item.vrUuid,
          vrName: item.vrName,
          tags: typeof item.tags === 'string' ? item.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : (item.tags || []),
          description: item.description,
          status: item.status || 'active',
          createdAt: item.createdAt ? String(item.createdAt).slice(0,19).replace('T',' ') : undefined,
          updatedAt: item.updatedAt ? String(item.updatedAt).slice(0,19).replace('T',' ') : undefined,
          vrInstanceIds: item.vrInstanceIds,
          vrPublicEniIds: item.vrPublicEniIds,
          vrPublicEip: item.vrPublicEip,
          vrPublicIp: item.vrPublicIp,
          vrPrivateIp: item.vrPrivateIp,
          vrPublicSubnetCidr: item.vrPublicSubnetCidr,
          vrPrivateSubnetCidr: item.vrPrivateSubnetCidr,
          resourcePool: item.resourcePool,
          purpose: item.purpose,
          tenantId: item.tenantId,
          tenantName: item.tenantName,
          organizationId: item.organizationId,
          organizationName: item.organizationName,
          });
      });
      setDomains(normalized);
    } catch (e: any) {
      message.error('获取安全域列表失败');
    } finally {
      setLoading(false);
    }
  };

  const filteredDomains = useMemo(() => {
    return domains.filter(item => {
      const cls = getDomainClass(item);
      const matchKeyword = keyword
        ? [item.name, item.provider, item.region, item.description]
            .filter(Boolean)
            .some(v => String(v).toLowerCase().includes(keyword.toLowerCase()))
        : true;
      const matchStatus = statusFilter ? item.status === statusFilter : true;
      const matchNetClass = netClassFilter ? netClassFilter === cls : true;
      return matchKeyword && matchStatus && matchNetClass;
    });
  }, [domains, keyword, statusFilter, netClassFilter]);

  const forceRefresh = () => {
    loadVRList();
    // loadTenants();
    message.success('已刷新');
  };

  const removeSelectedDomains = () => {
    if (!selectedRowKeys.length) return;
    const targets = domains.filter(d => selectedRowKeys.includes(d.id));
    Modal.confirm({
      title: '确认批量删除选中的安全域？',
      content: `共 ${targets.length} 项：${targets.map(t => t.name).join('、')}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const results = await Promise.allSettled(targets.map(t => deleteSecurityDomain(t.id)));
        const success = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.length - success;
        if (success) message.success(`已删除 ${success} 项${failed ? `，失败 ${failed} 项` : ''}`);
        else message.error('删除失败');
        setSelectedRowKeys([]);
        reloadDomains();
      },
    });
  };

  const openDetail = (record: SecurityDomain) => {
    setDetailData(record);
    setDetailOpen(true);
  };

  const openEdit = (record: SecurityDomain) => {
    setEditing(record);
    setCreateOpen(true);
    loadVRList();
    loadTenants();
    createForm.setFieldsValue({
      ...record,
      subType: record.subType ? record.subType.split(',').map(s => s.trim()).filter(Boolean) : [],
      cidr4: record.cidr4 || [],
      cidr6: record.cidr6 || [],
      tenantId: record.tenantId,
      organizationId: record.organizationId,
    } as any);
    if (record.tenantId) {
      const tid = String(record.tenantId);
      (async () => {
        try {
          const orgTree = await fetchOrganizationsByTenant(tid);
          const flat: any[] = [];
          const recur = (list: any[]) => {
            for (const o of list) {
              flat.push({ id: o.id, name: o.name });
              if (Array.isArray(o.children) && o.children.length) recur(o.children);
            }
          };
          recur(Array.isArray(orgTree) ? orgTree : []);
          setOrgOptions(flat.map(o => ({ value: o.id, label: o.name })));
        } catch {
          setOrgOptions([]);
        }
      })();
    } else {
      setOrgOptions([]);
    }
  };

  const removeDomain = (record: SecurityDomain) => {
    Modal.confirm({
      title: '确认删除该安全域？',
      content: `安全域名称：${record.name}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        deleteSecurityDomain(record.id)
          .then(() => { message.success('删除成功'); reloadDomains(); })
          .catch((e) => { message.error(`删除失败: ${e?.message || e}`); });
      },
    });
  };

  const onSubmitCreate = async () => {
    try {
      const values = await createForm.validateFields();
      try {
        if (editing) {
          const payload: Partial<SecurityDomainPayload> = {
            name: values.name,
            category: values.category,
            subType: Array.isArray(values.subType) ? values.subType.join(',') : values.subType,
            description: values.description,
            vrUuid: values.vrUuid,
            vrName: values.vrUuid ? (vrCeOptions.find(v => v.uuid === values.vrUuid)?.name || vrOptions.find(v => v.uuid === values.vrUuid)?.name) : undefined,
            tags: Array.isArray(values.tags) ? values.tags.join(',') : values.tags,
            status: values.status || 'active',
            tenantId: values.tenantId,
            organizationId: values.organizationId,
          };
          await updateSecurityDomain(editing.id, payload);
          message.success('安全域已更新');
          setEditing(null);
          reloadDomains();
        } else {
          const payload: SecurityDomainPayload = {
            name: values.name,
            category: values.category,
            subType: Array.isArray(values.subType) ? values.subType.join(',') : values.subType,
            description: values.description,
            vrUuid: values.vrUuid,
            vrName: values.vrUuid ? (vrCeOptions.find(v => v.uuid === values.vrUuid)?.name || vrOptions.find(v => v.uuid === values.vrUuid)?.name) : undefined,
            tags: Array.isArray(values.tags) ? values.tags.join(',') : values.tags,
            status: values.status || 'active',
            tenantId: values.tenantId,
            organizationId: values.organizationId,
          };
          await createSecurityDomain(payload);
          message.success('安全域已创建');
          reloadDomains();
        }
        setCreateOpen(false);
        createForm.resetFields();
      } catch (err: any) {
        const msg = typeof err?.message === 'string' ? err.message : String(err);
        message.error(`保存失败：${msg}`);
      }
    } catch (validationErr) {}
  };

  const onCancelCreate = () => {
    setCreateOpen(false);
    setEditing(null);
    createForm.resetFields();
  };

  const openChangeVr = (record: SecurityDomain) => {
    setSelectedDomainForVr(record);
    setChangeVrOpen(true);
    // Pass tenantId to load specific VRs
    loadVRList(record.tenantId);
    changeVrForm.setFieldsValue({ vrUuid: record.vrUuid });
  };

  const handleChangeVrSubmit = async () => {
    if (!selectedDomainForVr) return;
    try {
      const values = await changeVrForm.validateFields();
      setChangeVrLoading(true);
      await updateSecurityDomain(selectedDomainForVr.id, {
        vrUuid: values.vrUuid,
        vrName: null,
        vrInstanceIds: null,
      } as any);
      message.success('VR 实例已更换');
      setChangeVrOpen(false);
      reloadDomains();
    } catch (e) {
      console.error('Failed to change VR', e);
      message.error('更换失败');
    } finally {
      setChangeVrLoading(false);
    }
  };

  const handleUnbindVr = (record: SecurityDomain) => {
    Modal.confirm({
      title: '确认解绑 VR',
      content: '解绑 VR 实例将清除相关的网络配置（ENI/IP），是否继续？',
      onOk: async () => {
        try {
          await updateSecurityDomain(record.id, {
            vrUuid: '',
            vrName: null,
            vrInstanceIds: null,
            vrPublicEniIds: null,
            vrPrivateEniIds: null,
            vrPublicIp: null,
            vrPrivateIp: null,
            vrPublicEip: null,
            vrPublicSubnetCidr: null,
            vrPrivateSubnetCidr: null
          } as any);
          message.success('VR 实例已解绑');
          reloadDomains();
        } catch (e) {
          console.error('Unbind VR failed', e);
          message.error('解绑失败');
        }
      }
    });
  };

  const columns = useMemo(() => {
    return [
      {
        title: '名称',
        dataIndex: 'name',
        key: 'name',
        render: (text: string, record: SecurityDomain) => (
          <Space direction="vertical" size={0}>
            <Link to={`/admin/sec-mgr-plane/security-domain/${record.id}`} style={{ fontWeight: 400 }}>{text}</Link>
            {record.description ? <span style={{ color: '#8c8c8c', fontSize: 12 }}>{record.description}</span> : null}
          </Space>
        ),
      },
      {
        title: '分类',
        key: 'category',
        render: (_: any, r: SecurityDomain) => {
          const cls = getDomainClass(r);
          const major = netClassLabel(cls);
          const color = netClassColor(cls);
          const subtype = String(r.subType || '').trim();
          const subTypes = subtype ? subtype.split(',').map(s => s.trim()).filter(Boolean) : [];
          return (
            <Space size={4}>
              <Tag color={color}>{major}</Tag>
              {subTypes.length ? (<span style={{ color: '#8c8c8c' }}>/</span>) : null}
              {subTypes.map((t, i) => <Tag key={i}>{t}</Tag>)}
            </Space>
          );
        },
      },
      {
        title: '云厂商/地域',
        key: 'providerRegion',
        render: (_: any, r: SecurityDomain) => {
          const provider = String(r.provider || '').trim();
          const region = String(r.region || '').trim();
          if (provider && region) return <span>{provider} / {region}</span>;
          if (provider) return <span>{provider}</span>;
          if (region) return <span>{region}</span>;
          return '';
        },
      },
      {
        title: '租户',
        key: 'tenant',
        render: (_: any, r: SecurityDomain) => {
          if (r.tenantName) return r.tenantName;
          const id = String(r.tenantId || '').trim();
          if (!id) return '-';
          const t = tenants.find((x: any) => String(x.id) === id);
          return t ? (t.name || id) : id;
        },
      },
      {
        title: '组织',
        key: 'organization',
        render: (_: any, r: SecurityDomain) => {
          if (r.organizationName) return r.organizationName;
          const id = String(r.organizationId || '').trim();
          if (!id) return '-';
          return id;
        },
      },
      {
        title: '网络来源',
        key: 'source',
        render: (_: any, r: SecurityDomain) => {
          if (r.category === 'vpc') {
            const modeText = r.vpcMode === 'existing' ? '已有VPC' : (r.vpcMode === 'new' ? '新建VPC' : 'VPC');
            return (
              <Space size={4}>
                <Tag color="blue">{modeText}</Tag>
                <span style={{ color: '#8c8c8c' }}>{r.vpcId || ''}</span>
              </Space>
            );
          }
          return '';
        },
      },
      {
        title: 'IPv4 CIDR',
        dataIndex: 'cidr4',
        key: 'cidr4',
        render: (list: string[] = []) => list.length ? list.map((c, idx) => <Tag key={idx}>{c}</Tag>) : '',
      },
      {
        title: 'IPv6 CIDR',
        dataIndex: 'cidr6',
        key: 'cidr6',
        render: (list: string[] = []) => list.length ? list.map((c, idx) => <Tag key={idx}>{c}</Tag>) : '',
      },
      {
        title: '标签',
        dataIndex: 'tags',
        key: 'tags',
        render: (list: string[] = []) => list.length ? list.map((t, idx) => <Tag key={idx}>{t}</Tag>) : '',
      },
      {
        title: '绑定 VR 实例',
        key: 'vr',
        render: (_: any, r: SecurityDomain) => r.vrName ? (
          <Tooltip title={r.vrUuid}><Tag color="geekblue">{r.vrName}</Tag></Tooltip>
        ) : '未绑定',
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (s: SecurityDomainStatus = 'active') => (
          <Tag color={s === 'active' ? 'geekblue' : 'default'}>{s === 'active' ? '启用' : '停用'}</Tag>
        ),
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
      },
      {
        title: '操作',
        key: 'actions',
        fixed: 'right',
        render: (_: any, record: SecurityDomain) => {
          const items: MenuProps['items'] = [
            { key: 'detail', label: '详情' },
            { key: 'edit', label: '编辑' },
            { key: 'changeVr', label: '更换 VR 实例' },
            ...(record.vrUuid ? [{ key: 'unbindVr', label: '解绑 VR 实例' }] : []),
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true },
          ];
          const onMenuClick: MenuProps['onClick'] = ({ key }) => {
            if (key === 'detail') return openDetail(record);
            if (key === 'edit') return openEdit(record);
            if (key === 'changeVr') return openChangeVr(record);
            if (key === 'unbindVr') return handleUnbindVr(record);
            if (key === 'delete') return removeDomain(record);
          };
          return (
            <Dropdown menu={{ items, onClick: onMenuClick }} trigger={['click']}>
              <Button type="text" icon={<EllipsisOutlined />} />
            </Dropdown>
          );
        },
      },
    ];
  }, [createForm, vrOptions, vrCeOptions, openEdit, removeDomain]);

  return (
    <PageContainer
      titleLevel={3}
      asCard={false}
      defaultHiddenColumns={['cidr6', 'tags', 'createdAt']}
      primaryAction={{
        text: '新建安全域',
        onClick: () => navigate('/admin/sec-mgr-plane/security-domain/new'),
      }}
      moreMenuItems={[
        {
          key: 'bulkDel',
          label: '批量删除',
          danger: true,
          disabled: selectedRowKeys.length === 0,
          onClick: removeSelectedDomains,
        },
      ]}
      onRefresh={forceRefresh}
      tableProps={{
        loading,
        rowKey: 'id',
        dataSource: filteredDomains,
        columns: columns as any,
        bordered: true,
        className: 'vr-table',
        rowSelection: {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
        },
        pagination: { pageSize: 8, showSizeChanger: true, pageSizeOptions: ['8', '16', '32'] },
      }}
      toolbarLeft={
        <Form
          className="filter-tools filter-tools--center"
          layout="vertical"
          form={form}
          initialValues={{}}
          style={{ rowGap: 12, columnGap: 12, display: 'flex', alignItems: 'flex-end' }}
          onValuesChange={(changed, all) => {
            setKeyword((all.keyword || '').trim());
            setStatusFilter(all.status || undefined);
            setNetClassFilter(all.netClass || undefined);
          }}
        >
          <Form.Item name="keyword" label="关键字">
            <Input allowClear placeholder="名称/云厂商/地域/描述" style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="netClass" label="网络分类">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 200 }}
              options={[
                { value: 'vpc', label: 'VPC网络' },
                { value: 'flat', label: '扁平网络' },
              ]}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 200 }}
              options={[
                { value: 'active', label: '启用' },
                { value: 'inactive', label: '停用' },
              ]}
            />
          </Form.Item>
        </Form>
      }
    >

      <Modal
        title={editing ? '编辑安全域' : '编辑安全域'}
        open={createOpen}
        onCancel={onCancelCreate}
        onOk={onSubmitCreate}
        okText={'保存'}
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入安全域名称' }]}> 
            <Input placeholder="如：华东生产VPC / 总部办公网" />
          </Form.Item>
          <Form.Item name="category" label="安全域大类"> 
            <Select allowClear placeholder="请选择" options={[{ value: 'vpc', label: 'VPC网络' }, { value: 'flat', label: '扁平网络' }]} />
          </Form.Item>
          <Form.Item name="tenantId" label="所属租户">
            <Select
              allowClear
              placeholder="请选择租户（可选）"
              loading={tenantLoading}
              options={tenants.map((t: any) => ({ value: t.id, label: t.name }))}
              onChange={async (tid: string) => {
                createForm.setFieldsValue({ organizationId: undefined } as any);
                setOrgOptions([]);
                if (!tid) return;
                try {
                  const orgTree = await fetchOrganizationsByTenant(String(tid));
                  const flat: any[] = [];
                  const recur = (list: any[]) => {
                    for (const o of list) {
                      flat.push({ id: o.id, name: o.name });
                      if (Array.isArray(o.children) && o.children.length) recur(o.children);
                    }
                  };
                  recur(Array.isArray(orgTree) ? orgTree : []);
                  setOrgOptions(flat.map(o => ({ value: o.id, label: o.name })));
                } catch {
                  setOrgOptions([]);
                }
              }}
            />
          </Form.Item>
          <Form.Item name="organizationId" label="所属组织">
            <Select
              allowClear
              placeholder="请选择组织（可选）"
              options={orgOptions}
              disabled={!createForm.getFieldValue('tenantId')}
            />
          </Form.Item>
          <Form.Item shouldUpdate={(prev,cur)=>prev.category!==cur.category} noStyle>
            {() => (
              <Form.Item name="subType" label="安全域标签"> 
                <Select 
                  mode="tags"
                  tokenSeparators={[',', ' ']}
                  allowClear 
                  showSearch 
                  optionFilterProp="label" 
                  disabled={!createForm.getFieldValue('category')} 
                  placeholder={createForm.getFieldValue('category') ? '请选择或输入标签（可选）' : '请先选择大类'} 
                  options={(() => {
                    const cat = createForm.getFieldValue('category');
                    if (cat === 'vpc') return [
                      { value: '公有云VPC网络', label: '公有云VPC网络' },
                      { value: '私有云VPC网络', label: '私有云VPC网络' },
                    ];
                    if (cat === 'flat') return [
                      { value: '虚拟化网络', label: '虚拟化网络' },
                      { value: 'IDC网络', label: 'IDC网络' },
                      { value: '办公网络', label: '办公网络' },
                    ];
                    return [];
                  })()} 
                />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="description" label="用途说明"> 
            <Input.TextArea rows={3} placeholder="设定安全域用途与说明" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="安全域详情"
        width={1000}
        onCancel={() => setDetailOpen(false)}
        open={detailOpen}
        footer={<Button onClick={() => setDetailOpen(false)}>关闭</Button>}
      >
        {detailData && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="名称">{detailData.name}</Descriptions.Item>
            <Descriptions.Item label="ID">{detailData.id}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={detailData.status === 'active' ? 'geekblue' : 'default'}>
                {detailData.status === 'active' ? '启用' : '停用'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label={
              <span>
                分类
                <Tooltip title="网络架构类型，区分VPC网络与扁平网络">
                  <QuestionCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.45)' }} />
                </Tooltip>
              </span>
            }>
              {(() => {
                const cls = getDomainClass(detailData);
                const major = netClassLabel(cls);
                const color = netClassColor(cls);
                return (
                  <Space size={4}>
                    <Tag color={color}>{major}</Tag>
                    {detailData.subType && detailData.subType.split(',').map((s, i) => <Tag key={i}>{s.trim()}</Tag>)}
                    {detailData.type && <Tag>{detailData.type}</Tag>}
                  </Space>
                );
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="云厂商/地域">
              {detailData.provider} {detailData.region ? `/ ${detailData.region}` : ''}
            </Descriptions.Item>
            <Descriptions.Item label={
              <span>
                资源池
                <Tooltip title={detailData.cloudId ? `资源池 ID: ${detailData.cloudId}` : '所属云平台或资源池'}>
                  <QuestionCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.45)' }} />
                </Tooltip>
              </span>
            }>
              {detailData.cloudId ? (resourcePoolMap[detailData.cloudId] || detailData.cloudId) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="VPC ID">{detailData.vpcId || '-'}</Descriptions.Item>
            <Descriptions.Item label="IPv4 CIDR" span={2}>
              {(() => {
                const list = new Set<string>();
                if (detailData.cidr) list.add(detailData.cidr);
                if (detailData.cidr4 && Array.isArray(detailData.cidr4)) detailData.cidr4.forEach(c => list.add(c));
                const arr = Array.from(list);
                return arr.length > 0 ? arr.map((c, i) => <Tag key={i}>{c}</Tag>) : '-';
              })()}
            </Descriptions.Item>
            <Descriptions.Item label="IPv6 CIDR" span={2}>
              {(detailData.cidr6 || []).length > 0 ? (detailData.cidr6 || []).map((c, i) => <Tag key={i}>{c}</Tag>) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="VR 实例">
              {detailData.vrName ? <Tag color="geekblue">{detailData.vrName}</Tag> : '未绑定'}
            </Descriptions.Item>
            <Descriptions.Item label="VR UUID">{detailData.vrUuid || '-'}</Descriptions.Item>
            <Descriptions.Item label="VR 实例 ID">{detailData.vrInstanceIds || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网 ENI ID">{detailData.vrPublicEniIds || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网 EIP">{detailData.vrPublicEip || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网 IP">{detailData.vrPublicIp || '-'}</Descriptions.Item>
            <Descriptions.Item label="私网 IP">{detailData.vrPrivateIp || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网子网 CIDR">{detailData.vrPublicSubnetCidr || '-'}</Descriptions.Item>
            <Descriptions.Item label="私网子网 CIDR">{detailData.vrPrivateSubnetCidr || '-'}</Descriptions.Item>
            <Descriptions.Item label="标签" span={2}>
              {(detailData.tags || []).length > 0 ? (detailData.tags || []).map((t, i) => <Tag key={i}>{t}</Tag>) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="用途说明" span={2}>{detailData.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{detailData.createdAt || '-'}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{detailData.updatedAt || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
      <Modal
        title="更换 VR 实例"
        open={changeVrOpen}
        onCancel={() => setChangeVrOpen(false)}
        onOk={handleChangeVrSubmit}
        confirmLoading={changeVrLoading}
      >
        <Form form={changeVrForm} layout="vertical">
          <Form.Item
            name="vrUuid"
            label="VR 实例"
            rules={[{ required: true, message: '请选择 VR 实例' }]}
            extra="更换 VR 实例可能会改变该安全域的流量出口和互联策略，请谨慎操作。"
          >
            <Select
              showSearch
              placeholder="请选择 VR 实例"
              optionFilterProp="label"
              options={vrOptions.map(v => ({ label: v.name, value: v.uuid }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default SecurityDomainPage;
