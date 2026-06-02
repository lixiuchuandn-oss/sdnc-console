import { useState, useMemo, useCallback, useEffect } from 'react';
import { Form } from 'antd';
import type { FormInstance } from 'antd/es/form';
import {
  fetchKubeOvnSubnets,
  fetchKubeOvnVpcs,
  fetchHarvesterNads,
} from '../../../../../../../../services/harvesterApi';

export type WorkloadFormSubnetOption = {
  label: string;
  value: string;
  subnet: any;
};

export type WorkloadFormVpcOption = {
  label: string;
  value: string;
};

export type WorkloadFormNadOption = {
  label: string;
  value: string;
  nad: any;
  _type: string;
  _promisc: boolean;
};

type UseWorkloadFormNetworkOptionsParams = {
  cloudId: string;
  form: FormInstance;
  defaultNamespace?: string;
  editData?: any;
};

export function useWorkloadFormNetworkOptions({
  cloudId,
  form,
  defaultNamespace,
  editData,
}: UseWorkloadFormNetworkOptionsParams) {
  const [kubeSubnets, setKubeSubnets] = useState<any[]>([]);
  const [kubeVpcs, setKubeVpcs] = useState<any[]>([]);
  const [nads, setNads] = useState<any[]>([]);
  const [loadingNetworkData, setLoadingNetworkData] = useState(false);

  useEffect(() => {
    const fetchNetworkData = async () => {
      setLoadingNetworkData(true);
      try {
        const [subnetsRes, vpcsRes, nadsRes] = await Promise.all([
          fetchKubeOvnSubnets(cloudId, false, false, 'underlay').catch(() => ({ items: [] })),
          fetchKubeOvnVpcs(cloudId, false, false, 'vpc').catch(() => ({ items: [] })),
          fetchHarvesterNads(cloudId).catch(() => ({ items: [] })),
        ]);

        const subnetItems: any[] =
          subnetsRes?.data?.items || subnetsRes?.items || (Array.isArray(subnetsRes) ? subnetsRes : []);
        const normalizedSubnets = subnetItems.map((x: any) => ({
          ...x,
          name: x?.metadata?.name || x?.name,
          namespace: x?.metadata?.namespace || 'default',
          vpc: x?.spec?.vpc || x?.vpc,
          cidr: x?.spec?.cidrBlock || x?.cidr,
        }));

        const vpcItems: any[] =
          vpcsRes?.data?.items || vpcsRes?.items || (Array.isArray(vpcsRes) ? vpcsRes : []);
        const normalizedVpcs = vpcItems.map((x: any) => ({
          ...x,
          name: x?.metadata?.name || x?.name,
          alias: x?.metadata?.annotations?.['tower.io/alias'] || x?.annotations?.['tower.io/alias'] || '',
        }));

        setKubeSubnets(normalizedSubnets);
        setKubeVpcs(normalizedVpcs);
        setNads(nadsRes?.data?.items || nadsRes?.items || (Array.isArray(nadsRes) ? nadsRes : []));
      } catch (error) {
        console.error('获取网络数据失败:', error);
      } finally {
        setLoadingNetworkData(false);
      }
    };

    void fetchNetworkData();
  }, [cloudId]);

  useEffect(() => {
    if (!editData || loadingNetworkData || kubeSubnets.length === 0) return;

    const template = editData?.spec?.template || {};
    const templateAnnotations = template?.metadata?.annotations || {};
    const networksAnnotation = templateAnnotations['k8s.v1.cni.cncf.io/networks'];
    const logicalSwitch = templateAnnotations['ovn.kubernetes.io/logical_switch'];

    if (!networksAnnotation) return;

    const parts = networksAnnotation.split('/');
    const subnetName = parts.length === 2 ? parts[1] : parts[0];

    const subnet = kubeSubnets.find((s) => (s.name || s?.metadata?.name) === subnetName);
    if (!subnet) {
      form.setFieldsValue({
        networkType: 'custom_nad',
        customNad: networksAnnotation,
        flatSubnet: undefined,
        vpcSubnet: undefined,
        vpcName: undefined,
      });
      return;
    }

    const subnetVpc = subnet?.vpc || subnet?.spec?.vpc;
    const subnetType = subnet?.metadata?.annotations?.['tower.io/subnet-type'];

    if (subnetType === 'flat' || subnetVpc === 'ovn-internal') {
      form.setFieldsValue({
        networkType: 'flat_subnet',
        flatSubnet: networksAnnotation,
        vpcSubnet: undefined,
        vpcName: undefined,
        customNad: undefined,
      });
    } else if (logicalSwitch) {
      form.setFieldsValue({
        networkType: 'vpc',
        vpcSubnet: networksAnnotation,
        vpcName: subnetVpc,
        flatSubnet: undefined,
        customNad: undefined,
      });
    } else {
      form.setFieldsValue({
        networkType: 'flat_subnet',
        flatSubnet: networksAnnotation,
        vpcSubnet: undefined,
        vpcName: undefined,
        customNad: undefined,
      });
    }
  }, [editData, loadingNetworkData, kubeSubnets, form]);

  const isFlatSubnet = useCallback((subnet: any) => {
    const type = subnet?.metadata?.annotations?.['tower.io/subnet-type'];
    return type === 'flat';
  }, []);

  const isFlatVpc = useCallback((vpc: string) => {
    return vpc === 'ovn-internal' || vpc === 'ovn-cluster';
  }, []);

  const flatSubnetOptions = useMemo((): WorkloadFormSubnetOption[] => {
    return (kubeSubnets || [])
      .filter((s) => isFlatVpc(s?.vpc || s?.spec?.vpc) && isFlatSubnet(s))
      .map((s) => {
        const name = s.name || s?.metadata?.name || '-';
        const subnetNs = s?.namespace || s?.metadata?.namespace || 'default';
        const alias = s?.metadata?.annotations?.['tower.io/alias'] || s?.annotations?.['tower.io/alias'] || '';
        const cidr = s?.cidr || s?.spec?.cidrBlock || '';
        const label = alias
          ? `${alias} (${name})${cidr ? ` - ${cidr}` : ''}`
          : `${name}${cidr ? ` (${cidr})` : ''}`;
        const nadRef = `${subnetNs}/${name}`;
        return {
          label,
          value: nadRef,
          subnet: s,
        };
      });
  }, [kubeSubnets, isFlatSubnet, isFlatVpc]);

  const vpcOptions = useMemo((): WorkloadFormVpcOption[] => {
    return (kubeVpcs || [])
      .filter((v) => !isFlatVpc(v?.name || v?.metadata?.name))
      .map((v) => {
        const name = v.name || v?.metadata?.name || '-';
        const alias = v.alias || v?.metadata?.annotations?.['tower.io/alias'] || '';
        const label = alias ? `${alias}(${name})` : name;
        return {
          label,
          value: name,
        };
      });
  }, [kubeVpcs, isFlatVpc]);

  const selectedVpc = Form.useWatch('vpcName', form);

  const vpcSubnetOptions = useMemo((): WorkloadFormSubnetOption[] => {
    if (!selectedVpc) return [];
    return (kubeSubnets || [])
      .filter((s) => (s?.vpc || s?.spec?.vpc) === selectedVpc)
      .map((s) => {
        const name = s.name || s?.metadata?.name || '-';
        const alias = s?.metadata?.annotations?.['tower.io/alias'] || s?.annotations?.['tower.io/alias'] || '';
        const cidr = s?.cidr || s?.spec?.cidrBlock || '';
        const label = alias
          ? `${alias} (${name})${cidr ? ` - ${cidr}` : ''}`
          : `${name}${cidr ? ` (${cidr})` : ''}`;
        return {
          label,
          value: name,
          subnet: s,
        };
      });
  }, [kubeSubnets, selectedVpc]);

  const allNadOptions = useMemo((): WorkloadFormNadOption[] => {
    const selectedNamespace = form.getFieldValue('namespace') || defaultNamespace || 'default';
    return (nads || [])
      .map((n: any) => {
        const name = n?.metadata?.name || n?.name;
        const ns = n?.metadata?.namespace || n?.namespace || 'default';
        const displayName = n?.spec?.displayName || n?.metadata?.annotations?.['tower.io/alias'] || '';

        let type = 'unknown';
        let vlan: any = undefined;
        let promiscMode = false;
        try {
          const cfg = JSON.parse(n?.spec?.config || '{}');
          type = String(cfg?.type || 'unknown').toLowerCase();
          vlan = cfg?.vlan;
          promiscMode = !!cfg?.promiscMode;
        } catch {
          /* ignore invalid NAD config JSON */
        }

        const isCurrentNs = ns === selectedNamespace;
        const tag = type || '-';
        const labelBase = displayName ? `${displayName}(${name})` : name;
        const label = vlan
          ? `${labelBase} · ${tag} · VLAN ${vlan}${isCurrentNs ? '' : ` [${ns}]`}`
          : `${labelBase} · ${tag}${isCurrentNs ? '' : ` [${ns}]`}`;

        return {
          label,
          value: `${ns}/${name}`,
          nad: n,
          _type: type,
          _promisc: promiscMode,
        };
      })
      .filter((x): x is WorkloadFormNadOption => x !== null)
      .filter((x) => x._promisc === true)
      .filter((x) => x.value.split('/')[0] === selectedNamespace)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [nads, defaultNamespace, form]);

  const reloadNads = useCallback(async () => {
    try {
      const nadsRes = await fetchHarvesterNads(cloudId, true, false);
      const nadItems =
        nadsRes?.data?.items || nadsRes?.items || (Array.isArray(nadsRes) ? nadsRes : []);
      setNads(nadItems);
    } catch (e) {
      console.error('重新加载NAD失败:', e);
      throw e;
    }
  }, [cloudId]);

  return {
    kubeSubnets,
    kubeVpcs,
    nads,
    setNads,
    loadingNetworkData,
    isFlatSubnet,
    isFlatVpc,
    flatSubnetOptions,
    vpcOptions,
    vpcSubnetOptions,
    selectedVpc,
    allNadOptions,
    reloadNads,
  };
}
