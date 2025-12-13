import React from 'react';
import { Button, Descriptions, Modal, Tabs, Table } from 'antd';
import VpcDetailHw from '../VpcDetailHw';
import { statusTag, collectIpv4FromAddresses } from '../components/Common';

type Props = {
  open: boolean;
  cloudId: string;
  detailType: string;
  detailTitle: string;
  detailData: any;
  vpcs: any[];
  subnets: any[];
  routeTables: any[];
  ecs: any[];
  secGroups: any[];
  eips: any[];
  onCancel: () => void;
  onOpenVmDetail: (vm: any) => void;
};

const ResourceDetailModal: React.FC<Props> = ({ open, cloudId, detailType, detailTitle, detailData, vpcs, subnets, routeTables, ecs, secGroups, eips, onCancel, onOpenVmDetail }) => {
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      width={(detailType==='subnet' || detailType==='disk' || detailType==='eip') ? '60vw' : '80vw'}
      destroyOnHidden
      footer={null}
      centered
      styles={{ content: (detailType==='subnet' || detailType==='disk' || detailType==='eip') ? {} : { height: '80vh' }, body: (detailType==='subnet' || detailType==='disk' || detailType==='eip') ? { padding: 12 } : { padding: 12, height: 'calc(80vh - 64px)', overflowY: 'auto' } }}
      title={detailTitle}
    >
      {detailType==='vpc' && (
        <VpcDetailHw
          cloudId={cloudId}
          vpc={detailData}
          vpcs={vpcs}
          subnets={subnets}
          routeTables={routeTables}
          ecs={ecs}
          onOpenVmDetail={(r:any) => onOpenVmDetail(r)}
        />
      )}

      {detailType==='subnet' && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="名称">{detailData?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID">{detailData?.id || detailData?.SubnetId || detailData?.VSwitchId || '-'}</Descriptions.Item>
          <Descriptions.Item label="CIDR">{detailData?.cidr || detailData?.CidrBlock || '-'}</Descriptions.Item>
          <Descriptions.Item label="网关">{detailData?.gateway_ip || detailData?.GatewayIp || '-'}</Descriptions.Item>
          <Descriptions.Item label="DHCP">{(detailData?.dhcp_enable===true || detailData?.DhcpEnable===true)?'启用':'关闭'}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag(detailData?.status)}</Descriptions.Item>
          <Descriptions.Item label="可用IP数">{detailData?.available_ip_address_count!=null? String(detailData?.available_ip_address_count) : '-'}</Descriptions.Item>
          <Descriptions.Item label="IPv6启用">{detailData?.ipv6_enable===true?'是':'否'}</Descriptions.Item>
          <Descriptions.Item label="VPC 名称">{(vpcs||[]).find((v:any)=> String(v?.id||v?.VpcId||'')===String(detailData?.vpc_id||''))?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="VPC ID">{detailData?.vpc_id || '-'}</Descriptions.Item>
          <Descriptions.Item label="主DNS">{detailData?.primary_dns || '-'}</Descriptions.Item>
          <Descriptions.Item label="备DNS">{detailData?.secondary_dns || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{detailData?.created_at || detailData?.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{detailData?.updated_at || detailData?.updatedAt || '-'}</Descriptions.Item>
        </Descriptions>
      )}

      {detailType==='sg' && (
        <Tabs
          defaultActiveKey="overview"
          items={[
            {
              key: 'overview',
              label: '概览',
              children: (
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="名称">{detailData?.name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="ID">{detailData?.id || detailData?.SecurityGroupId || '-'}</Descriptions.Item>
                  <Descriptions.Item label="所属VPC">{(vpcs||[]).find((v:any)=> String(v?.id||v?.VpcId||'')===String(detailData?.vpc_id||''))?.name || '-'}</Descriptions.Item>
                  <Descriptions.Item label="VPC ID">{detailData?.vpc_id || '-'}</Descriptions.Item>
                  <Descriptions.Item label="规则统计" span={2}>{(()=>{ const list:any[]=Array.isArray(detailData?.security_group_rules)?detailData.security_group_rules:[]; const inCnt=list.filter((x:any)=> String(x?.direction||'').toLowerCase()==='ingress').length; const outCnt=list.filter((x:any)=> String(x?.direction||'').toLowerCase()==='egress').length; return `入站: ${inCnt}；出站: ${outCnt}`; })()}</Descriptions.Item>
                  <Descriptions.Item label="引用实例数" span={2}>{(()=>{ const sgName=String(detailData?.name||'').trim().toLowerCase(); const sgId=String(detailData?.id||detailData?.SecurityGroupId||'').trim().toLowerCase(); let cnt=0; const uniq=new Set<string>(); for (const s of (ecs||[])) { const sid=String(s?.id||s?.InstanceId||''); const names=Array.isArray(s?.security_groups)? (s.security_groups as any[]).map(x=> String(x?.name||x?.Name||'').trim().toLowerCase()) : []; if ((sgName && names.includes(sgName)) || (!sgName && sgId && names.includes(sgId))) { if (!uniq.has(sid)) { uniq.add(sid); cnt++; } } } return cnt; })()}</Descriptions.Item>
                  <Descriptions.Item label="创建时间" span={2}>{detailData?.created_at || detailData?.createdAt || detailData?.create_time || '-'}</Descriptions.Item>
                </Descriptions>
              )
            },
            {
              key: 'rules',
              label: '规则',
              children: (
                <Table
                  size="small"
                  rowKey={(r:any)=> r?.id || `${r?.direction}-${r?.protocol}-${r?.remote_ip_prefix}-${r?.remote_group_id}-${r?.port_min}-${r?.port_max}`}
                  columns={[
                    { title: '方向', dataIndex: 'direction', key: 'direction' },
                    { title: '类型', dataIndex: 'ethertype', key: 'ethertype', render: (_:any, r:any)=> (r?.ethertype ? String(r.ethertype).toUpperCase() : 'IPv4') },
                    { title: '协议端口', key: 'protoport', render: (_:any, r:any)=> { const p=String(r?.protocol||'').toLowerCase(); const min=r?.port_min; const max=r?.port_max; if(!p||p==='all') return '全部'; if(p==='icmp') return 'ICMP: 全部'; if(min!=null&&max!=null&&min===max) return `${p.toUpperCase()}: ${min}`; if(min!=null||max!=null) return `${p.toUpperCase()}: ${(min??'')}-${(max??'')}`; return p.toUpperCase(); } },
                    { title: '源地址', key: 'remote', render: (_:any, r:any)=> { const rgid=r?.remote_group_id; const g=(secGroups||[]).find((x:any)=> String(x?.id||x?.SecurityGroupId||'')===String(rgid||'')); const nm=g?.name; const txt=nm || r?.remote_ip_prefix || rgid || '-'; return txt; } },
                    { title: '修改时间', key: 'mtime', render: (_:any, r:any)=> (r?.updated_at || r?.updatedAt || r?.update_time || '-') },
                    { title: '描述', dataIndex: 'description', key: 'desc' },
                    { title: '创建时间', dataIndex: 'created_at', key: 'ctime' },
                  ] as any}
                  dataSource={(() => { const raw:any[] = Array.isArray(detailData?.security_group_rules) ? detailData.security_group_rules : []; return raw.map((x:any)=> ({ id:x?.id, direction:x?.direction, protocol:x?.protocol, ethertype:x?.ethertype, port_min:x?.port_range_min ?? x?.port_min, port_max:x?.port_range_max ?? x?.port_max, remote_group_id:x?.remote_group_id, remote_ip_prefix:x?.remote_ip_prefix ?? x?.remote_ip_cidr, description:x?.description, created_at:x?.created_at ?? x?.createdAt ?? x?.create_time })) })()}
                  pagination={false}
                />
              )
            },
            {
              key: 'refs',
              label: '引用实例',
              children: (
                <Table
                  size="small"
                  rowKey={(r:any)=> r?.id || r?.InstanceId}
                  columns={[
                    { title: '实例ID', key: 'id', render: (_:any, r:any)=> (r?.id || r?.InstanceId || '-') },
                    { title: '实例名', key: 'name', render: (_:any, r:any)=> (r?.name || r?.InstanceName || '-') },
                    { title: '状态', key: 'status', render: (_:any, r:any)=> (r?.status || r?.Status || '-') },
                    { title: '私网IP', key: 'pri', render: (_:any, r:any)=> { const { fixed } = collectIpv4FromAddresses(r?.addresses); return fixed.length ? fixed.join(', ') : '-'; } },
                    { title: '操作', key: 'op', render: (_:any, r:any)=> (<Button type="link" onClick={async ()=>{ onOpenVmDetail(r); }}>详情</Button>) }
                  ] as any}
                  dataSource={(() => { const sgName=String(detailData?.name||'').trim().toLowerCase(); const sgId=String(detailData?.id||detailData?.SecurityGroupId||'').trim().toLowerCase(); const out:any[]=[]; const seen=new Set<string>(); for (const s of (ecs||[])) { const sid=String(s?.id||s?.InstanceId||''); const names=Array.isArray(s?.security_groups)? (s.security_groups as any[]).map(x=> String(x?.name||x?.Name||'').trim().toLowerCase()) : []; const match = (sgName && names.includes(sgName)) || (!sgName && sgId && names.includes(sgId)); if (match && sid && !seen.has(sid)) { seen.add(sid); out.push(s); } } return out; })()}
                  pagination={false}
                />
              )
            }
          ]}
        />
      )}

      {detailType==='eip' && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="公网IP">{detailData?.public_ip_address || detailData?.publicip_address || detailData?.ip_address || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID">{detailData?.id || detailData?.publicip_id || '-'}</Descriptions.Item>
          <Descriptions.Item label="带宽" span={2}>{(()=>{ const bw=detailData?.bandwidth; const name=(typeof bw==='object'?bw?.name:detailData?.bandwidth_name)||'-'; const size=(typeof bw==='object'?bw?.size:detailData?.bandwidth_size); const share=(typeof bw==='object'?bw?.share_type:detailData?.share_type); const st=String(share||'').toUpperCase()==='PER'?'独享':(share?'共享':''); const sizeTxt=(size!=null&&size!=='')? `${size}Mbps` : '-'; return `${name}（${sizeTxt}${st?` / ${st}`:''}）`; })()}</Descriptions.Item>
          <Descriptions.Item label="绑定资源" span={2}>{(()=>{ const ai=detailData?.associate_instance; if (ai && typeof ai==='object') { const tp=String(ai?.type||'').toLowerCase(); const id=ai?.id||ai?.instance_id||''; const map:any={ port:'网卡', eni:'网卡', elb:'负载均衡', nat:'NAT网关' }; const label = map[tp] || (ai?.type || '资源'); return id ? `${label} ${id}` : label; } const pid=detailData?.port_id||''; return pid? `网卡 ${pid}` : '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag(detailData?.status)}</Descriptions.Item>
          <Descriptions.Item label="标签">{(()=>{ const tags=detailData?.tags; const pairs:string[]=[]; if (Array.isArray(tags)) { for (const t of tags){ const k=t?.key??t?.Key; const v=t?.value??t?.Value; if(k!=null&&v!=null) pairs.push(`${k}=${v}`);} } else if (tags && typeof tags==='object'){ for(const k of Object.keys(tags)){ const v=(tags as any)[k]; if(v!=null) pairs.push(`${k}=${v}`);} } return pairs.length? pairs.join('；'):'-'; })()}</Descriptions.Item>
        </Descriptions>
      )}

      {detailType==='slb' && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="名称">{detailData?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID">{detailData?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="类型">{detailData?.loadbalancer_type || detailData?.type || '-'}</Descriptions.Item>
          <Descriptions.Item label="VIP">{detailData?.vip_address || detailData?.vipAddress || detailData?.virtual_ip || '-'}</Descriptions.Item>
          <Descriptions.Item label="监听器数量">{Array.isArray(detailData?.listeners)? detailData.listeners.length : 0}</Descriptions.Item>
          <Descriptions.Item label="后端池数量">{Array.isArray(detailData?.pools)? detailData.pools.length : (Array.isArray(detailData?.backend_pools)? detailData.backend_pools.length : 0)}</Descriptions.Item>
          <Descriptions.Item label="子网">{(()=>{ const sid=detailData?.subnet_id || detailData?.vip_subnet_id || ''; const sn=(subnets||[]).find((s:any)=> String(s?.id||s?.SubnetId||'')===String(sid||'')); return sn?.name || sid || '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="VPC">{(()=>{ const vid=detailData?.vpc_id || ''; const vn=(vpcs||[]).find((v:any)=> String(v?.id||v?.VpcId||'')===String(vid||'')); return vn?.name || vid || '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="标签" span={2}>{(()=>{ const tags=detailData?.tags; const pairs:string[]=[]; if (Array.isArray(tags)) { for (const t of tags){ const k=t?.key??t?.Key; const v=t?.value??t?.Value; if(k!=null&&v!=null) pairs.push(`${k}=${v}`);} } else if (tags && typeof tags==='object'){ for(const k of Object.keys(tags)){ const v=(tags as any)[k]; if(v!=null) pairs.push(`${k}=${v}`);} } return pairs.length? pairs.join('；'):'-'; })()}</Descriptions.Item>
          <Descriptions.Item label="状态" span={2}>{statusTag(detailData?.provisioning_status || detailData?.operating_status || detailData?.status)}</Descriptions.Item>
        </Descriptions>
      )}

      {detailType==='nat' && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="名称">{detailData?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID">{detailData?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="规格">{detailData?.spec || detailData?.Spec || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag(detailData?.status || detailData?.Status)}</Descriptions.Item>
          <Descriptions.Item label="绑定EIP数量" span={2}>{(()=>{ let cnt=0; const nid=String(detailData?.id||''); for (const e of (eips||[])) { const ai=(e as any)?.associate_instance; if (ai && typeof ai==='object') { const tp=String(ai?.type||'').toLowerCase(); const id=String(ai?.id||ai?.instance_id||''); if ((tp==='nat' || tp==='nat_gateway') && id===nid) cnt++; } } return cnt; })()}</Descriptions.Item>
          <Descriptions.Item label="子网">{(()=>{ const sid=detailData?.subnet_id || ''; const sn=(subnets||[]).find((s:any)=> String(s?.id||s?.SubnetId||'')===String(sid||'')); return sn?.name || sid || '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="VPC">{(()=>{ const vid=detailData?.vpc_id || ''; const vn=(vpcs||[]).find((v:any)=> String(v?.id||v?.VpcId||'')===String(vid||'')); return vn?.name || vid || '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="标签" span={2}>{(()=>{ const tags=detailData?.tags; const pairs:string[]=[]; if (Array.isArray(tags)) { for (const t of tags){ const k=t?.key??t?.Key; const v=t?.value??t?.Value; if(k!=null&&v!=null) pairs.push(`${k}=${v}`);} } else if (tags && typeof tags==='object'){ for(const k of Object.keys(tags)){ const v=(tags as any)[k]; if(v!=null) pairs.push(`${k}=${v}`);} } return pairs.length? pairs.join('；'):'-'; })()}</Descriptions.Item>
        </Descriptions>
      )}

      {detailType==='rt' && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="名称">{detailData?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID">{detailData?.id || detailData?.RouteTableId || '-'}</Descriptions.Item>
          <Descriptions.Item label="默认路由表">{(detailData?.is_default===true || detailData?._default===true || detailData?.default===true)? '是' : '否'}</Descriptions.Item>
          <Descriptions.Item label="关联子网数">{Array.isArray(detailData?.subnets)? detailData.subnets.length : 0}</Descriptions.Item>
          <Descriptions.Item label="关联子网列表" span={2}>{(()=>{ const list:any[]=Array.isArray(detailData?.subnets)?detailData.subnets:[]; const ids=list.map((x:any)=> x?.id || x?.SubnetId || '').filter(Boolean); return ids.length? ids.join('；') : '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="VPC 名称">{(vpcs||[]).find((v:any)=> String(v?.id||v?.VpcId||'')===String(detailData?.vpc_id||''))?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="VPC ID">{detailData?.vpc_id || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{detailData?.created_at || detailData?.createdAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{detailData?.updated_at || detailData?.updatedAt || '-'}</Descriptions.Item>
          <Descriptions.Item label="租户" span={2}>{detailData?.tenant_id || '-'}</Descriptions.Item>
        </Descriptions>
      )}

      {detailType==='disk' && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="名称">{detailData?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID">{detailData?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="容量">{detailData?.size!=null? `${detailData?.size}GB` : '-'}</Descriptions.Item>
          <Descriptions.Item label="类型">{detailData?.volume_type || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag(detailData?.status)}</Descriptions.Item>
          <Descriptions.Item label="挂载实例/设备" span={2}>{(()=>{ const atts:any[]=Array.isArray(detailData?.attachments)?detailData.attachments:[]; const list=atts.map((a:any)=> `${a?.server_id || a?.instance_id || '-'}（${a?.device || '-'}）`).filter(Boolean); return list.length? list.join('；') : '-'; })()}</Descriptions.Item>
          <Descriptions.Item label="可用区">{detailData?.availability_zone || detailData?.zone || detailData?.ZoneId || '-'}</Descriptions.Item>
          <Descriptions.Item label="加密">{detailData?.encrypted===true?'是':detailData?.encrypted===false?'否':'-'}</Descriptions.Item>
          <Descriptions.Item label="标签" span={2}>{(()=>{ const tags=detailData?.tags; const pairs:string[]=[]; if (Array.isArray(tags)) { for (const t of tags){ const k=t?.key??t?.Key; const v=t?.value??t?.Value; if(k!=null&&v!=null) pairs.push(`${k}=${v}`);} } else if (tags && typeof tags==='object'){ for(const k of Object.keys(tags)){ const v=(tags as any)[k]; if(v!=null) pairs.push(`${k}=${v}`);} } return pairs.length? pairs.join('；'):'-'; })()}</Descriptions.Item>
        </Descriptions>
      )}

      {detailType==='snapshot' && (
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="名称">{detailData?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="ID">{detailData?.id || '-'}</Descriptions.Item>
          <Descriptions.Item label="源磁盘">{detailData?.volume_id || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag(detailData?.status)}</Descriptions.Item>
        </Descriptions>
      )}
    </Modal>
  );
};

export default ResourceDetailModal;