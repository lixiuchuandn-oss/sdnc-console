import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { App, Button, Space, Table, Modal, Input, InputNumber, Form, AutoComplete, Select, Tag, Badge, Tooltip, Typography } from 'antd';
import { ReloadOutlined, HddOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import {
  fetchCloudProviderDisks,
  createCloudProviderDisk,
  deleteCloudProviderDisk,
  resizeCloudProviderDisk,
  attachCloudProviderDisk,
  detachCloudProviderDisk,
  createCloudProviderSnapshot,
} from '../../../../../services/aliyunApi';

type Props = {
  cloudId: string;
  instance: any;
  disks?: any[];
  ecs?: any[];
  onSetDisks?: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
};

const diskCategoryOptions = [
  { label: 'ESSD 云盘', value: 'cloud_essd' },
  { label: 'ESSD AutoPL 云盘', value: 'cloud_auto' },
  { label: 'SSD 云盘', value: 'cloud_ssd' },
  { label: '高效云盘', value: 'cloud_efficiency' },
  { label: '普通云盘', value: 'cloud' },
];

const performanceLevelOptions = ['PL0', 'PL1', 'PL2', 'PL3'].map((v) => ({ label: v, value: v }));

const diskStatusMap: Record<string, { status: 'success' | 'processing' | 'error' | 'default' | 'warning', text: string }> = {
  In_use: { status: 'success', text: '使用中' },
  Available: { status: 'processing', text: '待挂载' },
  Attaching: { status: 'warning', text: '挂载中' },
  Detaching: { status: 'warning', text: '卸载中' },
  Creating: { status: 'processing', text: '创建中' },
  ReIniting: { status: 'processing', text: '初始化中' },
};

const diskCategoryMap: Record<string, string> = {
  cloud: '普通云盘',
  cloud_efficiency: '高效云盘',
  cloud_ssd: 'SSD云盘',
  cloud_essd: 'ESSD云盘',
  cloud_auto: 'ESSD AutoPL',
  ephemeral_ssd: '本地SSD',
  ephemeral: '本地磁盘',
};

const chargeTypeLabelMap: Record<string, string> = {
  PrePaid: '包年包月',
  PostPaid: '按量付费',
};

const ensureArray = <T,>(v: T | T[] | undefined | null): T[] => {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
};

const isTrue = (v: any) => v === true || v === 'true' || v === 1 || v === '1';

const getDiskId = (r: any) => r?.DiskId || r?.id || '';
const getDiskName = (r: any) => r?.DiskName || r?.name || r?.Name || '';
const getDiskStatus = (r: any) => r?.Status || r?.status || '';
const getDiskCategory = (r: any) => r?.Category || r?.VolumeType || r?.volumeType || '';
const getDiskChargeType = (r: any) => r?.InstanceChargeType || r?.charge_type || '';
const getDiskSize = (r: any) => (r?.Size != null ? r.Size : r?.size);
const getDiskZone = (r: any) => r?.ZoneId || r?.zone || '';
const getDiskCreationTime = (r: any) => r?.CreationTime || r?.created_at || r?.createdAt || '';
const getDiskAttachments = (r: any): any[] => {
  const atts1 = ensureArray<any>(r?.Attachments?.Attachment);
  const atts2 = ensureArray<any>(r?.attachments);
  return [...atts1, ...atts2].filter(Boolean);
};

const getAliyunDiskTypeLabel = (r: any) => {
  const t = String(r?.Type || r?.type || '').toLowerCase();
  if (t === 'system') return '系统盘';
  if (t === 'data') return '数据盘';
  return '';
};

const filterDisksForInstance = (list: any[], instanceId: string) => {
  if (!instanceId) return Array.isArray(list) ? list : [];
  const iid = String(instanceId || '');
  return (Array.isArray(list) ? list : []).filter((d: any) => {
    const allAtts = getDiskAttachments(d);
    const matchAtt = allAtts.some((a: any) => {
      const rid = a?.InstanceId || a?.server_id || a?.instance_id;
      return String(rid || '') === iid;
    });
    const rid = d?.InstanceId || d?.instance_id || '';
    return matchAtt || (String(rid || '') === iid);
  });
};

const DiskSectionAliyun: React.FC<Props> = ({ cloudId, instance, disks, ecs, onSetDisks, onRefreshAll }) => {
  const { message } = App.useApp();
  const [loading, setLoading] = useState<boolean>(false);
  const [local, setLocal] = useState<any[]>(Array.isArray(disks) ? disks : []);
  const [keyword, setKeyword] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [payTypeFilter, setPayTypeFilter] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [createForm] = Form.useForm();
  const [resizeOpen, setResizeOpen] = useState<boolean>(false);
  const [resizeForm] = Form.useForm();
  const [resizeTarget, setResizeTarget] = useState<any | null>(null);
  const [attachOpen, setAttachOpen] = useState<boolean>(false);
  const [attachForm] = Form.useForm();
  const [attachTarget, setAttachTarget] = useState<any | null>(null);
  const [snapOpen, setSnapOpen] = useState<boolean>(false);
  const [snapForm] = Form.useForm();
  const [snapTarget, setSnapTarget] = useState<any | null>(null);

  useEffect(() => { setLocal(Array.isArray(disks) ? disks : []); }, [disks]);

  const load = useCallback(async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json: any = await fetchCloudProviderDisks(cloudId);
      const raw = json?.data?.Disks?.Disk ?? json?.disks;
      const list: any[] = ensureArray<any>(raw);
      if (onSetDisks) onSetDisks(Array.isArray(list) ? list : []);
      else setLocal(Array.isArray(list) ? list : []);
      message.success('云硬盘已刷新');
    } catch (e: any) { message.error(e?.message || '查询云硬盘失败'); }
    finally { setLoading(false); }
  }, [cloudId, message, onSetDisks]);

  const reloadAfterWrite = useCallback(async () => {
    await load();
    if (onRefreshAll) await onRefreshAll();
  }, [load, onRefreshAll]);

  const iid = String(instance?.InstanceId || instance?.id || '');

  const zoneSuggestions = useMemo(() => {
    const set = new Set<string>();
    (Array.isArray(disks) ? disks : (local || [])).forEach((d: any) => {
      const z = getDiskZone(d);
      if (z) set.add(z);
    });
    (Array.isArray(ecs) ? ecs : []).forEach((i: any) => {
      const z = i?.ZoneId || i?.zone;
      if (z) set.add(z);
    });
    return Array.from(set).map((z) => ({ value: z }));
  }, [disks, local, ecs]);

  const openCreate = useCallback(() => {
    createForm.resetFields();
    createForm.setFieldsValue({ diskCategory: 'cloud_essd', size: 40 });
    setCreateOpen(true);
  }, [createForm]);

  const submitCreate = useCallback(async () => {
    try {
      const values = await createForm.validateFields();
      setSubmitting(true);
      await createCloudProviderDisk(cloudId, {
        zoneId: values.zoneId,
        diskCategory: values.diskCategory,
        size: values.size,
        diskName: values.diskName,
        description: values.description,
        performanceLevel: values.diskCategory === 'cloud_essd' ? values.performanceLevel : undefined,
      });
      message.success('云盘创建成功');
      setCreateOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建云盘失败');
    } finally {
      setSubmitting(false);
    }
  }, [cloudId, createForm, message, reloadAfterWrite]);

  const openResize = useCallback((r: any) => {
    setResizeTarget(r);
    resizeForm.resetFields();
    resizeForm.setFieldsValue({ newSize: Number(getDiskSize(r) || 20) + 10, type: 'offline' });
    setResizeOpen(true);
  }, [resizeForm]);

  const submitResize = useCallback(async () => {
    try {
      const values = await resizeForm.validateFields();
      const diskId = getDiskId(resizeTarget);
      if (!diskId) return;
      setSubmitting(true);
      await resizeCloudProviderDisk(cloudId, diskId, { newSize: values.newSize, type: values.type });
      message.success('扩容指令已下发');
      setResizeOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '扩容云盘失败');
    } finally {
      setSubmitting(false);
    }
  }, [cloudId, resizeForm, resizeTarget, message, reloadAfterWrite]);

  const openAttach = useCallback((r: any) => {
    setAttachTarget(r);
    attachForm.resetFields();
    setAttachOpen(true);
  }, [attachForm]);

  const attachInstanceOptions = useMemo(() => {
    const zone = String(getDiskZone(attachTarget) || '');
    return (Array.isArray(ecs) ? ecs : [])
      .filter((i: any) => !zone || String(i?.ZoneId || i?.zone || '') === zone)
      .map((i: any) => ({
        label: `${i?.InstanceName || i?.name || i?.InstanceId || i?.id}（${i?.InstanceId || i?.id}）`,
        value: i?.InstanceId || i?.id,
      }));
  }, [ecs, attachTarget]);

  const submitAttach = useCallback(async () => {
    try {
      const values = await attachForm.validateFields();
      const diskId = getDiskId(attachTarget);
      if (!diskId) return;
      setSubmitting(true);
      await attachCloudProviderDisk(cloudId, diskId, { instanceId: values.instanceId });
      message.success('挂载指令已下发');
      setAttachOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '挂载云盘失败');
    } finally {
      setSubmitting(false);
    }
  }, [cloudId, attachForm, attachTarget, message, reloadAfterWrite]);

  const handleDetach = useCallback((r: any) => {
    const diskId = getDiskId(r);
    const atts = getDiskAttachments(r);
    const attInstanceId = atts[0]?.InstanceId || atts[0]?.instance_id || r?.InstanceId || r?.instance_id;
    if (!diskId || !attInstanceId) { message.error('未找到云盘所属实例'); return; }
    Modal.confirm({
      title: '确定卸载该云盘?',
      content: `云盘 ${getDiskName(r) || diskId} 将从实例 ${attInstanceId} 卸载`,
      okText: '确认卸载',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await detachCloudProviderDisk(cloudId, diskId, { instanceId: String(attInstanceId) });
          message.success('卸载指令已下发');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '卸载云盘失败'); }
      },
    });
  }, [cloudId, message, reloadAfterWrite]);

  const handleDelete = useCallback((r: any) => {
    const diskId = getDiskId(r);
    if (!diskId) return;
    Modal.confirm({
      title: '确定删除该云盘?',
      content: `云盘 ${getDiskName(r) || diskId} 删除后不可恢复`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteCloudProviderDisk(cloudId, diskId);
          message.success('删除成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '删除云盘失败'); }
      },
    });
  }, [cloudId, message, reloadAfterWrite]);

  const openSnapshot = useCallback((r: any) => {
    setSnapTarget(r);
    snapForm.resetFields();
    setSnapOpen(true);
  }, [snapForm]);

  const submitSnapshot = useCallback(async () => {
    try {
      const values = await snapForm.validateFields();
      const diskId = getDiskId(snapTarget);
      if (!diskId) return;
      setSubmitting(true);
      await createCloudProviderSnapshot(cloudId, {
        diskId,
        snapshotName: values.snapshotName,
        description: values.description,
      });
      message.success('创建快照指令已下发');
      setSnapOpen(false);
      if (onRefreshAll) await onRefreshAll();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建快照失败');
    } finally {
      setSubmitting(false);
    }
  }, [cloudId, snapForm, snapTarget, message, onRefreshAll]);

  const sourceList = useMemo(() => (Array.isArray(disks) ? disks : (local || [])), [disks, local]);
  const instanceDisks = useMemo(() => filterDisksForInstance(sourceList, iid), [sourceList, iid]);

  const deferredKeyword = useDeferredValue(keyword);

  const myDisks = useMemo(() => {
    const kw = deferredKeyword.trim().toLowerCase();
    return instanceDisks.filter((r: any) => {
      const name = String(getDiskName(r) || '').toLowerCase();
      const id = String(getDiskId(r) || '').toLowerCase();
      const okKw = !kw || name.includes(kw) || id.includes(kw);

      const st = String(getDiskStatus(r) || '');
      const okSt = !statusFilter || st === statusFilter;

      const cat = String(getDiskCategory(r) || '');
      const okCat = !categoryFilter || cat === categoryFilter;

      const cm = String(getDiskChargeType(r) || '');
      const okPay = !payTypeFilter || cm === payTypeFilter;

      return okKw && okSt && okCat && okPay;
    });
  }, [instanceDisks, deferredKeyword, statusFilter, categoryFilter, payTypeFilter]);

  // 提取筛选选项
  const statusOptions = useMemo(() => {
    const all = new Set<string>();
    instanceDisks.forEach((d: any) => {
      const s = getDiskStatus(d);
      if (s) all.add(s);
    });
    return Array.from(all).map(s => ({ label: diskStatusMap[s]?.text || s, value: s }));
  }, [instanceDisks]);

  const categoryOptions = useMemo(() => {
    const all = new Set<string>();
    instanceDisks.forEach((d: any) => {
      const c = getDiskCategory(d);
      if (c) all.add(c);
    });
    return Array.from(all).map(c => ({ label: diskCategoryMap[c] || c, value: c }));
  }, [instanceDisks]);

  const payTypeOptions = useMemo(() => {
    const all = new Set<string>();
    instanceDisks.forEach((d: any) => {
      const c = getDiskChargeType(d);
      if (c) all.add(c);
    });
    const list = Array.from(all).map(v => ({ label: chargeTypeLabelMap[v] || v, value: v }));
    const order = ['PrePaid', 'PostPaid'];
    list.sort((a, b) => {
      const ai = order.indexOf(a.value);
      const bi = order.indexOf(b.value);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return String(a.label).localeCompare(String(b.label));
    });
    return list;
  }, [instanceDisks]);

  const columns = useMemo(() => [
    { 
      title: '磁盘', 
      key: 'info', 
      fixed: 'left' as const,
      width: 240,
      render: (_: any, r: any) => {
        const name = getDiskName(r) || '-';
        const id = getDiskId(r) || '-';
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong ellipsis={{ tooltip: name }}>{name}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: id }}>
              {id}
            </Typography.Text>
          </Space>
        );
      } 
    },
    { 
      title: '状态', 
      dataIndex: 'Status', 
      key: 'status', 
      width: 100,
      render: (_: any, r: any) => {
        const s = getDiskStatus(r) || '-';
        const map = diskStatusMap[s] || { status: 'default', text: s };
        return <Badge status={map.status} text={map.text} />;
      } 
    },
    { 
      title: '容量', 
      key: 'size', 
      width: 100,
      render: (_: any, r: any) => {
        const sz = getDiskSize(r);
        return sz != null ? <span style={{ fontWeight: 500 }}>{sz} GB</span> : '-';
      },
      sorter: (a: any, b: any) => (Number(getDiskSize(a) ?? 0) - Number(getDiskSize(b) ?? 0))
    },
    { 
      title: '类型', 
      key: 'category', 
      width: 180,
      render: (_: any, r: any) => {
        const cat = getDiskCategory(r);
        const pl = r?.PerformanceLevel; // PL0, PL1, etc.
        const encrypted = isTrue(r?.Encrypted) || isTrue(r?.encrypted);
        const diskTypeLabel = getAliyunDiskTypeLabel(r);
        return (
          <Space direction="vertical" size={2}>
            <span>{diskCategoryMap[cat] || cat || '-'}</span>
            <Space size={4}>
              {diskTypeLabel && <Tag bordered={false} style={{ margin: 0 }}>{diskTypeLabel}</Tag>}
              {pl && <Tag bordered={false} color="blue" style={{ margin: 0 }}>{pl}</Tag>}
              {encrypted && <Tag bordered={false} color="purple" style={{ margin: 0 }}>加密</Tag>}
              {(isTrue(r?.Portable) || isTrue(r?.portable)) && <Tag bordered={false} style={{ margin: 0 }}>可卸载</Tag>}
            </Space>
          </Space>
        );
      } 
    },
    { 
      title: '付费模式', 
      key: 'charge', 
      width: 100,
      render: (_: any, r: any) => {
        const t = getDiskChargeType(r);
        if (!t) return '-';
        if (t === 'PrePaid') return <Tag color="orange">{chargeTypeLabelMap[t] || t}</Tag>;
        return <Tag>{chargeTypeLabelMap[t] || t}</Tag>;
      } 
    },
    { 
      title: '可用区', 
      key: 'zone', 
      width: 120,
      render: (_: any, r: any) => {
        const z = getDiskZone(r);
        return z || '-';
      },
      sorter: (a: any, b: any) => String(getDiskZone(a) || '').localeCompare(String(getDiskZone(b) || '')),
    },
    { 
      title: '挂载点', 
      key: 'device', 
      render: (_: any, r: any) => {
        const allAtts = getDiskAttachments(r);
        
        if (allAtts.length === 0) return <Typography.Text type="secondary">未挂载</Typography.Text>;

        // 如果是实例详情视图，只显示当前实例的挂载点
        if (iid) {
          const att = allAtts.find((a: any) => String(a?.InstanceId || a?.server_id || a?.instance_id || '') === iid);
          return att ? <Tag>{att?.Device || att?.device || '-'}</Tag> : <Typography.Text type="secondary">未挂载</Typography.Text>;
        }
        
        // 否则显示所有挂载点
        return (
          <Space direction="vertical" size={2}>
            {allAtts.map((a: any, idx: number) => (
              <div key={idx} style={{ fontSize: 12 }}>
                <Typography.Text type="secondary">{a?.InstanceId || a?.instance_id}: </Typography.Text>
                <Tag style={{ margin: 0 }}>{a?.Device || a?.device || '-'}</Tag>
              </div>
            ))}
          </Space>
        );
      } 
    },
    { 
      title: '创建时间', 
      key: 'time', 
      width: 160,
      render: (_: any, r: any) => {
        const t = getDiskCreationTime(r);
        if (!t) return '-';
        try {
          return new Date(t).toLocaleString('zh-CN', { hour12: false }); 
        } catch { return t; }
      },
      sorter: (a: any, b: any) => {
        const at = getDiskCreationTime(a);
        const bt = getDiskCreationTime(b);
        const an = Date.parse(String(at || ''));
        const bn = Date.parse(String(bt || ''));
        if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
        return String(at || '').localeCompare(String(bt || ''));
      }
    },
    { 
      title: '操作', 
      key: 'actions', 
      fixed: 'right',
      width: 80,
      render: (_: any, r: any) => {
        const status = String(getDiskStatus(r) || '');
        const isSystem = String(r?.Type || r?.type || '').toLowerCase() === 'system';
        const attached = getDiskAttachments(r).length > 0 || !!(r?.InstanceId || r?.instance_id);
        const items: any[] = [
          { key: 'detail', label: '详情' },
          { key: 'snapshot', label: '创建快照' },
          { key: 'resize', label: '扩容' },
        ];
        if (status === 'Available' && !attached) {
          items.push({ key: 'attach', label: '挂载' });
        }
        if (!isSystem && attached) {
          items.push({ key: 'detach', label: '卸载' });
        }
        if (!isSystem && status === 'Available' && !attached) {
          items.push({ key: 'delete', label: '删除', danger: true });
        }
        return (
          <RowActionsButton
            items={items}
            onClick={async ({ key }) => {
              if (key === 'detail') {
                Modal.info({
                  title: '磁盘详情',
                  width: 600,
                  content: (
                    <pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10, borderRadius: 4 }}>
                      {JSON.stringify(r, null, 2)}
                    </pre>
                  ),
                  maskClosable: true,
                });
                return;
              }
              if (key === 'snapshot') { openSnapshot(r); return; }
              if (key === 'resize') { openResize(r); return; }
              if (key === 'attach') { openAttach(r); return; }
              if (key === 'detach') { handleDetach(r); return; }
              if (key === 'delete') { handleDelete(r); return; }
            }}
          />
        );
      } 
    },
  ], [iid, openSnapshot, openResize, openAttach, handleDetach, handleDelete]);

  return (
    <PageDetailSection
      toolbarLeft={(
        <>
          <Input
            className="toolbar-search"
            prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
            placeholder="名称 / ID"
            allowClear
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
          <Select className="toolbar-filter-sm" placeholder="状态" allowClear value={statusFilter} onChange={setStatusFilter} options={statusOptions} dropdownMatchSelectWidth={false} />
          <Select className="toolbar-filter-sm" placeholder="磁盘类型" allowClear value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} dropdownMatchSelectWidth={false} />
          <Select className="toolbar-filter-sm" placeholder="付费类型" allowClear value={payTypeFilter} onChange={setPayTypeFilter} options={payTypeOptions} dropdownMatchSelectWidth={false} />
          <button type="button" className="toolbar-reset-btn" onClick={() => { setKeyword(''); setStatusFilter(undefined); setCategoryFilter(undefined); setPayTypeFilter(undefined); }}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          {!iid && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建云盘</Button>
          )}
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} loading={loading} onClick={async () => { await load(); if (onRefreshAll) await onRefreshAll(); }} /></Tooltip>
        </div>
      )}
    >
      <Table
        className="std-table"
        bordered={false}
        loading={loading}
        rowKey={(r: any, idx: number | undefined) => String(getDiskId(r) || idx || 0)}
        columns={columns as any}
        dataSource={myDisks}
        pagination={{
          size: 'small',
          showTotal: (total) => `共 ${total} 条`,
        }}
        scroll={{ x: true }}
      />

      <Modal
        title="新建云盘"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="zoneId" label="可用区" rules={[{ required: true, message: '请输入可用区 ZoneId' }]}>
            <AutoComplete options={zoneSuggestions} placeholder="如 cn-hangzhou-i" allowClear filterOption={(v, o) => String(o?.value || '').includes(v)} />
          </Form.Item>
          <Form.Item name="diskCategory" label="云盘类型" rules={[{ required: true, message: '请选择云盘类型' }]}>
            <Select options={diskCategoryOptions} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.diskCategory !== c.diskCategory}>
            {() => createForm.getFieldValue('diskCategory') === 'cloud_essd' ? (
              <Form.Item name="performanceLevel" label="性能等级 (PL)">
                <Select options={performanceLevelOptions} allowClear placeholder="默认 PL1" />
              </Form.Item>
            ) : null}
          </Form.Item>
          <Form.Item name="size" label="容量 (GB)" rules={[{ required: true, message: '请输入容量' }]}>
            <InputNumber min={20} max={32768} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="diskName" label="名称">
            <Input placeholder="选填" maxLength={128} allowClear />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="选填" maxLength={256} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="扩容云盘"
        open={resizeOpen}
        onCancel={() => setResizeOpen(false)}
        onOk={submitResize}
        okText="扩容"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={resizeForm} layout="vertical">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            当前容量：{getDiskSize(resizeTarget) ?? '-'} GB（扩容只能增大，且不可缩小）
          </Typography.Paragraph>
          <Form.Item
            name="newSize"
            label="目标容量 (GB)"
            rules={[
              { required: true, message: '请输入目标容量' },
              {
                validator: (_, v) =>
                  v != null && Number(v) > Number(getDiskSize(resizeTarget) || 0)
                    ? Promise.resolve()
                    : Promise.reject(new Error('目标容量须大于当前容量')),
              },
            ]}
          >
            <InputNumber min={Number(getDiskSize(resizeTarget) || 20) + 1} max={32768} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="type" label="扩容方式" rules={[{ required: true }]}>
            <Select
              options={[
                { label: '离线扩容（需重启实例生效）', value: 'offline' },
                { label: '在线扩容（实例运行中）', value: 'online' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="挂载云盘"
        open={attachOpen}
        onCancel={() => setAttachOpen(false)}
        onOk={submitAttach}
        okText="挂载"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={attachForm} layout="vertical">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            云盘可用区：{getDiskZone(attachTarget) || '-'}（仅可挂载到同可用区的实例）
          </Typography.Paragraph>
          <Form.Item name="instanceId" label="目标实例" rules={[{ required: true, message: '请选择目标实例' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={attachInstanceOptions}
              placeholder={attachInstanceOptions.length ? '请选择实例' : '同可用区暂无可用实例'}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建快照"
        open={snapOpen}
        onCancel={() => setSnapOpen(false)}
        onOk={submitSnapshot}
        okText="创建"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={snapForm} layout="vertical">
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            源云盘：{getDiskName(snapTarget) || getDiskId(snapTarget) || '-'}
          </Typography.Paragraph>
          <Form.Item name="snapshotName" label="快照名称">
            <Input placeholder="选填" maxLength={128} allowClear />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="选填" maxLength={256} />
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <HddOutlined />;
export const Label = '云硬盘';
;(DiskSectionAliyun as any).tabMeta = {
  key: 'disks',
  title: Label,
  icon: <HddOutlined style={{ color: '#1677FF' }} />,
  countOf: (p: any) => {
    const iid = String(p?.instance?.InstanceId || p?.instance?.id || '');
    const list: any[] = Array.isArray(p?.disks) ? p.disks : [];
    if (!iid) return list.length;
    return filterDisksForInstance(list || [], iid).length;
  },
};
export default DiskSectionAliyun;
