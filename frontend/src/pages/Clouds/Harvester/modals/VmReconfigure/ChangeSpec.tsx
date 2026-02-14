import React from 'react';
import { Form, InputNumber, Row, Col, Checkbox, Tooltip, Typography, Space, Alert } from 'antd';
import { QuestionCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';

const { Text } = Typography;

type Props = {
  form: any;
  currentCpu: number;
  currentMemory: number;
  isHotPlugEnabledOnVm: boolean;
};

const ChangeSpec: React.FC<Props> = ({ form, currentCpu, currentMemory, isHotPlugEnabledOnVm }) => {
  const cpu = Form.useWatch('cpu', form);
  const memory = Form.useWatch('memory', form);
  const enableHotPlug = Form.useWatch('enableHotPlug', form);

  // Helper to render validation message
  const renderValidationMessage = (currentVal: number, newVal: number | undefined, isEnabledInForm: boolean) => {
    if (newVal === undefined || newVal === null) return null;
    
    // Scenario 3 (Invalid input / Lower than current)
    if (newVal < currentVal) {
       return <div style={{marginTop: 8}}><Text type="danger"><ExclamationCircleOutlined style={{ marginRight: 4 }} /> 输入值无效，本次变更为冷扩容（需重启）。</Text></div>;
    }

    const limit = currentVal * 4;
    
    // Scenario 3 (Not Enabled)
    if (!isEnabledInForm) {
       return <div style={{marginTop: 8}}><Text type="secondary"><ExclamationCircleOutlined style={{ marginRight: 4 }} /> 未开启热扩容，本次变更为冷扩容（需重启）。</Text></div>;
    }

    // Scenario 3b (Enabled in form, but not on VM)
    if (isEnabledInForm && !isHotPlugEnabledOnVm) {
       return <div style={{marginTop: 8}}><Text type="warning"><ExclamationCircleOutlined style={{ marginRight: 4 }} /> 开启热扩容需重启生效，本次变更为冷扩容。</Text></div>;
    }
    
    // Scenario 1 (Within Range)
    if (newVal <= limit) {
       return <div style={{marginTop: 8}}><Text type="success"><CheckCircleOutlined style={{ marginRight: 4 }} /> 符合热扩容条件，变更无需重启实例。</Text></div>;
    }
    
    // Scenario 2 (Out of Range)
    return <div style={{marginTop: 8}}><Text type="warning"><ExclamationCircleOutlined style={{ marginRight: 4 }} /> 超出热扩容上限，本次变更将自动转为冷扩容（需重启）。</Text></div>;
  };

  const renderGlobalAlert = () => {
    // Scenario 3: Not Enabled in form OR Not Enabled on VM
    // If enableHotPlug (form) is true, but isHotPlugEnabledOnVmVal (VM) is false, it means we are turning it ON, which requires restart.
    // So effectively, we only support HotPlug if BOTH are true.

    if (!enableHotPlug) {
       // Case A: Form switch is OFF -> Cold Plug
       return <Alert type="info"  message="本次变更为【冷扩容】，需要重启实例才能生效。" style={{ marginTop: 4 }} />;
    } else if (enableHotPlug && !isHotPlugEnabledOnVm) {
       // Case B: Form switch is ON, but VM was OFF -> Cold Plug (Turning it on requires reboot)
       return <Alert type="info"  message="本次变更为【冷扩容】，开启热扩容功能需要重启实例生效。" style={{ marginTop: 4 }} />;
    } else {
       // Case C: Both ON -> Potential Hot Plug (check limits)
       const limitCpu = currentCpu * 4;
       const limitMem = currentMemory * 4;
       
       const isOverLimit = (cpu !== undefined && cpu > limitCpu) || (memory !== undefined && memory > limitMem);
       const isInvalid = (cpu !== undefined && cpu < currentCpu) || (memory !== undefined && memory < currentMemory);

       if (isOverLimit || isInvalid) {
          // Scenario 2: Over limit
          return <Alert type="warning"  message="本次变更由于超出热扩上限，本次变更将自动转为【冷扩容】（需重启）。" style={{ marginTop: 4 }} />;
       } else {
          // Scenario 1: Within Range
          return <Alert type="success"  message="本次变更为【热扩容】，符合热扩容条件，变更无需重启实例，业务不中断。" style={{ marginTop: 4 }} />;
       }
    }
  };

  return (
    <>
      <div style={{ marginBottom: 16}}>
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Text type="secondary"> 仅支持CPU和内存扩容，当前云主机的规格为 {currentCpu} vCPU / {currentMemory} GiB</Text>
          {renderGlobalAlert()}
        </Space>
      </div>

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={24}>
          <Form.Item 
            name="cpu" 
            label="CPU数量" 
            style={{ marginBottom: 0 }}
            rules={[
              
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (value && value < currentCpu) {
                    return Promise.reject(new Error(`CPU核数不能小于当前值 (${currentCpu} vCPU)`));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <InputNumber min={currentCpu} precision={0} style={{ width: '100%' }} addonAfter="vCPU" />
          </Form.Item>
          {renderValidationMessage(currentCpu, cpu, enableHotPlug)}
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={24}>
          <Form.Item 
            name="memory" 
            label="内存大小" 
            style={{ marginBottom: 0 }}
            rules={[
              
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (value && value < currentMemory) {
                    return Promise.reject(new Error(`内存不能小于当前值 (${currentMemory} GiB)`));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <InputNumber min={currentMemory} precision={0} style={{ width: '100%' }} addonAfter="GiB" />
          </Form.Item>
          {renderValidationMessage(currentMemory, memory, enableHotPlug)}
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={24}>
          <Form.Item 
            label={
              <span>
                热扩容 &nbsp;
                <Tooltip title="开启后，需重启实例才能激活热扩容能力。激活后，在 8 vCPU / 16 GiB（当前配额 4 倍）范围内调整规格无需重启，超出范围或未开启时则需重启。">
                  <QuestionCircleOutlined style={{ color: '#999' }} />
                </Tooltip>
              </span>
            }
            style={{ marginBottom: 0 }}
          >
            <Form.Item name="enableHotPlug" valuePropName="checked" noStyle>
              <Checkbox>启用 (需要重启生效)</Checkbox>
            </Form.Item>
          </Form.Item>
        </Col>
      </Row>

    </>
  );
};

export default ChangeSpec;
