import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col, Tooltip, Button, Empty, Spin, Tag } from 'antd';
import {
  AlertOutlined,
  ReloadOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  GatewayOutlined,
  SecurityScanOutlined,
  SwapOutlined,
  ShareAltOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import { 
  fetchCens,
  fetchSrv6Tunnels,
  fetchIPsecVPNs,
  fetchCenAttachments
} from '../../services/api';
import { getACLRules, getNATRules } from '../../services/virtualRouterApi';
import { fetchServiceChains } from '../../services/trafficOrchestration';
import { fetchVrRealtimeList } from '../../services/virtualRouterApi';
import './Dashboard.css';
import { getBarOption, getDonutOption } from './chartUtils';

// --- KPI Card Component ---
const KPICard = ({ title, value, icon, trend, suffix, loading }: any) => (
  <div className="kpi-card">
    <div className="kpi-content">
      <div className="kpi-top-row">
        <span className="kpi-title">{title}</span>
        {trend !== undefined && (
          <div className={`kpi-trend ${trend > 0 ? 'trend-up' : 'trend-down'}`}>
            {trend > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
      <Spin spinning={loading}>
        <div className="kpi-value-wrapper">
          <span className="kpi-value">{value}</span>
          {suffix && <span className="kpi-suffix">{suffix}</span>}
        </div>
      </Spin>
    </div>
    <div className="kpi-icon-wrapper">
      {icon}
    </div>
  </div>
);

const SdnDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [chartsLoading, setChartsLoading] = useState(false);
  const [isDark, setIsDark] = useState(false);

  const [cens, setCens] = useState<any[]>([]);
  const [sdnStats, setSdnStats] = useState<{ cenCount: number; attachCount: number; srv6Count: number; ipsecCount: number; vrCount: number; aclCount: number; natCount: number; scCount: number }>({ cenCount: 0, attachCount: 0, srv6Count: 0, ipsecCount: 0, vrCount: 0, aclCount: 0, natCount: 0, scCount: 0 });
  const [aclDist, setAclDist] = useState<Array<{ name: string; value: number }>>([]);
  const [natDist, setNatDist] = useState<Array<{ name: string; value: number }>>([]);

  const loadCenAttachments = async (cenList: any[]) => {
    if (!cenList || cenList.length === 0) return [];

    try {
      // 限制并发请求，分批处理 (Batch Processing)
      const BATCH_SIZE = 5;
      const results: any[] = [];
      
      for (let i = 0; i < cenList.length; i += BATCH_SIZE) {
        const batch = cenList.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(c => fetchCenAttachments(String(c.id)))
        );
        results.push(...batchResults);
      }
      
      return results;
    } catch (error) {
      console.error('Failed to load CEN attachments:', error);
      return [];
    }
  };

  const loadData = async () => {
    setChartsLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchCens(),
        fetchSrv6Tunnels(),
        fetchIPsecVPNs(),
        getACLRules(),
        getNATRules(),
        fetchServiceChains(),
        fetchVrRealtimeList(500, 1)
      ]);

      const getValue = (res: PromiseSettledResult<any>, defaultVal: any) => 
        res.status === 'fulfilled' ? res.value : defaultVal;

      const cenArr: any[] = getValue(results[0], []);
      const srv6List = getValue(results[1], []);
      const ipsecList = getValue(results[2], []);
      const aclAll = getValue(results[3], []);
      const natAll = getValue(results[4], []);
      const scAll = getValue(results[5], []);
      const vrRealtime = getValue(results[6], []);

      // SDN Stats logic
      const srv6Count = Array.isArray(srv6List) ? srv6List.length : (Array.isArray((srv6List as any)?.data) ? (srv6List as any).data.length : 0);
      const ipsecCount = Array.isArray(ipsecList) ? ipsecList.length : (Array.isArray((ipsecList as any)?.data) ? (ipsecList as any).data.length : 0);
      const aclArr: any[] = Array.isArray((aclAll as any)?.data) ? (aclAll as any).data : (Array.isArray(aclAll) ? aclAll as any[] : []);
      const natArr: any[] = Array.isArray((natAll as any)?.data) ? (natAll as any).data : (Array.isArray(natAll) ? natAll as any[] : []);
      const scArr: any[] = Array.isArray((scAll as any)?.data) ? (scAll as any).data : (Array.isArray(scAll) ? scAll as any[] : []);
      const vrData: any = (vrRealtime as any)?.data ?? vrRealtime;
      const vrList: any[] = Array.isArray(vrData?.page) ? vrData.page : Array.isArray(vrData?.list) ? vrData.list : Array.isArray(vrData?.rows) ? vrData.rows : (Array.isArray(vrData) ? vrData : []);
      
      const vrCount = Array.isArray(vrList) ? vrList.length : 0;
      const aclCount = Array.isArray(aclArr) ? aclArr.length : 0;
      const natCount = Array.isArray(natArr) ? natArr.length : 0;
      const scCount = Array.isArray(scArr) ? scArr.length : 0;
      
      // Chart Data
      const permit = aclArr.filter((r: any) => String(r.action || '').toLowerCase() === 'permit').length;
      const deny = aclArr.filter((r: any) => String(r.action || '').toLowerCase() === 'deny').length;
      setAclDist([{ name: '允许', value: permit }, { name: '拒绝', value: deny }]);
      
      const snat = natArr.filter((r: any) => String(r.type || '').toLowerCase() === 'snat').length;
      const dnat = natArr.filter((r: any) => String(r.type || '').toLowerCase() === 'dnat').length;
      const statNat = natArr.filter((r: any) => String(r.type || '').toLowerCase() === 'static').length;
      setNatDist([{ name: 'SNAT', value: snat }, { name: 'DNAT', value: dnat }, { name: '静态NAT', value: statNat }]);

      // CEN Attachments (Heaviest operation)
      let cenWithAttach: any[] = cenArr;
      let attachCount = 0;
      
      if (cenArr.length > 0) {
        try {
          const attResults = await loadCenAttachments(cenArr);
          
          const uniqueDomainIds = new Set<string>();
          const attachCountsByCen: Record<string, number> = {};
          
          attResults.forEach((res: any, idx: number) => {
            if (res.status === 'fulfilled') {
              const list: any[] = Array.isArray((res.value as any)) ? (res.value as any) : Array.isArray((res.value as any)?.data) ? (res.value as any).data : [];
              let cnt = 0;
              list.forEach((att: any) => {
                const st = String(att?.status || '').toLowerCase();
                const domId = String(att?.securityDomain?.id || att?.securityDomainId || '').trim();
                if (st === 'attached' && domId) {
                  cnt += 1;
                  uniqueDomainIds.add(domId);
                }
              });
              const cenId = String(cenArr[idx]?.id || '');
              if (cenId) attachCountsByCen[cenId] = cnt;
            }
          });
          attachCount = uniqueDomainIds.size;
          cenWithAttach = cenArr.map(c => ({ ...c, attachCount: attachCountsByCen[String(c.id)] || 0 }));
        } catch (e) {
          console.error('CEN Attachment processing error:', e);
          attachCount = (cenArr || []).reduce((s: number, c: any) => s + (c?.attachCount || 0), 0);
          cenWithAttach = cenArr;
        }
      }
      
      setCens(cenWithAttach);
      const cenCount = cenArr.length;
      setSdnStats({ cenCount, attachCount, srv6Count, ipsecCount, vrCount, aclCount, natCount, scCount });

    } catch (err) {
      console.error('Failed to load SDN data:', err);
    } finally {
      setChartsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const el = document.documentElement;
    if (el.getAttribute('data-theme') === 'dark') setIsDark(true);
    
    // Observer for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          setIsDark(el.getAttribute('data-theme') === 'dark');
        }
      });
    });
    
    observer.observe(el, { attributes: true });
    return () => observer.disconnect();
  }, []);

  const cenAttachData = useMemo(() => {
    return cens.map(c => ({ name: c.name, value: c.attachCount || 0 })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [cens]);

  const cenStatusData = useMemo(() => {
    const m: Record<string, number> = {};
    cens.forEach(c => {
      const s = (c.status || 'Unknown');
      m[s] = (m[s] || 0) + 1;
    });
    return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [cens]);

  return (
    <div className="dashboard">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Tooltip title="刷新数据"><Button icon={<ReloadOutlined />} onClick={loadData} /></Tooltip>
      </div>

      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="VR 实例" value={sdnStats.vrCount} icon={<GatewayOutlined />} loading={chartsLoading} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="ACL 规则" value={sdnStats.aclCount} icon={<SecurityScanOutlined />} loading={chartsLoading} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="NAT 规则" value={sdnStats.natCount} icon={<SwapOutlined />} loading={chartsLoading} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="服务链数" value={sdnStats.scCount} icon={<NodeIndexOutlined />} loading={chartsLoading} />
        </Col>
      </Row>
      
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="级联通道数量" value={sdnStats.cenCount} icon={<SafetyCertificateOutlined />} loading={chartsLoading} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="已挂载安全域总数" value={sdnStats.attachCount} icon={<GlobalOutlined />} loading={chartsLoading} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="SRv6 隧道" value={sdnStats.srv6Count} icon={<ShareAltOutlined />} loading={chartsLoading} />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KPICard title="IPsec VPN" value={sdnStats.ipsecCount} icon={<AlertOutlined />} loading={chartsLoading} />
        </Col>
      </Row>
      
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <div className="content-card">
            <div className="card-header">
              <span className="card-title">ACL 允许/拒绝占比</span>
            </div>
            {chartsLoading && aclDist.length === 0 ? <div style={{height:300, display:'flex', alignItems:'center', justifyContent:'center'}}><Spin /></div> :
             aclDist.length > 0 ? (
              <ReactECharts option={getDonutOption(aclDist, isDark)} style={{ height: '300px' }} />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div className="content-card">
            <div className="card-header">
              <span className="card-title">NAT 类型分布</span>
            </div>
            {chartsLoading && natDist.length === 0 ? <div style={{height:300, display:'flex', alignItems:'center', justifyContent:'center'}}><Spin /></div> :
             natDist.length > 0 ? (
              <ReactECharts option={getDonutOption(natDist, isDark)} style={{ height: '300px' }} />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        </Col>
      </Row>
      <Row gutter={[24, 24]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <div className="content-card">
            <div className="card-header">
              <span className="card-title">级联通道附加安全域 Top 8</span>
            </div>
            {chartsLoading && cenAttachData.length === 0 ? <div style={{height:300, display:'flex', alignItems:'center', justifyContent:'center'}}><Spin /></div> :
             cenAttachData.length > 0 ? (
              <ReactECharts option={getBarOption(cenAttachData, isDark)} style={{ height: '300px' }} />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        </Col>
        <Col xs={24} lg={12}>
          <div className="content-card">
            <div className="card-header">
              <span className="card-title">级联通道状态分布</span>
            </div>
            {chartsLoading && cenStatusData.length === 0 ? <div style={{height:300, display:'flex', alignItems:'center', justifyContent:'center'}}><Spin /></div> :
             cenStatusData.length > 0 ? (
              <ReactECharts option={getDonutOption(cenStatusData, isDark)} style={{ height: '300px' }} />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </div>
        </Col>
      </Row>
      <div className="content-card">
        <div className="card-header">
          <span className="card-title">级联通道列表</span>
          <Button type="primary" onClick={() => navigate('/admin/sec-mgr-plane/instances')}>管理实例</Button>
        </div>
        {chartsLoading && cens.length === 0 ? <div style={{padding:40, textAlign:'center'}}><Spin /></div> :
        <Row gutter={[24, 24]}>
          {cens.length > 0 ? cens.map(cen => (
            <Col xs={24} md={12} lg={8} key={cen.id}>
              <div className="resource-card">
                <div className="resource-card-header">
                  <div className="resource-card-header-inner">
                    <div className="resource-icon"><SafetyCertificateOutlined /></div>
                    <div>
                      <div className="resource-info-title">{cen.name}</div>
                      <div className="resource-info-subtitle">{new Date(cen.createdAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <Tag color="blue">{cen.status}</Tag>
                </div>
                <div className="resource-card-body">
                  <div className="resource-stat-row">
                    <div className="resource-stat-label">已附加安全域</div>
                    <div className="resource-stat-value">{cen.attachCount || 0}</div>
                  </div>
                </div>
                <div className="resource-action-wrapper">
                  <Button block onClick={() => navigate('/admin/sec-mgr-plane/instances')}>查看详情</Button>
                </div>
              </div>
            </Col>
          )) : <Col span={24}><Empty description="暂无级联通道" /></Col>}
        </Row>
        }
      </div>
    </div>
  );
};

export default SdnDashboard;