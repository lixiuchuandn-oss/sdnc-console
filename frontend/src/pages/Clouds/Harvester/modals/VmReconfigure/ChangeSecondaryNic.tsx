import React from 'react';
import { Form, Select, Row, Col, Card, Button, Input } from 'antd';
import { MinusCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

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

const ChangeSecondaryNic: React.FC<Props> = ({
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
       <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
         <div style={{ color: '#999' }}>变更辅助网卡接口配置（需重启生效）</div>
         <Button
           type="link"
           icon={<ReloadOutlined />}
           onClick={() => { reloadNads(); reloadVpcs(); reloadSubnets(); }}
           style={{ padding: 0 }}
         >
           刷新
         </Button>
       </div>
       <Form.List name="secondaryNics">
         {(fields, { add, remove }) => (
           <div>
             {fields.map(({ key, name, ...restField }, idx) => {
               return (
                 <Card
                   key={key}
                   size="small"
                   title={`网卡 #${idx + 2}`}
                   extra={
                    <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(name)} danger />
                  }
                   style={{ marginBottom: 12, border: '1px solid #d9d9d9' }}
                 >
                   <Row gutter={12}>
                     <Form.Item name={[name, 'mode']} initialValue="flat" hidden><Input /></Form.Item>
                     
                     <Form.Item noStyle shouldUpdate>
                       {({ getFieldValue }) => {
                          const mode = getFieldValue(['secondaryNics', name, 'mode']) || 'flat';
                          return (
                            <>
                              {(['flat','passthrough'].includes(mode)) ? (
                                <Col span={8}>
                                  <Form.Item {...restField} label={mode === 'passthrough' ? '直通网络' : 'NAD网络'} name={[name, 'name']} rules={[{ required: true, message: '请选择网络' }]}>
                                    <Select
                                      placeholder={mode === 'passthrough' ? '选择直通网络（SR-IOV/macvtap NAD）' : '选择网络'}
                                      options={mode === 'passthrough' ? nadOptionsPassthrough : nadOptionsFlat}
                                      onDropdownVisibleChange={(open) => { if (open) reloadNads(); }}
                                      allowClear={mode !== 'passthrough'}
                                      onChange={(val) => {
                                        try {
                                          const list = form.getFieldValue('secondaryNics') || [];
                                          const curr = list[name] || {};
                                          // 扁平模式选择 NAD 时强制为 bridge；直通模式仅更新名称
                                          list[name] = { ...curr, name: val, ...(mode === 'flat' ? { type: 'bridge' } : {}) };
                                          form.setFieldsValue({ secondaryNics: list });
                                        } catch {}
                                      }}
                                    />
                                  </Form.Item>
                                </Col>
                              ) : (
                                <>
                                  <Col span={8}>
                                    <Form.Item {...restField} label="VPC" name={[name, 'vpc']}>
                                      <Select
                                        placeholder="选择 VPC"
                                        options={kubeVpcOptions}
                                        onDropdownVisibleChange={(open) => { if (open) reloadVpcs(); }}
                                        onChange={(val) => { 
                                            const list = form.getFieldValue('secondaryNics');
                                            list[name] = { ...list[name], vpc: val, subnet: undefined, name: undefined };
                                            form.setFieldsValue({ secondaryNics: list });
                                        }}
                                      />
                                    </Form.Item>
                                  </Col>
                                  <Col span={8}>
                                    <Form.Item {...restField} label="子网" name={[name, 'subnet']} rules={[{ required: true, message: '请选择子网' }]}>
                                      <Select
                                        placeholder="选择 VPC 子网"
                                        options={(function () { 
                                            const vpc = form.getFieldValue(['secondaryNics', name, 'vpc']); 
                                            const list = subnets || []; 
                                            const filtered = vpc ? list.filter((x: any) => x?.spec?.vpc === vpc) : list; 
                                            return filtered.map((x: any) => {
                                              const n = x?.metadata?.name || '-';
                                              const a = x?.metadata?.annotations?.['tower.io/alias'] || '';
                                              return { label: (a && a !== n) ? `${a} (${n})` : n, value: x?.metadata?.name };
                                            }); 
                                        })()}
                                        onDropdownVisibleChange={(open) => { if (open) reloadSubnets(); }}
                                        onChange={(val) => { 
                                            const list = form.getFieldValue('secondaryNics');
                                            list[name] = { ...list[name], name: val, type: 'bridge' }; // Set name to subnet name and enforce bridge
                                            form.setFieldsValue({ secondaryNics: list });
                                        }}
                                      />
                                    </Form.Item>
                                  </Col>
                                  <Col span={8}>
                                   <Form.Item
                                     {...restField}
                                     label="子网网段"
                                     shouldUpdate={(prev, curr) =>
                                       prev.secondaryNics?.[name]?.subnet !== curr.secondaryNics?.[name]?.subnet
                                     }
                                   >
                                     {({ getFieldValue }) => {
                                       const subnetName = getFieldValue(['secondaryNics', name, 'subnet']);
                                       const subnet = (subnets || []).find((x: any) => x?.metadata?.name === subnetName);
                                       return <Input value={subnet?.spec?.cidrBlock || ''} disabled />;
                                     }}
                                   </Form.Item>
                                 </Col>
                                </>
                              )}

                              {/* --- 通用物理属性 --- */}
                              <Col span={8}>
                                <Form.Item {...restField} label="类型" name={[name, 'type']} initialValue={mode === 'passthrough' ? 'sriov' : 'bridge'}>
                                  <Select options={mode === 'passthrough' ? [{ label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }] : [{ label: 'bridge', value: 'bridge' }]} />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item {...restField} label="模型" name={[name, 'model']} initialValue="virtio">
                                  <Select disabled={getFieldValue(['secondaryNics', name, 'type']) === 'sriov'} options={[{ label: 'virtio', value: 'virtio' }, { label: 'e1000', value: 'e1000' }, { label: 'e1000e', value: 'e1000e' }, { label: 'rtl8139', value: 'rtl8139' }]} />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item {...restField} label="MAC 地址" name={[name, 'macAddress']} rules={[{ pattern: /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/, message: '格式如 52:54:00:12:34:56' }]}>
                                  <Input placeholder="自动生成" />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item
                                  {...restField}
                                  label="静态IP"
                                  name={[name, 'ipAddress']}
                                  rules={[{ pattern: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/, message: '格式如 192.168.1.10/24' }]}
                                  style={{ marginBottom: mode === 'vpc' ? 0 : undefined }}
                                >
                                  <Input placeholder="192.168.1.10/24" />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item {...restField} label="网关" name={[name, 'gateway']} style={{ marginBottom: mode === 'vpc' ? 0 : undefined }}>
                                  <Input placeholder="192.168.1.1" />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item {...restField} label="DNS" name={[name, 'dns']} style={{ marginBottom: 0 }}>
                                  <Input placeholder="8.8.8.8" />
                                </Form.Item>
                              </Col>
                            </>
                          );
                       }}
                     </Form.Item>
                   </Row>
                 </Card>
               );
             })}
             <div style={{ display: 'flex', gap: 8 }}>
              <Button type="dashed" onClick={() => add({ mode: 'flat', type: 'bridge', model: 'virtio' })} style={{ flex: 1 }} icon={<PlusOutlined />}>
                 添加NAD网络网卡
               </Button>
               <Button type="dashed" onClick={() => { reloadVpcs(); add({ mode: 'vpc', type: 'bridge', model: 'virtio' }); }} style={{ flex: 1 }} icon={<PlusOutlined />}>
                 添加VPC网卡
               </Button>
               <Button type="dashed" onClick={() => add({ mode: 'passthrough', type: 'sriov', model: 'virtio' })} style={{ flex: 1 }} icon={<PlusOutlined />}>
                 添加直通网卡
               </Button>
             </div>
           </div>
         )}
       </Form.List>
    </>
  );
};

export default ChangeSecondaryNic;
