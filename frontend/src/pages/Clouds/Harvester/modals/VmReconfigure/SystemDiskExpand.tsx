import React, { useEffect, useState } from 'react';
import { Form, Input, Select, InputNumber, Alert, Descriptions, Collapse, Typography, Space, Tabs, Steps, Divider, Row, Col } from 'antd';
import { WindowsOutlined, CodeOutlined, InfoCircleOutlined } from '@ant-design/icons';
import winStep1 from '../../../../../assets/clouds/window1.5dc81859.png';
import winStep2 from '../../../../../assets/clouds/window2.6e92b0b7.png';
import winStep3 from '../../../../../assets/clouds/window3.9c744333.png';
import linuxSteps from '../../../../../assets/clouds/linux.c091b5d0.png';

const { Text, Paragraph, Title } = Typography;

type Props = {
  form: any;
  scOptions: any[];
  reloadScs: () => void;
  selectedKey: string;
  systemDisk?: string;
  systemDiskSize?: number | null;
  loading?: boolean;
};

const SystemDiskExpand: React.FC<Props> = ({
  form,
  scOptions,
  reloadScs,
  selectedKey,
  systemDisk,
  systemDiskSize,
  loading
}) => {
  // Parse current system disk size from record if available
  // Assuming claims[0] is the system disk name, but we need its size.
  // For now, we'll let the user input the new size, but we can improve this by passing more data.
  
  return (
    <>      
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px', display: 'flex', alignItems: 'center', gap: 4 }}>
            当前系统盘
            <span style={{ fontSize: 12, color: '#999' }} title="对应底层存储的 PVC 名称，通常格式为 {实例ID}-{磁盘名}-{随机后缀}">
              <InfoCircleOutlined />
            </span>
          </div>
        </Col>
        <Col span={18}>
          <Input 
            value={systemDisk ? `${systemDisk} ${systemDiskSize ? `(${systemDiskSize} GiB)` : ''}` : '未找到系统盘'} 
            disabled
            readOnly 
            style={{ color: '#00000040' }} 
            suffix={loading ? <span style={{ fontSize: 12, color: '#999' }}>加载中...</span> : null}
          />
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>新容量 (GiB)</div>
        </Col>
        <Col span={18}>
          <Form.Item 
            name="systemDiskSize" 
            rules={[
              { required: true, message: '请输入新容量' },
              {
                 validator: async (_, value) => {
                    if (!value) return;
                    if (value <= 0) throw new Error('容量必须大于 0');
                    if (systemDiskSize && value < systemDiskSize) {
                       throw new Error(`新容量必须大于等于当前容量 (${systemDiskSize} GiB)`);
                    }
                 }
              }
            ]}
            noStyle
          >
            <InputNumber 
              suffix="GiB" 
              style={{ width: '100%' }} 
              placeholder="请输入扩容后的总容量" 
              min={systemDiskSize || 1}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Collapse 
        className="std-collapse-minimal"
        bordered={false}
        items={[{
          key: '1',
          label: <span>扩容指南</span>,
          children: (
            <div style={{ padding: '0 12px' }}>
              <Alert
                description={
                  <ul style={{ paddingLeft: 20, margin: 0 }}>
                    <li>扩容操作仅支持增加容量，不可减少。</li>
                    <li>平台层扩容完成后，<strong>必须</strong>进入操作系统内部扩展文件系统才能生效。</li>
                    <li>部分操作系统可能需要重启才能识别新的磁盘大小。</li>
                  </ul>
                }
                type="info"
                style={{padding: 12, marginBottom: 16 }}
              />
              <Tabs
                defaultActiveKey="linux"
                size="small"
                type="card"
                items={[
                  {
                    key: 'linux',
                    label: <span><CodeOutlined /> Linux 系统</span>,
                    children: (
                      <div style={{ marginTop: 12 }}>
                         <div style={{ textAlign: 'center' }}>
                           <img
                             src={linuxSteps}
                             alt="Linux 系统盘扩容步骤"
                             style={{ maxWidth: '100%', borderRadius: 8 }}
                           />
                         </div>
                      </div>
                    )
                  },
                  {
                    key: 'windows',
                    label: <span><WindowsOutlined /> Windows 系统</span>,
                    children: (
                      <div style={{ marginTop: 12 }}>
                         <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                           <img
                             src={winStep1}
                             alt="Windows 扩容步骤 1"
                             style={{ maxWidth: '100%', borderRadius: 8 }}
                           />
                           <img
                             src={winStep2}
                             alt="Windows 扩容步骤 2"
                             style={{ maxWidth: '100%', borderRadius: 8 }}
                           />
                           <img
                             src={winStep3}
                             alt="Windows 扩容步骤 3"
                             style={{ maxWidth: '100%', borderRadius: 8 }}
                           />
                         </div>
                      </div>
                    )
                  }
                ]}
              />
            </div>
          )
        }]}
        style={{ marginBottom: 24, background: '#ffffff', borderRadius: 8 }}
      />
    </>
  );
};

export default SystemDiskExpand;
