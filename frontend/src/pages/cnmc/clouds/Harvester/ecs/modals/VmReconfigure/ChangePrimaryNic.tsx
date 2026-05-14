import React from 'react';
import { Form, Select, Row, Col, Input, Segmented } from 'antd';
import {
  ifaceTypeOption,
  PASSTHROUGH_VIRT_IFACE_OPTIONS,
} from '../VmCreateWizard/harvesterVmIfaceTypeOptions';
import { KUBE_OVN_FLAT_VPC, isFlatKubeOvnSubnetVpc } from '../../../kube-ovn/lib/kubeOvnSubnetConstants';

type Props = {
  form: any;
  nads: any[];
  vpcs: any[];
  subnets: any[];
  reloadNads: () => void;
  reloadVpcs: () => void;
  reloadSubnets: () => void;
  setVpcs: (vpcs: any[]) => void;
};

const NIC_MODELS = [
  { label: 'virtio', value: 'virtio' },
  { label: 'e1000', value: 'e1000' },
  { label: 'e1000e', value: 'e1000e' },
  { label: 'rtl8139', value: 'rtl8139' },
];

const SUBNET_TYPE_ANNOTATION = 'tower.io/subnet-type';

function isKubeOvnFlatSubnet(s: any): boolean {
  const t = String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION] ?? '').trim().toLowerCase();
  return t === 'flat';
}

const ChangePrimaryNic: React.FC<Props> = ({
  form,
  nads,
  vpcs,
  subnets,
  reloadNads,
  reloadVpcs,
  reloadSubnets,
  setVpcs,
}) => {
  const nadInfos = (nads || []).map((n: any) => {
    let type = '' as any;
    let vlan: any = undefined;
    try {
      const cfg = JSON.parse(n?.spec?.config || '{}');
      type = cfg?.type || '';
      vlan = cfg?.vlan;
    } catch {}
    const id = n?.metadata?.name || '-';
    const alias = n?.metadata?.annotations?.['tower.io/alias'] || '';
    const labelBase = alias && alias !== id ? `${alias} (${id})` : id;
    const tag = type || '-';
    const label = vlan ? `${labelBase} (VLAN ${vlan}) · ${tag}` : `${labelBase} · ${tag}`;
    return { label, value: `${n.metadata.namespace}/${n.metadata.name}`, _type: String(type).toLowerCase() };
  });
  const nadOptionsFlat = nadInfos.filter((x) => !String(x._type || '').includes('ovn')).map((x) => ({ label: x.label, value: x.value }));
  const nadOptionsPassthrough = nadInfos
    .filter((x) => x._type === 'sriov' || x._type === 'macvtap')
    .map((x) => ({ label: x.label, value: x.value }));
  const kubeVpcOptions = (vpcs || []).map((v: any) => {
    const name = v?.metadata?.name || '-';
    const alias = v?.metadata?.annotations?.['tower.io/alias'] || '';
    const label = alias && alias !== name ? `${alias} (${name})` : name;
    return { label, value: name };
  });

  return (
    <div>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>网络类型</div>
        </Col>
        <Col span={18}>
          <Form.Item name="netMode" initialValue="flat" rules={[{ required: true, message: '请选择网络类型' }]}>
            <Select
              style={{ width: '100%', maxWidth: 480 }}
              options={[
                { label: 'NAD网络', value: 'flat' },
                { label: '扁平子网', value: 'flat_subnet' },
                { label: 'VPC网络', value: 'vpc' },
                { label: '直通网卡', value: 'passthrough' },
              ]}
              placeholder="选择网络类型"
              onChange={(v) => {
                const initialType =
                  v === 'vpc' ? 'managedtap' : v === 'flat_subnet' ? 'managedtap' : v === 'passthrough' ? 'sriov' : 'bridge';
                try {
                  form.setFieldsValue({
                    netMode: v,
                    primaryNic: {
                      type: initialType,
                      model: 'virtio',
                      name: undefined,
                      vpc: v === 'flat_subnet' ? KUBE_OVN_FLAT_VPC : undefined,
                      subnet: undefined,
                      macAddress: undefined,
                      ipAddress: undefined,
                      gateway: undefined,
                      dns: undefined,
                    },
                  });
                } catch {}
                setVpcs([...vpcs]);
                if (v === 'vpc' || v === 'flat_subnet') {
                  reloadVpcs();
                  reloadSubnets();
                }
              }}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
        {({ getFieldValue }) => {
          const mode = getFieldValue('netMode') || 'flat';
          if (mode === 'flat' || mode === 'passthrough') {
            return (
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>{mode === 'passthrough' ? '直通网络' : 'NAD网络'}</div>
                </Col>
                <Col span={18}>
                  <Form.Item name={['primaryNic', 'name']} rules={[{ required: true, message: '请选择网络' }]}>
                    <Select
                      style={{ width: '100%', maxWidth: 480 }}
                      placeholder={mode === 'passthrough' ? '选择直通网络（SR-IOV/macvtap NAD）' : '选择网络'}
                      options={mode === 'passthrough' ? nadOptionsPassthrough : nadOptionsFlat || []}
                      onDropdownVisibleChange={(open) => {
                        if (open) reloadNads();
                      }}
                      allowClear={mode !== 'passthrough'}
                      onChange={(val) => {
                        try {
                          const curr = form.getFieldValue('primaryNic') || {};
                          const m = form.getFieldValue('netMode') || 'flat';
                          if (m === 'flat') {
                            const isPod = !val;
                            const nextType = isPod ? 'masquerade' : 'bridge';
                            form.setFieldsValue({ primaryNic: { ...curr, name: val, type: nextType } });
                          } else {
                            form.setFieldsValue({ primaryNic: { ...curr, name: val } });
                          }
                        } catch {}
                      }}
                    />
                  </Form.Item>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>
            );
          }
          if (mode === 'flat_subnet') {
            const list = subnets || [];
            const flatList = list.filter(
              (x: any) => isFlatKubeOvnSubnetVpc(x?.spec?.vpc || x?.vpc) && isKubeOvnFlatSubnet(x),
            );
            return (
              <>
                <Row gutter={12} style={{ marginBottom: 0 }}>
                  <Col span={6}>
                    <div style={{ lineHeight: '32px' }}>扁平子网</div>
                  </Col>
                  <Col span={18}>
                    <Form.Item name={['primaryNic', 'vpc']} hidden>
                      <Input />
                    </Form.Item>
                    <Form.Item name={['primaryNic', 'subnet']} rules={[{ required: true, message: '请选择扁平子网' }]}>
                      <Select
                        style={{ width: '100%', maxWidth: 480 }}
                        placeholder="选择扁平子网"
                        options={(() => {
                          const used = new Set<string>();
                          try {
                            const secs = form.getFieldValue('secondaryNics') || [];
                            secs.forEach((it: any) => {
                              if (String(it?.mode || '') === 'flat_subnet' && it?.subnet) used.add(String(it.subnet));
                            });
                          } catch {}
                          const currentSelected = (() => {
                            try {
                              return form.getFieldValue(['primaryNic', 'subnet']);
                            } catch {
                              return undefined;
                            }
                          })();
                          return flatList
                            .filter((x: any) => {
                              const n = x?.metadata?.name || x?.name;
                              if (!n) return false;
                              if (currentSelected && String(currentSelected) === String(n)) return true;
                              return !used.has(String(n));
                            })
                            .map((x: any) => {
                              const n = x?.metadata?.name || x?.name || '-';
                              const alias = String(x?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
                              const vpcDisp =
                                String(x?.spec?.vpc || x?.vpc || KUBE_OVN_FLAT_VPC).trim() || KUBE_OVN_FLAT_VPC;
                              return { label: alias ? `${alias} (${n})` : `${n} (${vpcDisp})`, value: n };
                            });
                        })()}
                        onDropdownVisibleChange={(open) => {
                          if (open) reloadSubnets();
                        }}
                        onChange={(val) => {
                          try {
                            const subnet = flatList.find((x: any) => (x?.metadata?.name || x?.name) === val);
                            let netName = val;
                            let subnetNs = subnet?.metadata?.namespace || subnet?.namespace;
                            if (!subnetNs && subnet?.spec?.provider) {
                              const parts = String(subnet.spec.provider).split('.');
                              if (parts.length >= 2) subnetNs = parts[parts.length - 2];
                            }
                            if (subnetNs) netName = `${subnetNs}/${val}`;
                            const flatVpc =
                              String(subnet?.spec?.vpc || subnet?.vpc || KUBE_OVN_FLAT_VPC).trim() || KUBE_OVN_FLAT_VPC;
                            form.setFieldsValue({
                              primaryNic: {
                                vpc: flatVpc,
                                subnet: val,
                                name: netName,
                                type: 'managedtap',
                              },
                            });
                          } catch {}
                        }}
                      />
                    </Form.Item>
                    <Form.Item name={['primaryNic', 'name']} hidden>
                      <Input />
                    </Form.Item>
                    <div style={{ marginBottom: 24 }} />
                  </Col>
                </Row>
                <Row gutter={12} style={{ marginBottom: 0 }}>
                  <Col span={6}>
                    <div style={{ lineHeight: '32px' }}>子网网段</div>
                  </Col>
                  <Col span={18}>
                    <Form.Item shouldUpdate={(prev, curr) => prev.primaryNic?.subnet !== curr.primaryNic?.subnet} noStyle>
                      {({ getFieldValue: gf }) => {
                        const subnetName = gf(['primaryNic', 'subnet']);
                        const subnet = flatList.find((x: any) => (x?.metadata?.name || x?.name) === subnetName);
                        return <Input value={subnet?.spec?.cidrBlock || subnet?.cidr || ''} disabled style={{ maxWidth: 480 }} />;
                      }}
                    </Form.Item>
                    <div style={{ marginBottom: 24 }} />
                  </Col>
                </Row>
              </>
            );
          }
          return (
            <>
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>VPC</div>
                </Col>
                <Col span={18}>
                  <Form.Item name={['primaryNic', 'vpc']} rules={[{ required: true }]}>
                    <Select
                      style={{ width: '100%', maxWidth: 480 }}
                      placeholder="选择 VPC"
                      options={kubeVpcOptions}
                      onDropdownVisibleChange={(open) => {
                        if (open) reloadVpcs();
                      }}
                      onChange={async (val) => {
                        try {
                          const curr = form.getFieldValue('primaryNic') || {};
                          form.setFieldsValue({
                            primaryNic: { ...curr, vpc: val, subnet: undefined, name: undefined, type: 'managedtap' },
                          });
                          await reloadSubnets();
                        } catch {}
                      }}
                    />
                  </Form.Item>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>
              <Form.Item noStyle shouldUpdate={(prev: any, curr: any) => prev?.primaryNic?.vpc !== curr?.primaryNic?.vpc}>
                {({ getFieldValue }) => {
                  const vpc = getFieldValue(['primaryNic', 'vpc']);
                  const list = subnets || [];
                  const filtered = vpc
                    ? list.filter((x: any) => {
                        const subnetVpc = x?.spec?.vpc || x?.vpc;
                        return subnetVpc === vpc;
                      })
                    : [];
                  return (
                    <Row gutter={12} style={{ marginBottom: 0 }}>
                      <Col span={6}>
                        <div style={{ lineHeight: '32px' }}>子网</div>
                      </Col>
                      <Col span={18}>
                        <Form.Item name={['primaryNic', 'subnet']} rules={[{ required: true, message: '请选择子网' }]}>
                          <Select
                            style={{ width: '100%', maxWidth: 480 }}
                            placeholder="选择 VPC 子网"
                            options={filtered.map((x: any) => ({
                              label: (() => {
                                const name = x?.metadata?.name || x?.name || '-';
                                const alias = x?.metadata?.annotations?.['tower.io/alias'] || '';
                                return alias && alias !== name ? `${alias} (${name})` : name;
                              })(),
                              value: x?.metadata?.name || x?.name,
                            }))}
                            onDropdownVisibleChange={(open) => {
                              if (open) reloadSubnets();
                            }}
                            onChange={(val) => {
                              try {
                                const curr = form.getFieldValue('primaryNic') || {};
                                form.setFieldsValue({ primaryNic: { ...curr, name: val, type: 'managedtap' } });
                              } catch {}
                            }}
                          />
                        </Form.Item>
                        <div style={{ marginBottom: 24 }} />
                      </Col>
                    </Row>
                  );
                }}
              </Form.Item>
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>子网网段</div>
                </Col>
                <Col span={18}>
                  <Form.Item
                    shouldUpdate={(prev, curr) => prev.primaryNic?.subnet !== curr.primaryNic?.subnet}
                    noStyle
                  >
                    {({ getFieldValue }) => {
                      const subnetName = getFieldValue(['primaryNic', 'subnet']);
                      const vpc = getFieldValue(['primaryNic', 'vpc']);
                      const list = subnets || [];
                      const subnet = list.find(
                        (x: any) =>
                          (x?.metadata?.name === subnetName || x?.name === subnetName) &&
                          (x?.spec?.vpc === vpc || x?.vpc === vpc),
                      );
                      return (
                        <Input value={subnet?.spec?.cidrBlock || subnet?.cidr || ''} disabled style={{ maxWidth: 480 }} />
                      );
                    }}
                  </Form.Item>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>
            </>
          );
        }}
      </Form.Item>

      <Form.Item
        noStyle
        shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode || prev.primaryNic?.name !== curr.primaryNic?.name}
      >
        {({ getFieldValue }) => {
          const mode = getFieldValue('netMode') || 'flat';
          const netName = getFieldValue(['primaryNic', 'name']) || '';
          const t = getFieldValue(['primaryNic', 'type']);
          const initType =
            mode === 'passthrough'
              ? 'sriov'
              : mode === 'vpc'
                ? 'managedtap'
                : mode === 'flat_subnet'
                  ? 'managedtap'
                  : netName
                    ? 'bridge'
                    : 'masquerade';
          const typeOptions =
            mode === 'passthrough'
              ? PASSTHROUGH_VIRT_IFACE_OPTIONS
              : mode === 'vpc'
                ? [ifaceTypeOption('managedtap')]
                : mode === 'flat_subnet'
                  ? [ifaceTypeOption('managedtap')]
                  : netName
                    ? [ifaceTypeOption('bridge')]
                    : [ifaceTypeOption('masquerade'), ifaceTypeOption('bridge')];
          return (
            <>
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>接口类型</div>
                </Col>
                <Col span={18}>
                  <Form.Item name={['primaryNic', 'type']} initialValue={initType}>
                    <Select style={{ width: '100%', maxWidth: 320 }} options={typeOptions} />
                  </Form.Item>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>模型</div>
                </Col>
                <Col span={18}>
                  <Form.Item name={['primaryNic', 'model']} initialValue="virtio">
                    <Segmented
                      disabled={t === 'sriov'}
                      options={NIC_MODELS}
                      style={{ maxWidth: '100%' }}
                    />
                  </Form.Item>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>
            </>
          );
        }}
      </Form.Item>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>Mac地址</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name={['primaryNic', 'macAddress']}
            rules={[{ pattern: /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/, message: '请输入有效的 MAC 地址' }]}
          >
            <Input placeholder="自动生成" style={{ maxWidth: 480 }} />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>静态IP</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name={['primaryNic', 'ipAddress']}
            rules={[
              {
                pattern:
                  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/,
                message: '请输入有效的 IP 地址 (如 192.168.1.10 或 192.168.1.10/24)',
              },
            ]}
          >
            <Input placeholder="192.168.1.10/24" style={{ maxWidth: 480 }} />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>网关</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name={['primaryNic', 'gateway']}
            rules={[
              {
                pattern: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
                message: '请输入有效的网关地址',
              },
            ]}
          >
            <Input placeholder="192.168.1.1" style={{ maxWidth: 480 }} />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>DNS</div>
        </Col>
        <Col span={18}>
          <Form.Item name={['primaryNic', 'dns']}>
            <Input placeholder="8.8.8.8, 114.114.114.114" style={{ maxWidth: 480 }} />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
    </div>
  );
};

export default ChangePrimaryNic;
