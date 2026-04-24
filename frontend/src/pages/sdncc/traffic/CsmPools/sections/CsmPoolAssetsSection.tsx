import React, { useMemo, useState } from 'react';
import { Table, Input, Select, Tag, Form, Modal, message } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { ColumnOption } from '../../../../../components/SharedToolbar';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { createCsmAsset, deleteCsmAsset } from '../../../../../services/api';
import { createRowSelection, getColumnOptions, getDisplayColumns } from '../utils/csmDetailHelpers';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';

type Props = {
  cloudId: string;
  assets: any[];
  loading: boolean;
  onRefresh: () => void;
};

const CsmPoolAssetsSection: React.FC<Props> = ({ cloudId, assets, loading, onRefresh }) => {
  const [assetSearch, setAssetSearch] = useState('');
  const [assetType, setAssetType] = useState<string | undefined>(undefined);
  const [assetIpType, setAssetIpType] = useState<string | undefined>(undefined);
  const [assetPort, setAssetPort] = useState('');
  const [assetSelectedRowKeys, setAssetSelectedRowKeys] = useState<React.Key[]>([]);
  const [assetVisibleColumnKeys, setAssetVisibleColumnKeys] = useState<string[]>(['id', 'type', 'ip_type', 'value', 'port', 'action']);
  const [assetCreateOpen, setAssetCreateOpen] = useState(false);
  const [assetEditOpen, setAssetEditOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<any | null>(null);
  const [assetForm] = Form.useForm();
  const [assetEditForm] = Form.useForm();

  const columnsAssets = useMemo(
    () => [
      { title: '防护对象', dataIndex: 'value', key: 'value', render: (t: any) => t || '-' },
      { title: '资产ID', dataIndex: 'network_id', key: 'id', render: (t: any, r: any) => t || r?.id || r?.Id || r?.uuid || '-' },
      { title: '对象类型', dataIndex: 'type', key: 'type', render: (t: any) => {
        const map: any = { subnet: '子网', ip: 'IP', vpc: 'VPC' };
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
                port: (record.port || ''),
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
                    await onRefresh();
                  } catch (e: any) {
                    message.error(e.message || '删除失败');
                  }
                },
              });
            }
          }}
          icon={<EllipsisOutlined />}
          size="small"
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ) },
    ],
    [cloudId, assetEditForm, onRefresh],
  );

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

  const assetColumnOptions = useMemo(() => getColumnOptions(columnsAssets), [columnsAssets]);
  const columnsAssetsDisplay = useMemo(
    () => getDisplayColumns(columnsAssets, assetVisibleColumnKeys),
    [columnsAssets, assetVisibleColumnKeys],
  );
  const assetRowSelection = createRowSelection(assetSelectedRowKeys, setAssetSelectedRowKeys, {
    getCheckboxProps: (record: any) => ({
      value: record.network_id || record.id || record.Id || record.uuid,
    }),
  });

  const handleBatchDeleteAssets = () => {
    if (!assetSelectedRowKeys.length) return;
    Modal.confirm({
      title: '批量删除资产',
      content: `确定删除选中的 ${assetSelectedRowKeys.length} 项资产吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          let ok = 0;
          let fail = 0;
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
          await onRefresh();
        } catch (e: any) {
          message.error(e.message || '批量删除失败');
        }
      },
    });
  };

  const handleCreateAsset = async () => {
    try {
      const values = await assetForm.validateFields();
      const payload: any = {
        type: values.type,
        ip_type: values.ip_type,
        value: values.value,
      };
      if (values.port) payload.port = String(values.port).trim();
      await createCsmAsset(cloudId, payload);
      message.success('创建成功');
      setAssetCreateOpen(false);
      assetForm.resetFields();
      await onRefresh();
    } catch (e: any) {
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
      await onRefresh();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e.message || '更新失败');
    }
  };

  return (
    <>
      <PageDetailSection
        asCard={false}
        autoStyleInputs={false}
        toolbarLeft={(
          <>
            <Input
              className="toolbar-search"
              allowClear
              placeholder="搜索资产ID/值/类型"
              suffix={<SearchOutlined />}
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
            />
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="类型"
              value={assetType}
              onChange={(v) => setAssetType(v || undefined)}
              options={[
                { label: 'IP', value: 'ip' },
                { label: '子网', value: 'subnet' },
                { label: 'VPC', value: 'vpc' },
              ]}
            />
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="IP类型"
              value={assetIpType}
              onChange={(v) => setAssetIpType(v || undefined)}
              options={[
                { label: 'IPv4', value: 'ipv4' },
                { label: 'IPv6', value: 'ipv6' },
              ]}
            />
            <Input
              className="toolbar-input-port-100"
              placeholder="端口"
              value={assetPort}
              onChange={(e) => setAssetPort(e.target.value)}
              allowClear
            />
          </>
        )}
        onRefresh={onRefresh}
        refreshLoading={loading}
        primaryAction={{ label: '创建资产', onClick: () => setAssetCreateOpen(true) }}
        batchActions={{
          items: [
            { key: 'batch_delete', label: '批量删除', danger: true, disabled: assetSelectedRowKeys.length === 0 },
          ],
          onMenuClick: (key) => {
            if (key === 'batch_delete') handleBatchDeleteAssets();
          },
        }}
        columnsConfig={{
          value: assetVisibleColumnKeys.filter((k) => k !== 'action'),
          options: assetColumnOptions as ColumnOption[],
          onChange: (vals) => setAssetVisibleColumnKeys([...vals, 'action']),
        }}
      >
        <Table
          {...csmStdTableLayoutProps}
          rowSelection={assetRowSelection}
          rowKey={(r: any, i?: number) => {
            const k = r.network_id ?? r.id ?? r.Id ?? r.uuid;
            return k != null && String(k) !== '' ? String(k) : `asset-${i ?? 0}`;
          }}
          columns={columnsAssetsDisplay as any}
          dataSource={filteredAssets}
          loading={loading}
          pagination={csmListPagination}
        />
      </PageDetailSection>
      <Modal
        title="创建资产"
        open={assetCreateOpen}
        onCancel={() => setAssetCreateOpen(false)}
        onOk={handleCreateAsset}
        okText="创建"
      >
        <Form form={assetForm} layout="vertical">
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={[{ label: 'IP', value: 'ip' }, { label: '子网', value: 'subnet' }, { label: 'VPC', value: 'vpc' }]} />
          </Form.Item>
          <Form.Item name="ip_type" label="IP类型" initialValue="ipv4" rules={[{ required: true }]}>
            <Select options={[{ label: 'IPv4', value: 'ipv4' }, { label: 'IPv6', value: 'ipv6' }]} />
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
        onCancel={() => { setAssetEditOpen(false); setEditingAsset(null); }}
        onOk={handleEditAsset}
        okText="保存"
      >
        <Form form={assetEditForm} layout="vertical">
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={[{ label: 'IP', value: 'ip' }, { label: '子网', value: 'subnet' }, { label: 'VPC', value: 'vpc' }]} />
          </Form.Item>
          <Form.Item name="ip_type" label="IP类型" rules={[{ required: true }]}>
            <Select options={[{ label: 'IPv4', value: 'ipv4' }, { label: 'IPv6', value: 'ipv6' }]} />
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
  );
};

export default CsmPoolAssetsSection;
