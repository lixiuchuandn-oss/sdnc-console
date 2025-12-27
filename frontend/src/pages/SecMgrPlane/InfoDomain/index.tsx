import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Divider,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Dropdown,
  Steps,
  Radio,
} from 'antd';
import type { MenuProps } from 'antd';
import { PlusOutlined, ReloadOutlined, EllipsisOutlined, EnvironmentOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import '../../common/filters.css';
import { vrApi } from '../../../services/vrApi';
import { getVRRoles } from '../../../services/vrConfigApi';
import { fetchCloudProviderVpcs } from '../../../services/api';
import { listInfoDomains, createInfoDomain, updateInfoDomain, deleteInfoDomain, InfoDomainPayload } from '../../../services/infoDomainApi';
import { getDomainClass, netClassLabel, netClassColor } from '../../../utils/netClass';

export type InfoDomainType = 'IDC' | 'VPC' | '虚拟化网络' | '办公网络';
export type InfoDomainStatus = 'active' | 'inactive';

export interface InfoDomain {
  id: string;
  name: string;
  type?: InfoDomainType;
  category?: string;
  subType?: string;
  provider?: string;
  region?: string;
  cidr4?: string[];
  cidr6?: string[];
  vrUuid?: string;
  vrName?: string;
  tags?: string[];
  description?: string;
  status?: InfoDomainStatus;
  createdAt?: string;
}

interface InfoDomainForm extends InfoDomain {}

interface VRRowOpt {
  uuid: string;
  name: string;
}

const defaultDomains: InfoDomain[] = [
  {
    id: 'dom-001',
    name: '总部办公网',
    type: '办公网络',
    provider: undefined,
    region: undefined,
    cidr4: ['10.10.0.0/16'],
    cidr6: [],
    vrUuid: undefined,
    vrName: undefined,
    tags: ['office', 'main'],
    description: '公司总部办公网络，主要承载办公系统与打印服务',
    status: 'active',
    createdAt: '2024-08-01 10:00:00',
  },
  {
    id: 'dom-002',
    name: '华东生产VPC',
    type: 'VPC',
    provider: '阿里云',
    region: 'cn-shanghai',
    cidr4: ['172.16.0.0/16'],
    cidr6: [],
    vrUuid: undefined,
    vrName: undefined,
    tags: ['prod', 'east'],
    description: '生产业务承载VPC',
    status: 'active',
    createdAt: '2024-08-15 12:00:00',
  },
];

const InfoDomainPage: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<InfoDomainStatus | undefined>();
  const [netClassFilter, setNetClassFilter] = useState<'vpc' | 'flat' | undefined>();

  const [domains, setDomains] = useState<InfoDomain[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [vrOptions, setVrOptions] = useState<VRRowOpt[]>([]);
  const [vrCeOptions, setVrCeOptions] = useState<VRRowOpt[]>([]);
  const [vrLoading, setVrLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<InfoDomain | null>(null);
  const [createForm] = Form.useForm<InfoDomainForm>();

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<InfoDomain | null>(null);

  const initializedRef = useRef(false);

  const loadVRList = async () => {
    setVrLoading(true);
    try {
      const res = await vrApi.getVRInstances(50, 1);
      const list = (res?.data?.list || res?.list || res?.data || []) as any[];
      const opts: VRRowOpt[] = list.map((item: any) => ({
        uuid: item.uuid || item.vm_id || item.id || item.vmId || item.vm_uuid || '',
        name: item.name || item.vm_name || item.vmName || item.uuid || '未命名VR',
      })).filter(v => v.uuid);
      setVrOptions(opts);
      try {
        const roles = await getVRRoles(opts.map(o => o.uuid));
        const ceOpts = opts.filter(o => String(roles?.[o.uuid] || '').toUpperCase() === 'CE');
        setVrCeOptions(ceOpts);
      } catch (e) {
        setVrCeOptions(opts);
      }
    } catch (err: any) {
      message.warning('VR 列表获取失败，暂无法在创建信息域时绑定 VR 实例');
      setVrOptions([]);
      setVrCeOptions([]);
    } finally {
      setVrLoading(false);
    }
  };

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      loadVRList();
      reloadDomains();
    }
  }, []);

  const reloadDomains = async () => {
    try {
      setLoading(true);
      const list = await listInfoDomains();
      const needVpcCidrs = (Array.isArray(list) ? list : []).filter((it: any) => it?.category === 'vpc' && it?.vpcMode === 'existing' && it?.cloudId && it?.vpcId);
      const cloudIds = Array.from(new Set(needVpcCidrs.map((it: any) => String(it.cloudId)))).filter(Boolean);
      const vpcCache: Record<string, any[]> = {};
      for (const cid of cloudIds) {
        try {
          const res = await fetchCloudProviderVpcs(cid);
          const raw = (res?.data || res || []);
          vpcCache[cid] = Array.isArray(raw?.vpcs) ? raw.vpcs : Array.isArray(raw?.Vpcs) ? raw.Vpcs : Array.isArray(raw?.list) ? raw.list : (Array.isArray(raw) ? raw : []);
        } catch (e) {
          vpcCache[cid] = [];
        }
      }
      const normalized: InfoDomain[] = (Array.isArray(list) ? list : []).map((item: any) => {
        let ipv4Cidrs: string[] = [];
        if (item.newVpcCidr) {
          ipv4Cidrs = [item.newVpcCidr];
        } else if (item.category === 'vpc' && item.vpcMode === 'existing' && item.cloudId && item.vpcId) {
          const vpcs = vpcCache[String(item.cloudId)] || [];
          const v = vpcs.find((x: any) => String(x?.VpcId || x?.id || x?.uuid || x?.vpcId || x?.vpc_id) === String(item.vpcId));
          const cidr = v?.CidrBlock || v?.Ipv4CidrBlock || v?.cidr || v?.Cidr || v?.VpcCidr || v?.CidrIpv4 || undefined;
          if (cidr) ipv4Cidrs = [String(cidr)];
        } else if (item.cidr) {
          ipv4Cidrs = [String(item.cidr)];
        }
        return ({
          id: item.id,
          name: item.name,
          type: item.type,
          category: (item as any).category,
          subType: (item as any).subType,
          provider: item.provider,
          region: item.region,
          cidr4: ipv4Cidrs,
          cidr6: typeof (item as any).cidr6 === 'string'
            ? (item as any).cidr6.split(',').map((s: string) => s.trim()).filter(Boolean)
            : ((item as any).cidr6 || []),
          vrUuid: item.vrUuid,
          vrName: item.vrName,
          tags: typeof item.tags === 'string' ? item.tags.split(',').map((s: string) => s.trim()).filter(Boolean) : (item.tags || []),
          description: item.description,
          status: item.status || 'active',
          createdAt: item.createdAt ? String(item.createdAt).slice(0,19).replace('T',' ') : undefined,
          });
      });
      setDomains(normalized);
    } catch (e: any) {
      message.error('获取信息域列表失败');
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
    message.success('已刷新');
  };

  const openDetail = (record: InfoDomain) => {
    setDetailData(record);
    setDetailOpen(true);
  };

  const openEdit = (record: InfoDomain) => {
    setEditing(record);
    setCreateOpen(true);
    loadVRList();
    createForm.setFieldsValue({
      ...record,
      cidr4: record.cidr4 || [],
      cidr6: record.cidr6 || [],
    });
  };

  const removeDomain = (record: InfoDomain) => {
    Modal.confirm({
      title: '确认删除该信息域？',
      content: `信息域名称：${record.name}`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        deleteInfoDomain(record.id)
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
          const payload: Partial<InfoDomainPayload> = {
            name: values.name,
            category: values.category,
            subType: values.subType,
            description: values.description,
            vrUuid: values.vrUuid,
            vrName: values.vrUuid ? (vrCeOptions.find(v => v.uuid === values.vrUuid)?.name || vrOptions.find(v => v.uuid === values.vrUuid)?.name) : undefined,
            tags: Array.isArray(values.tags) ? values.tags.join(',') : values.tags,
            status: values.status || 'active',
          };
          await updateInfoDomain(editing.id, payload);
          message.success('信息域已更新');
          setEditing(null);
          reloadDomains();
        } else {
          const payload: InfoDomainPayload = {
            name: values.name,
            category: values.category,
            subType: values.subType,
            description: values.description,
            vrUuid: values.vrUuid,
            vrName: values.vrUuid ? (vrCeOptions.find(v => v.uuid === values.vrUuid)?.name || vrOptions.find(v => v.uuid === values.vrUuid)?.name) : undefined,
            tags: Array.isArray(values.tags) ? values.tags.join(',') : values.tags,
            status: values.status || 'active',
          };
          await createInfoDomain(payload);
          message.success('信息域已创建');
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

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: InfoDomain) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontWeight: 400 }}>{text}</span>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{record.description || '—'}</span>
        </Space>
      ),
    },
    {
      title: '分类',
      key: 'category',
      render: (_: any, r: InfoDomain) => {
        const cls = getDomainClass(r);
        const major = netClassLabel(cls);
        const color = netClassColor(cls);
        const subtype = r.subType || '—';
        return (
          <Space size={4}>
            <Tag color={color}>{major}</Tag>
            <span style={{ color: '#8c8c8c' }}>/</span>
            <Tag>{subtype}</Tag>
          </Space>
        );
      },
    },
    {
      title: '云厂商/地域',
      key: 'providerRegion',
      render: (_: any, r: InfoDomain) => (
        <span>{r.provider || '—'}{r.region ? ` / ${r.region}` : ''}</span>
      ),
    },
    {
      title: 'IPv4 CIDR',
      dataIndex: 'cidr4',
      key: 'cidr4',
      render: (list: string[] = []) => list.length ? list.map((c, idx) => <Tag key={idx}>{c}</Tag>) : '—',
    },
    {
      title: 'IPv6 CIDR',
      dataIndex: 'cidr6',
      key: 'cidr6',
      render: (list: string[] = []) => list.length ? list.map((c, idx) => <Tag key={idx}>{c}</Tag>) : '—',
    },
    {
      title: '绑定 VR 实例',
      key: 'vr',
      render: (_: any, r: InfoDomain) => r.vrName ? (
        <Tooltip title={r.vrUuid}><Tag color="geekblue">{r.vrName}</Tag></Tooltip>
      ) : '未绑定',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: InfoDomainStatus = 'active') => (
        <Tag color={s === 'active' ? 'geekblue' : 'default'}>{s === 'active' ? '启用' : '停用'}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 160,
      render: (_: any, record: InfoDomain) => {
        const items: MenuProps['items'] = [
          { key: 'detail', label: '详情' },
          { key: 'edit', label: '编辑' },
          { key: 'delete', label: '删除', danger: true },
        ];
        const onMenuClick: MenuProps['onClick'] = ({ key }) => {
          if (key === 'detail') return openDetail(record);
          if (key === 'edit') return openEdit(record);
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

  return (
    <PageContainer
      title="信息域管理"
      titleLevel={3}
      subtitle="信息域代表用户私有网络（IDC/VPC/办公网络）。通过 VR 实例之间建立的 SRv6 隧道或 IPsec 隧道，实现不同信息域之间的互联通信。"
      asCard={false}
    >
      <Divider style={{ margin: '0 0 20px 0' }} />
      <div className="filters-row filters-row--compact">
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
        <Space className="filter-actions">
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/sec-mgr-plane/info-domain/new')}>新建</Button>
          <Button icon={<ReloadOutlined />} onClick={forceRefresh}>刷新</Button>
        </Space>
      </div>

      <Divider dashed style={{ margin: '12px 0' }} />

      <Table
        bordered
        className="vr-table"
        rowKey="id"
        loading={loading}
        dataSource={filteredDomains}
        columns={columns as any}
        pagination={{ pageSize: 8, showSizeChanger: true, pageSizeOptions: ['8', '16', '32'] }}
      />

      <Modal
        title={editing ? '编辑信息域' : '编辑信息域'}
        open={createOpen}
        onCancel={onCancelCreate}
        onOk={onSubmitCreate}
        okText={'保存'}
        cancelText="取消"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入信息域名称' }]}> 
            <Input placeholder="如：华东生产VPC / 总部办公网" />
          </Form.Item>
          <Form.Item name="category" label="信息域大类"> 
            <Select allowClear placeholder="请选择" options={[{ value: 'vpc', label: 'VPC网络' }, { value: 'flat', label: '扁平网络' }]} />
          </Form.Item>
          <Form.Item shouldUpdate={(prev,cur)=>prev.category!==cur.category} noStyle>
            {() => (
              <Form.Item name="subType" label="信息域子类"> 
                <Select 
                  allowClear 
                  showSearch 
                  optionFilterProp="label" 
                  disabled={!createForm.getFieldValue('category')} 
                  placeholder={createForm.getFieldValue('category') ? '请选择子类' : '请先选择大类'} 
                  options={(() => {
                    const cat = createForm.getFieldValue('category');
                    if (cat === 'vpc') return [
                      { value: '公有云VPC网络', label: '公有云VPC网络' },
                      { value: '私有云VPC网络', label: '私有云VPC网络' },
                    ];
                    if (cat === 'flat') return [
                      { value: '虚拟化网络', label: '虚拟化网络' },
                      { value: 'IDC网络', label: 'IDC网络' },
                    ];
                    return [];
                  })()} 
                />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="description" label="用途说明"> 
            <Input.TextArea rows={3} placeholder="设定信息域用途与说明" />
          </Form.Item>
          <Form.Item name="tags" label="标签"> 
            <Select mode="tags" tokenSeparators={[',', ' ']} placeholder="如：prod,east,office" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
};

export default InfoDomainPage;
