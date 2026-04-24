import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Input, Select, Button, Tag, message, Modal } from 'antd';
import { SearchOutlined, EllipsisOutlined } from '@ant-design/icons';
import type { ColumnOption } from '../../../../../components/SharedToolbar';
import PageDetailSection from '../../../../../components/PageDetailSection';
import ResourceActionsDropdown from '../../../../../components/ResourceActionsDropdown';
import { operateCsmVm, getCsmVmConsole, csmSsoLogin } from '../../../../../services/api';
import { createRowSelection, getColumnOptions, getDisplayColumns } from '../utils/csmDetailHelpers';
import { csmListPagination, csmStdTableLayoutProps } from '../utils/csmListTableProps';
import CsmVmDetailModal from '../modals/CsmVmDetailModal';

type Props = {
  cloudId: string;
  virtualElements: any[];
  loading: boolean;
  onRefresh: () => void;
};

const CsmVirtualElementsSection: React.FC<Props> = ({ cloudId, virtualElements, loading, onRefresh }) => {
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [vendorFilter, setVendorFilter] = useState<string>('');
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [currentVm, setCurrentVm] = useState<any | null>(null);

  const handleSingleOperation = useCallback(
    async (record: any, action: 'start' | 'stop' | 'reboot') => {
      const vmId = record.id || record.Id || record.uuid || record.vm_id;
      if (!vmId) return;
      try {
        await operateCsmVm(cloudId, vmId, action);
        message.success('指令已发送');
        onRefresh();
      } catch (e: any) {
        message.error(`操作失败: ${e.message}`);
      }
    },
    [cloudId, onRefresh],
  );

  const handleConsole = useCallback(
    async (record: any) => {
      const vmId = record.id || record.Id || record.uuid || record.vm_id;
      if (!vmId) return;
      try {
        const res = await getCsmVmConsole(cloudId, vmId);
        const url = res?.data?.url || res?.url || (typeof res === 'string' ? res : null);
        if (url) {
          window.open(url, '_blank');
        } else {
          message.warning('未获取到有效的控制台地址');
        }
      } catch (e: any) {
        message.error(`获取控制台失败: ${e.message}`);
      }
    },
    [cloudId],
  );

  const handleBatchOperation = async (action: 'start' | 'stop' | 'reboot') => {
    if (!selectedRowKeys.length) return;
    Modal.confirm({
      title: `确定要${action === 'reboot' ? '重启' : action === 'start' ? '启动' : '停止'}选中的 ${selectedRowKeys.length} 台虚拟机吗？`,
      onOk: async () => {
        try {
          let successCount = 0;
          let failCount = 0;
          for (const key of selectedRowKeys) {
            try {
              await operateCsmVm(cloudId, String(key), action);
              successCount++;
            } catch (e) {
              console.error(`Failed to ${action} VM ${key}:`, e);
              failCount++;
            }
          }
          if (failCount === 0) {
            message.success('批量操作成功');
          } else {
            message.warning(`操作完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
          }
          onRefresh();
          setSelectedRowKeys([]);
        } catch (e) {
          message.error('操作异常');
        }
      },
    });
  };

  const filteredVirtualElements = useMemo(() => {
    return virtualElements.filter((item) => {
      if (filterStatus !== 'all') {
        const s = item.status;
        const k = String(s || '').toLowerCase();
        let statusMatch = false;
        if (filterStatus === 'running') statusMatch = (s === 1 || k.includes('run') || k.includes('正常'));
        else if (filterStatus === 'stopped') statusMatch = (s === 0 || k.includes('stop') || k.includes('关闭'));
        else if (filterStatus === 'error') statusMatch = (s === 2 || k.includes('error') || k.includes('fail') || k.includes('失败'));
        else if (filterStatus === 'other') { statusMatch = !((s === 1 || k.includes('run')) || (s === 0 || k.includes('stop')) || (s === 2 || k.includes('error'))); }
        if (!statusMatch) return false;
      }
      if (typeFilter) {
        const t = String(item.vm_type || item.Type || '').trim();
        if (t !== typeFilter) return false;
      }
      if (vendorFilter) {
        const v = String(item.vm_vendor || '').trim();
        if (v !== vendorFilter) return false;
      }
      if (searchText) {
        const lower = searchText.toLowerCase();
        const name = String(item.vm_name || item.name || '').toLowerCase();
        const ip = String(item.manage_ip || '').toLowerCase();
        const type = String(item.vm_type || item.type || '').toLowerCase();
        const vendor = String(item.vm_vendor || '').toLowerCase();
        return name.includes(lower) || ip.includes(lower) || type.includes(lower) || vendor.includes(lower);
      }
      return true;
    });
  }, [virtualElements, searchText, filterStatus, typeFilter, vendorFilter]);

  const columnsVirtual = useMemo(
    () => [
      { title: '名称', dataIndex: 'name', key: 'name', render: (t: any, r: any) => (
        <Button type="link" className="cell-link" onClick={() => { setCurrentVm(r); setVmModalOpen(true); }}>
          {t || r?.vm_name || r?.Name || r?.displayName || '-'}
        </Button>
      ) },
      { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: any) => {
        if (typeof s === 'number') {
          const map: any = { 0: '已关闭', 1: '正常', 2: '启动失败', 3: '启动中', 4: '部署中' };
          const colorMap: any = { 0: 'default', 1: 'green', 2: 'red', 3: 'blue', 4: 'processing' };
          return <Tag color={colorMap[s] || 'default'}>{map[s] || s}</Tag>;
        }
        const k = String(s || '').toLowerCase();
        const color = k.includes('run') ? 'green' : k.includes('stop') ? 'orange' : (k.includes('error') ? 'red' : 'blue');
        return <Tag color={color}>{s || '-'}</Tag>;
      } },
      { title: '管理IP', dataIndex: 'manage_ip', key: 'ip', width: 140, render: (t: any) => t || '-' },
      { title: '规格', key: 'spec', width: 120, render: (_: any, r: any) => {
        if (r.vm_summary) return r.vm_summary;
        const cpu = r.cpu ? `${r.cpu}C` : '';
        const mem = r.memory ? `${r.memory}G` : '';
        if (cpu || mem) return `${cpu} ${mem}`.trim();
        return '-';
      } },
      { title: '类型', dataIndex: 'vm_type', key: 'type', width: 100, render: (t: any, r: any) => t || r?.Type || '-' },
      { title: '版本', dataIndex: 'vm_version', key: 'version', width: 120, render: (t: any) => t || '-' },
      { title: '厂商', dataIndex: 'vm_vendor', key: 'vendor', width: 100, render: (t: any) => t || '-' },
      { title: '模板', dataIndex: 'template_name', key: 'template', ellipsis: true, render: (t: any) => t || '-' },
      { title: '宿主机ID', dataIndex: 'host_id', key: 'host', ellipsis: true, render: (t: any) => t || '-' },
      { title: '操作', key: 'action', width: 120, fixed: 'right' as 'right', render: (_: any, record: any) => (
        <ResourceActionsDropdown
          items={[
            { key: 'detail', label: '查看元数据' },
            { key: 'start', label: '开机' },
            { key: 'reboot', label: '重启' },
            { key: 'console', label: '控制台' },
            { key: 'sso', label: 'SSO登录' },
            { type: 'divider' as any },
            { key: 'stop', label: '关机', danger: true },
          ]}
          onClick={({ key }) => {
            if (key === 'detail') {
              Modal.info({
                title: '虚拟安全网元元数据',
                width: 600,
                content: (
                  <div style={{ maxHeight: 420, overflow: 'auto', background: '#f7f7f7', borderRadius: 8, padding: 12, border: '1px solid #eee' }}>
                    <pre style={{ margin: 0, fontSize: 12, lineHeight: '20px', fontFamily: 'SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace' }}>
{JSON.stringify(record, null, 2)}
                    </pre>
                  </div>
                ),
              });
              return;
            }
            if (key === 'start') return void handleSingleOperation(record, 'start');
            if (key === 'stop') return void handleSingleOperation(record, 'stop');
            if (key === 'reboot') return void handleSingleOperation(record, 'reboot');
            if (key === 'console') return void handleConsole(record);
            if (key === 'sso') {
              const vmId = record.id || record.Id || record.uuid || record.vm_id;
              if (!vmId) { message.warning('未找到虚机ID'); return; }
              const port = '8011';
              const hide = message.loading('正在发起 SSO 登录...', 0);
              csmSsoLogin(cloudId, String(vmId), port).then((res: any) => {
                hide();
                const raw = res?.data?.data?.url || res?.data?.url || res?.url || '';
                const url = String(raw || '').trim().replace(/^[`'"]|[`'"]$/g, '');
                const steps = res?.data?.steps || res?.steps || {};
                const authStep = steps?.auth;
                const adminStep = steps?.getAdmin;
                const ssoStep = steps?.sso;
                if (url) {
                  const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40);
                  const h = Math.max(800, (window.screen?.availHeight || 900) - 80);
                  const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`;
                  window.open(url, 'csm-sso', features);
                }
                Modal.info({
                  title: 'SSO 返回',
                  width: '90vw',
                  centered: true,
                  styles: {
                    content: { height: '90vh', display: 'flex', flexDirection: 'column' },
                    body: { flex: 1, overflow: 'auto' },
                  },
                  content: (
                    <div>
                      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%' }}>
                        {url ? (
                          <div style={{ marginBottom: 12 }}>
                            <a href={url} target="_blank" rel="noreferrer">{url}</a>
                          </div>
                        ) : null}
                        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 12, height: '100%' }}>
                          <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 0 }}>
                            <div style={{ fontWeight: 600 }}>步骤1 · 鉴权（请求体 / 返回值）</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                              <pre style={{ height: 240, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(authStep?.request ?? null, null, 2)}</pre>
                              <pre style={{ height: 240, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(authStep?.response ?? null, null, 2)}</pre>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 0 }}>
                            <div style={{ fontWeight: 600 }}>步骤2 · 管理员信息（请求体 / 返回值）</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                              <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(adminStep?.request ?? null, null, 2)}</pre>
                              <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(adminStep?.response ?? null, null, 2)}</pre>
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', gap: 8, minHeight: 0 }}>
                            <div style={{ fontWeight: 600 }}>步骤3 · SSO返回（请求体 / 返回值）</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 0 }}>
                              <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(ssoStep?.request ?? null, null, 2)}</pre>
                              <pre style={{ height: 220, overflow: 'auto', padding: 12, background: '#f5f5f5', borderRadius: 8 }}>{JSON.stringify(ssoStep?.response ?? null, null, 2)}</pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ),
                });
              }).catch((e: any) => {
                hide();
                message.error(e?.message || 'SSO 登录失败');
              });
            }
          }}
          icon={<EllipsisOutlined />}
          size="small"
          buttonProps={{ className: 'row-actions-trigger' }}
        />
      ) },
    ],
    [cloudId, handleSingleOperation, handleConsole],
  );

  useEffect(() => {
    const initKeys = columnsVirtual.map((c: any) => c.key).filter((k: string) => k !== 'action');
    setVisibleColumnKeys(initKeys);
  }, [columnsVirtual]);

  const columnOptions = useMemo(() => getColumnOptions(columnsVirtual), [columnsVirtual]);
  const columnsVirtualDisplay = useMemo(
    () => getDisplayColumns(columnsVirtual, visibleColumnKeys),
    [columnsVirtual, visibleColumnKeys],
  );
  const rowSelection = createRowSelection(selectedRowKeys, setSelectedRowKeys);

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
              placeholder="搜索名称/IP/类型/厂商"
              suffix={<SearchOutlined />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <Select
              className="toolbar-filter-sm"
              value={filterStatus}
              onChange={setFilterStatus}
              options={[
                { label: '全部状态', value: 'all' },
                { label: '运行中', value: 'running' },
                { label: '已停止', value: 'stopped' },
                { label: '故障', value: 'error' },
                { label: '其他', value: 'other' },
              ]}
            />
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="类型"
              value={typeFilter || undefined}
              onChange={(v) => setTypeFilter(v || '')}
              options={[
                ...Array.from(new Set((virtualElements || []).map((r: any) => String(r?.vm_type || r?.Type || '').trim()).filter(Boolean))).map((t) => ({ label: t, value: t })),
              ]}
            />
            <Select
              className="toolbar-filter-sm"
              allowClear
              placeholder="厂商"
              value={vendorFilter || undefined}
              onChange={(v) => setVendorFilter(v || '')}
              options={[
                ...Array.from(new Set((virtualElements || []).map((r: any) => String(r?.vm_vendor || '').trim()).filter(Boolean))).map((v) => ({ label: v, value: v })),
              ]}
            />
          </>
        )}
        onRefresh={onRefresh}
        refreshLoading={loading}
        batchActions={{
          items: [
            { key: 'batch_start', label: '批量开机', disabled: selectedRowKeys.length === 0 },
            { key: 'batch_stop', label: '批量关机', danger: true, disabled: selectedRowKeys.length === 0 },
            { key: 'batch_reboot', label: '批量重启', disabled: selectedRowKeys.length === 0 },
            { type: 'divider' },
            { key: 'single_console', label: '打开控制台（单选）', disabled: selectedRowKeys.length !== 1 },
          ],
          onMenuClick: (key) => {
            if (key === 'batch_start') return void handleBatchOperation('start');
            if (key === 'batch_stop') return void handleBatchOperation('stop');
            if (key === 'batch_reboot') return void handleBatchOperation('reboot');
            if (key === 'single_console') {
              const r = filteredVirtualElements.find((v) => (v.id || v.Id || v.uuid || v.vm_id) === selectedRowKeys[0]);
              if (r) void handleConsole(r);
            }
          },
        }}
        columnsConfig={{
          value: visibleColumnKeys,
          options: columnOptions as ColumnOption[],
          onChange: (vals) => setVisibleColumnKeys(vals),
        }}
      >
        <Table
          {...csmStdTableLayoutProps}
          rowSelection={rowSelection}
          rowKey={(r: any, i?: number) => {
            const k = r.id ?? r.Id ?? r.uuid ?? r.vm_id;
            return k != null && String(k) !== '' ? String(k) : `vm-${i ?? 0}`;
          }}
          columns={columnsVirtualDisplay as any}
          dataSource={filteredVirtualElements}
          loading={loading}
          pagination={csmListPagination}
        />
      </PageDetailSection>
      <CsmVmDetailModal
        open={vmModalOpen}
        onClose={() => setVmModalOpen(false)}
        vm={currentVm}
        cloudId={cloudId}
      />
    </>
  );
};

export default CsmVirtualElementsSection;
