import React from 'react';
import { Form, Select, Checkbox, Input, Space, Row, Col, Typography, Button, List } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface StepOthersProps {
  form: any;
  usbResources: any[];
  reloadUsbResources: () => void;
  autoStart: boolean;
  setAutoStart: (val: boolean) => void;
}

const StepOthers: React.FC<StepOthersProps> = ({
  form,
  usbResources,
  reloadUsbResources,
  autoStart,
  setAutoStart,
}) => {
  return (
    <>
      <Typography.Paragraph type="secondary">配置新建云主机的启动、Cloud-Init和USB设备参数</Typography.Paragraph>
      <div className="wizard-group-title">启动与可用性</div>
      <Form.Item label="运行策略" name="runStrategy" initialValue="RerunOnFailure">
        <Select options={[
          { label: '始终运行（Always）', value: 'Always' },
          { label: '故障重试（RerunOnFailure）', value: 'RerunOnFailure' },
          { label: '手动（Manual）', value: 'Manual' },
          { label: '停止（Halted）', value: 'Halted' },
        ]} style={{ width: 240 }} />
      </Form.Item>
      <Form.Item>
        <Checkbox checked={autoStart} onChange={(e) => setAutoStart(!!e.target?.checked)}>创建后自动开机</Checkbox>
      </Form.Item>
      <div className="wizard-group-title">固件与TPM</div>
      <Form.Item label="固件">
        <Space direction="vertical">
          <Form.Item name="bootUseEfi" valuePropName="checked" noStyle>
            <Checkbox>使用 EFI 固件</Checkbox>
          </Form.Item>
          {(!!form.getFieldValue('bootUseEfi')) ? (
            <Space>
              <Form.Item name="efiPersistent" valuePropName="checked" noStyle>
                <Checkbox>持久化变量</Checkbox>
              </Form.Item>
              <Form.Item name="efiSecureBoot" valuePropName="checked" noStyle>
                <Checkbox>启用安全启动</Checkbox>
              </Form.Item>
            </Space>
          ) : null}
        </Space>
      </Form.Item>
      <Form.Item label="TPM">
        <Space>
          <Form.Item name="tpmEnabled" valuePropName="checked" noStyle>
            <Checkbox>启用</Checkbox>
          </Form.Item>
          <Form.Item name="tpmPersistent" valuePropName="checked" noStyle>
            <Checkbox>持久化状态</Checkbox>
          </Form.Item>
        </Space>
      </Form.Item>
      <Form.Item label="输入设备" name="useUsbTablet" valuePropName="checked">
        <Space>
          <Checkbox>USB Tablet</Checkbox>
        </Space>
      </Form.Item>
      <Form.Item label="Guest Agent" name="installGuestAgent" valuePropName="checked">
        <Space>
          <Checkbox>安装 QEMU Guest Agent（无 Cloud-Init 时自动生成）</Checkbox>
        </Space>
      </Form.Item>
      <Form.Item label="SSH 公钥标识" name="sshNames">
        <Select mode="tags" placeholder="输入或选择SSH key名称" options={[]} />
      </Form.Item>
      <div className="wizard-group-title">Cloud-Init</div>
      <Form.Item label="Cloud-Init" name="userData">
        <Input.TextArea rows={6} placeholder="#cloud-config" />
      </Form.Item>
      
      <div className="wizard-group-title">USB设备</div>
      <Form.List name="usbDevices" initialValue={[]}>
        {(fields, { add, remove }) => (
          <div>
            {(usbResources || []).length === 0 ? (
              <Typography.Text type="secondary">未检测到允许的 USB 资源，请检查 KubeVirt 的 permittedHostDevices.usb 设置</Typography.Text>
            ) : null}
            {fields.map(({ key, name }, idx) => (
              <Row key={key} gutter={12} style={{ marginBottom: 8 }}>
                <Col span={16}>
                  <Form.Item name={[name]} rules={[{ required: true, message: '请选择 USB 设备' }]}>
                    <Select
                      placeholder="选择 USB 设备"
                      options={(usbResources || []).map((x: any) => { const v = String(x?.vendorId || x?.vendor || ''); const p = String(x?.productId || x?.product || ''); const code = (v && p) ? `${v}:${p}` : ''; const rn = x?.resourceName || '-'; return { label: code ? `${rn} (${code})` : rn, value: rn }; })}
                      onOpenChange={(open) => { if (open) reloadUsbResources(); }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Button type="text" icon={<CloseOutlined />} onClick={() => remove(name)} />
                </Col>
              </Row>
            ))}
            <Space>
              <Button type="dashed" onClick={() => add('')}>新增USB设备</Button>
              <Button type="dashed" onClick={() => reloadUsbResources()}>刷新资源</Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepOthers;
