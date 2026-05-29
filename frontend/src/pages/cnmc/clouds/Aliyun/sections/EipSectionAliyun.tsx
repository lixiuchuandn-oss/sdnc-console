import React, { useMemo, useState } from 'react';
import { App, Button, Input, Table, Modal, Space, Form, InputNumber, Select, Tooltip, Typography } from 'antd';
import { GlobalOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import PageDetailSection, { RowActionsButton } from '../../../../../components/PageDetailSection';
import {
  fetchCloudProviderEips,
  allocateCloudProviderEip,
  releaseCloudProviderEip,
  unassociateAliyunEip,
} from '../../../../../services/aliyunApi';
import { statusTag } from '../../Hw/components/Common';

type EipSectionAliyunProps = {
  cloudId: string;
  eips: any[];
  onSetEips: (list: any[]) => void;
  onRefreshAll?: () => Promise<void> | void;
  showLog?: boolean;
  raw?: any;
};

const internetChargeTypeOptions = [
  { label: '按使用流量计费', value: 'PayByTraffic' },
  { label: '按固定带宽计费', value: 'PayByBandwidth' },
];

const EipSectionAliyun: React.FC<EipSectionAliyunProps> = ({ cloudId, eips, onSetEips, onRefreshAll, showLog, raw }) => {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [allocOpen, setAllocOpen] = useState<boolean>(false);
  const [allocForm] = Form.useForm();

  const refresh = async () => {
    if (!cloudId) return;
    setLoading(true);
    try {
      const json: any = await fetchCloudProviderEips(cloudId);
      const list: any[] =
        json?.data?.EipAddresses?.EipAddress ||
        json?.EipAddresses?.EipAddress ||
        json?.data?.publicIps ||
        json?.publicIps ||
        [];
      onSetEips(Array.isArray(list) ? list : []);
    } catch (e: any) { message.error(e?.message || '刷新失败'); }
    finally { setLoading(false); }
  };

  const reloadAfterWrite = async () => {
    await refresh();
    if (onRefreshAll) await onRefreshAll();
  };

  const submitAlloc = async () => {
    try {
      const values = await allocForm.validateFields();
      setSubmitting(true);
      await allocateCloudProviderEip(cloudId, {
        bandwidth: values.bandwidth,
        internetChargeType: values.internetChargeType,
        name: values.name,
      });
      message.success('EIP 申请成功');
      setAllocOpen(false);
      await reloadAfterWrite();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '申请 EIP 失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnbind = (r: any) => {
    const allocationId = r?.AllocationId || r?.id;
    const instanceId = r?.InstanceId || r?.instance_id;
    if (!allocationId) return;
    Modal.confirm({
      title: '确定解绑该 EIP?',
      content: `EIP ${r?.IpAddress || allocationId} 将与实例 ${instanceId || '-'} 解绑`,
      okText: '确认解绑',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await unassociateAliyunEip(cloudId, allocationId, instanceId ? { InstanceId: String(instanceId) } : {});
          message.success('解绑成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '解绑失败'); }
      },
    });
  };

  const handleRelease = (r: any) => {
    const allocationId = r?.AllocationId || r?.id;
    if (!allocationId) return;
    Modal.confirm({
      title: '确定释放该 EIP?',
      content: `EIP ${r?.IpAddress || allocationId} 释放后将被回收，不可恢复`,
      okText: '确认释放',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await releaseCloudProviderEip(cloudId, allocationId);
          message.success('释放成功');
          await reloadAfterWrite();
        } catch (e: any) { message.error(e?.message || '释放失败'); }
      },
    });
  };

  const filteredEips = useMemo(() => {
    const list = Array.isArray(eips) ? eips : [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((r: any) => {
      const text = `${r?.IpAddress || r?.public_ip_address || ''} ${r?.AllocationId || r?.id || ''} ${r?.InstanceId || r?.instance_id || ''}`.toLowerCase();
      return !kw || text.includes(kw);
    });
  }, [eips, keyword]);

  const columns = useMemo(() => ([
    {
      title: '公网 IP / ID', key: 'ip_id', fixed: 'left' as const, width: 220,
      render: (_: any, r: any) => {
        const ip = r?.IpAddress || r?.public_ip_address || '-';
        const id = r?.AllocationId || r?.id || '-';
        const bw = r?.Bandwidth;
        return (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Typography.Text strong copyable={ip !== '-' ? { text: ip } : false}>{ip}{bw ? `（${bw}Mbps）` : ''}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={id !== '-' ? { text: id } : false}>{id}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '绑定实例', key: 'bind', width: 220,
      render: (_: any, r: any) => {
        const inst = r?.InstanceId || r?.instance_id || '';
        const type = r?.InstanceType || '';
        if (!inst) return <Typography.Text type="secondary">未绑定</Typography.Text>;
        return (
          <Space direction="vertical" size={0}>
            <Typography.Text copyable={{ text: inst }} ellipsis={{ tooltip: inst }} style={{ maxWidth: 180 }}>{inst}</Typography.Text>
            {type && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{type}</Typography.Text>}
          </Space>
        );
      },
    },
    { title: '状态', key: 'status', width: 110, render: (_: any, r: any) => statusTag(r?.Status || r?.status) },
    { title: '操作', key: 'actions', fixed: 'right' as const, width: 80, render: (_: any, r: any) => {
      const bound = !!(r?.InstanceId || r?.instance_id);
      const status = String(r?.Status || r?.status || '');
      const items: any[] = [{ key: 'detail', label: '详情' }];
      if (bound || status === 'InUse') {
        items.push({ key: 'unbind', label: '解绑' });
      } else {
        items.push({ key: 'release', label: '释放', danger: true });
      }
      return (
        <RowActionsButton
          items={items}
          onClick={async ({ key }: { key: string }) => {
            if (key === 'detail') {
              Modal.info({
                title: 'EIP详情',
                width: 600,
                content: (
                  <pre style={{ maxHeight: 400, overflow: 'auto', background: '#f5f5f5', padding: 10 }}>
                    {JSON.stringify(r, null, 2)}
                  </pre>
                ),
                maskClosable: true,
              });
              return;
            }
            if (key === 'unbind') { handleUnbind(r); return; }
            if (key === 'release') { handleRelease(r); return; }
          }}
        />
      );
    } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), []);

  return (
    <PageDetailSection
      title={Label}
      icon={Icon}
      toolbarLeft={(
        <>
          <Input className="toolbar-search" prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />} placeholder="IP / ID / 实例" allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <button type="button" className="toolbar-reset-btn" onClick={() => setKeyword('')}>重置</button>
        </>
      )}
      toolbarRight={(
        <div className="toolbar-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { allocForm.resetFields(); allocForm.setFieldsValue({ bandwidth: 5, internetChargeType: 'PayByTraffic' }); setAllocOpen(true); }}>申请 EIP</Button>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} onClick={refresh} loading={loading} /></Tooltip>
        </div>
      )}
      asCard={false}
    >
      <Table className="std-table" bordered={false} loading={loading} rowKey={(r: any) => r.AllocationId || r.id} dataSource={filteredEips} columns={columns as any} pagination={{
        size: 'small',
        showTotal: (total) => `共 ${total} 条`,
      }} scroll={{ x: true }} />
      {!!showLog && (
        <div style={{ marginTop: 12 }}>
          <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(raw, null, 2)}</pre>
        </div>
      )}

      <Modal
        title="申请 EIP"
        open={allocOpen}
        onCancel={() => setAllocOpen(false)}
        onOk={submitAlloc}
        okText="申请"
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={allocForm} layout="vertical">
          <Form.Item name="bandwidth" label="带宽峰值 (Mbps)" rules={[{ required: true, message: '请输入带宽峰值' }]}>
            <InputNumber min={1} max={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="internetChargeType" label="计费方式" rules={[{ required: true }]}>
            <Select options={internetChargeTypeOptions} />
          </Form.Item>
          <Form.Item name="name" label="名称">
            <Input placeholder="选填" maxLength={128} allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </PageDetailSection>
  );
};

export const Icon = <GlobalOutlined />;
export const Label = 'EIP';
export default EipSectionAliyun;
