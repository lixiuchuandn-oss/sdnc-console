import React from 'react';
import { Form, InputNumber, Row, Col, Switch, Tooltip, Typography, Space, Alert } from 'antd';
import { InfoCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';

const { Text } = Typography;

/**
 * HotPlugSettings Props 定义
 */
type Props = {
  form: any;
  currentCpu: number;
  currentMemory: number;
  isHotPlugEnabledOnVm: boolean;
  maxSockets?: number;
  maxMemory?: number;
  architecture?: string;
  disabled?: boolean;
};

/**
 * 热扩容设置组件
 * 专门用于管理虚拟机的热扩容开关和上限设置
 */
const HotPlugSettings: React.FC<Props> = ({ 
  form, 
  currentCpu, 
  currentMemory, 
  isHotPlugEnabledOnVm, 
  maxSockets, 
  maxMemory, 
  architecture, 
  disabled 
}) => {
  const enableHotPlug = Form.useWatch('enableHotPlug', form);
  const maxSocketsVal = Form.useWatch('maxSockets', form);
  const maxMemoryVal = Form.useWatch('maxMemory', form);
  const isArm = architecture === 'arm64' || architecture === 'aarch64';

  return (
    <>
      <div style={{ opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
        {/* 热扩容开关 */}
        <Row gutter={12}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>
              热扩容
              <Tooltip title={
                <div>
                  <div>1. 变更热扩容状态，需要重启生效</div>
                  <div>2. 启用后，强制使用单核模式（cores=1, threads=1），仅允许调整sockets</div>
                  <div>3. 开启热扩容后，可以在不重启的情况下增加CPU/内存</div>
                </div>
              }>
                <QuestionCircleOutlined style={{ color: '#999', marginLeft: 4 }} />
              </Tooltip>
            </div>
          </Col>
          <Col span={18}>
            <Form.Item style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', height: 32 }}>
                <Form.Item name="enableHotPlug" valuePropName="checked" noStyle>
                  <Switch
                    disabled={isArm}
                    checkedChildren="已启用" 
                    unCheckedChildren="未启用"
                  />
                </Form.Item>
                <div style={{ marginLeft: 8 }}>
                  {isArm ? (
                    <Text type="secondary">ARM 架构不支持热扩容</Text>
                  ) : (
                    <Text type="secondary">变更后需要重启生效</Text>
                  )}
                </div>
              </div>

              {/* 热扩容上限设置 */}
              {enableHotPlug && (
                <div style={{ background: '#EDF0F7', padding: '12px', marginTop: 12, border: '1px solid #e5e5e5', borderRadius: 8 }}>
                  <Space size="large" align="start">
                    <div>
                      <Space>
                        <span>CPU上限</span>
                        <Form.Item
                          name="maxSockets"
                          initialValue={maxSockets || (currentCpu * 4)}
                          noStyle
                          rules={[{ required: true, message: '必填' }]}
                        >
                          <InputNumber 
                            min={currentCpu} 
                            max={currentCpu * 4}
                            suffix="核" 
                            style={{ width: 100 }} 
                            disabled={isHotPlugEnabledOnVm}
                          />
                        </Form.Item>
                        <Tooltip title="设置虚拟机所能支持的最大 CPU 核数。将来热扩容时，CPU总数不能超过此值。">
                          <InfoCircleOutlined style={{ color: '#999' }} />
                        </Tooltip>
                      </Space>
                    </div>
                    <div>
                      <Space>
                        <span>内存上限</span>
                        <Form.Item
                          name="maxMemory"
                          initialValue={maxMemory || (currentMemory * 4)}
                          noStyle
                          rules={[{ required: true, message: '必填' }]}
                        >
                          <InputNumber 
                            min={currentMemory} 
                            max={currentMemory * 4}
                            suffix="GiB" 
                            style={{ width: 100 }} 
                            disabled={isHotPlugEnabledOnVm}
                          />
                        </Form.Item>
                        <Tooltip title="设置虚拟机所能支持的最大内存。将来热扩容时，内存总数不能超过此值。">
                          <InfoCircleOutlined style={{ color: '#999' }} />
                        </Tooltip>
                      </Space>
                    </div>
                  </Space>
                  <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                    热扩容上限设置（默认为当前规格的 4 倍）
                    {isHotPlugEnabledOnVm && (
                      <span style={{ marginLeft: 8, color: '#ff9800' }}>
                        已开启热扩容，上限不可修改
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* 提示信息 */}
              {enableHotPlug && !isHotPlugEnabledOnVm && (
                <Alert
                  type="info"
                  message="首次开启热扩容需要重启生效"
                  description="开启热扩容后，CPU拓扑将自动调整为 cores=1, threads=1，sockets=当前CPU数量"
                  style={{ marginTop: 12 }}
                />
              )}
            </Form.Item>
          </Col>
        </Row>
      </div>
    </>
  );
};

export default HotPlugSettings;
