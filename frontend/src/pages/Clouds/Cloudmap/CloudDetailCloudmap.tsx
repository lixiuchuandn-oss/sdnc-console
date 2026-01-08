import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, Dropdown, message, Table, Input, Select, Modal, Popover, Checkbox } from 'antd';
import { CloudUploadOutlined, SafetyCertificateOutlined, DeploymentUnitOutlined, NodeIndexOutlined, ArrowLeftOutlined, UnorderedListOutlined, PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, DesktopOutlined, SearchOutlined, DownOutlined, EllipsisOutlined, SettingOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import SharedToolbar from '../../../components/SharedToolbar';
import { fetchClouds, fetchCloudmapVirtualElements, fetchCloudmapPhysicalElements, fetchCloudmapElementGroups, operateCsmVm, getCsmVmConsole } from '../../../services/api';
import CsmVmDetailModal from '../Csm/modals/CsmVmDetailModal';
import ResourceActionsDropdown from '../../../components/ResourceActionsDropdown';
import CsmServiceChainSection from '../Csm/sections/CsmServiceChainSection';

interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

const CloudDetailCloudmap: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const navigate = useNavigate();
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [virtualElements, setVirtualElements] = useState<any[]>([]);
  const [physicalElements, setPhysicalElements] = useState<any[]>([]);
  const [elementGroups, setElementGroups] = useState<any[]>([]);
  const [showLog, setShowLog] = useState<boolean>(false);
  const [rawVirtual, setRawVirtual] = useState<any | null>(null);
  const [rawPhysical, setRawPhysical] = useState<any | null>(null);
  const [rawGroups, setRawGroups] = useState<any | null>(null);
  const [vmModalOpen, setVmModalOpen] = useState(false);
  const [currentVm, setCurrentVm] = useState<any | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [vendorFilter, setVendorFilter] = useState<string>('');
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>([]);

  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => setSelectedRowKeys(newSelectedRowKeys),
  };

  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    return fromConfig || '-';
  }, [cloud]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);



  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const cloudsRes = await fetchClouds();
      const cloudList: any[] = Array.isArray(cloudsRes) ? cloudsRes : (Array.isArray((cloudsRes as any)?.data) ? (cloudsRes as any).data : []);
      setCloud((cloudList || []).find((c:any)=> String(c.id) === String(cloudId)) || null);
      const [virtualJson, physicalJson, groupsJson] = await Promise.all([
        fetchCloudmapVirtualElements(cloudId).catch(()=>null),
        fetchCloudmapPhysicalElements(cloudId).catch(()=>null),
        fetchCloudmapElementGroups(cloudId).catch(()=>null),
      ]);
      const vList: any[] = (virtualJson as any)?.data?.items || (virtualJson as any)?.items || (virtualJson as any)?.data || [];
      const pList: any[] = (physicalJson as any)?.data?.items || (physicalJson as any)?.items || (physicalJson as any)?.data || [];
      const gList: any[] = (groupsJson as any)?.data?.items || (groupsJson as any)?.items || (groupsJson as any)?.data || [];
      setVirtualElements(Array.isArray(vList) ? vList : []);
      setPhysicalElements(Array.isArray(pList) ? pList : []);
      const groupsFinal = gList;
      setElementGroups(Array.isArray(groupsFinal) ? groupsFinal : []);
      setRawVirtual(virtualJson || null);
      setRawPhysical(physicalJson || null);
      setRawGroups(groupsJson || null);
    } catch (e:any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  }, [cloudId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleBatchOperation = async (action: 'start' | 'stop' | 'reboot') => {
    if (!selectedRowKeys.length) return;
    
    Modal.confirm({
      title: `确定要${action === 'reboot' ? '重启' : action === 'start' ? '启动' : '停止'}选中的 ${selectedRowKeys.length} 台虚拟机吗？`,
      onOk: async () => {
        setOperationLoading(true);
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
            message.success(`批量操作成功`);
          } else {
            message.warning(`操作完成: 成功 ${successCount} 个, 失败 ${failCount} 个`);
          }
          loadAll();
          setSelectedRowKeys([]);
        } catch (e) {
          message.error('操作异常');
        } finally {
          setOperationLoading(false);
        }
      }
    });
  };

  const handleSingleOperation = async (record: any, action: 'start' | 'stop' | 'reboot') => {
    const vmId = record.id || record.Id || record.uuid || record.vm_id;
    if (!vmId) return;
    try {
      await operateCsmVm(cloudId, vmId, action);
      message.success('指令已发送');
      loadAll();
    } catch (e: any) {
      message.error(`操作失败: ${e.message}`);
    }
  };

  const handleConsole = async (record: any) => {
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
  };

  const filteredVirtualElements = useMemo(() => {
    return virtualElements.filter(item => {
      // Filter by Status
      if (filterStatus !== 'all') {
        const s = item.status;
        const k = String(s || '').toLowerCase();
        let statusMatch = false;
        // Map common status to simple keys
        if (filterStatus === 'running') statusMatch = (s === 1 || k.includes('run') || k.includes('正常'));
        else if (filterStatus === 'stopped') statusMatch = (s === 0 || k.includes('stop') || k.includes('关闭'));
        else if (filterStatus === 'error') statusMatch = (s === 2 || k.includes('error') || k.includes('fail') || k.includes('失败'));
        else if (filterStatus === 'other') statusMatch = !((s === 1 || k.includes('run')) || (s === 0 || k.includes('stop')) || (s === 2 || k.includes('error')));
        
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

      // Filter by Search Text
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

  const columnsCommon = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (t: any, r: any) => t || r?.Name || r?.displayName || r?.vm_name || '-' },
    { title: 'ID', dataIndex: 'id', key: 'id', render: (t: any, r: any) => t || r?.Id || r?.uuid || r?.vm_id || '-' },
    { title: '类型', dataIndex: 'type', key: 'type', render: (t: any, r: any) => t || r?.Type || r?.vm_type || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: any) => {
      // Handle integer status from Table 26
      if (typeof s === 'number') {
        const map: any = { 0: '已关闭', 1: '正常', 2: '启动失败', 3: '启动中', 4: '部署中' };
        const colorMap: any = { 0: 'default', 1: 'green', 2: 'red', 3: 'blue', 4: 'processing' };
        return <Tag color={colorMap[s] || 'default'}>{map[s] || s}</Tag>;
      }
      const k = String(s || '').toLowerCase();
      const color = k.includes('run') ? 'green' : k.includes('stop') ? 'orange' : (k.includes('error') ? 'red' : 'blue');
      return <Tag color={color}>{s || '-'}</Tag>;
    } },
    { title: '描述', dataIndex: 'description', key: 'desc', render: (t: any, r: any) => t || r?.Description || '-' },
    { title: '创建时间', dataIndex: 'createdAt', key: 'ctime', render: (t: any, r: any) => t || r?.CreatedAt || r?.createTime || '-' },
  ] as any[];

  const columnsVirtual = [
    { title: '名称', dataIndex: 'name', key: 'name', render: (t: any, r: any) => (
      <Button type="link" style={{ padding: 0 }} onClick={() => { setCurrentVm(r); setVmModalOpen(true); }}>
        {t || r?.vm_name || r?.Name || r?.displayName || '-'}
      </Button>
    )},
    { title: '状态', dataIndex: 'status', key: 'status', width: 100, render: (s: any) => {
      // Handle integer status from Table 26
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
          { key: 'start', label: '开机' },
          { key: 'stop', label: '关机', danger: true },
          { key: 'reboot', label: '重启' },
          { key: 'console', label: '控制台' },
        ]}
        onClick={({ key }) => {
          if (key === 'start') return handleSingleOperation(record, 'start');
          if (key === 'stop') return handleSingleOperation(record, 'stop');
          if (key === 'reboot') return handleSingleOperation(record, 'reboot');
          if (key === 'console') return handleConsole(record);
        }}
        icon={<EllipsisOutlined />}
        size="small"
        buttonProps={{ style: { padding: 0 } }}
      />
    ) },
  ];

  React.useEffect(() => {
    const initKeys = columnsVirtual.map((c: any) => c.key).filter((k: string) => k !== 'action');
    setVisibleColumnKeys(initKeys);
  }, []);

  const columnOptions = React.useMemo(() => {
    return columnsVirtual
      .filter((c: any) => c.key !== 'action')
      .map((c: any) => ({ label: c.title, value: c.key }));
  }, [columnsVirtual]);

  const columnsVirtualDisplay = React.useMemo(() => {
    return columnsVirtual.filter((c: any) => c.key === 'action' || visibleColumnKeys.includes(c.key));
  }, [columnsVirtual, visibleColumnKeys]);

  return (
    <PageDetailContainer
      icon={<CloudUploadOutlined />}
      title={`Cloudmap ${cloud?.name || '-'}`}
      titleLevel={3}
      extra={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/admin/clouds')}></Button>
          <Dropdown
            menu={{
              items: [
                { key: 'refresh', label: '资源刷新' },
                { key: 'toggleLog', label: (showLog ? '隐藏日志' : '显示日志') },
              ],
              onClick: ({ key }) => {
                if (key === 'refresh') { loadAll(); return; }
                if (key === 'toggleLog') { setShowLog(v => !v); return; }
              },
            }}
          >
            <Button icon={<UnorderedListOutlined />} />
          </Dropdown>
        </Space>
      }
      asCard={false}
      subtitle={<span style={{ color: 'rgba(0,0,0,0.45)' }}>Cloudmap 详情（独立页面），汇总平台内资源与网络</span>}
      overviewContent={(
        <Descriptions bordered size="small" column={4}>
          <Descriptions.Item label="资源名称">{cloud?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源供应商">Cloudmap</Descriptions.Item>
          <Descriptions.Item label="资源地域">{cloud?.region || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源类型">{cloud?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="资源状态">{cloud?.status === 'online' ? <Tag color="green">在线</Tag> : cloud?.status === 'maintenance' ? <Tag color="orange">维护</Tag> : cloud?.status === 'offline' ? <Tag color="red">离线</Tag> : <Tag>未知</Tag>}</Descriptions.Item>
          <Descriptions.Item label="Endpoint">{cloud?.endpoint || '-'}</Descriptions.Item>
          <Descriptions.Item label="版本">{versionText}</Descriptions.Item>
          <Descriptions.Item label="TLS 忽略">{tlsIgnored ? <Tag color="orange">是</Tag> : <Tag>否</Tag>}</Descriptions.Item>
          <Descriptions.Item label="资源ID">{cloud?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{cloud?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}
    >
      {error && (
        <Alert type="error" message="查询失败" description={error} style={{ marginBottom: 16 }} showIcon />
      )}
          <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: '资源总览',
            children: (
              <>
                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12} md={8}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><DeploymentUnitOutlined style={{ color:'#1677ff', marginRight:8 }} />虚拟机数量</span>} value={virtualElements.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={8}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />物理安全网元</span>} value={physicalElements.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={8}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><SafetyCertificateOutlined style={{ color:'#1677ff', marginRight:8 }} />安全网元组</span>} value={elementGroups.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                </Row>
              </>
            )
          },
          {
            key: 'virtual',
            label: '虚拟机列表',
            children: (
              <>
                <SharedToolbar
                  left={
                    <>
                      <Input
                        placeholder="搜索名称/IP/类型/厂商"
                        prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.25)' }} />}
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        style={{ width: 200 }}
                        allowClear
                      />
                      <Select
                        value={filterStatus}
                        onChange={setFilterStatus}
                        style={{ width: 120 }}
                        options={[
                          { label: '全部状态', value: 'all' },
                          { label: '运行中', value: 'running' },
                          { label: '已停止', value: 'stopped' },
                          { label: '故障', value: 'error' },
                          { label: '其他', value: 'other' },
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="类型"
                        value={typeFilter || undefined}
                        onChange={(v) => setTypeFilter(v || '')}
                        style={{ width: 140 }}
                        options={[
                          ...Array.from(new Set((virtualElements || []).map((r: any) => String(r?.vm_type || r?.Type || '').trim()).filter(Boolean))).map(t => ({ label: t, value: t }))
                        ]}
                      />
                      <Select
                        allowClear
                        placeholder="厂商"
                        value={vendorFilter || undefined}
                        onChange={(v) => setVendorFilter(v || '')}
                        style={{ width: 140 }}
                        options={[
                          ...Array.from(new Set((virtualElements || []).map((r: any) => String(r?.vm_vendor || '').trim()).filter(Boolean))).map(v => ({ label: v, value: v }))
                        ]}
                      />
                      
                    </>
                  }
                  right={
                    <Space size={8}>
                      <ResourceActionsDropdown
                        items={[
                          { key: 'batch_start', label: '批量开机', disabled: selectedRowKeys.length === 0 },
                          { key: 'batch_stop', label: '批量关机', danger: true, disabled: selectedRowKeys.length === 0 },
                          { key: 'batch_reboot', label: '批量重启', disabled: selectedRowKeys.length === 0 },
                          { type: 'divider' as any },
                          { key: 'single_console', label: '打开控制台（单选）', disabled: selectedRowKeys.length !== 1 },
                        ]}
                        onClick={({ key }) => {
                          if (key === 'batch_start') return handleBatchOperation('start');
                          if (key === 'batch_stop') return handleBatchOperation('stop');
                          if (key === 'batch_reboot') return handleBatchOperation('reboot');
                          if (key === 'single_console') {
                            const r = filteredVirtualElements.find(v => (v.id || v.Id || v.uuid || v.vm_id) === selectedRowKeys[0]);
                            if (r) handleConsole(r);
                          }
                        }}
                        buttonType="default"
                        icon={<EllipsisOutlined />}
                      />
                      <Popover
                        trigger="click"
                        placement="bottomRight"
                        content={(
                          <Checkbox.Group
                            options={columnOptions}
                            value={visibleColumnKeys}
                            onChange={(vals) => setVisibleColumnKeys(vals as string[])}
                          />
                        )}
                      >
                        <Button icon={<SettingOutlined />} />
                      </Popover>
                      <Button icon={<ReloadOutlined />} onClick={loadAll} loading={loading} />
                    </Space>
                  }
                />
                <Table
                  bordered
                  rowSelection={rowSelection}
                  rowKey={(r:any)=> r.id || r.Id || r.uuid || r.vm_id}
                  columns={columnsVirtualDisplay as any}
                  dataSource={filteredVirtualElements}
                  loading={loading}
                  pagination={{ showSizeChanger:true, showQuickJumper:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawVirtual, null, 2)}</pre></div>)}
              </>
            )
          },
          {
            key: 'physical',
            label: '物理安全网元',
            children: (
              <>
                <Table
                  bordered
                  rowKey={(r:any)=> r.id || r.Id || r.uuid}
                  columns={columnsCommon}
                  dataSource={physicalElements}
                  loading={loading}
                  pagination={{ showSizeChanger:true, showQuickJumper:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawPhysical, null, 2)}</pre></div>)}
              </>
            )
          },
          {
            key: 'groups',
            label: '安全网元组',
            children: (
              <>
                <Table
                  bordered
                  rowKey={(r:any)=> r.id || r.Id || r.uuid}
                  columns={[
                    { title: '名称', dataIndex: 'name', key: 'name', render: (t:any,r:any)=> t || r?.Name || '-' },
                    { title: 'ID', dataIndex: 'id', key: 'id', render: (t:any,r:any)=> t || r?.Id || r?.uuid || '-' },
                    { title: '网元数量', dataIndex: 'count', key: 'count', render: (_:any,r:any)=> Array.isArray(r?.elements) ? r.elements.length : (r?.Count ?? '-') },
                    { title: '描述', dataIndex: 'description', key: 'desc', render: (t:any,r:any)=> t || r?.Description || '-' },
                    { title: '创建时间', dataIndex: 'createdAt', key: 'ctime', render: (t:any,r:any)=> t || r?.CreatedAt || r?.createTime || '-' },
                  ] as any}
                  dataSource={elementGroups}
                  loading={loading}
                  pagination={{ showSizeChanger:true, showQuickJumper:true, pageSize:10, pageSizeOptions:[10,20,50,100] }}
                />
                {showLog && (<div style={{ marginTop: 12 }}><pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:300, overflow:'auto' }}>{JSON.stringify(rawGroups, null, 2)}</pre></div>)}
              </>
            )
          },
          {
            key: 'serviceChains',
            label: '服务链',
            children: <CsmServiceChainSection cloudId={cloudId} showLog={showLog} />
          },
        ]}
      />
      <CsmVmDetailModal
        open={vmModalOpen}
        onClose={() => setVmModalOpen(false)}
        vm={currentVm}
        cloudId={cloudId}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailCloudmap;
