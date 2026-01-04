import React from 'react';
import { Table, Space, Input, Button, Popover, Checkbox, Tag } from 'antd';
import { SearchOutlined, SettingOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import SharedToolbar from '../../../../components/SharedToolbar';
import ResourceActionsDropdown from '../../../../components/ResourceActionsDropdown';
import { Modal, message } from 'antd';
import { deleteCsmServiceChain } from '../../../../services/api';
import { fetchCsmServiceChains } from '../../../../services/api';
import { useNavigate } from 'react-router-dom';

type Props = { cloudId: string; showLog?: boolean };

const CsmServiceChainSection: React.FC<Props> = ({ cloudId, showLog }) => {
  const navigate = useNavigate();
  const [items, setItems] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [raw, setRaw] = React.useState<any | null>(null);
  const [searchText, setSearchText] = React.useState('');
  const [visibleColumnKeys, setVisibleColumnKeys] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchCsmServiceChains(cloudId);
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

  const deriveType = (r: any) => {
    const hasSerial = toList(r?.serial_list).length > 0;
    const hasBypass = toList(r?.monitor_list).length > 0;
    if (hasSerial && hasBypass) return '旁路+串行';
    if (hasSerial) return '串行';
    if (hasBypass) return '旁路';
    return '-';
  };

  const columns = [
    { title: '服务链ID', dataIndex: 'service_chain_id', key: 'service_chain_id', render: (_: any, r: any) => r?.service_chain_id || r?.id || '-' },
    { title: '服务链类型', dataIndex: 'type', key: 'type', width: 120, render: (_: any, r: any) => deriveType(r) },
    { title: '防护对象', dataIndex: 'network_ids', key: 'targets', width: 120, render: (v: any) => {
      const n = toList(v).length;
      return `${n} 项`;
    } },
    { title: '安全服务（网元组）', dataIndex: 'services', key: 'services', width: 160, render: (_: any, r: any) => {
      const serialCount = toList(r?.serial_list).length;
      const monitorCount = toList(r?.monitor_list).length;
      const total = serialCount + monitorCount;
      return `${total} 项`;
    } },
    { title: '串行状态', dataIndex: 'serial_status', key: 'serial_status', width: 100, render: (v: any, r: any) => statusTag(v, toList(r?.serial_list).length > 0) },
    { title: '旁路状态', dataIndex: 'monitor_status', key: 'monitor_status', width: 100, render: (v: any, r: any) => statusTag(v, toList(r?.monitor_list).length > 0) },
    { title: '目标流量', dataIndex: 'target_pps', key: 'target_pps', width: 100, render: (t: any) => (t != null ? `${t}pps` : '0.0pps') },
    { title: '来源流量', dataIndex: 'source_pps', key: 'source_pps', width: 100, render: (t: any) => (t != null ? `${t}pps` : '0.0pps') },
    { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, r: any) => {
      const chainId = r?.service_chain_id || r?.id;
      return (
        <ResourceActionsDropdown
          items={[
            { key: 'detail', label: '详情' },
            { key: 'delete', label: '删除', danger: true, disabled: !chainId },
          ]}
          onClick={async ({ key }) => {
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
          buttonProps={{ style: { padding: 0 } }}
        />
      );
    } },
  ] as any[];

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
  }, [items, searchText]);

  return (
    <>
      <SharedToolbar
        left={
          <>
            <Input
              placeholder="搜索名称/ID/类型/状态"
              prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.25)' }} />}
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 220 }}
              allowClear
            />
          </>
        }
        right={
          <Space size={8}>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/admin/security/traffic/service-chains/create')}>
              创建服务链
            </Button>
            <Button icon={<ReloadOutlined />} onClick={load} />
            <Popover
              trigger="click"
              content={(
                <div style={{ maxWidth: 240 }}>
                  {columnOptions.map(opt => (
                    <div key={opt.value} style={{ marginBottom: 6 }}>
                      <Checkbox
                        checked={visibleColumnKeys.includes(opt.value)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setVisibleColumnKeys(prev => {
                            if (checked) return Array.from(new Set([...prev, opt.value]));
                            return prev.filter(k => k !== opt.value);
                          });
                        }}
                      >
                        {opt.label}
                      </Checkbox>
                    </div>
                  ))}
                </div>
              )}
            >
              <Button icon={<SettingOutlined />} />
            </Popover>
          </Space>
        }
      />
      <Table
        bordered
        rowKey={(r:any)=> r.id || r.service_chain_id || r.uuid}
        columns={columnsDisplay}
        dataSource={filteredItems}
        loading={loading}
        pagination={{ showSizeChanger:true, showQuickJumper:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
      />
      {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(raw, null, 2)}</pre></div>)}
    </>
  );
};

export default CsmServiceChainSection;
