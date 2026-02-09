import React from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Card, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface StepNetworksProps {
  form: any;
  netModeState: string;
  setNetModeState: (mode: string) => void;
  nadOptions: any[];
  reloadNads: () => void;
  kubeVpcOptions: any[];
  reloadKubeVpcs: () => void;
  kubeSubnets: any[];
  kubeSubnetOptions: any[];
  reloadKubeSubnets: () => void;
  selectedNetIdx: number | null;
  setSelectedNetIdx: (idx: number | null) => void;
}

const StepNetworks: React.FC<StepNetworksProps> = ({
  form,
  netModeState,
  setNetModeState,
  nadOptions,
  reloadNads,
  kubeVpcOptions,
  reloadKubeVpcs,
  kubeSubnets,
  kubeSubnetOptions,
  reloadKubeSubnets,
  selectedNetIdx,
  setSelectedNetIdx,
}) => {
  return (
    <>
      <Typography.Paragraph type="secondary">设定新建云主机的网络接口配置</Typography.Paragraph>
      <div className="wizard-group-title">主网卡</div>
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item label="网络类型" name="netMode" initialValue="flat" rules={[{ required: true, message: '请选择网络类型' }]}>
            <Select
              options={[{ label: '扁平网络', value: 'flat' }, { label: 'VPC网络', value: 'vpc' }]}
              placeholder="选择网络类型"
              onChange={(v) => { setNetModeState(v); try { form.setFieldsValue({ netMode: v }); } catch { }; if (v === 'vpc') { reloadKubeVpcs(); reloadKubeSubnets(); } }}
            />
          </Form.Item>
        </Col>
        {(form.getFieldValue('netMode') || 'flat') === 'flat' ? (
          <Col span={16}>
            <Form.Item label="选择网络" name={["primaryNic", 'name']}>
              <Select
                placeholder="选择网络 (留空则使用 Pod Network)"
                options={[{ label: 'Management Network (Pod Network)', value: '' }, ...(nadOptions || [])]}
                onOpenChange={async (open) => { if (open) reloadNads(); }}
                allowClear
              />
            </Form.Item>
          </Col>
        ) : (
          <>
            <Col span={8}>
              <Form.Item label="VPC" name={["primaryNic", 'vpc']}>
                <Select
                  placeholder="选择 VPC"
                  options={kubeVpcOptions}
                  onOpenChange={(open) => { if (open) reloadKubeVpcs(); }}
                  onChange={(val) => { try { const curr = form.getFieldValue('primaryNic') || {}; const next = { ...curr, vpc: val, subnet: undefined, name: undefined, type: 'bridge' }; form.setFieldsValue({ primaryNic: next }); } catch { } }}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="子网" name={["primaryNic", 'subnet']} rules={[{ required: true }]}>
                <Select
                  placeholder="选择 VPC 子网"
                  options={(function () { const vpc = form.getFieldValue(['primaryNic', 'vpc']); const list = kubeSubnets || []; const filtered = vpc ? list.filter((x: any) => x?.vpc === vpc) : list; return filtered.map((x: any) => ({ label: `${x?.name || '-'} (${x?.vpc || '-'})`, value: x?.name })); })()}
                  onOpenChange={(open) => { if (open) reloadKubeSubnets(); }}
                  onChange={(val) => { try { const curr = form.getFieldValue('primaryNic') || {}; const next = { ...curr, name: val, type: 'bridge' }; form.setFieldsValue({ primaryNic: next }); } catch { } }}
                />
              </Form.Item>
            </Col>
          </>
        )}

        {(form.getFieldValue('netMode') || 'flat') === 'flat' ? (
          <>
            <Col span={8}>
              <Form.Item label="类型" name={["primaryNic", 'type']} initialValue="masquerade">
                <Select options={[{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }, { label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="模型" name={["primaryNic", 'model']} initialValue="virtio">
                <Select options={[{ label: 'virtio', value: 'virtio' }, { label: 'e1000', value: 'e1000' }, { label: 'e1000e', value: 'e1000e' }, { label: 'rtl8139', value: 'rtl8139' }]} />
              </Form.Item>
            </Col>
          </>
        ) : (
          <Col span={8}>
            <Form.Item label="子网网段">
              <Input value={(function () { try { const key = String(form.getFieldValue(['primaryNic', 'subnet']) || ''); const it = (kubeSubnets || []).find((x: any) => x?.name === key); return String(it?.cidr || ''); } catch { return ''; } })()} disabled />
            </Form.Item>
          </Col>
        )}

        {(form.getFieldValue('netMode') || 'flat') === 'vpc' && (
          <>
            <Col span={8}>
              <Form.Item label="类型" name={["primaryNic", 'type']} initialValue="masquerade">
                <Select options={[{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }, { label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="模型" name={["primaryNic", 'model']} initialValue="virtio">
                <Select options={[{ label: 'virtio', value: 'virtio' }, { label: 'e1000', value: 'e1000' }, { label: 'e1000e', value: 'e1000e' }, { label: 'rtl8139', value: 'rtl8139' }]} />
              </Form.Item>
            </Col>
          </>
        )}
        <Col span={8}>
          <Form.Item label="MAC 地址" name={["primaryNic", 'macAddress']} rules={[{ pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/, message: '格式如 52:54:00:12:34:56' }]}>
            <Input placeholder="52:54:00:12:34:56" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="静态IP" name={["primaryNic", 'ipAddress']} rules={[{ pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[12][0-9]|3[0-2]))?$/, message: '格式如 192.168.1.10 或 192.168.1.10/24' }]}>
            <Input placeholder="192.168.1.10/24" />
          </Form.Item>
        </Col>
      </Row>
      <div className="wizard-group-title">辅助网卡</div>
      <Form.List name="netIfaces" initialValue={[]}>
        {(fields, { add, remove }) => (
          <div>
            {fields.map(({ key, name }, idx) => {
              const nm = form.getFieldValue(['netIfaces', name, 'name']) || 'default';
              const tp = form.getFieldValue(['netIfaces', name, 'type']) || 'masquerade';
              const title = (
                <div role="button" onClick={() => setSelectedNetIdx(idx)}>
                  {`#${idx + 2} ${nm} · ${String(tp).toUpperCase()}`}
                </div>
              );
              const canRemove = true;
              return (
                <Card
                  key={key}
                  size="small"
                  title={title}
                  extra={canRemove ? (
                    <Button
                      type="text"
                      icon={<CloseOutlined />}
                      onClick={(e) => { e.stopPropagation?.(); remove(name); }}
                      style={{ width: 24, height: 24, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}
                    />
                  ) : undefined}
                  className={`wizard-disk-card ${selectedNetIdx === idx ? 'active' : ''}`}
                  style={{ marginBottom: 8 }}
                  onClick={() => setSelectedNetIdx(idx)}
                >
                  <Row gutter={12}>
                    {(form.getFieldValue(['netIfaces', name, 'mode']) || 'flat') === 'flat' ? (
                      <>
                        <Col span={8}>
                          <Form.Item label="名称" name={[name, 'name']} rules={[{ required: true }]}>
                            <Select
                              placeholder="选择网络"
                              options={nadOptions}
                              onOpenChange={async (open) => { if (open) reloadNads(); }}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="类型" name={[name, 'type']} initialValue="masquerade">
                            <Select options={[{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }, { label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="模型" name={[name, 'model']} initialValue="virtio">
                            <Select options={[{ label: 'virtio', value: 'virtio' }, { label: 'e1000', value: 'e1000' }, { label: 'e1000e', value: 'e1000e' }, { label: 'rtl8139', value: 'rtl8139' }]} />
                          </Form.Item>
                        </Col>
                      </>
                    ) : (
                      <>
                        <Col span={8}>
                          <Form.Item label="VPC" name={[name, 'vpc']}>
                            <Select
                              placeholder="选择 VPC"
                              options={kubeVpcOptions}
                              onDropdownVisibleChange={(open) => { if (open) reloadKubeVpcs(); }}
                              onChange={(val) => { try { const curr = form.getFieldValue('netIfaces') || []; const next = [...curr]; next[name] = { ...next[name], vpc: val, subnet: undefined, name: undefined }; form.setFieldsValue({ netIfaces: next }); } catch { } }}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="子网" name={[name, 'subnet']} rules={[{ required: true }]}>
                            <Select
                              placeholder="选择 VPC 子网"
                              options={(function () { const vpc = form.getFieldValue(['netIfaces', name, 'vpc']); const list = kubeSubnets || []; const filtered = vpc ? list.filter((x: any) => x?.vpc === vpc) : list; return filtered.map((x: any) => ({ label: `${x?.name || '-'} (${x?.vpc || '-'})`, value: x?.name })); })()}
                              onDropdownVisibleChange={(open) => { if (open) reloadKubeSubnets(); }}
                              onChange={(val) => { try { const curr = form.getFieldValue('netIfaces') || []; const next = [...curr]; next[name] = { ...next[name], name: val }; form.setFieldsValue({ netIfaces: next }); } catch { } }}
                            />
                          </Form.Item>
                        </Col>
                      </>
                    )}
                  </Row>
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item label="MAC 地址" name={[name, 'macAddress']} rules={[{ pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/, message: '格式如 52:54:00:12:34:56' }]}>
                        <Input placeholder="52:54:00:12:34:56" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="静态IP" name={[name, 'ipAddress']} rules={[{ pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[12][0-9]|3[0-2]))?$/, message: '格式如 192.168.1.10/24' }]}>
                        <Input placeholder="192.168.1.10/24" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item label="网络模式" name={[name, 'mode']} initialValue="flat" hidden>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
            <Space>
              <Button onClick={() => add({ mode: 'flat', type: 'masquerade', model: 'virtio' })}>添加扁平网络网卡</Button>
              <Button onClick={() => { reloadKubeVpcs(); add({ mode: 'vpc', type: 'bridge', model: 'virtio' }); }}>添加VPC网卡</Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepNetworks;
