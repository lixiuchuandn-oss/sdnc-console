import React, { useEffect } from 'react';
import { Descriptions, Tag } from 'antd';
import { SCENARIOS } from '../constants';
import { fetchCsmVRouters, detectCsmPoolId } from '../../../../../../services/api';

interface StepReviewProps {
  form: any;
  scenarioType: string;
  selectedTemplate: string;
  user: any;
  tenants: any[];
  orgOptions: any[];
  nodes: any[];
  edges: any[];
  vrDomains?: any[];
  cloudPools?: any[];
}

const StepReview: React.FC<StepReviewProps> = ({
  form,
  scenarioType,
  selectedTemplate,
  user,
  tenants,
  orgOptions,
  nodes,
  edges,
  vrDomains = [],
  cloudPools = [],
}) => {
  const values = form.getFieldsValue(true);
  
  const scenarioLabel = SCENARIOS[scenarioType].label;
  const templateLabel = SCENARIOS[scenarioType].options.find((o: any) => o.value === selectedTemplate)?.label;
  const clusterName = (() => {
    const sel = cloudPools.find((c: any) => String(c.id) === String(values.cluster));
    return sel?.name || values.cluster || '-';
  })();
  
  const _vrSelectedList = (values.vrDomains || []).map((id: string) => {
    const d = (vrDomains || []).find((v: any) => String(v.id) === String(id));
    const name = d?.name || id;
    const cidr = d?.cidr;
    return cidr ? `${name} (${cidr})` : name;
  });

  const serviceNodes = (nodes || []).filter((n: any) => n.type === 'serviceNode');
  const instanceList = serviceNodes.flatMap((n: any) => ((n.data?.instances || []) as any[]));
  const totalInstances = instanceList.length;
  const abnormalInstances = instanceList.filter((it: any) => it.status !== 'normal').length;
  const avgInstanceLoad = (() => {
    const loads = instanceList.map((it: any) => Number(it.load) || 0);
    if (!loads.length) return 0;
    const sum = loads.reduce((a, b) => a + b, 0);
    return Math.round((sum / loads.length) * 10) / 10;
  })();
  const overallStatus = (() => {
    if (!serviceNodes.length || !totalInstances) return 'unknown';
    return abnormalInstances === 0 ? 'healthy' : 'abnormal';
  })();
  const showUnknown = overallStatus === 'unknown';
  const nodeHealthItems = serviceNodes.map((n: any) => {
    const label = n.data?.typeLabel || n.data?.label || n.id;
    const count = Number(n.data?.instanceCount) || (n.data?.instances || []).length || 0;
    const nodeLoad = Number(n.data?.load) || 0;
    const nodeAbnormal = (n.data?.instances || []).filter((it: any) => it.status !== 'normal').length;
    return { label, count, nodeLoad, nodeAbnormal };
  });
  const _orderedServices = (nodes || [])
    .filter((n: any) => n.type === 'serviceNode')
    .sort((a: any, b: any) => (a.position?.x || 0) - (b.position?.x || 0))
    .map((n: any) => n.data?.serviceType)
    .filter((x: any) => !!x);
  
  const steeringMode = form.getFieldValue('steeringMode') || 'vr';
  const _poolId = String(values.pool_id || '').trim();

  const selectedList = (() => {
      if (steeringMode === 'direct') {
          const objects = form.getFieldValue('selectedAssetObjects') || [];
          return objects.map((o: any) => {
              const name = o.name || '-';
              const val = o.value || o.cidr || '-';
              return `${name} (${val})`;
          });
      }
      return (values.vrDomains || []).map((id: string) => {
        const d = (vrDomains || []).find((v: any) => String(v.id) === String(id));
        const name = d?.name || id;
        const cidr = d?.cidr;
        return cidr ? `${name} (${cidr})` : name;
      });
  })();

  const _targetsCidrs = (() => {
      if (steeringMode === 'direct') {
          const objects = form.getFieldValue('selectedAssetObjects') || [];
          return objects.map((o: any) => String(o.value || o.cidr || '')).filter(Boolean);
      }
      return (values.vrDomains || []).map((id: string) => {
        const d = (vrDomains || []).find((v: any) => String(v.id) === String(id));
        return String(d?.cidr || '').trim();
      }).filter((x: string) => !!x);
  })();

  const detectPoolId = async () => {
    const cloudId = String(values.cluster || '').trim();
    if (!cloudId) return;
    try {
      const resp = await detectCsmPoolId(cloudId);
      const pid = String(resp?.data?.pool_id || '').trim();
      if (pid) { form.setFieldsValue({ pool_id: pid }); return; }
    } catch {}
    try {
      const vjson: any = await fetchCsmVRouters(cloudId);
      const vitems: any[] = Array.isArray(vjson?.data?.items) ? vjson.data.items
        : Array.isArray(vjson?.items) ? vjson.items
        : Array.isArray(vjson?.data) ? vjson.data
        : Array.isArray(vjson) ? vjson
        : [];
      const first = vitems.find((it: any) => it && (it.pool_id != null || it.poolId != null));
      const pid = String((first?.pool_id ?? first?.poolId ?? '') || '').trim();
      if (pid) form.setFieldsValue({ pool_id: pid });
    } catch {}
  };

  useEffect(() => {
    const cloudId = String(values.cluster || '').trim();
    if (cloudId && !form.getFieldValue('pool_id')) {
      detectPoolId();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [String(values.cluster || '')]);

  return (
    <div>
      <div style={{ fontSize: 13, color: '#000', margin: '0 0 8px 0', paddingBottom: 0 }}>基本信息</div>
      <Descriptions
        column={1}
        bordered
        size="small"
      >
        <Descriptions.Item label="场景模式">{scenarioLabel} - {templateLabel}</Descriptions.Item>
        <Descriptions.Item label="服务链名称">{values.name || '-'}</Descriptions.Item>
        <Descriptions.Item label="安全资源池">{clusterName || '-'}</Descriptions.Item>
        <Descriptions.Item label="服务链类型">{values.type === 'bypass' ? <Tag color="cyan">旁路</Tag> : <Tag color="blue">串行</Tag>}</Descriptions.Item>
        <Descriptions.Item label="引流方式">{steeringMode === 'direct' ? '直连引流 (资源池资产)' : 'VR引流 (网际路由域)'}</Descriptions.Item>
        {user?.role === 'super_admin' && (
          <>
            <Descriptions.Item label="所属租户">{tenants.find(t => t.id === values.tenantId)?.name || '-'}</Descriptions.Item>
            <Descriptions.Item label="所属组织">{(orgOptions.find((o: any) => o.value === values.organizationId) || { label: '-' }).label}</Descriptions.Item>
          </>
        )}
        <Descriptions.Item label="描述">{values.description || '-'}</Descriptions.Item>
      </Descriptions>
      <div style={{ height: 8 }} />
      <div style={{ fontSize: 13, color: '#000', margin: '0 0 8px 0', paddingBottom: 0 }}>服务链信息</div>
      <Descriptions
        column={2}
        bordered
        size="small"
      >
        <Descriptions.Item label={steeringMode === 'direct' ? '防护对象（CSM 资产）' : '防护对象（网际路由域）'} span={2}>
          {selectedList.join(', ') || '-'}
        </Descriptions.Item>
        <Descriptions.Item label="总体健康状态">
          {showUnknown ? <Tag color="default">未知</Tag> : (overallStatus === 'healthy' ? <Tag color="green">健康</Tag> : <Tag color="red">异常</Tag>)}
        </Descriptions.Item>
        <Descriptions.Item label="异常实例数（服务实例）">{showUnknown ? '-' : abnormalInstances}</Descriptions.Item>
        <Descriptions.Item label="服务实例总数">{showUnknown ? '-' : totalInstances}</Descriptions.Item>
        <Descriptions.Item label="服务实例平均负载（%）">{showUnknown ? '-' : (avgInstanceLoad ? `${avgInstanceLoad}%` : '-')}</Descriptions.Item>
        <Descriptions.Item label="安全服务节点数">{serviceNodes.length}</Descriptions.Item>
        <Descriptions.Item label="拓扑节点总数（含入口/出口等）">{nodes.length}</Descriptions.Item>
        <Descriptions.Item label="拓扑连线总数">{edges.length}</Descriptions.Item>
        <Descriptions.Item label="服务节点明细" span={2}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {nodeHealthItems.length ? nodeHealthItems.map((it: any) => (
              <div key={it.label} style={{ border: '1px solid #f0f0f0', borderRadius: 4, padding: '6px 8px' }}>
                <div style={{ fontSize: 13, marginBottom: 4 }}>{it.label}</div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  负载 {it.nodeLoad}% ，实例 {it.count} ，异常 {it.nodeAbnormal}
                </div>
              </div>
            )) : <span>-</span>}
          </div>
        </Descriptions.Item>
      </Descriptions>
      <div style={{ height: 8 }} />
    </div>
  );
};

export default StepReview;
