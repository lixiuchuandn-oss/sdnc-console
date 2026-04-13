import React from 'react';
import { App, Button, Descriptions, Modal, Space, Tag } from 'antd';
import { DesktopOutlined, PlayCircleOutlined, PoweroffOutlined, ReloadOutlined, DeleteOutlined, WindowsOutlined, CodeOutlined } from '@ant-design/icons';
import { startAliyunEcs, stopAliyunEcs, rebootAliyunEcs, deleteAliyunEcs, fetchAliyunEcsVncUrl } from '../../../../../services/aliyunApi';
import { statusTag, collectIpv4FromAddresses } from '../../Hw/components/Common';

export type EcsInsDetSectionProps = {
  cloudId: string;
  instance: any;
  onRefreshAll?: () => Promise<void> | void;
  eips?: any[];
  secGroups?: any[];
};

const EcsInsDetSection: React.FC<EcsInsDetSectionProps> = ({ cloudId, instance, onRefreshAll, eips, secGroups }) => {
  const { message } = App.useApp();
  const st = String(instance?.Status || instance?.status || '').trim();
  const isRunning = st === 'Running' || st === 'ONLINE';
  const isStopped = st === 'Stopped' || st === 'OFFLINE';
  const isBusy = st === 'Starting' || st === 'Stopping' || st === 'Rebooting';
  const flavorName = instance?.InstanceType || instance?.flavor?.name || '-';
  const v = parseInt(String(instance?.Cpu ?? instance?.CPU ?? instance?.flavor?.vcpus ?? 0)) || 0;
  const rMb = parseFloat(String(instance?.Memory ?? instance?.memory ?? instance?.flavor?.ram ?? 0)) || 0;
  const memGb = rMb ? `${Math.round(rMb / 1024)}GB` : '';
  const specText = [flavorName, v ? `${v}vCPU` : '', memGb].filter(Boolean).join(' / ');
  const osRaw = String(instance?.OSName || instance?.OSNameEn || instance?.OSType || instance?.Platform || instance?.os_name || instance?.os_type || '').toLowerCase();
  const isWin = osRaw.includes('win');
  const icon = isWin ? <WindowsOutlined style={{ color: '#1890ff', marginRight: 6 }} /> : <CodeOutlined style={{ color: '#1890ff', marginRight: 6 }} />;
  const { fixed, floating } = collectIpv4FromAddresses(instance?.addresses);
  const vpcId = instance?.VpcAttributes?.VpcId || instance?.VpcId || '';
  const zoneId = instance?.ZoneId || instance?.zoneId || instance?.zone || '-';
  const pubArr = instance?.PublicIpAddress?.IpAddress;
  const eip = instance?.EipAddress?.IpAddress || instance?.publicIpAddress;
  const pubIps = Array.isArray(pubArr) ? pubArr : [];
  const pubNorm = instance?.publicIpAddress;
  if (pubNorm) pubIps.push(pubNorm);
  const iid = instance?.InstanceId || instance?.id || '';
  const pubFromEips: string[] = Array.isArray(eips)
    ? eips
        .filter((r: any) => {
          const ai = r?.associate_instance;
          const rid = ai?.id || ai?.instance_id || '';
          return rid && String(rid) === String(iid);
        })
        .map((r: any) => r?.public_ip_address || r?.publicip_address || r?.ip_address)
        .filter(Boolean)
    : [];
  const eipIps = Array.from(new Set([...(eip ? [eip] : []), ...pubFromEips, ...floating]));
  const priArr = instance?.VpcAttributes?.PrivateIpAddress?.IpAddress;
  const priIps = Array.isArray(priArr) ? priArr : [];

  // Enhanced Private IP Collection
  const allPriIps = new Set<string>();
  // 1. VpcAttributes
  priIps.forEach((ip: string) => allPriIps.add(ip));
  // 2. NetworkInterfaces
  const nicsRaw: any[] = Array.isArray(instance?.NetworkInterfaces?.NetworkInterface) 
    ? instance.NetworkInterfaces.NetworkInterface 
    : (Array.isArray(instance?.network_interfaces) ? instance.network_interfaces : []);
  nicsRaw.forEach((nic: any) => {
    if (nic?.PrimaryIpAddress) allPriIps.add(nic.PrimaryIpAddress);
    if (nic?.primaryIpAddress) allPriIps.add(nic.primaryIpAddress);
    const sets = nic?.PrivateIpSets?.PrivateIpSet;
    if (Array.isArray(sets)) {
      sets.forEach((s: any) => {
        if (s?.PrivateIpAddress) allPriIps.add(s.PrivateIpAddress);
      });
    }
  });
  // 3. InnerIpAddress (Classic Network)
  const innerIps = instance?.InnerIpAddress?.IpAddress;
  if (Array.isArray(innerIps)) innerIps.forEach((ip: string) => allPriIps.add(ip));
  // 4. Flat fields
  if (instance?.privateIpAddress) allPriIps.add(instance.privateIpAddress);
  if (instance?.private_ip_address) allPriIps.add(instance.private_ip_address);
  // 5. OpenStack/Generic "addresses"
  if (Array.isArray(fixed)) fixed.forEach((ip: string) => allPriIps.add(ip));

  const finalPriIps = Array.from(allPriIps).filter(Boolean);

  // MAC Address Logic
  const macsRaw: any[] = Array.isArray(instance?.NetworkInterfaces?.NetworkInterface) 
    ? instance.NetworkInterfaces.NetworkInterface 
    : (Array.isArray(instance?.network_interfaces) ? instance.network_interfaces : []);
  
  const macList = macsRaw.map((n:any) => n?.MacAddress || n?.mac_address || n?.macAddress).filter(Boolean);
  if (instance?.MacAddress) macList.push(instance.MacAddress);
  if (instance?.mac_address) macList.push(instance.mac_address);
  
  const macDisplay = Array.from(new Set(macList)).join('; ');
  
  // Tag Display: Key: Value
  const tagsAli: any[] = Array.isArray(instance?.Tags?.Tag) ? instance!.Tags.Tag : [];
  const tagsNorm: any[] = Array.isArray(instance?.tags) ? instance!.tags : [];
  const tags: any[] = [...tagsAli, ...tagsNorm];
  const tagDisplay = tags.map((t: any) => {
    const k = t?.TagKey ?? t?.Key ?? t?.key;
    const v = t?.TagValue ?? t?.Value ?? t?.value;
    return v ? `${k}: ${v}` : k;
  }).filter(Boolean).join('; ');

  // Date Formatting
  const formatDate = (raw: string) => {
    if (!raw) return '-';
    try {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false });
    } catch {}
    return raw;
  };

  const createdAt = formatDate(instance?.CreationTime || instance?.created || instance?.create_time);
  const updatedAt = formatDate(instance?.Updated || instance?.updated || instance?.update_time || instance?.StartTime || instance?.start_time);
  
  // Expired Time Logic
  const expiredTimeRaw = instance?.ExpiredTime || '';
  let expiredTimeNode: React.ReactNode = '-';
  if (expiredTimeRaw) {
    try {
      const d = new Date(expiredTimeRaw);
      if (!isNaN(d.getTime())) {
        const now = new Date();
        const isExpired = d < now;
        const diffDays = (d.getTime() - now.getTime()) / (1000 * 3600 * 24);
        const color = isExpired ? '#ff4d4f' : (diffDays < 7 ? '#faad14' : 'inherit');
        expiredTimeNode = <span style={{ color }}>{d.toLocaleString('zh-CN', { hour12: false })}</span>;
      } else {
        expiredTimeNode = expiredTimeRaw;
      }
    } catch {
      expiredTimeNode = expiredTimeRaw;
    }
  }

  // Security Group Names
  const sgIds = instance?.SecurityGroupIds?.SecurityGroupId || instance?.security_groups || [];
  const sgDisplay = (Array.isArray(sgIds) ? sgIds : []).map((id: string) => {
    const found = (secGroups || []).find((g: any) => String(g.SecurityGroupId || g.id) === String(id));
    return found ? `${found.SecurityGroupName || found.name} (${id})` : id;
  }).join('; ');

  return (
    <div>
      <Descriptions bordered column={2} size="small" style={{ width: '100%' }}>
        <Descriptions.Item label="实例ID">{instance?.InstanceId || instance?.id || '-'}</Descriptions.Item>
        <Descriptions.Item label="实例名">{instance?.InstanceName || instance?.name || '-'}</Descriptions.Item>
        <Descriptions.Item label="状态">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {statusTag(instance?.Status || instance?.status)}
            <Space size={4}>
              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isRunning || isBusy} icon={<PlayCircleOutlined style={{ fontSize: 12, color: '#1890ff' }} />} onClick={async () => { const iid = instance?.InstanceId || instance?.id; if (!iid) return; try { await startAliyunEcs(cloudId, iid); message.success('启动指令已下发'); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '启动失败'); } }}>启动</Button>
              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={isStopped || isBusy} icon={<PoweroffOutlined style={{ fontSize: 12, color: '#f5222d' }} />} onClick={async () => { const iid = instance?.InstanceId || instance?.id; if (!iid) return; try { await stopAliyunEcs(cloudId, iid, false); message.success('停止指令已下发'); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '停止失败'); } }}>停止</Button>
              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} disabled={!isRunning || isBusy} icon={<ReloadOutlined style={{ fontSize: 12, color: '#1890ff' }} />} onClick={async () => { const iid = instance?.InstanceId || instance?.id; if (!iid) return; try { await rebootAliyunEcs(cloudId, iid, false); message.success('重启指令已下发'); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '重启失败'); } }}>重启</Button>
              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} icon={<DesktopOutlined style={{ fontSize: 12, color: '#1890ff' }} />} onClick={async () => { const iid = instance?.InstanceId || instance?.id; if (!iid) return; try { const json = await fetchAliyunEcsVncUrl(cloudId, iid); const url = json?.data?.VncUrl || json?.data?.vncUrl; if (url) { const w = Math.max(1280, (window.screen?.availWidth || 1600) - 40); const h = Math.max(800, (window.screen?.availHeight || 900) - 80); const features = `width=${w},height=${h},top=0,left=0,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes`; const page = 'https://g.alicdn.com/aliyun/ecs-console-vnc2/0.0.8/index.html'; const web = `${page}?vncUrl=${encodeURIComponent(url)}&instanceId=${encodeURIComponent(iid)}&isWindows=${isWin ? 'true' : 'false'}`; window.open(web, 'aliyun-webvnc', features); } else { message.warning('未获取到VNC地址'); } } catch (e: any) { message.error(e?.message || '获取VNC地址失败'); } }}>VNC</Button>
              <Button shape="round" size="small" style={{ fontSize: 12, height: 24, paddingInline: 8 }} danger icon={<DeleteOutlined style={{ fontSize: 12, color: '#f5222d' }} />} onClick={() => { const iid = instance?.InstanceId || instance?.id; if (!iid) return; Modal.confirm({ title: '确认删除该实例？', onOk: async () => { try { await deleteAliyunEcs(cloudId, iid); message.success('删除成功'); if (onRefreshAll) await onRefreshAll(); } catch (e: any) { message.error(e?.message || '删除失败'); } } }); }}>删除</Button>
            </Space>
          </div>
        </Descriptions.Item>
        <Descriptions.Item label="规格">{specText || '-'}</Descriptions.Item>
        <Descriptions.Item label="可用区">{zoneId}</Descriptions.Item>
        <Descriptions.Item label="VPC">{vpcId || '-'}</Descriptions.Item>
        <Descriptions.Item label="私网IP">{finalPriIps.length ? finalPriIps.join(', ') : '-'}</Descriptions.Item>
        <Descriptions.Item label="公网IP">{(() => { const pub = Array.from(new Set(pubIps.filter(Boolean))); return pub.length ? pub.join(', ') : '-'; })()}</Descriptions.Item>
        <Descriptions.Item label="弹性公网IP">{(() => { const e = eipIps.filter(Boolean); return e.length ? e.join(', ') : '-'; })()}</Descriptions.Item>
        <Descriptions.Item label="MAC地址">{macDisplay || '-'}</Descriptions.Item>
        <Descriptions.Item label="镜像">{(() => { const nm = instance?.ImageId || instance?.Image?.ImageName || instance?.metadata?.image_name || '-'; return (<span>{icon}{nm}</span>); })()}</Descriptions.Item>
        <Descriptions.Item label="安全组">{sgDisplay || '-'}</Descriptions.Item>
        <Descriptions.Item label="标签">{tagDisplay || '-'}</Descriptions.Item>
        <Descriptions.Item label="创建时间">{createdAt}</Descriptions.Item>
        <Descriptions.Item label="到期时间">{expiredTimeNode}</Descriptions.Item>
      </Descriptions>
    </div>
  );
};

export default EcsInsDetSection;
