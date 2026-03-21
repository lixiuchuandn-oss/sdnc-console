import React from 'react';
import { Form, Select, Row, Col, Input, Typography } from 'antd';

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

const NIC_TYPES = [
  { label: 'bridge', value: 'bridge' }
];

const NIC_MODELS = [
  { label: 'virtio', value: 'virtio' },
  { label: 'e1000', value: 'e1000' },
  { label: 'e1000e', value: 'e1000e' },
  { label: 'rtl8139', value: 'rtl8139' }
];

const SUBNET_TYPE_ANNOTATION = 'tower.io/subnet-type';
const UNDERLAY_SYSTEM_VPC = 'ovn-cluster';

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
  setVpcs
}) => {
  const nadInfos = (nads || []).map((n: any) => {
    let type = '' as any; let vlan: any = undefined;
    try { const cfg = JSON.parse(n?.spec?.config || '{}'); type = cfg?.type || ''; vlan = cfg?.vlan; } catch {}
    const id = n?.metadata?.name || '-';
    const alias = n?.metadata?.annotations?.['tower.io/alias'] || '';
    const labelBase = (alias && alias !== id) ? `${alias} (${id})` : id;
    const tag = type || '-';
    const label = vlan ? `${labelBase} (VLAN ${vlan}) · ${tag}` : `${labelBase} · ${tag}`;
    return { label, value: `${n.metadata.namespace}/${n.metadata.name}`, _type: String(type).toLowerCase() };
  });
  const nadOptionsFlat = nadInfos.filter(x => !String(x._type || '').includes('ovn')).map(x => ({ label: x.label, value: x.value }));
  const nadOptionsPassthrough = nadInfos.filter(x => x._type === 'sriov' || x._type === 'macvtap').map(x => ({ label: x.label, value: x.value }));
  const kubeVpcOptions = (vpcs || []).map((v: any) => {
    const name = v?.metadata?.name || '-';
    const alias = v?.metadata?.annotations?.['tower.io/alias'] || '';
    const label = (alias && alias !== name) ? `${alias} (${name})` : name;
    return { label, value: name };
  });

  return (
    <>
       <Row gutter={12}>
          <Col span={8}>
            <Form.Item label="网络类型" name="netMode" initialValue="flat" rules={[{ required: true, message: '请选择网络类型' }]}>
              <Select
                options={[
                  { label: 'NAD网络', value: 'flat' },
                  { label: '扁平子网', value: 'flat_subnet' },
                  { label: 'VPC网络', value: 'vpc' },
                  { label: '直通网卡', value: 'passthrough' },
                ]}
                placeholder="选择网络类型"
                onChange={(v) => { 
                   const initialType =
                     v === 'vpc' || v === 'flat_subnet' ? 'bridge' : v === 'passthrough' ? 'sriov' : 'bridge';
                   try {
                     form.setFieldsValue({
                       netMode: v,
                       primaryNic: {
                         type: initialType,
                         model: 'virtio',
                         name: undefined,
                         vpc: v === 'flat_subnet' ? UNDERLAY_SYSTEM_VPC : undefined,
                         subnet: undefined,
                         macAddress: undefined,
                         ipAddress: undefined,
                         gateway: undefined,
                         dns: undefined
                       }
                     });
                   } catch {}
                   setVpcs([...vpcs]); 
                   if (v === 'vpc' || v === 'flat_subnet') { reloadVpcs(); reloadSubnets(); }
                }}
              />
            </Form.Item>
          </Col>
          
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
             {({ getFieldValue }) => {
                const mode = getFieldValue('netMode') || 'flat';
                if (mode === 'flat' || mode === 'passthrough') {
                  return (
                  <Col span={16}>
                    <Form.Item 
                      label={mode === 'passthrough' ? '直通网络' : 'NAD网络'} 
                      name={["primaryNic", 'name']} 
                      rules={[{ required: true, message: '请选择网络' }]}
                    >
                      <Select
                        placeholder={mode === 'passthrough' ? '选择直通网络（SR-IOV/macvtap NAD）' : '选择网络'}
                        options={mode === 'passthrough' ? nadOptionsPassthrough : (nadOptionsFlat || [])}
                        onDropdownVisibleChange={(open) => { if (open) reloadNads(); }}
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
                  </Col>
                  );
                }
                if (mode === 'flat_subnet') {
                  const list = subnets || [];
                  const flatList = list.filter(
                    (x: any) =>
                      String(x?.spec?.vpc || x?.vpc || '').trim() === UNDERLAY_SYSTEM_VPC &&
                      isKubeOvnFlatSubnet(x),
                  );
                  return (
                    <>
                      <Col span={8}>
                        <Form.Item name={['primaryNic', 'vpc']} hidden>
                          <Input />
                        </Form.Item>
                        <Form.Item label="扁平子网" name={['primaryNic', 'subnet']} rules={[{ required: true, message: '请选择扁平子网' }]}>
                          <Select
                            placeholder="选择扁平子网"
                            options={flatList.map((x: any) => {
                              const n = x?.metadata?.name || x?.name || '-';
                              const alias = String(x?.metadata?.annotations?.['tower.io/alias'] ?? '').trim();
                              return { label: alias ? `${alias} (${n})` : `${n} (${UNDERLAY_SYSTEM_VPC})`, value: n };
                            })}
                            onDropdownVisibleChange={(open) => { if (open) reloadSubnets(); }}
                            onChange={(val) => {
                              try {
                                const subnet = flatList.find(
                                  (x: any) => (x?.metadata?.name || x?.name) === val,
                                );
                                let netName = val;
                                let subnetNs = subnet?.metadata?.namespace || subnet?.namespace;
                                if (!subnetNs && subnet?.spec?.provider) {
                                  const parts = String(subnet.spec.provider).split('.');
                                  if (parts.length >= 2) subnetNs = parts[parts.length - 2];
                                }
                                if (subnetNs) netName = `${subnetNs}/${val}`;
                                form.setFieldsValue({
                                  primaryNic: {
                                    vpc: UNDERLAY_SYSTEM_VPC,
                                    subnet: val,
                                    name: netName,
                                    type: 'bridge',
                                  },
                                });
                              } catch {}
                            }}
                          />
                        </Form.Item>
                        <Form.Item name={['primaryNic', 'name']} hidden>
                          <Input />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          label="子网网段"
                          shouldUpdate={(prev, curr) => prev.primaryNic?.subnet !== curr.primaryNic?.subnet}
                        >
                          {({ getFieldValue: gf }) => {
                            const subnetName = gf(['primaryNic', 'subnet']);
                            const subnet = flatList.find(
                              (x: any) => (x?.metadata?.name || x?.name) === subnetName,
                            );
                            return (
                              <Input value={subnet?.spec?.cidrBlock || subnet?.cidr || ''} disabled />
                            );
                          }}
                        </Form.Item>
                      </Col>
                    </>
                  );
                }
                return (
                   <>
                      <Col span={8}>
                        <Form.Item label="VPC" name={["primaryNic", 'vpc']} rules={[{ required: true }]}>
                          <Select
                            placeholder="选择 VPC"
                            options={kubeVpcOptions}
                            onDropdownVisibleChange={(open) => { if (open) reloadVpcs(); }}
                            onChange={async (val) => { 
                               try {
                                 const curr = form.getFieldValue('primaryNic') || {}; 
                                 // Reset subnet when VPC changes
                                 form.setFieldsValue({ primaryNic: { ...curr, vpc: val, subnet: undefined, name: undefined, type: 'bridge' } }); 
                                 // 重新加载子网列表，确保能获取到该VPC下的子网
                                 await reloadSubnets();
                               } catch {}
                            }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item noStyle shouldUpdate={(prev: any, curr: any) => prev?.primaryNic?.vpc !== curr?.primaryNic?.vpc}>
                          {({ getFieldValue }) => {
                            const vpc = getFieldValue(['primaryNic', 'vpc']);
                            const list = subnets || [];
                            // 过滤出属于当前VPC的子网
                            const filtered = vpc ? list.filter((x: any) => {
                              const subnetVpc = x?.spec?.vpc || x?.vpc;
                              return subnetVpc === vpc;
                            }) : [];
                            return (
                              <Form.Item 
                                label="子网" 
                                name={["primaryNic", 'subnet']} 
                                rules={[{ required: true, message: '请选择子网' }]}
                              >
                                <Select
                                  placeholder="选择 VPC 子网"
                                  options={filtered.map((x: any) => ({ 
                                    label: (function () {
                                      const name = x?.metadata?.name || x?.name || '-';
                                      const alias = x?.metadata?.annotations?.['tower.io/alias'] || '';
                                      return (alias && alias !== name) ? `${alias} (${name})` : name;
                                    })(), 
                                    value: x?.metadata?.name || x?.name 
                                  }))}
                                  onDropdownVisibleChange={(open) => { if (open) reloadSubnets(); }}
                                  onChange={(val) => { 
                                     try {
                                       const curr = form.getFieldValue('primaryNic') || {}; 
                                       // Subnet name IS the network name in Harvester/Kube-OVN
                                       form.setFieldsValue({ primaryNic: { ...curr, name: val, type: 'bridge' } }); 
                                     } catch {}
                                  }}
                                />
                              </Form.Item>
                            );
                          }}
                        </Form.Item>
                      </Col>
                      {/* CIDR 回显 */}
                      <Col span={8}>
                        <Form.Item
                          label="子网网段"
                          shouldUpdate={(prev, curr) =>
                            prev.primaryNic?.subnet !== curr.primaryNic?.subnet
                          }
                        >
                          {({ getFieldValue }) => {
                            const subnetName = getFieldValue(['primaryNic', 'subnet']);
                            const vpc = getFieldValue(['primaryNic', 'vpc']);
                            const list = subnets || [];
                            const subnet = list.find((x: any) => (x?.metadata?.name === subnetName || x?.name === subnetName) && ((x?.spec?.vpc === vpc) || (x?.vpc === vpc)));
                            return <Input value={subnet?.spec?.cidrBlock || subnet?.cidr || ''} disabled />;
                          }}
                        </Form.Item>
                      </Col>
                   </>
                );
             }}
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode || prev.primaryNic?.name !== curr.primaryNic?.name}>
             {({ getFieldValue }) => {
                 const mode = getFieldValue('netMode') || 'flat';
                 const netName = getFieldValue(['primaryNic', 'name']) || '';
                 const t = getFieldValue(['primaryNic', 'type']);
                 const initType =
                   mode === 'passthrough'
                     ? 'sriov'
                     : mode === 'vpc' || mode === 'flat_subnet'
                       ? 'bridge'
                       : netName
                         ? 'bridge'
                         : 'masquerade';
                 const typeOptions = mode === 'passthrough'
                   ? [{ label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]
                   : (mode === 'vpc' || mode === 'flat_subnet'
                     ? [{ label: 'bridge', value: 'bridge' }]
                     : (netName ? [{ label: 'bridge', value: 'bridge' }] : [{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }]));
                 return (
                   <>
                      <Col span={8}>
                        <Form.Item label="类型" name={["primaryNic", 'type']} initialValue={initType}>
                          <Select options={typeOptions} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="模型" name={["primaryNic", 'model']} initialValue="virtio">
                          <Select disabled={t === 'sriov'} options={NIC_MODELS} />
                        </Form.Item>
                      </Col>
                   </>
                 );
             }}
          </Form.Item>

          <Col span={8}>
            <Form.Item
              label="Mac地址"
              name={['primaryNic', 'macAddress']}
              rules={[{ pattern: /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/, message: '请输入有效的 MAC 地址' }]}
            >
              <Input placeholder="自动生成" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="静态IP"
              name={['primaryNic', 'ipAddress']}
              rules={[{ pattern: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/, message: '请输入有效的 IP 地址 (如 192.168.1.10 或 192.168.1.10/24)' }]}
            >
              <Input placeholder="192.168.1.10/24" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="网关"
              name={['primaryNic', 'gateway']}
              rules={[{ pattern: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/, message: '请输入有效的网关地址' }]}
            >
              <Input placeholder="192.168.1.1" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="DNS" name={['primaryNic', 'dns']}>
              <Input placeholder="8.8.8.8, 114.114.114.114" />
            </Form.Item>
          </Col>
       </Row>
    </>
  );
};

export default ChangePrimaryNic;
