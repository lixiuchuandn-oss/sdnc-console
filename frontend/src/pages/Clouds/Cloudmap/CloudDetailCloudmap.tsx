import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tag, Space, Button, Statistic, Row, Col, Alert, Tabs, Descriptions, Dropdown, message, Table } from 'antd';
import { CloudUploadOutlined, SafetyCertificateOutlined, DeploymentUnitOutlined, NodeIndexOutlined, ArrowLeftOutlined, UnorderedListOutlined } from '@ant-design/icons';
import PageDetailContainer from '../../../components/PageDetailContainer';
import { API_BASE_URL, fetchClouds, fetchCloudmapVirtualElements, fetchCloudmapPhysicalElements, fetchCloudmapElementGroups } from '../../../services/api';

interface CloudItem { id: string; name: string; region: string; type: string; config?: any; status?: string; endpoint?: string; description?: string; createdAt?: string; updatedAt?: string; }

const CloudDetailCloudmap: React.FC<{ cloudId: string }> = ({ cloudId }) => {
  const navigate = useNavigate();
  const [cloud, setCloud] = useState<CloudItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [virtualElements, setVirtualElements] = useState<any[]>([]);
  const [physicalElements, setPhysicalElements] = useState<any[]>([]);
  const [elementGroups, setElementGroups] = useState<any[]>([]);
  const [showLog, setShowLog] = useState<boolean>(false);
  const [rawVirtual, setRawVirtual] = useState<any | null>(null);
  const [rawPhysical, setRawPhysical] = useState<any | null>(null);
  const [rawGroups, setRawGroups] = useState<any | null>(null);

  const providerName = 'Cloudmap';
  const versionText = useMemo(() => {
    const fromConfig = cloud?.config?.harvesterVersion;
    return fromConfig || '-';
  }, [cloud]);
  const tlsIgnored = !!(cloud?.config?.ignoreTls);

  const loadAll = async () => {
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
      setElementGroups(Array.isArray(gList) ? gList : []);
      setRawVirtual(virtualJson || null);
      setRawPhysical(physicalJson || null);
      setRawGroups(groupsJson || null);
    } catch (e:any) {
      setError(e?.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [cloudId]);
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
    ...columnsCommon,
    { title: '管理IP', dataIndex: 'manage_ip', key: 'ip', render: (t: any) => t || '-' },
    { title: '配置', key: 'config', render: (_: any, r: any) => {
      if (r.vm_summary) return r.vm_summary;
      if (r.cpu && r.memory) return `${r.cpu}C ${r.memory}G`;
      return '-';
    } },
  ];

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
      subtitle={<span style={{ color: 'rgba(0,0,0,0.45)' }}>CSM 详情（独立页面），汇总平台内资源与网络</span>}
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
                  <Col xs={24} sm={12} md={8}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><DeploymentUnitOutlined style={{ color:'#1677ff', marginRight:8 }} />虚拟安全网元</span>} value={virtualElements.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={8}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><NodeIndexOutlined style={{ color:'#1677ff', marginRight:8 }} />物理安全网元</span>} value={physicalElements.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                  <Col xs={24} sm={12} md={8}><Card size="small" variant="outlined" style={{ borderRadius: 8 }}><Statistic title={<span style={{ display:'flex', alignItems:'center' }}><SafetyCertificateOutlined style={{ color:'#1677ff', marginRight:8 }} />安全网元组</span>} value={elementGroups.length} valueStyle={{ fontSize: 24, fontWeight: 700 }} /></Card></Col>
                </Row>
              </>
            )
          },
          {
            key: 'virtual',
            label: '虚拟安全网元',
            children: (
              <>
                <Table
                  bordered
                  rowKey={(r:any)=> r.id || r.Id || r.uuid || r.vm_id}
                  columns={columnsVirtual}
                  dataSource={virtualElements}
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
        ]}
      />
    </PageDetailContainer>
  );
};

export default CloudDetailCloudmap;
