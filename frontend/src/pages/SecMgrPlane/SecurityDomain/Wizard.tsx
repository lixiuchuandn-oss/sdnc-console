import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Divider, Form, Input, Radio, Row, Col, Select, Space, Steps, message, Descriptions, Tag, Table } from 'antd';
import { ArrowLeftOutlined, UserOutlined, ReloadOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import { fetchVrRealtimeList, normalizeVrRows } from '../../../services/vrCacheApi';
import { fetchClouds, fetchCloudProviderVpcs, fetchInventoryInstancesByCloud, fetchCloudProviderEnis, fetchCloudProviderEips, fetchCloudProviderSubnets, fetchCloudProviderEcs, fetchHuaweiPorts, fetchCloudProviderSubnetsByVpc } from '../../../services/api';
import { createSecurityDomain, SecurityDomainPayload } from '../../../services/securityDomainApi';

interface VRRowOpt { uuid: string; name: string; }

const SecurityDomainWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const [current, setCurrent] = useState<number>(0);
  const [form] = Form.useForm();

  const [vrOptions, setVrOptions] = useState<VRRowOpt[]>([]);
  const [vrLoading, setVrLoading] = useState<boolean>(false);

  const [vmOptions, setVmOptions] = useState<any[]>([]);
  const [eniOptions, setEniOptions] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [rawEnis, setRawEnis] = useState<any[]>([]);
  const [resLoading, setResLoading] = useState<boolean>(false);
  const [debugEcs, setDebugEcs] = useState<any[]>([]);
  const [debugPorts, setDebugPorts] = useState<any[]>([]);
  const [debugOpen, setDebugOpen] = useState<boolean>(false);
  const [providerKey, setProviderKey] = useState<string>('');

  const [clouds, setClouds] = useState<any[]>([]);
  const [cloudLoading, setCloudLoading] = useState<boolean>(false);
  const [normalizedVpcs, setNormalizedVpcs] = useState<Array<{ id: string; name: string; label: string }>>([]);
  const [rawVpcs, setRawVpcs] = useState<any[]>([]);
  const [vpcLoading, setVpcLoading] = useState<boolean>(false);
  const [autoBinding, setAutoBinding] = useState<boolean>(false);

  const stepTitle = useMemo(() => {
    if (current === 0) return '设定基础信息';
    if (current === 1) return '设定安全域';
    return '确认安全域';
  }, [current]);

  const loadVRList = async () => {
    setVrLoading(true);
    try {
      const res = await fetchVrRealtimeList(50, 1);
      // Backend returns { code: 200, data: <csm_response> }
      // CSM response might be { page: [...] } or just [...]
      console.log('Wizard fetchVrRealtimeList res:', res);
      const rawData = res?.data; 
      const list = (rawData?.page || rawData?.list || rawData?.rows || (Array.isArray(rawData) ? rawData : []) || []) as any[];
      const opts: VRRowOpt[] = normalizeVrRows(list);
      setVrOptions(opts);
    } catch (e: any) {
      console.error(e);
      message.warning('VR 列表获取失败');
      setVrOptions([]);
    } finally { setVrLoading(false); }
  };

  const providerName = (p?: string, type?: string) => {
    const key = (p || type || '').toLowerCase();
    if (key.includes('aliyun') || key === 'aliyun') return '阿里云';
    if (key.includes('huaweicloud') || key === 'huaweicloud') return '华为云';
    if (key.includes('aws')) return 'AWS';
    if (key.includes('gcp')) return 'GCP';
    return type || p || '未知云';
  };

  const cloudLabel = (c: any) => {
    const prov = providerName(c?.config?.provider, c?.type);
    const region = c?.region || '-';
    const name = c?.name || c?.id || '未命名资源池';
    return `${name}（${prov} / ${region}）`;
  };

  const loadClouds = async () => {
    setCloudLoading(true);
    try {
      const res = await fetchClouds();
      const list = (res?.data || res || []);
      setClouds(Array.isArray(list) ? list : []);
    } catch (e: any) {
      message.warning('云资源池获取失败');
      setClouds([]);
    } finally { setCloudLoading(false); }
  };

  const loadCloudVpcs = async (cloudId: string) => {
    if (!cloudId) { setNormalizedVpcs([]); return; }
    setVpcLoading(true);
    try {
      const res = await fetchCloudProviderVpcs(String(cloudId));
      const data = (res?.data || res || {});
      const cloud = clouds.find((c) => String(c?.id || c?._id || c?.uuid || c?.cloudId) === String(cloudId));
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let arr: any[] = [];
      if (provider === 'aliyun') {
        arr = (data?.Vpcs?.Vpc) || (data?.VpcSets) || [];
      } else if (provider === 'huaweicloud') {
        arr = (data?.vpcs) || (data?.data?.vpcs) || [];
      } else if (provider === 'tencentcloud') {
        arr = (data?.VpcSet) || [];
      } else if (provider === 'harvester' || provider.includes('cloudmap')) {
        arr = (data?.items) || (data?.data?.items) || [];
      } else {
        arr = Array.isArray((data as any)) ? (data as any) : (data?.list || data?.items || []);
      }
      setRawVpcs(Array.isArray(arr) ? arr : []);
      const normalized = (Array.isArray(arr) ? arr : []).map((v: any) => {
        const id = v.VpcId || v.id || v.uuid || v.vpc_id || v.vpcId || v.ID || v.Name || v.name || '';
        const name = v.VpcName || v.name || v.Vpc || v.DisplayName || id || 'VPC';
        const cidr = v.CidrBlock || v.cidr || v.cidrBlock || v.network || v.address || v.vpc_cidr || '';
        const label = `${name}（${id ? String(id).slice(0,8) : '—'}）${cidr ? ' / ' + cidr : ''}`;
        return { id: String(id), name: String(name), label };
      }).filter(x => !!x.id);
      setNormalizedVpcs(normalized);
    } catch (e: any) {
      message.warning('云端 VPC 获取失败');
      setNormalizedVpcs([]);
    } finally { setVpcLoading(false); }
  };

  const loadResources = async (cloudId: string, vpcId: string) => {
    if (!cloudId || !vpcId) {
      setVmOptions([]);
      setEniOptions([]);
      return;
    }
    setResLoading(true);
    const cloud = clouds.find((c) => String(c?.id || c?._id || c?.uuid || c?.cloudId) === String(cloudId));
    const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
    setProviderKey(provider);

    try {
      // Fetch subnets for CIDR lookup
      try {
        const res: any = await fetchCloudProviderSubnetsByVpc(cloudId, vpcId);
        let list: any[] = [];
        if (provider.includes('huawei')) {
           list = (res?.data?.subnets) || (res?.subnets) || [];
        } else if (provider.includes('tencent')) {
           list = (res?.data?.SubnetSet) || [];
        } else if (provider === 'harvester' || provider.includes('cloudmap')) {
           list = (res?.data?.items) || (res?.items) || [];
        } else {
           // Default to Aliyun structure or generic array
           list = (res?.data?.VSwitches?.VSwitch) || (Array.isArray(res) ? res : []) || [];
        }
        console.log('Wizard loaded subnets:', list);
        setSubnets(Array.isArray(list) ? list : []);
      } catch (e) {
        console.warn('Wizard failed to load subnets:', e);
        setSubnets([]);
      }

      let validVmIds: Set<string> | null = null;
      let harvesterVmsInVpc: any[] | null = null;

      if (provider.includes('huawei') || provider === 'huaweicloud' || provider.includes('华为云')) {
        const subnetsJson: any = await fetchCloudProviderSubnets(cloudId);
        const subnetList: any[] = (subnetsJson?.data?.subnets) || (subnetsJson?.subnets) || [];
        
        // Ensure subnets are populated (fallback if ByVpc API returned empty)
        const filteredSubnets = subnetList.filter((s: any) => String(s?.vpc_id || s?.VpcId || '').trim() === String(vpcId).trim());
        if (filteredSubnets.length > 0) {
            setSubnets(filteredSubnets);
        }

        const subnetIdsInVpc = new Set(
          filteredSubnets.map((s: any) => String(s?.id || s?.SubnetId || '').trim())
        );
        const ecsJson: any = await fetchCloudProviderEcs(cloudId);
        const ecsList: any[] = (ecsJson?.data?.servers) || (ecsJson?.servers) || [];
        setDebugEcs(Array.isArray(ecsList) ? ecsList : []);
        const aggPorts: any[] = [];
        const seenPortIds = new Set<string>();
        for (const vm of (Array.isArray(ecsList) ? ecsList : [])) {
          const vmId = String(vm?.id || vm?.InstanceId || vm?.instance_id || '');
          if (!vmId) continue;
          try {
            const pj = await fetchHuaweiPorts(cloudId, { deviceId: vmId });
            const pls: any[] = (pj?.data?.ports) || (pj?.ports) || [];
            const filtered = pls.filter((p: any) => {
              const ips: any[] = Array.isArray(p?.fixed_ips) ? p.fixed_ips : [];
              return ips.some((fi: any) => subnetIdsInVpc.has(String(fi?.subnet_id || '').trim()));
            });
            filtered.forEach((p:any)=> {
              const pid = String(p?.id || p?.port_id || '');
              if (pid && !seenPortIds.has(pid)) { seenPortIds.add(pid); aggPorts.push(p); }
            });
          } catch (e) {}
        }
        if (aggPorts.length === 0) {
          for (const vm of (Array.isArray(ecsList) ? ecsList : [])) {
            const vmId = String(vm?.id || vm?.InstanceId || vm?.instance_id || '');
            if (!vmId) continue;
            try {
              const pj = await fetchHuaweiPorts(cloudId, { deviceId: vmId });
              const pls: any[] = (pj?.data?.ports) || (pj?.ports) || [];
              pls.forEach((p:any)=> {
                const pid = String(p?.id || p?.port_id || '');
                if (pid && !seenPortIds.has(pid)) { seenPortIds.add(pid); aggPorts.push(p); }
              });
            } catch (e) {}
          }
        }
        setRawEnis(aggPorts);
        setDebugPorts(aggPorts);
        const enis = aggPorts.map((p: any) => {
          const ip = Array.isArray(p?.fixed_ips) && p.fixed_ips.length ? (p.fixed_ips[0]?.ip_address || '') : '';
          const name = p?.name || p?.id || 'port';
          return {
            label: `${name} (${p?.id || ''}) ${ip ? '/ ' + ip : ''}`,
            value: String(p?.id || '')
          };
        }).filter(x => !!x.value);
        setEniOptions(enis);
        validVmIds = new Set(aggPorts.map((p: any) => String(p?.device_id || '')).filter(Boolean));
        if (!validVmIds || validVmIds.size === 0) {
          const portIdsInVpc = new Set(aggPorts.map((p: any) => String(p?.id || p?.port_id || '')).filter(Boolean));
          const networkIdsInVpc = new Set(aggPorts.map((p: any) => String(p?.network_id || '')).filter(Boolean));
          const setByAddr = new Set<string>();
          (Array.isArray(ecsList) ? ecsList : []).forEach((x: any) => {
            const addrs = x?.addresses;
            if (addrs && !Array.isArray(addrs)) {
              Object.entries(addrs).forEach(([netKey, arr]: [string, any]) => {
                const ips: any[] = Array.isArray(arr) ? arr : [];
                const hasPortId = ips.some((i: any) => portIdsInVpc.has(String(i?.['OS-EXT-IPS:port_id'] || '')));
                const hasNetworkKey = networkIdsInVpc.has(String(netKey || '').trim());
                if (hasPortId || hasNetworkKey) {
                  const id0 = String(x?.id || x?.InstanceId || x?.instance_id || '');
                  if (id0) setByAddr.add(id0);
                }
              });
            }
          });
        if (setByAddr.size > 0) validVmIds = setByAddr;
        }
      } else if (provider === 'harvester' || provider.includes('cloudmap')) {
        let ecsList: any[] = [];
        try {
          const ecsJson: any = await fetchCloudProviderEcs(cloudId);
          const data = ecsJson?.data || ecsJson;
          ecsList = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
        } catch {
          ecsList = [];
        }

        const vmsInVpc = (Array.isArray(ecsList) ? ecsList : []).filter((x: any) => String(x?.VpcId || x?.vpcId || x?.vpc_id || '').trim() === String(vpcId).trim());
        harvesterVmsInVpc = vmsInVpc;
        setDebugEcs(Array.isArray(vmsInVpc) ? vmsInVpc : []);

        const pseudoEnis: any[] = [];
        for (const vm of (Array.isArray(vmsInVpc) ? vmsInVpc : [])) {
          const vmId = String(vm?.InstanceId || vm?.id || vm?.uuid || '').trim();
          if (!vmId) continue;

          const nets: string[] = Array.isArray(vm?.Extra?.Networks) ? vm.Extra.Networks : (Array.isArray(vm?.Networks) ? vm.Networks : []);
          const ip0 = Array.isArray(vm?.VpcAttributes?.PrivateIpAddress?.IpAddress) ? vm.VpcAttributes.PrivateIpAddress.IpAddress[0] : undefined;

          if (!nets.length) {
            const id = `${vmId}::primary`;
            pseudoEnis.push({
              id,
              NetworkInterfaceId: id,
              NetworkInterfaceName: 'primary',
              Attachment: { InstanceId: vmId },
              InstanceId: vmId,
              instanceId: vmId,
              device_id: vmId,
              port_id: id,
              VpcId: vm?.VpcId,
              VSwitchId: vm?.Extra?.SubnetName,
              PrivateIpAddress: ip0,
              fixed_ips: ip0 ? [{ ip_address: ip0 }] : [],
            });
          } else {
            nets.forEach((n: string, idx: number) => {
              const netName = String(n || '').trim() || `net${idx}`;
              const id = `${vmId}::${netName}`;
              pseudoEnis.push({
                id,
                NetworkInterfaceId: id,
                NetworkInterfaceName: netName.includes('/') ? (netName.split('/').pop() || netName) : netName,
                Attachment: { InstanceId: vmId },
                InstanceId: vmId,
                instanceId: vmId,
                device_id: vmId,
                port_id: id,
                VpcId: vm?.VpcId,
                VSwitchId: vm?.Extra?.SubnetName,
                PrivateIpAddress: idx === 0 ? ip0 : undefined,
                fixed_ips: (idx === 0 && ip0) ? [{ ip_address: ip0 }] : [],
              });
            });
          }
        }

        setRawEnis(pseudoEnis);
        const enis = pseudoEnis.map((x: any) => {
          const ip = x?.PrivateIpAddress || (Array.isArray(x?.fixed_ips) && x.fixed_ips.length ? x.fixed_ips[0]?.ip_address : '');
          const name = x?.NetworkInterfaceName || x?.name || x?.id || 'nic';
          return {
            label: `${name} (${x?.NetworkInterfaceId || x?.Id || x?.id || x?.port_id || ''}) ${ip ? '/ ' + ip : ''}`,
            value: String(x?.NetworkInterfaceId || x?.Id || x?.id || x?.port_id || ''),
          };
        }).filter((x: any) => !!x.value);
        setEniOptions(enis);
        validVmIds = new Set((Array.isArray(vmsInVpc) ? vmsInVpc : []).map((x: any) => String(x?.InstanceId || x?.id || x?.uuid || '').trim()).filter(Boolean));
      } else {
        const eniRes = await fetchCloudProviderEnis(cloudId, { vpcId });
        const eniList: any[] = eniRes?.data?.NetworkInterfaces?.NetworkInterface || eniRes?.data?.enis || eniRes?.enis || eniRes?.list || [];
        setRawEnis(Array.isArray(eniList) ? eniList : []);
        setDebugPorts([]);
        setDebugEcs([]);
        const enis = (Array.isArray(eniList) ? eniList : []).map((x: any) => ({
          label: `${x?.NetworkInterfaceName || x?.name || x?.id} (${x?.NetworkInterfaceId || x?.id}) ${x?.PrivateIpAddress ? '/ ' + x.PrivateIpAddress : ''}`,
          value: String(x?.NetworkInterfaceId || x?.Id || x?.id || '')
        })).filter(x => !!x.value);
        setEniOptions(enis);
      }

      const instRes = await fetchInventoryInstancesByCloud(cloudId);
      let allInst: any[] = (instRes?.data?.instances || instRes?.instances || instRes?.data || instRes || []);
      if (harvesterVmsInVpc && (provider === 'harvester' || provider.includes('cloudmap'))) {
        allInst = harvesterVmsInVpc;
      }
      if (provider.includes('huawei') || provider === 'huaweicloud' || provider.includes('华为云')) {
        const ecsJson: any = await fetchCloudProviderEcs(cloudId);
        const ecsList: any[] = (ecsJson?.data?.servers) || (ecsJson?.servers) || (Array.isArray(ecsJson?.data) ? ecsJson.data : []);
        setDebugEcs(Array.isArray(ecsList) ? ecsList : []);
        const seen = new Set<string>();
        const merged: any[] = [];
        [...(Array.isArray(allInst) ? allInst : []), ...(Array.isArray(ecsList) ? ecsList : [])].forEach((x: any) => {
          const id = String(x?.InstanceId || x?.instanceId || x?.id || x?.uuid || x?.instance_id || '');
          if (id && !seen.has(id)) { seen.add(id); merged.push(x); }
        });
        allInst = merged;
        if ((!validVmIds || validVmIds.size === 0)) {
          const netSet = new Set((Array.isArray(debugPorts) ? debugPorts : []).map((p:any)=> String(p?.network_id || '').trim()).filter(Boolean));
          const fallback = new Set<string>();
          (Array.isArray(allInst) ? allInst : []).forEach((x: any) => {
            const addrs = x?.addresses;
            if (addrs && !Array.isArray(addrs)) {
              Object.keys(addrs || {}).forEach((k: string) => {
                if (netSet.has(String(k).trim())) {
                  const id0 = String(x?.id || x?.InstanceId || x?.instance_id || '');
                  if (id0) fallback.add(id0);
                }
              });
            }
          });
          if (fallback.size > 0) validVmIds = fallback;
        }
      }

      let vms = (Array.isArray(allInst) ? allInst : []).filter((x: any) => {
        if (validVmIds && validVmIds.size > 0) {
           const id = String(x?.InstanceId || x?.instanceId || x?.id || x?.uuid || x?.instance_id || '');
           return validVmIds.has(id);
        }
        const v = x?.VpcId || x?.vpcId || x?.vpc_id || (x?.VpcAttributes?.VpcId) || x?.extra?.vpcId;
        return String(v || '').trim() === String(vpcId).trim();
      }).map((x: any) => ({
        label: `${x?.InstanceName || x?.name || x?.id} (${x?.InstanceId || x?.instanceId || x?.id || x?.uuid || x?.instance_id || ''})`,
        value: String(x?.InstanceId || x?.instanceId || x?.id || x?.uuid || x?.instance_id || '')
      })).filter(x => !!x.value);
      if ((!vms || vms.length === 0) && (provider === 'harvester' || provider.includes('cloudmap'))) {
        const fallbackVms = harvesterVmsInVpc || [];
        vms = (Array.isArray(fallbackVms) ? fallbackVms : []).map((x: any) => ({
          label: `${x?.InstanceName || x?.name || x?.id} (${x?.InstanceId || x?.id || ''})`,
          value: String(x?.InstanceId || x?.id || '')
        })).filter((x: any) => !!x.value);
      }
      if ((!vms || vms.length === 0) && (provider.includes('huawei') || provider === 'huaweicloud' || provider.includes('华为云'))) {
        vms = (Array.isArray(debugEcs) ? debugEcs : []).map((x: any) => ({
          label: `${x?.name || x?.InstanceName || x?.id} (${x?.id || x?.InstanceId || ''})`,
          value: String(x?.id || x?.InstanceId || '')
        })).filter(x => !!x.value);
      }

      setVmOptions(vms);

    } catch (e) {
      console.error(e);
      // message.warning('关联资源列表获取失败');
    } finally {
      setResLoading(false);
    }
  };

  const autoBindResources = async (cloudId?: string, vpcId?: string) => {
    const cid = String(cloudId || '').trim();
    const vid = String(vpcId || '').trim();
    if (!cid || !vid) return;
    setAutoBinding(true);
    try {
      const cloud = clouds.find((c) => String(c?.id || c?._id || c?.uuid || c?.cloudId) === String(cid));
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();

      let validVmIds: Set<string> | null = null;
      let enis: any[] = [];

      if (provider.includes('huawei') || provider === 'huaweicloud' || provider.includes('华为云')) {
        const subnetsJson: any = await fetchCloudProviderSubnets(cid);
        const subnetList: any[] = (subnetsJson?.data?.subnets) || (subnetsJson?.subnets) || [];
        const subnetIdsInVpc = new Set(
          subnetList.filter((s: any) => String(s?.vpc_id || s?.VpcId || '').trim() === String(vid).trim())
                    .map((s: any) => String(s?.id || s?.SubnetId || '').trim())
        );
        const ecsJson: any = await fetchCloudProviderEcs(cid);
        const ecsList: any[] = (ecsJson?.data?.servers) || (ecsJson?.servers) || [];
        const aggPorts: any[] = [];
        for (const vm of (Array.isArray(ecsList) ? ecsList : [])) {
          const vmId = String(vm?.id || vm?.InstanceId || vm?.instance_id || '');
          if (!vmId) continue;
          try {
            const pj = await fetchHuaweiPorts(cid, { deviceId: vmId });
            const pls: any[] = (pj?.data?.ports) || (pj?.ports) || [];
            aggPorts.push(...pls.filter((p: any) => {
              const ips: any[] = Array.isArray(p?.fixed_ips) ? p.fixed_ips : [];
              return ips.some((fi: any) => subnetIdsInVpc.has(String(fi?.subnet_id || '').trim()));
            }));
          } catch (e) {}
        }
        enis = aggPorts;
        validVmIds = new Set(enis.map((p: any) => String(p?.device_id || '')).filter(Boolean));
        if (!validVmIds || validVmIds.size === 0) {
          const portIdsInVpc = new Set(enis.map((p: any) => String(p?.id || p?.port_id || '')).filter(Boolean));
          const networkIdsInVpc = new Set(enis.map((p: any) => String(p?.network_id || '')).filter(Boolean));
          const ecsJson: any = await fetchCloudProviderEcs(cid);
          const ecsList: any[] = (ecsJson?.data?.servers) || (ecsJson?.servers) || [];
          const setByAddr = new Set<string>();
          (Array.isArray(ecsList) ? ecsList : []).forEach((x: any) => {
            const addrs = x?.addresses;
            if (addrs && !Array.isArray(addrs)) {
              Object.entries(addrs).forEach(([netKey, arr]: [string, any]) => {
                const ips: any[] = Array.isArray(arr) ? arr : [];
                const hasPortId = ips.some((i: any) => portIdsInVpc.has(String(i?.['OS-EXT-IPS:port_id'] || '')));
                const hasNetworkKey = networkIdsInVpc.has(String(netKey || '').trim());
                if (hasPortId || hasNetworkKey) {
                  const id0 = String(x?.id || x?.InstanceId || x?.instance_id || '');
                  if (id0) setByAddr.add(id0);
                }
              });
            }
          });
          if (setByAddr.size > 0) validVmIds = setByAddr;
        }
      } else if (provider === 'harvester' || provider.includes('cloudmap')) {
        enis = [];
      } else {
        const eniRes: any = await fetchCloudProviderEnis(cid, { vpcId: vid });
        const eniList: any[] = eniRes?.data?.NetworkInterfaces?.NetworkInterface || eniRes?.data?.enis || eniRes?.enis || eniRes?.list || [];
        enis = Array.isArray(eniList) ? eniList : [];
      }
      setRawEnis(enis);

      const instRes: any = await fetchInventoryInstancesByCloud(cid);
      let allInst: any[] = (instRes?.data?.instances || instRes?.instances || instRes?.data || instRes || []);
      if (provider.includes('huawei') || provider === 'huaweicloud') {
        const ecsJson: any = await fetchCloudProviderEcs(cid);
        const ecsList: any[] = (ecsJson?.data?.servers) || (ecsJson?.servers) || (Array.isArray(ecsJson?.data) ? ecsJson.data : []);
        const seen = new Set<string>();
        const merged: any[] = [];
        [...(Array.isArray(allInst) ? allInst : []), ...(Array.isArray(ecsList) ? ecsList : [])].forEach((x: any) => {
          const id = String(x?.InstanceId || x?.instanceId || x?.id || x?.uuid || x?.instance_id || '');
          if (id && !seen.has(id)) { seen.add(id); merged.push(x); }
        });
        allInst = merged;
        if ((!validVmIds || validVmIds.size === 0) && String(vid).trim()) {
          // fallback by matching addresses' network keys against ports' network_id set
          const netSet = new Set((enis || []).map((p:any)=> String(p?.network_id || '').trim()).filter(Boolean));
          const fallback = new Set<string>();
          (Array.isArray(allInst) ? allInst : []).forEach((x: any) => {
            const addrs = x?.addresses;
            if (addrs && !Array.isArray(addrs)) {
              Object.keys(addrs || {}).forEach((k: string) => {
                if (netSet.has(String(k).trim())) {
                  const id0 = String(x?.id || x?.InstanceId || x?.instance_id || '');
                  if (id0) fallback.add(id0);
                }
              });
            }
          });
          if (fallback.size > 0) validVmIds = fallback;
        }
      }
      
      const targetInsts = (Array.isArray(allInst) ? allInst : []).filter((x: any) => {
        if (validVmIds) {
           const id = String(x?.InstanceId || x?.instanceId || x?.id || x?.uuid || x?.instance_id || '');
           return validVmIds.has(id);
        }
        const v = x?.VpcId || x?.vpcId || x?.vpc_id || (x?.VpcAttributes?.VpcId) || x?.extra?.vpcId;
        return String(v || '').trim() === vid;
      });

      const eipRes: any = await fetchCloudProviderEips(cid);
      const eips: any[] = Array.isArray(eipRes?.data?.eips) ? eipRes!.data!.eips : (Array.isArray(eipRes) ? eipRes : []);
      const isBoundToEip = (niId: string) => {
        const list = (eips || []).filter((x: any) => {
          const type = String(x?.InstanceType || x?.instance_type || '').toLowerCase();
          const eniByType = (type === 'networkinterface') ? (x?.InstanceId || x?.instance_id || '') : '';
          const eniByField = x?.NetworkInterfaceId || x?.port_id || '';
          const target = String(niId || '');
          return String(eniByField || '') === target || String(eniByType || '') === target;
        });
        return list.length > 0;
      };
      
      const associations = targetInsts.map((inst: any) => {
        const vmId = String(inst?.InstanceId || inst?.instanceId || inst?.id || inst?.uuid || inst?.instance_id || '');
        if (!vmId) return null;
        
        let vmEnis: any[] = [];
        if (provider.includes('huawei') || provider === 'huaweicloud') {
          vmEnis = enis.filter((p: any) => String(p?.device_id || '').trim() === String(vmId || '').trim());
        } else {
          vmEnis = enis.filter((e: any) => {
              const attachment = e?.Attachment || e?.attachment || {};
              const iid = String(attachment?.InstanceId || attachment?.instance_id || attachment?.instanceId || e?.InstanceId || e?.instanceId || '');
              return iid && iid.trim() === String(vmId || '').trim();
          });
        }
        
        const pubEni = vmEnis.find(ni => isBoundToEip(String(ni?.NetworkInterfaceId || ni?.Id || ni?.id || ni?.port_id || '')));
        const privEni = vmEnis.find(ni => !isBoundToEip(String(ni?.NetworkInterfaceId || ni?.Id || ni?.id || ni?.port_id || '')));
        
        return { 
          vmId, 
          publicEniId: pubEni ? String(pubEni?.NetworkInterfaceId || pubEni?.Id || pubEni?.id || pubEni?.port_id || '') : undefined,
          privateEniId: privEni ? String(privEni?.NetworkInterfaceId || privEni?.Id || privEni?.id || privEni?.port_id || '') : undefined
        };
      }).filter(Boolean);

      if (associations.length) {
        form.setFieldsValue({ vrAssociations: associations.slice(0, 1) });
        message.success(`已自动关联 1 台云主机及网卡`);
      }
    } catch (e) {
      console.error(e);
      message.warning('自动关联失败，可手动填写关联ID');
    } finally {
      setAutoBinding(false);
    }
  };

  useEffect(() => { loadVRList(); loadClouds(); }, []);

  const onPrev = () => setCurrent((c) => Math.max(0, c - 1));
  const onNext = async () => {
    try {
      if (current === 0) {
        await form.validateFields(['name','category','subType']);
      } else if (current === 1) {
        const isVpc = form.getFieldValue('category') === 'vpc';
        if (isVpc) {
          await form.validateFields(['cloudId','vpcId','vrBindingMode']);
          if (form.getFieldValue('vrBindingMode') === 'existing') await form.validateFields(['vrUuid']);
        } else {
          await form.validateFields(['vrUuid']);
        }
      }
      setCurrent((c) => c + 1);
    } catch (e) {}
  };

  const onCreate = async () => {
    try {
      const values = form.getFieldsValue(true);
      const isVpc = form.getFieldValue('category') === 'vpc';

      const subType = form.getFieldValue('subType');
      const associations = Array.isArray(values.vrAssociations) ? values.vrAssociations : [];
      const vrInstanceIds = associations.map((a: any) => a.vmId).filter(Boolean);
      const vrPublicEniIds = associations.map((a: any) => a.publicEniId).filter(Boolean);
      const vrPrivateEniIds = associations.map((a: any) => a.privateEniId).filter(Boolean);

      // Extract IPs
      console.log('[Wizard Debug] onCreate rawEnis count:', rawEnis.length, 'First few IDs:', rawEnis.slice(0, 3).map(e => e.NetworkInterfaceId || e.id));

      const findEniIp = (eniId: string, type: 'public' | 'private') => {
        if (!eniId) return undefined;
        const targetId = String(eniId).trim();
        // Try to find in rawEnis
        const eni = rawEnis.find(e => String(e?.NetworkInterfaceId || e?.Id || e?.id || e?.port_id || '').trim() === targetId);
        if (eni) {
             // If public type, try to find public IP first (Aliyun EIP)
             if (type === 'public') {
                 const publicIp = eni.AssociatedPublicIp?.PublicIpAddress || eni.PublicIpAddress;
                 if (publicIp) return publicIp;
             }
             
             const ip = eni.PrivateIpAddress || eni.PrimaryIpAddress || (Array.isArray(eni.fixed_ips) && eni.fixed_ips[0]?.ip_address) || eni.ip_address;
             if (ip) return ip;
             console.warn('[Wizard Debug] ENI found but no IP:', Object.keys(eni));
        } else {
             console.warn(`[Wizard Debug] ENI not found for ID: ${targetId} in rawEnis (count: ${rawEnis.length})`);
        }
        // Fallback: try to find in eniOptions (label might contain IP)
        const opt = eniOptions.find(o => String(o.value).trim() === targetId);
        if (opt && opt.label) {
            const parts = opt.label.split('/ ');
            if (parts.length > 1) return parts[1].trim();
        }
        return undefined;
      };

      const vrPublicIp = associations.map((a: any) => findEniIp(a.publicEniId, 'public')).filter(Boolean);
      const vrPrivateIp = associations.map((a: any) => findEniIp(a.privateEniId, 'private')).filter(Boolean);

      console.log('[Wizard Debug] Extracted IPs:', { vrPublicIp, vrPrivateIp, associations });

      // Ensure subnets are loaded (safety net)
      let currentSubnets = subnets;
      if ((!currentSubnets || currentSubnets.length === 0) && isVpc && values.vpcId && values.cloudId) {
        try {
          console.log('Wizard: Subnets empty, fetching again...');
          const cloud = clouds.find((c) => String(c.id) === String(values.cloudId));
          const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
          const res: any = await fetchCloudProviderSubnetsByVpc(values.cloudId, values.vpcId);
          let list: any[] = [];
          if (provider.includes('huawei')) {
             list = (res?.data?.subnets) || (res?.subnets) || [];
          } else if (provider.includes('tencent')) {
             list = (res?.data?.SubnetSet) || [];
          } else {
             list = (res?.data?.VSwitches?.VSwitch) || (Array.isArray(res) ? res : []) || [];
          }
          currentSubnets = Array.isArray(list) ? list : [];
          console.log('Wizard: Refetched subnets:', currentSubnets.length);
          // setSubnets(currentSubnets); // Update state for future, though we use local var now
        } catch (e) {
          console.warn('Wizard: Failed to refetch subnets:', e);
        }
      }

      // Extract Subnet CIDRs
      const findEniSubnetCidr = (eniId: string) => {
        if (!eniId) return undefined;
        const targetId = String(eniId).trim();
        const eni = rawEnis.find(e => String(e?.NetworkInterfaceId || e?.Id || e?.id || e?.port_id || '').trim() === targetId);
        if (!eni) {
          console.warn(`[Wizard Debug] ENI not found for ID: ${targetId}`);
          return undefined;
        }
        const subnetId = eni.VSwitchId || eni.subnet_id || (Array.isArray(eni.fixed_ips) && eni.fixed_ips[0]?.subnet_id);
        if (!subnetId) {
          console.warn(`[Wizard Debug] Subnet ID not found in ENI object keys:`, Object.keys(eni));
          return undefined;
        }
        // Use currentSubnets instead of state subnets
        const subnet = currentSubnets.find((s: any) => String(s.VSwitchId || s.id || s.subnet_id || s.SubnetId || '').trim() === String(subnetId).trim());
        if (!subnet) {
          console.warn(`[Wizard Debug] Subnet not found for ID: ${subnetId}. Available subnets:`, currentSubnets.map(s => s.id || s.subnet_id || s.VSwitchId));
          return undefined;
        }
        return subnet.CidrBlock || subnet.cidr;
      };

      const vrPublicSubnetCidr = associations.map((a: any) => findEniSubnetCidr(a.publicEniId)).filter(Boolean);
      const vrPrivateSubnetCidr = associations.map((a: any) => findEniSubnetCidr(a.privateEniId)).filter(Boolean);
      
      console.log('[Wizard Debug] Extracted CIDRs:', { vrPublicSubnetCidr, vrPrivateSubnetCidr });

      const payload: SecurityDomainPayload = {
        name: values.name,
        category: values.category,
        subType: Array.isArray(values.subType) ? values.subType.join(',') : values.subType,
        cidr: !isVpc ? String(values.cidr || '') : (() => {
          if (!values.vpcId) return undefined;
          const v = rawVpcs.find(rv => String(rv.VpcId || rv.id || rv.uuid || rv.vpc_id || rv.vpcId || rv.ID || rv.Name || rv.name || '') === String(values.vpcId));
          return v ? (v.CidrBlock || v.cidr || v.cidrBlock || v.network || v.address || v.vpc_cidr) : undefined;
        })(),
        cidr6: !isVpc ? String(values.cidr6 || '') : (() => {
          if (!values.vpcId) return undefined;
          const v = rawVpcs.find(rv => String(rv.VpcId || rv.id || rv.uuid || rv.vpc_id || rv.vpcId || rv.ID || rv.Name || rv.name || '') === String(values.vpcId));
          return v ? (v.Ipv6CidrBlock || v.ipv6_cidr) : undefined;
        })(),
        cloudId: isVpc ? String(values.cloudId || '') : undefined,
        vpcId: isVpc ? String(values.vpcId || '') : undefined,
        vrUuid: !isVpc ? String(values.vrUuid || '') : (values.vrBindingMode === 'existing' ? String(values.vrUuid || '') : undefined),
        vrName: (() => {
          const id = values.vrUuid;
          return id ? (vrOptions.find(v => v.uuid === id)?.name) : undefined;
        })(),
        vrInstanceIds: vrInstanceIds.length ? vrInstanceIds : undefined,
        vrPublicEniIds: vrPublicEniIds.length ? vrPublicEniIds : undefined,
        vrPrivateEniIds: vrPrivateEniIds.length ? vrPrivateEniIds : undefined,
        vrPublicIp: vrPublicIp.length ? vrPublicIp : undefined,
        vrPrivateIp: vrPrivateIp.length ? vrPrivateIp : undefined,
        vrPublicSubnetCidr: vrPublicSubnetCidr.length ? vrPublicSubnetCidr : undefined,
        vrPrivateSubnetCidr: vrPrivateSubnetCidr.length ? vrPrivateSubnetCidr : undefined,
        tags: undefined,
        description: values.description,
        status: 'active',
      };

      await createSecurityDomain(payload);
      message.success('安全域已创建');
      navigate('/admin/sec-mgr-plane/security-domain');
    } catch (e) {
        console.error(e);
        message.error('创建失败');
    }
  };

  return (
    <PageContainer
      title={<span><UserOutlined style={{ marginRight: 6, color: '#1677ff' }} />安全域设置向导</span>}
      titleLevel={3}
      subtitle="按照步骤设定安全域大类/子类、选择资源池与 VPC 或绑定 VR 实例，并最终确认配置。"
      extra={<Space><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button><Button icon={<ReloadOutlined />} onClick={() => { loadVRList(); loadClouds(); const cid = form.getFieldValue('cloudId'); if (cid) loadCloudVpcs(cid); }}>刷新</Button></Space>}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps direction="vertical" size="small" current={current} onChange={(idx) => setCurrent(idx)} items={[{ title: '设定基础信息' }, { title: '设定安全域' }, { title: '确认安全域' }]} />
          </Card>
        </Col>
        <Col span={19}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${current + 1} 步：${stepTitle}`}</span>} variant="outlined">
            <Form
              form={form}
              layout="vertical"
              initialValues={{ vrBindingMode: 'auto' }}
              onValuesChange={(changed, all) => {
                if (changed.cloudId) loadCloudVpcs(changed.cloudId);
                if (changed.category) {
                  form.setFieldsValue({ subType: undefined, cloudId: undefined, vpcId: undefined, vrUuid: undefined, vrBindingMode: 'auto' });
                }
                if (changed.subType) {
                  form.setFieldsValue({ cloudId: undefined, vpcId: undefined, vrUuid: undefined, vrBindingMode: 'auto' });
                }
                if (changed.vpcId || changed.cloudId) {
                  const cid = String(form.getFieldValue('cloudId') || changed.cloudId || '');
                  const vid = String(form.getFieldValue('vpcId') || changed.vpcId || '');
                  if (cid && vid) {
                    try {
                      const cloud = clouds.find((c) => String(c?.id || c?._id || c?.uuid || c?.cloudId) === String(cid));
                      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
                      if (provider.includes('huawei') || provider === 'huaweicloud' || provider.includes('华为云')) {
                        Promise.resolve().then(()=>fetchCloudProviderEcs(cid)).catch(()=>{});
                      }
                    } catch {}
                    loadResources(cid, vid);
                  }
                }
                if (changed.vrUuid) {
                  const cid = String(form.getFieldValue('cloudId') || '');
                  const vid = String(form.getFieldValue('vpcId') || '');
                  if (cid && vid) { /* disabled auto binding */ }
                }
              }}
            >
              {current === 0 && (
                <>
                  <Form.Item name="name" label="安全域名称" rules={[{ required: true, message: '请输入安全域名称' }]}> 
                    <Input placeholder="如：华东生产VPC / 总部办公网" />
                  </Form.Item>
                  <Form.Item name="category" label="安全域大类" rules={[{ required: true, message: '请选择大类' }]}> 
                    <Select placeholder="请选择大类" options={[{ value: 'vpc', label: 'VPC网络' }, { value: 'flat', label: '扁平网络' }]} />
                  </Form.Item>
                  <Form.Item shouldUpdate={(prev, cur) => prev.category !== cur.category} noStyle>
                    {() => (
                      <Form.Item name="subType" label="安全域标签"> 
                        <Select mode="tags" tokenSeparators={[',', ' ']} showSearch allowClear optionFilterProp="label" disabled={!form.getFieldValue('category')} placeholder={form.getFieldValue('category') ? '请选择或输入标签（可选）' : '请先选择大类'} notFoundContent={form.getFieldValue('category') ? '暂无选项' : '请先选择大类'} options={(() => {
                          const cat = form.getFieldValue('category');
                          const vpcSubs = [{ value: '公有云VPC网络', label: '公有云VPC网络' }, { value: '私有云VPC网络', label: '私有云VPC网络' }];
                          const flatSubs = [{ value: '虚拟化网络', label: '虚拟化网络' }, { value: 'IDC网络', label: 'IDC网络' }, { value: '办公网络', label: '办公网络' }];
                          if (cat === 'vpc') return vpcSubs;
                          if (cat === 'flat') return flatSubs;
                          return [];
                        })()} />
                      </Form.Item>
                    )}
                  </Form.Item>
                  <Form.Item name="description" label="用途说明"> 
                    <Input.TextArea rows={3} placeholder="设定安全域用途与说明" />
                  </Form.Item>
                </>
              )}

              {current === 1 && (
                <>
                  {form.getFieldValue('category') === 'vpc' ? (
                    <>
                      <Form.Item name="cloudId" label="选择已接入的云资源池" rules={[{ required: true, message: '请选择资源池' }]}> 
                        <Select placeholder="请选择资源池（含云厂商与地域）" loading={cloudLoading} options={clouds.map(c => ({ value: c.id || c._id || c.uuid || c.cloudId || c.name, label: cloudLabel(c) }))} />
                      </Form.Item>
                      <Form.Item name="vpcId" label="选择 VPC" rules={[{ required: true, message: '请选择 VPC' }]}> 
                        <Select placeholder="从云端拉取（自动适配云厂商接口）" loading={vpcLoading} options={normalizedVpcs.map(v => ({ value: v.id, label: v.label }))} />
                      </Form.Item>
                      <Form.Item name="vrBindingMode" label="VR 绑定" rules={[{ required: true, message: '请选择 VR 绑定方式' }]}> 
                        <Radio.Group>
                          <Radio value="auto">自动部署 VR 实例</Radio>
                          <Radio value="existing">绑定已有 VR 实例（仅限 CE）</Radio>
                        </Radio.Group>
                      </Form.Item>
                      <Form.Item shouldUpdate={(prev, cur) => prev.vrBindingMode !== cur.vrBindingMode} noStyle>
                        {() => (
                          form.getFieldValue('vrBindingMode') === 'existing' && (
                            <Form.Item name="vrUuid" label="选择 VR 实例" rules={[{ required: true, message: '请选择 VR 实例' }]}> 
                              <Select showSearch optionFilterProp="label" placeholder={vrLoading ? '加载中...' : '选择已部署的 VR 实例'} options={vrOptions.map(v => ({ value: v.uuid, label: `${v.name} (${String(v.uuid).slice(0,8)})` }))} loading={vrLoading} notFoundContent={vrLoading ? '加载中...' : '暂无数据'} filterOption={(input, option) => { const text = String((option as any)?.label ?? (option as any)?.value ?? '').toLowerCase(); return text.includes(String(input).toLowerCase()); }} onDropdownVisibleChange={(open) => { if (open) { loadVRList(); } }} onFocus={() => { loadVRList(); }} allowClear />
                            </Form.Item>
                          )
                        )}
                      </Form.Item>
                      <div style={{ marginBottom: 8, color: '#000000e0', fontWeight: 500 }}>关联云主机与网卡：</div>
                      <Form.List name="vrAssociations">
                        {(fields, { add, remove }) => (
                          <>
                            {fields.map(({ key, name, ...restField }) => (
                              <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                                <Form.Item
                                  {...restField}
                                  name={[name, 'vmId']}
                                  rules={[{ required: true, message: '请选择云主机' }]}
                                  style={{ width: 280 }}
                                >
                                  <Select placeholder="选择云主机" options={vmOptions} showSearch optionFilterProp="label" 
                                    onChange={() => {
                                       const path = ['vrAssociations', name];
                                       form.setFieldValue([...path, 'publicEniId'], undefined);
                                       form.setFieldValue([...path, 'privateEniId'], undefined);
                                    }}
                                  />
                                </Form.Item>
                                <Form.Item
                                  shouldUpdate={(prev, cur) => prev.vrAssociations?.[name]?.vmId !== cur.vrAssociations?.[name]?.vmId}
                                >
                                  {() => {
                                      const vmId = form.getFieldValue(['vrAssociations', name, 'vmId']);
                                      const filteredEnis = rawEnis.filter(e => {
                                           const attachment = e?.Attachment || e?.attachment || {};
                                           const iid = String(
                                             attachment?.InstanceId || 
                                             attachment?.instance_id || 
                                             attachment?.instanceId || 
                                             e?.InstanceId || 
                                             e?.instanceId || 
                                             e?.device_id || 
                                             ''
                                           );
                                           return iid && String(vmId || '') && iid.trim() === String(vmId || '').trim();
                                      }).map(x => ({
                                          label: `${x?.NetworkInterfaceName || x?.name || x?.id} (${x?.NetworkInterfaceId || x?.Id || x?.id || x?.port_id || ''}) ${
                                            x?.PrivateIpAddress 
                                              ? '/ ' + x.PrivateIpAddress 
                                              : (Array.isArray(x?.fixed_ips) && x.fixed_ips.length ? ('/ ' + (x.fixed_ips[0]?.ip_address || '')) : '')
                                          }`,
                                          value: String(x?.NetworkInterfaceId || x?.Id || x?.id || x?.port_id || '')
                                      }));
                                      return (
                                          <Form.Item
                                              {...restField}
                                              name={[name, 'publicEniId']}
                                              style={{ width: 200, marginBottom: 0 }}
                                          >
                                              <Select placeholder="VR公网口绑定网卡" options={filteredEnis} allowClear />
                                          </Form.Item>
                                      );
                                  }}
                                </Form.Item>
                                <Form.Item
                                  shouldUpdate={(prev, cur) => prev.vrAssociations?.[name]?.vmId !== cur.vrAssociations?.[name]?.vmId}
                                >
                                  {() => {
                                      const vmId = form.getFieldValue(['vrAssociations', name, 'vmId']);
                                      const filteredEnis = rawEnis.filter(e => {
                                           const attachment = e?.Attachment || e?.attachment || {};
                                           const iid = String(
                                             attachment?.InstanceId || 
                                             attachment?.instance_id || 
                                             attachment?.instanceId || 
                                             e?.InstanceId || 
                                             e?.instanceId || 
                                             e?.device_id || 
                                             ''
                                           );
                                           return iid && String(vmId || '') && iid.trim() === String(vmId || '').trim();
                                      }).map(x => ({
                                          label: `${x?.NetworkInterfaceName || x?.name || x?.id} (${x?.NetworkInterfaceId || x?.Id || x?.id || x?.port_id || ''}) ${
                                            x?.PrivateIpAddress 
                                              ? '/ ' + x.PrivateIpAddress 
                                              : (Array.isArray(x?.fixed_ips) && x.fixed_ips.length ? ('/ ' + (x.fixed_ips[0]?.ip_address || '')) : '')
                                          }`,
                                          value: String(x?.NetworkInterfaceId || x?.Id || x?.id || x?.port_id || '')
                                      }));
                                      return (
                                          <Form.Item
                                              {...restField}
                                              name={[name, 'privateEniId']}
                                              style={{ width: 200, marginBottom: 0 }}
                                          >
                                              <Select placeholder="VR内网口绑定网卡" options={filteredEnis} allowClear />
                                          </Form.Item>
                                      );
                                  }}
                                </Form.Item>
                                <MinusCircleOutlined onClick={() => remove(name)} />
                              </Space>
                            ))}
                            {fields.length < 1 && (
                              <Form.Item>
                                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                                  添加关联云主机
                                </Button>
                              </Form.Item>
                            )}
                          </>
                        )}
                      </Form.List>
                      <Form.Item>
                        <Space>
                          <Button size="small" onClick={() => setDebugOpen((v) => !v)}>查看调试数据</Button>
                        </Space>
                      </Form.Item>
                      {(providerKey.includes('huawei') || providerKey.includes('华为云')) && debugOpen && (
                        <Card size="small" title="调试数据" variant="outlined" style={{ marginTop: 8 }}>
                          <Space style={{ marginBottom: 8 }}>
                            <Tag color="blue">ECS</Tag>
                            <span>{debugEcs.length}</span>
                            <Tag color="geekblue">Ports</Tag>
                            <span>{debugPorts.length}</span>
                          </Space>
                          <Row gutter={[8, 8]}>
                            <Col span={12}>
                              <Table
                                size="small"
                                bordered
                                dataSource={debugEcs}
                                rowKey={(r: any) => String(r?.id || r?.InstanceId || r?.instance_id || Math.random())}
                                pagination={{ pageSize: 5 }}
                                columns={[
                                  { title: 'id', dataIndex: 'id' },
                                  { title: 'name', dataIndex: 'name' },
                                ]}
                              />
                            </Col>
                            <Col span={12}>
                              <Table
                                size="small"
                                bordered
                                dataSource={debugPorts}
                                rowKey={(p: any) => String(p?.id || p?.port_id || Math.random())}
                                pagination={{ pageSize: 5 }}
                                columns={[
                                  { title: 'id', dataIndex: 'id' },
                                  { title: 'network_id', dataIndex: 'network_id' },
                                  { title: 'device_id', dataIndex: 'device_id' },
                                  { title: 'ip', render: (_: any, p: any) => (Array.isArray(p?.fixed_ips) && p.fixed_ips.length ? (p.fixed_ips[0]?.ip_address || '') : '') },
                                ]}
                              />
                            </Col>
                          </Row>
                        </Card>
                      )}
                    </>
                  ) : (
                    <>
                      <Form.Item name="vrUuid" label="选择 VR 实例" rules={[{ required: true, message: '请选择 VR 实例' }]}> 
                        <Select showSearch optionFilterProp="label" placeholder={vrLoading ? '加载中...' : '选择已部署的 VR 实例'} options={vrOptions.map(v => ({ value: v.uuid, label: `${v.name} (${String(v.uuid).slice(0,8)})` }))} loading={vrLoading} notFoundContent={vrLoading ? '加载中...' : '暂无数据'} filterOption={(input, option) => { const text = String((option as any)?.label ?? (option as any)?.value ?? '').toLowerCase(); return text.includes(String(input).toLowerCase()); }} onDropdownVisibleChange={(open) => { if (open) { loadVRList(); } }} onFocus={() => { loadVRList(); }} allowClear />
                      </Form.Item>
                      <Form.Item name="cidr" label="IPv4 CIDR"> 
                        <Input placeholder="例如：10.0.0.0/16" />
                      </Form.Item>
                      <Form.Item name="cidr6" label="IPv6 CIDR"> 
                        <Input placeholder="例如：2001:db8::/32,2001:db8:1::/48" />
                      </Form.Item>
                      <div style={{ marginBottom: 8, color: '#000000e0', fontWeight: 500 }}>关联云主机与网卡：</div>
                      <Form.List name="vrAssociations">
                        {(fields, { add, remove }) => (
                          <>
                            {fields.map(({ key, name, ...restField }) => (
                              <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                                <Form.Item
                                  {...restField}
                                  name={[name, 'vmId']}
                                  rules={[{ required: true, message: '请选择云主机' }]}
                                  style={{ width: 280 }}
                                >
                                  <Select placeholder="选择云主机" options={vmOptions} showSearch optionFilterProp="label" 
                                    onChange={() => {
                                       const path = ['vrAssociations', name];
                                       form.setFieldValue([...path, 'publicEniId'], undefined);
                                       form.setFieldValue([...path, 'privateEniId'], undefined);
                                    }}
                                  />
                                </Form.Item>
                                <Form.Item
                                  shouldUpdate={(prev, cur) => prev.vrAssociations?.[name]?.vmId !== cur.vrAssociations?.[name]?.vmId}
                                >
                                  {() => {
                                      const vmId = form.getFieldValue(['vrAssociations', name, 'vmId']);
                                      const filteredEnis = rawEnis.filter(e => {
                                           const attachment = e?.Attachment || e?.attachment || {};
                                           const iid = String(attachment?.InstanceId || attachment?.instance_id || attachment?.instanceId || e?.InstanceId || e?.instanceId || '');
                                           return iid && String(vmId || '') && iid.trim() === String(vmId || '').trim();
                                      }).map(x => ({
                                          label: `${x?.NetworkInterfaceName || x?.name || x?.id} (${x?.NetworkInterfaceId || x?.id}) ${x?.PrivateIpAddress ? '/ ' + x.PrivateIpAddress : ''}`,
                                          value: String(x?.NetworkInterfaceId || x?.Id || x?.id || '')
                                      }));
                                      return (
                                          <Form.Item
                                              {...restField}
                                              name={[name, 'publicEniId']}
                                              style={{ width: 200, marginBottom: 0 }}
                                          >
                                              <Select placeholder="VR公网口绑定网卡" options={filteredEnis} allowClear />
                                          </Form.Item>
                                      );
                                  }}
                                </Form.Item>
                                <Form.Item
                                  shouldUpdate={(prev, cur) => prev.vrAssociations?.[name]?.vmId !== cur.vrAssociations?.[name]?.vmId}
                                >
                                  {() => {
                                      const vmId = form.getFieldValue(['vrAssociations', name, 'vmId']);
                                      const filteredEnis = rawEnis.filter(e => {
                                           const attachment = e?.Attachment || e?.attachment || {};
                                           const iid = String(attachment?.InstanceId || attachment?.instance_id || attachment?.instanceId || e?.InstanceId || e?.instanceId || '');
                                           return iid && String(vmId || '') && iid.trim() === String(vmId || '').trim();
                                      }).map(x => ({
                                          label: `${x?.NetworkInterfaceName || x?.name || x?.id} (${x?.NetworkInterfaceId || x?.id}) ${x?.PrivateIpAddress ? '/ ' + x.PrivateIpAddress : ''}`,
                                          value: String(x?.NetworkInterfaceId || x?.Id || x?.id || '')
                                      }));
                                      return (
                                          <Form.Item
                                              {...restField}
                                              name={[name, 'privateEniId']}
                                              style={{ width: 200, marginBottom: 0 }}
                                          >
                                              <Select placeholder="VR内网口绑定网卡" options={filteredEnis} allowClear />
                                          </Form.Item>
                                      );
                                  }}
                                </Form.Item>
                                <MinusCircleOutlined onClick={() => remove(name)} />
                              </Space>
                            ))}
                            {fields.length < 1 && (
                              <Form.Item>
                                <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                                  添加关联云主机
                                </Button>
                              </Form.Item>
                            )}
                          </>
                        )}
                      </Form.List>
                    </>
                  )}
                </>
              )}

              {current === 2 && (
                <>
                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="安全域名称">{String(form.getFieldValue('name')||'')}</Descriptions.Item>
                    <Descriptions.Item label="大类/标签">
                      {(() => {
                        const cat = String(form.getFieldValue('category')||'').trim();
                        const subRaw = form.getFieldValue('subType');
                        const subArr = Array.isArray(subRaw) ? subRaw : (subRaw ? String(subRaw).split(',') : []);
                        
                        return (
                          <Space>
                            {cat && <Tag>{cat}</Tag>}
                            {subArr.map((s: string, i: number) => <Tag key={i}>{s}</Tag>)}
                          </Space>
                        );
                      })()}
                    </Descriptions.Item>
                    
                    <Descriptions.Item label="云主机">
                      {(() => {
                        const arr = Array.isArray(form.getFieldValue('vrAssociations')) ? form.getFieldValue('vrAssociations') : [];
                        if (!arr.length) return '';
                        const items = arr.map((a: any, i: number) => {
                          const opt = vmOptions.find(o => String(o.value) === String(a?.vmId || ''));
                          const text = opt ? opt.label : String(a?.vmId || '');
                          return <Tag key={i} color="geekblue">{text}</Tag>;
                        });
                        return <span>{items}</span>;
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="ENI绑定">
                      {(() => {
                        const arr = Array.isArray(form.getFieldValue('vrAssociations')) ? form.getFieldValue('vrAssociations') : [];
                        if (!arr.length) return '';
                        const renderLabel = (id?: string) => {
                          const opt = eniOptions.find(o => String(o.value) === String(id || ''));
                          return opt ? opt.label : (id || '');
                        };
                        return (
                          <div>
                            {arr.map((a: any, i: number) => (
                              <div key={i} style={{ marginBottom: 4 }}>
                                <Tag color="geekblue">公网口</Tag> {renderLabel(a?.publicEniId)}{' '}
                                <Tag color="geekblue" style={{ marginLeft: 8 }}>内网口</Tag> {renderLabel(a?.privateEniId)}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="云资源池">
                      {(() => {
                        const cid = String(form.getFieldValue('cloudId')||'').trim();
                        const cloud = clouds.find((c) => String(c?.id || c?._id || c?.uuid || c?.cloudId || c?.name) === cid);
                        return cloud ? cloudLabel(cloud) : '';
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="VPC">
                      {(() => {
                        const vid = String(form.getFieldValue('vpcId')||'').trim();
                        const v = normalizedVpcs.find(x => String(x.id) === vid);
                        return v ? v.label : (vid || '');
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="IPv4 CIDR">
                      {(() => {
                        const vid = String(form.getFieldValue('vpcId')||'').trim();
                        const v = normalizedVpcs.find(x => String(x.id) === vid);
                        const cidr = v?.label?.split(' / ').pop();
                        if (cidr) return cidr;
                        const c = String(form.getFieldValue('cidr')||'').trim();
                        return c || '';
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="IPv6 CIDR">
                      {(() => {
                        const c6raw = form.getFieldValue('cidr6');
                        if (typeof c6raw === 'string') {
                          const arr = c6raw.split(',').map(s=>s.trim()).filter(Boolean);
                          return arr.length ? arr.join(', ') : '';
                        }
                        const arr = Array.isArray(c6raw) ? c6raw : [];
                        return arr.length ? arr.join(', ') : '';
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="VR绑定方式">
                      {(() => {
                        const m = String(form.getFieldValue('vrBindingMode')||'').trim();
                        return m ? (<Tag color="geekblue">{m==='existing' ? '绑定已有' : '自动部署'}</Tag>) : '';
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="VR实例">
                      {(() => {
                        const id = String(form.getFieldValue('vrUuid')||'').trim();
                        const v = vrOptions.find(x => String(x.uuid) === id);
                        return v ? `${v.name} (${String(v.uuid).slice(0,8)})` : (id || '');
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="用途说明">{String(form.getFieldValue('description')||'')}</Descriptions.Item>
                    <Descriptions.Item label="标签">
                      {(() => {
                        const tags = (form.getFieldValue('tags')||[]) as string[];
                        return (Array.isArray(tags) && tags.length) ? tags.map((t:string, i:number)=><Tag key={i}>{t}</Tag>) : '';
                      })()}
                    </Descriptions.Item>
                  </Descriptions>
                </>
              )}

            </Form>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <Space>
                <Button onClick={() => navigate('/admin/sec-mgr-plane/security-domain')}>返回列表</Button>
                <Button onClick={onPrev} disabled={current===0}>上一步</Button>
              </Space>
              <Space>
                <Button type="primary" onClick={() => { if (current < 2) onNext(); else onCreate(); }}>{current<2? '下一步':'提交创建'}</Button>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>

    </PageContainer>
  );
};

export default SecurityDomainWizardPage;
