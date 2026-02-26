import React, { useState } from 'react';
import { Form, InputNumber, Row, Col, Checkbox, Tooltip, Typography, Space, Alert, Radio } from 'antd';
import { InfoCircleOutlined, QuestionCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';

const { Text } = Typography;

type Props = {
  form: any;
  currentCpu: number;
  currentMemory: number;
  isHotPlugEnabledOnVm: boolean;
  isRestartRequired?: boolean;
  maxCpuLimit?: number;
  maxSockets?: number;
  maxMemory?: number;
};

const ChangeSpec: React.FC<Props> = ({ form, currentCpu, currentMemory, isHotPlugEnabledOnVm, isRestartRequired, maxCpuLimit, maxSockets, maxMemory }) => {
  const cpu = Form.useWatch('cpu', form);
  const memory = Form.useWatch('memory', form);
  const enableHotPlug = Form.useWatch('enableHotPlug', form);
  const cpuSockets = Form.useWatch('cpuSockets', form);
  const cpuCores = Form.useWatch('cpuCores', form);
  const cpuThreads = Form.useWatch('cpuThreads', form);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memPreset, setMemPreset] = React.useState<string>(() => {
    const v = Number(currentMemory || 0);
    if (v === 4 || v === 8 || v === 16) return String(v);
    return 'custom';
  });
  const [memGi, setMemGi] = React.useState<number>(currentMemory || 0);

  // Sync memory preset when form value changes externally (e.g. initial load)
  React.useEffect(() => {
    const v = Number(memory || 0);
    if (v > 0) {
      setMemGi(v);
      if (v === 4 || v === 8 || v === 16) {
        setMemPreset(String(v));
      } else {
        setMemPreset('custom');
      }
    }
  }, [memory]);

  // Auto-calculate Total CPU from Topology
  React.useEffect(() => {
    const s = Number(cpuSockets) || 0;
    const c = Number(cpuCores) || 0;
    const t = Number(cpuThreads) || 0;
    if (s > 0 && c > 0 && t > 0) {
      const total = s * c * t;
      if (total !== cpu) {
        form.setFieldsValue({ cpu: total });
      }
    }
  }, [cpuSockets, cpuCores, cpuThreads, form, cpu]);

  // When Hot Plug is enabled, force Cores/Threads to 1 (Standard Harvester behavior)
  React.useEffect(() => {
    if (enableHotPlug) {
      const s = Number(cpuSockets) || 0;
      const c = Number(cpuCores) || 0;
      const t = Number(cpuThreads) || 0;
      
      // Only reset if they are not 1
      if ((c !== 1 || t !== 1) && s > 0) {
         // Keep total CPU constant if possible? No, maintain Sockets, reset others.
         // Or just warn?
         // Harvester UI forces Cores=1, Threads=1 for Hotplug.
         form.setFieldsValue({
           cpuCores: 1,
           cpuThreads: 1
         });
      }
    }
  }, [enableHotPlug, cpuSockets, cpuCores, cpuThreads, form]);

  // Initialize default topology if missing
  React.useEffect(() => {
    const s = form.getFieldValue('cpuSockets');
    if (s === undefined && currentCpu) {
       form.setFieldsValue({
         cpuSockets: currentCpu,
         cpuCores: 1,
         cpuThreads: 1
       });
    }
  }, [currentCpu, form]);

  // Helper to render validation message
  const renderValidationMessage = (currentVal: number, newVal: number | undefined, isEnabledInForm: boolean, limit: number) => {
    if (newVal === undefined || newVal === null) return null;
    if (newVal === currentVal) return null; // Unchanged

    // Scenario 3 (Invalid input / Lower than current)
    if (newVal < currentVal) {
       return <div style={{marginTop: 8}}><Text style={{ color: '#ff4d4f' }}>暂不支持规格缩容</Text></div>;
    }

    // Scenario 4: Pending Restart (Highest Priority for valid input)
    if (isRestartRequired) {
       return <div style={{marginTop: 8}}><Text type="secondary">存在未生效变更，当前修改重启后生效</Text></div>;
    }
    
    // Scenario 3 (Not Enabled)
    if (!isEnabledInForm) {
       return <div style={{marginTop: 8}}><Text type="secondary">未开启热扩容，当前修改重启后生效</Text></div>;
    }

    // Scenario 3b (Enabled in form, but not on VM)
    if (isEnabledInForm && !isHotPlugEnabledOnVm) {
       return <div style={{marginTop: 8}}><Text type="secondary">当前修改重启后生效</Text></div>;
    }
    
    // Scenario 1 (Within Range)
    if (newVal <= limit) {
       return <div style={{marginTop: 8}}><Text type="secondary">当前修改支持热扩容</Text></div>;
    }
    
    // Scenario 2 (Out of Range)
    return <div style={{marginTop: 8}}><Text type="secondary">超过热扩容范围，当前修改重启后生效</Text></div>;
  };

  const renderGlobalAlert = () => {
    // If no changes, show nothing
    if (cpu === currentCpu && memory === currentMemory && enableHotPlug === isHotPlugEnabledOnVm) {
       return null;
    }

    // Scenario 3: Not Enabled in form OR Not Enabled on VM
    // If enableHotPlug (form) is true, but isHotPlugEnabledOnVmVal (VM) is false, it means we are turning it ON, which requires restart.
    // So effectively, we only support HotPlug if BOTH are true.

    if (!enableHotPlug) {
       // Case A: Form switch is OFF -> Cold Plug
       return <Alert type="info" message="未开启热扩容，当前修改重启后生效" style={{ marginTop: 4 }} />;
    } else if (enableHotPlug && !isHotPlugEnabledOnVm) {
       // Case B: Form switch is ON, but VM was OFF -> Cold Plug (Turning it on requires reboot)
       if (isRestartRequired) {
         return <Alert type="info" message="存在未生效变更，当前修改重启后生效" style={{ marginTop: 4 }} />;
       }
       return <Alert type="info" message="当前修改重启后生效" style={{ marginTop: 4 }} />;
    } else {
       // Case C: Both ON -> Potential Hot Plug (check limits)
       const limitCpu = maxCpuLimit || currentCpu * 4;
       const limitMem = currentMemory * 4;
       
       const isOverLimit = (cpu !== undefined && cpu > limitCpu) || (memory !== undefined && memory > limitMem);
       const isScalingDown = (cpu !== undefined && cpu < currentCpu) || (memory !== undefined && memory < currentMemory);

       if (isScalingDown) {
          // Scenario: Scaling down
          return <Alert type="error" message="暂不支持规格缩容" style={{ marginTop: 4 }} />;
       }

       if (isOverLimit) {
          // Scenario 2: Over limit
          return <Alert type="info" message="超过热扩容范围，当前修改重启后生效" style={{ marginTop: 4 }} />;
       } else {
          // Scenario 1: Within Range
          return <Alert type="info" message="当前修改支持热扩容" style={{ marginTop: 4 }} />;
       }
    }
  };

  return (
    <>
     
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
           <div style={{ lineHeight: '32px' }}>vCPU分配</div>
        </Col>
        <Col span={18}>
           {enableHotPlug ? (
             <Form.Item style={{ marginBottom: 0 }}>
               <div style={{ display: 'flex', alignItems: 'center' }}>
                 <div style={{ display: 'flex', alignItems: 'center' }}>
                   <Form.Item name="cpu" noStyle>
                     <InputNumber 
                       style={{ width: 250 }} 
                       suffix="vCPU" 
                       min={1} 
                       onChange={(val) => {
                         const v = Number(val) || 0;
                         if (v > 0) {
                            form.setFieldsValue({
                              cpuSockets: v,
                              cpuCores: 1,
                              cpuThreads: 1
                            });
                         }
                       }}
                     />
                   </Form.Item>
                 </div>
                 <a onClick={() => setShowAdvanced(!showAdvanced)} style={{ fontSize: 14, marginLeft: 10 }}>
                   高级 {showAdvanced ? <UpOutlined /> : <DownOutlined />}
                 </a>
               </div>

               <div style={{ background: '#EDF0F7', padding: '12px', marginTop: 12, border: '1px solid #e5e5e5', borderRadius: 8, display: showAdvanced ? 'block' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                     <Form.Item noStyle name="cpuSockets">
                       <InputNumber min={1} max={64} style={{ width: 220 }} suffix="插槽" />
                     </Form.Item>
                     <span style={{ margin: '0 12px', color: '#666' }}>x</span>
                     <Form.Item noStyle name="cpuCores">
                       <InputNumber min={1} max={64} style={{ width: 220 }} suffix="核/插槽" disabled={enableHotPlug} />
                     </Form.Item>
                  </div>
                  <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                     当前热扩容上限为 {maxSockets} 个单核插槽。超过热扩容范围需重启后才能生效
                  </div>
                  
                  {/* Hidden Thread input to maintain logic */}
                  <Form.Item noStyle name="cpuThreads" hidden>
                    <InputNumber />
                  </Form.Item>
               </div>
             </Form.Item>
           ) : (
              <Form.Item style={{ marginBottom: 0 }}>
                <Space>
                   <Form.Item noStyle name="cpuSockets">
                     <InputNumber min={1} max={64} style={{ width: 100 }} placeholder="Socket" />
                   </Form.Item>
                   <Text>插槽，每插槽</Text>
                   <Form.Item noStyle name="cpuCores">
                     <InputNumber min={1} max={64} style={{ width: 100 }} placeholder="Core" />
                   </Form.Item>
                   <Text>核</Text>
                   <span style={{color: '#666' }}>，总计</span>
                   <Form.Item noStyle shouldUpdate={(prev, curr) => prev.cpuSockets !== curr.cpuSockets || prev.cpuCores !== curr.cpuCores}>
                     {() => {
                        const s = form.getFieldValue('cpuSockets') || 0;
                        const c = form.getFieldValue('cpuCores') || 0;
                        return <span style={{ fontWeight: 500 }}>{s * c} vCPU</span>;
                     }}
                   </Form.Item>
                </Space>
                
                {/* Hidden Thread input to maintain logic */}
                <Form.Item noStyle name="cpuThreads" hidden>
                   <InputNumber />
                </Form.Item>
                
                {/* Hidden CPU total input to maintain logic */}
                <Form.Item noStyle name="cpu" hidden>
                   <InputNumber />
                </Form.Item>
              </Form.Item>
            )}
           {renderValidationMessage(currentCpu, cpu, enableHotPlug, maxCpuLimit || currentCpu * 4)}
           <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
           <div style={{ lineHeight: '32px' }}>内存分配</div>
        </Col>
        <Col span={18}>
          <Form.Item style={{ marginBottom: 0 }}>
             <Space>
               <Radio.Group 
                 value={memPreset} 
                 buttonStyle="solid" 
                 onChange={(e) => { 
                   const v = String(e.target.value); 
                   setMemPreset(v); 
                   if (v !== 'custom') { 
                     const gi = Number(v); 
                     setMemGi(gi); 
                     form.setFieldsValue({ memory: gi }); 
                   } 
                 }}
               >
                 <Radio.Button value="4">4 GiB</Radio.Button>
                 <Radio.Button value="8">8 GiB</Radio.Button>
                 <Radio.Button value="16">16 GiB</Radio.Button>
                 <Radio.Button value="custom">自定义</Radio.Button>
               </Radio.Group>
               <InputNumber 
                 min={currentMemory} 
                 max={1024} 
                 value={memGi} 
                 suffix="GiB" 
                 style={{ width: 150 }} 
                 onChange={(val) => { 
                   const gi = Number(val || 1); 
                   setMemGi(gi); 
                   form.setFieldsValue({ memory: gi }); 
                   setMemPreset('custom'); 
                 }} 
               />
             </Space>
          </Form.Item>
          
          <Form.Item 
            name="memory" 
            hidden
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <InputNumber />
          </Form.Item>
          {renderValidationMessage(currentMemory, memory, enableHotPlug, currentMemory * 4)}
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Row gutter={12}>
        <Col span={6}>
           <div style={{ lineHeight: '32px' }}>
              热扩容
              <Tooltip title={`开启后，需重启实例才能激活热扩容能力。激活后，在热扩容资源范围内调整规格无需重启，超出范围或未开启时则需重启。`}>
                <QuestionCircleOutlined style={{ color: '#999', marginLeft: 4 }} />
              </Tooltip>
           </div>
        </Col>
        <Col span={18}>
          <Form.Item 
            style={{ marginBottom: 0 }}
          >
            <Form.Item name="enableHotPlug" valuePropName="checked" noStyle>
            <Checkbox
              onChange={(e) => {
                const checked = e.target.checked;
                form.setFieldsValue({ enableHotPlug: checked });
                if (checked) {
                  const currentCpuVal = form.getFieldValue('cpu') || currentCpu;
                  form.setFieldsValue({
                    cpuSockets: currentCpuVal,
                    cpuCores: 1,
                    cpuThreads: 1
                  });
                } else {
                  form.setFieldsValue({
                    cpuSockets: undefined,
                    cpuCores: undefined,
                    cpuThreads: undefined
                  });
                }
              }}
            >
              启用 (变更后需要重启生效)
            </Checkbox>
            </Form.Item>
            {enableHotPlug && (
                <div style={{ marginTop: 8, color: '#666', fontSize: 13 }}>
                  <Space>
                    <span>热扩容上限:</span>
                    <span> {maxSockets} vCPU（单核插槽）</span>
                    <span style={{color: '#ddd' }}>|</span>
                    <span> {maxMemory} GiB 内存</span>
                  </Space>
                </div>
             )}
          </Form.Item>
        </Col>
      </Row>

    </>
  );
};

export default ChangeSpec;
