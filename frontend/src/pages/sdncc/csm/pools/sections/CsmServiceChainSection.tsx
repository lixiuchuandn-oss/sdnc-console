import React from 'react';
import { Table, Input, Tag, Button, Popover } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { ColumnOption } from '../../../../../components/SharedToolbar';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { Modal, message } from 'antd';
import { deleteCsmServiceChain } from '../../../../../services/api';
import { fetchCsmServiceChains, fetchCsmAssets, fetchCsmElementGroups } from '../../../../../services/api';
import { useNavigate } from 'react-router-dom';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';

type Props = { cloudId: string; showLog?: boolean };

const CsmServiceChainSection: React.FC<Props> = ({ cloudId, showLog }) => {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [raw, setRaw] = React.useState<any | null>(null);
  const [searchText, setSearchText] = React.useState('');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<string[]>([]);
  const [assetMap, setAssetMap] = React.useState<Map<string, { name: string; type: string }>>(new Map());
  const [groupMap, setGroupMap] = React.useState<Map<string, string>>(new Map());

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [res, assetRes, groupRes] = await Promise.all([
        fetchCsmServiceChains(cloudId),
        fetchCsmAssets(cloudId).catch(() => ({ data: { items: [] } })),
        fetchCsmElementGroups(cloudId).catch(() => ({ data: { items: [] } }))
      ]);

      const arr =
        Array.isArray(res) ? res
        : Array.isArray(res?.data) ? res.data
        : Array.isArray(res?.data?.items) ? res.data.items
        : Array.isArray(res?.data?.page) ? res.data.page
        : Array.isArray(res?.data?.page?.items) ? res.data.page.items
        : Array.isArray(res?.items) ? res.items
        : Array.isArray(res?.page) ? res.page
        : Array.isArray(res?.page?.items) ? res.page.items
        : Array.isArray(res?.data?.list) ? res.data.list
        : Array.isArray(res?.list) ? res.list
        : Array.isArray(res?.data?.records) ? res.data.records
        : Array.isArray(res?.records) ? res.records
        : [];
      setItems(arr);
      setRaw(res);

      // Process assets
      const assets = Array.isArray(assetRes?.data?.items) ? assetRes.data.items :
                     Array.isArray(assetRes?.items) ? assetRes.items :
                     Array.isArray(assetRes?.data) ? assetRes.data :
                     Array.isArray(assetRes) ? assetRes : [];
      
      const map = new Map<string, { name: string; type: string }>();
      assets.forEach((a: any) => {
        const id = a.network_id || a.id || a.uuid;
        const val = a.value;
        const type = a.type || '虚拟机';
        if (id && val) map.set(id, { name: val, type });
      });
      setAssetMap(map);

      // Process groups
      const groups = Array.isArray(groupRes?.data?.items) ? groupRes.data.items :
                     Array.isArray(groupRes?.items) ? groupRes.items :
                     Array.isArray(groupRes?.data) ? groupRes.data :
                     Array.isArray(groupRes) ? groupRes : [];
      
      const gMap = new Map<string, string>();
      groups.forEach((g: any) => {
        const id = g.vm_group_id || g.id;
        const name = g.vm_group_name || g.name;
        if (id && name) gMap.set(id, name);
      });
      setGroupMap(gMap);

    } catch {
      setItems([]);
      setRaw(null);
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  React.useEffect(() => { load(); }, [load]);

  const toList = (s: any) => {
    if (s == null) return [];
    const str = String(s).trim();
    if (!str) return [];
    return str.split(/[;,]/).map(v => v.trim()).filter(Boolean);
  };

  const statusTag = (val: any, hasFeature: boolean) => {
    if (!hasFeature) return <span>--</span>;
    if (typeof val === 'number') {
      const map: any = { 0: '停止', 1: '正常', 2: '失败', 3: '启动中', 4: '部署中' };
      const colorMap: any = { 0: 'default', 1: 'green', 2: 'red', 3: 'blue', 4: 'processing' };
      return <Tag color={colorMap[val] || 'default'}>{map[val] ?? val}</Tag>;
    }
    const k = String(val || '').toLowerCase();
    const color = k.includes('run') ? 'green' : k.includes('stop') ? 'default' : (k.includes('error') || k.includes('fail') ? 'red' : 'blue');
    return <Tag color={color}>{val || '-'}</Tag>;
  };

  const deriveType = React.useCallback((r: any) => {
    const hasSerial = toList(r?.serial_list).length > 0;
    const hasBypass = toList(r?.monitor_list).length > 0;
    if (hasSerial && hasBypass) return '旁路+串行';
    if (hasSerial) return '串行';
    if (hasBypass) return '旁路';
    return '-';
  }, []);

  const columns = React.useMemo(() => [
    { title: '服务链ID', dataIndex: 'service_chain_id', key: 'service_chain_id', render: (_: any, r: any) => r?.service_chain_id || r?.id || '-' },
    { title: '服务链类型', dataIndex: 'type', key: 'type', render: (_: any, r: any) => deriveType(r) },
    { title: '防护对象', dataIndex: 'network_ids', key: 'targets',  render: (v: any) => {
      const ids = toList(v);
      if (ids.length === 0) return '-';
      
      const dataSource = ids.map((id, i) => {
        const asset = assetMap.get(id);
        return {
          key: i,
          id,
          name: asset?.name || id,
          type: asset?.type || '-'
        };
      });

      const columns = [
        { title: '对象类型', dataIndex: 'type', key: 'type' },
        { title: '防护对象', dataIndex: 'name', key: 'name' },
      ];

      const content = (
        <div className="csm-sc-popover-300">
          <Table
            {...csmStdTableLayoutProps}
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={dataSource}
            pagination={false}
          />
        </div>
      );

      return (
          <Popover content={content}>
             <Button type="link" className="table-link-count">{ids.length} 项</Button>
          </Popover>
      );
    } },
    { title: '安全服务（网元组）', dataIndex: 'services', key: 'services', render: (_: any, r: any) => {
      const serialList = toList(r?.serial_list);
      const monitorList = toList(r?.monitor_list);
      const total = serialList.length + monitorList.length;
      
      if (total === 0) return '-';

      const dataSource = [
        ...serialList.map((id, i) => ({ key: `s-${i}`, id, name: groupMap.get(id) || id, type: '串行' })),
        ...monitorList.map((id, i) => ({ key: `m-${i}`, id, name: groupMap.get(id) || id, type: '旁路' }))
      ];

      const columns = [
        { title: '名称', dataIndex: 'name', key: 'name' },
        { title: '类型', dataIndex: 'type', key: 'type', width: 80, render: (t: string) => (
            <Tag color={t === '串行' ? 'purple' : 'cyan'}>{t}</Tag>
        )},
      ];

      const content = (
        <div className="csm-sc-popover-400">
          <Table
            {...csmStdTableLayoutProps}
            size="small"
            rowKey="key"
            columns={columns}
            dataSource={dataSource}
            pagination={false}
          />
        </div>
      );

      return (
        <Popover content={content}>
           <Button type="link" className="table-link-count">{total} 项</Button>
        </Popover>
      );
    } },
    { title: '串行状态', dataIndex: 'serial_status', key: 'serial_status',  render: (v: any, r: any) => statusTag(v, toList(r?.serial_list).length > 0) },
    { title: '旁路状态', dataIndex: 'monitor_status', key: 'monitor_status',  render: (v: any, r: any) => statusTag(v, toList(r?.monitor_list).length > 0) },
    { title: '目标流量', dataIndex: 'target_pps', key: 'target_pps',  render: (t: any) => (t != null ? `${t}pps` : '0.0pps') },
    { title: '来源流量', dataIndex: 'source_pps', key: 'source_pps',  render: (t: any) => (t != null ? `${t}pps` : '0.0pps') },
    { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, r: any) => {
      const chainId = r?.service_chain_id || r?.id;
      return (
        <ResourceActionsDropdown
          items={[
            { key: 'metadata', label: '查看元数据' },
            { key: 'detail', label: '详情' },
            { type: 'divider' },
            { key: 'delete', label: '删除', danger: true, disabled: !chainId },
          ]}
          onClick={async ({ key }) => {
            if (key === 'metadata') {
              Modal.info({
                title: '服务链元数据',
                width: 600,
                content: (
                  <div style={{ maxHeight: 420, overflow: 'auto', background: '#f7f7f7', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
                    <pre style={{ margin: 0, fontSize: 12, lineHeight: '20px', fontFamily: 'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace' }}>
{JSON.stringify(r, null, 2)}
                    </pre>
                  </div>
                )
              });
              return;
            }
            if (key === 'detail') {
              window.open('#', '_blank');
              return;
            }
            if (key === 'delete' && chainId) {
              Modal.confirm({
                title: '确认删除服务链？',
                onOk: async () => {
                  try {
                    await deleteCsmServiceChain(cloudId, chainId);
                    message.success('删除成功');
                    load();
                  } catch (e: any) {
                    message.error(`删除失败: ${e?.message || e}`);
                  }
                }
              });
            }
          }}
          size="small"
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      );
    } },
  ] as any[], [cloudId, load, assetMap, groupMap, deriveType]);

  React.useEffect(() => {
    const initKeys = columns.map((c: any) => c.key).filter((k: string) => k !== 'action');
    setVisibleColumnKeys(initKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const columnOptions = React.useMemo(() => {
    return columns.filter((c: any) => c.key !== 'action').map((c: any) => ({ label: c.title, value: c.key }));
  }, [columns]);

  const columnsDisplay = React.useMemo(() => {
    return columns.filter((c: any) => c.key === 'action' || visibleColumnKeys.includes(c.key));
  }, [columns, visibleColumnKeys]);

  const filteredItems = React.useMemo(() => {
    const list = Array.isArray(items) ? items : [];
    if (!searchText) return list;
    const lower = searchText.toLowerCase();
    return list.filter((r: any) => {
      const name = String(r?.name || r?.service_chain_name || '').toLowerCase();
      const id = String(r?.id || r?.service_chain_id || r?.uuid || '').toLowerCase();
      const type = String(deriveType(r)).toLowerCase();
      const status = String(r?.status || r?.monitor_status || r?.serial_status || '').toLowerCase();
      return name.includes(lower) || id.includes(lower) || type.includes(lower) || status.includes(lower);
    });
  }, [items, searchText, deriveType]);

  return (
    <>
      <PageDetailSection
        asCard={false}
        autoStyleInputs={false}
        toolbarLeft={(
          <Input
            className="toolbar-search"
            allowClear
            placeholder="搜索名称/ID/类型/状态"
            suffix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        )}
        onRefresh={load}
        refreshLoading={loading}
        primaryAction={{
          label: '创建服务链',
          onClick: () =>
            navigate(
              `/admin/security/traffic/csm-pools/${encodeURIComponent(cloudId)}/service-chains/create`,
            ),
        }}
        columnsConfig={{
          value: visibleColumnKeys,
          options: columnOptions as ColumnOption[],
          onChange: (vals) => setVisibleColumnKeys(vals),
        }}
      >
        <Table
          {...csmStdTableLayoutProps}
          rowKey={(r: any, i?: number) => {
            const k = r.id ?? r.service_chain_id ?? r.uuid;
            return k != null && String(k) !== '' ? String(k) : `chain-${i ?? 0}`;
          }}
          columns={columnsDisplay}
          dataSource={filteredItems}
          loading={loading}
          pagination={csmListPagination}
        />
      </PageDetailSection>
      {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(raw, null, 2)}</pre></div>)}
    </>
  );
};

export default CsmServiceChainSection;
