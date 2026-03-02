import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Tag, Typography, message, Modal, Table } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import PageContainer from '../../../components/PageContainer';
import { fetchClouds, fetchCsmElementGroups } from '../../../services/api';
import { listSecurityDomains, getSecurityDomain, updateSecurityDomain } from '../../../services/securityDomainApi';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';

const { Text } = Typography;

interface CloudItem {
  id: string;
  name: string;
  type?: string;
  region?: string;
  config?: any;
}

interface SecurityServiceRow {
  uid: string;
  id: string;
  name: string;
  type: string;
  vendor: string;
  defenseType: string;
  neCount: number | string;
  cloudId: string;
  cloudName: string;
  cloudRegion?: string;
  cloudProvider?: string;
  raw: any;
}

const pickFromSources = (obj: any, keys: string[]) => {
  const sources = [obj, obj?.group, obj?.service, obj?.securityService, obj?.elementGroup, obj?.vmGroup];
  for (const src of sources) {
    for (const k of keys) {
      const v = src?.[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
  }
  return undefined;
};

const normalizeInstanceList = (val: any) => {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') return val.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const items = val?.items || val?.list || val?.data;
  if (Array.isArray(items)) return items;
  return [];
};

const calcNeCountLocal = (r: any) => {
  const v = pickFromSources(r, ['neCount', 'count', 'Count', 'elementCount', 'elementsCount', 'elements_count', 'vm_count', 'vmCount', 'ne_count']);
  if (v === 0 || v) return Number(v);
  const list = normalizeInstanceList(
    pickFromSources(r, [
      'elements',
      'elementList',
      'vmList',
      'vm_list',
      'vms',
      'vm_id_list',
      'vmIds',
      'vmIdList',
      'neList',
      'ne_id_list',
      'neIds',
      'neIdList',
      'instances',
      'instanceList',
      'members',
    ])
  );
  if (list.length > 0) return list.length;
  return '-';
};

const SecurityServices: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [services, setServices] = useState<SecurityServiceRow[]>([]);
  const [clouds, setClouds] = useState<CloudItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [cloudFilter, setCloudFilter] = useState<string | undefined>();
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assigningService, setAssigningService] = useState<SecurityServiceRow | null>(null);
  const [domainOptions, setDomainOptions] = useState<any[]>([]);
  const [domainLoading, setDomainLoading] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState<string | undefined>();
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [domains, setDomains] = useState<any[]>([]);
  const [assignedInfoModalOpen, setAssignedInfoModalOpen] = useState(false);
  const [assignedInfoService, setAssignedInfoService] = useState<SecurityServiceRow | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const cloudListRaw: any = await fetchClouds();
      const cloudList: CloudItem[] = Array.isArray(cloudListRaw) ? cloudListRaw : [];
      const csmClouds = cloudList.filter((c: any) => {
        const pvRaw = String(c?.config?.provider || '').trim().toLowerCase();
        return pvRaw === 'cloudmap.csm';
      });
      setClouds(csmClouds);

      const results = await Promise.all(
        csmClouds.map(async (cloud) => {
          try {
            const res: any = await fetchCsmElementGroups(String(cloud.id));
            const groups =
              Array.isArray(res?.data?.items) ? res.data.items :
              Array.isArray(res?.items) ? res.items :
              Array.isArray(res?.data) ? res.data :
              Array.isArray(res) ? res :
              [];
            return { cloud, groups };
          } catch (e: any) {
            message.error(`加载资源池 ${cloud.name || cloud.id} 的安全服务失败: ${e?.message || e}`);
            return { cloud, groups: [] };
          }
        })
      );

      const rows: SecurityServiceRow[] = [];
      results.forEach(({ cloud, groups }) => {
        (Array.isArray(groups) ? groups : []).forEach((g: any, idx: number) => {
          const idRaw = pickFromSources(g, ['id', 'vm_group_id', 'vmGroupId', 'group_id', 'groupId', 'vm_group_uuid', 'vmGroupUuid']) ?? g?.id ?? idx;
          const id = String(idRaw || '').trim() || `${cloud.id}-${idx}`;
          const name = String(
            pickFromSources(g, ['name', 'vm_group_name', 'vmGroupName', 'groupName', 'securityServiceName', 'serviceName', 'title', 'displayName']) ??
            id
          );
          const type = String(
            pickFromSources(g, ['type', 'groupType', 'vm_type', 'vm_group_type', 'vmGroupType', 'productType', 'product_type', 'kind', 'category']) ??
            ''
          );
          const vendor = String(
            pickFromSources(g, ['vendor', 'manufacturer', 'vendor_name', 'vendorName', 'factory', 'brand', 'company', 'maker', 'provider']) ??
            ''
          );
          const defenseType = String(
            pickFromSources(g, ['defend_type', 'defenseType', 'defense_type', 'protectType', 'protect_type', 'protectionType', 'protection_type', 'securityType', 'security_type']) ??
            ''
          );
          const neCount = calcNeCountLocal(g);
          rows.push({
            uid: `${cloud.id}-${id}`,
            id,
            name,
            type,
            vendor,
            defenseType,
            neCount,
            cloudId: String(cloud.id),
            cloudName: cloud.name,
            cloudRegion: cloud.region,
            cloudProvider: cloud.config?.provider,
            raw: g,
          });
        });
      });

      setServices(rows);
    } catch (e: any) {
      message.error(e?.message || '加载安全服务失败');
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  const loadDomains = async () => {
    try {
      const list = await listSecurityDomains();
      const arr = Array.isArray(list) ? list : [];
      setDomains(arr);
    } catch (e) {
      console.warn('加载安全域列表失败', e);
      setDomains([]);
    }
  };

  useEffect(() => {
    load();
    loadDomains();
  }, []);

  const cloudOptions = useMemo(
    () =>
      clouds.map((c) => ({
        label: `${c.name || c.id}${c.region ? ` / ${c.region}` : ''}`,
        value: String(c.id),
      })),
    [clouds]
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return services.filter((s) => {
      if (cloudFilter && s.cloudId !== cloudFilter) return false;
      if (!kw) return true;
      const text = [
        s.name,
        s.id,
        s.type,
        s.vendor,
        s.defenseType,
        s.cloudName,
        s.cloudRegion,
        s.cloudProvider,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return text.includes(kw);
    });
  }, [services, keyword, cloudFilter]);

  const assignedDomainsForService = useMemo(() => {
    if (!assignedInfoService) return [];
    const sid = assignedInfoService.id;
    return domains.filter((d: any) => {
      const raw = String((d as any).securityServiceIds || '').trim();
      if (!raw) return false;
      const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
      return ids.includes(sid);
    });
  }, [domains, assignedInfoService]);

  const assignedDomainColumns: any[] = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (t: string) => (
        <Text style={{ fontSize: 12 }} copyable>
          {t || '-'}
        </Text>
      ),
    },
    {
      title: '云厂商/地域',
      key: 'providerRegion',
      render: (_: any, d: any) => {
        const provider = d.provider || d.cloudProvider;
        const region = d.region;
        const txt = [provider, region].filter(Boolean).join(' / ');
        return txt || '-';
      },
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
    },
    {
      title: '标签',
      dataIndex: 'subType',
      key: 'subType',
    },
  ];

  const openAssignModal = async (row: SecurityServiceRow) => {
    setAssigningService(row);
    setAssignModalOpen(true);
    setSelectedDomainId(undefined);
    setDomainLoading(true);
    try {
      const list = await listSecurityDomains();
      const arr = Array.isArray(list) ? list : [];
      setDomainOptions(arr);
      setDomains(arr);
    } catch (e: any) {
      message.error(e?.message || '加载安全域列表失败');
      setDomainOptions([]);
    } finally {
      setDomainLoading(false);
    }
  };

  const openAssignedInfoModal = (row: SecurityServiceRow) => {
    setAssignedInfoService(row);
    setAssignedInfoModalOpen(true);
  };

  const handleAssignConfirm = async () => {
    if (!assigningService || !selectedDomainId) {
      message.warning('请选择安全域');
      return;
    }
    setAssignSubmitting(true);
    try {
      const detail = await getSecurityDomain(selectedDomainId);
      const existingRaw = String(detail?.securityServiceIds || '');
      const existingIds = existingRaw
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s);
      if (existingIds.includes(assigningService.id)) {
        message.success('该安全服务已分配到该安全域');
        setAssignModalOpen(false);
        setAssigningService(null);
        setSelectedDomainId(undefined);
        return;
      }
      const nextIds = [...existingIds, assigningService.id];
      const payloadIds = nextIds.join(',');
      await updateSecurityDomain(selectedDomainId, { securityServiceIds: payloadIds });
      message.success('分配成功');
      setAssignModalOpen(false);
      setAssigningService(null);
      setSelectedDomainId(undefined);
    } catch (e: any) {
      message.error(e?.message || '分配失败');
    } finally {
      setAssignSubmitting(false);
    }
  };

  const columns: any[] = [
    {
      title: '服务名称',
      dataIndex: 'name',
      key: 'name',
      render: (t: string, r: SecurityServiceRow) => (
        <Space direction="vertical" size={0}>
          <span>{t || '-'}</span>
        </Space>
      ),
    },
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      render: (t: string, r: SecurityServiceRow) => (
        <Text style={{ fontSize: 12 }} copyable>
          {t || r.id}
        </Text>
      ),
    },
    {
      title: '所属资源池',
      dataIndex: 'cloudName',
      key: 'cloud',
      render: (_: any, r: SecurityServiceRow) => {
        const meta = [r.cloudRegion, r.cloudProvider].filter(Boolean).join(' / ');
        return (
          <Space direction="vertical" size={0}>
            <span>{r.cloudName || r.cloudId}</span>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {meta || r.cloudId}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (t: string) => {
        if (!t) return '-';
        const key = String(t).toLowerCase();
        let color: any = 'blue';
        if (key === 'waf') color = 'blue';
        else if (key === 'ids' || key === 'ips') color = 'cyan';
        else if (key === 'fw' || key === 'firewall') color = 'purple';
        return <Tag color={color}>{t}</Tag>;
      },
    },
    {
      title: '厂商',
      dataIndex: 'vendor',
      key: 'vendor',
      render: (t: string) => t || '-',
    },
    {
      title: '防御类型',
      dataIndex: 'defenseType',
      key: 'defenseType',
      render: (t: string) => {
        if (t === undefined || t === null || t === '') return '-';
        const n = Number(t);
        if (!Number.isNaN(n)) {
          if (n === 1) return '非流量型';
          if (n === 2) return '流量型';
        }
        return t || '-';
      },
    },
    {
      title: '网元数量',
      dataIndex: 'neCount',
      key: 'neCount',
      render: (v: any) => v,
    },
    {
      title: '分配信息',
      key: 'assignment',
      render: (_: any, r: SecurityServiceRow) => {
        const assigned = domains.filter((d: any) => {
          const raw = String((d as any).securityServiceIds || '').trim();
          if (!raw) return false;
          const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
          return ids.includes(r.id);
        });
        if (!assigned.length) return '未分配';
        return (
          <Typography.Link onClick={() => openAssignedInfoModal(r)}>
            已分配 {assigned.length} 个安全域
          </Typography.Link>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, r: SecurityServiceRow) => {
        const items = [
          { key: 'assign', label: '分配到安全域' },
          { key: 'detail', label: '查看元数据' },
        ];
        const onClick = ({ key }: { key: string }) => {
          if (key === 'assign') {
            openAssignModal(r);
          }
          if (key === 'detail') {
            Modal.info({
              title: '安全服务元数据',
              width: 600,
              content: (
                <div
                  style={{
                    maxHeight: 420,
                    overflow: 'auto',
                    background: '#f7f7f7',
                    borderRadius: 8,
                    padding: 12,
                    border: '1px solid #eee',
                  }}
                >
                  <pre
                    style={{
                      margin: 0,
                      fontSize: 12,
                      lineHeight: '20px',
                      fontFamily:
                        'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace',
                    }}
                  >
                    {JSON.stringify(r.raw || r, null, 2)}
                  </pre>
                </div>
              ),
            });
          }
        };
        return <ResourceActionsDropdown items={items} onClick={onClick} buttonType="text" />;
      },
    },
  ];

  return (
    <>
      <PageContainer
        pagePadding="24px 36px"
        toolbarLeft={
          <Space align="end" size={12}>
            <div>
              <div style={{ fontSize: 14, color: '#000000E0', paddingBottom: 8 }}>关键字</div>
              <Input
                allowClear
                style={{ width: 260 }}
                placeholder="服务名称 / ID / 厂商 / 资源池"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: 14, color: '#000000E0', paddingBottom: 8 }}>所属安全资源池</div>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 220 }}
                value={cloudFilter}
                onChange={(v) => setCloudFilter(v)}
                options={cloudOptions}
              />
            </div>
            <Typography.Link
              onClick={() => {
                setKeyword('');
                setCloudFilter(undefined);
              }}
              style={{ padding: 0, margin: 0, height: 30, lineHeight: '30px', display: 'inline-block' }}
            >
              重置
            </Typography.Link>
          </Space>
        }
        toolbarRight={
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading} />
        }
        tableProps={{
          loading,
          rowKey: 'uid',
          dataSource: filtered,
          columns,
          pagination: { pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` },
          bordered: true,
        }}
      />
      <Modal
        title="分配到安全域"
        open={assignModalOpen}
        onOk={handleAssignConfirm}
        onCancel={() => {
          setAssignModalOpen(false);
          setAssigningService(null);
          setSelectedDomainId(undefined);
        }}
        confirmLoading={assignSubmitting}
        destroyOnHidden
        width={1000}
      >
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: '#fafafa', border: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>待分配安全服务</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontWeight: 500 }}>{assigningService?.name || '-'}</span>
            <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{assigningService?.id}</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>目标安全域</div>
          <Select
            style={{ width: '100%' }}
            placeholder="请选择安全域"
            loading={domainLoading}
            value={selectedDomainId}
            onChange={(v) => setSelectedDomainId(v)}
            options={domainOptions.map((d: any) => {
              const extras = [d.provider, d.region].filter(Boolean).join(' / ');
              const extraText = extras ? ` / ${extras}` : '';
              return {
                label: `${d.name || d.id}${extraText}`,
                value: String(d.id),
              };
            })}
            showSearch
            filterOption={(input, option) =>
              typeof option?.label === 'string'
                ? option.label.toLowerCase().includes(input.toLowerCase())
                : false
            }
          />
          <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            仅支持选择已创建的安全域，分配后可在“安全域详情”中查看关联关系。
          </div>
        </div>
      </Modal>
      <Modal
        title="已分配的安全域"
        open={assignedInfoModalOpen}
        onCancel={() => {
          setAssignedInfoModalOpen(false);
          setAssignedInfoService(null);
        }}
        footer={null}
        width={1000}
        destroyOnHidden
      >
        <Table
          bordered
          rowKey="id"
          dataSource={assignedDomainsForService}
          columns={assignedDomainColumns}
          pagination={false}
        />
      </Modal>
    </>
  );
};

export default SecurityServices;
