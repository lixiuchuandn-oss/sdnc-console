import React from 'react';
import { Form, Select, InputNumber, Alert, Descriptions, Collapse, Tabs, Row, Col } from 'antd';
import { WindowsOutlined, CodeOutlined, InfoCircleOutlined } from '@ant-design/icons';
import winStep1 from '../../../../../../../assets/clouds/window1.5dc81859.png';
import winStep2 from '../../../../../../../assets/clouds/window2.6e92b0b7.png';
import winStep3 from '../../../../../../../assets/clouds/window3.9c744333.png';
import linuxSteps from '../../../../../../../assets/clouds/linux.c091b5d0.png';

export type ExpandDiskCandidateRow = {
  pvcName: string;
  diskName: string;
  label: string;
};

type Props = {
  form: any;
  expandDiskCandidates: ExpandDiskCandidateRow[];
  /** 拉取选中 PVC 的当前容量并回填「新容量」 */
  loadExpandDiskSize: (pvcName: string) => void | Promise<void>;
  expandDiskCurrentSizeGi?: number | null;
  loading?: boolean;
};

const SystemDiskExpand: React.FC<Props> = ({
  form,
  expandDiskCandidates,
  loadExpandDiskSize,
  expandDiskCurrentSizeGi,
  loading,
}) => {
  const hasTargets = expandDiskCandidates.length > 0;
  const selectedPvc = Form.useWatch('expandDiskPvc', form);

  return (
    <>
      {!hasTargets ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="未找到可扩容的卷"
          description="仅支持对系统盘（根盘）关联的 PVC 扩容；请确认虚拟机规格中系统卷使用 persistentVolumeClaim。"
        />
      ) : null}

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px', display: 'flex', alignItems: 'center', gap: 4 }}>
            扩容对象
            <span
              style={{ fontSize: 12, color: '#999' }}
              title="选择要扩容的系统盘 PVC（块存储根盘）。"
            >
              <InfoCircleOutlined />
            </span>
          </div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="expandDiskPvc"
            rules={
              hasTargets ? [{ required: true, message: '请选择要扩容的卷' }] : []
            }
            noStyle
          >
            <Select
              style={{ width: '100%' }}
              disabled={!hasTargets}
              placeholder="选择系统盘 PVC"
              options={expandDiskCandidates.map((c) => ({
                value: c.pvcName,
                label: c.label,
              }))}
              onChange={(pvc) => {
                void loadExpandDiskSize(String(pvc || ''));
              }}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {selectedPvc ? (
        <Row gutter={12} style={{ marginBottom: 0 }}>
          <Col span={6}>
            <div style={{ lineHeight: '32px' }}>磁盘信息</div>
          </Col>
          <Col span={18}>
            <div
              style={{
                padding: 12,
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                background: '#fafafa',
              }}
            >
              <Descriptions size="small" column={1} styles={{ label: { width: 88 } }}>
                <Descriptions.Item label="PVC 名称">{selectedPvc}</Descriptions.Item>
                <Descriptions.Item label="当前容量">
                  {loading ? '加载中…' : expandDiskCurrentSizeGi != null ? `${expandDiskCurrentSizeGi} GiB` : '—'}
                </Descriptions.Item>
              </Descriptions>
            </div>
            <div style={{ marginBottom: 24 }} />
          </Col>
        </Row>
      ) : null}

      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>新容量 (GiB)</div>
        </Col>
        <Col span={18}>
          <Form.Item
            name="systemDiskSize"
            rules={
              hasTargets
                ? [
                    { required: true, message: '请输入新容量' },
                    {
                      validator: async (_, value) => {
                        if (!value) return;
                        if (value <= 0) throw new Error('容量必须大于 0');
                        if (expandDiskCurrentSizeGi != null && value < expandDiskCurrentSizeGi) {
                          throw new Error(`新容量必须大于等于当前容量 (${expandDiskCurrentSizeGi} GiB)`);
                        }
                      },
                    },
                  ]
                : []
            }
            noStyle
          >
            <InputNumber
              suffix="GiB"
              style={{ width: '150px' }}
              placeholder="扩容后的总容量"
              min={expandDiskCurrentSizeGi || 1}
              disabled={!hasTargets}
            />
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      <Collapse
        className="std-collapse-minimal"
        bordered={false}
        defaultActiveKey={['1']}
        items={[
          {
            key: '1',
            showArrow: false,
            label: <span>系统盘扩容指南</span>,
            children: (
              <div style={{ padding: '0 12px' }}>
                <Alert
                  description={
                    <ul style={{ paddingLeft: 20, margin: 0 }}>
                      <li>扩容操作仅支持增加容量，不可减少。</li>
                      <li>
                        平台层扩容完成后，<strong>必须</strong>进入操作系统内部扩展文件系统（或分区）才能生效。
                      </li>
                      <li>部分操作系统可能需要重启才能识别新的磁盘大小。</li>
                    </ul>
                  }
                  type="info"
                  style={{ padding: 12, marginBottom: 16 }}
                />
                <Tabs
                  defaultActiveKey="linux"
                  size="small"
                  type="card"
                  items={[
                    {
                      key: 'linux',
                      label: (
                        <span>
                          <CodeOutlined /> Linux
                        </span>
                      ),
                      children: (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ textAlign: 'center' }}>
                            <img
                              src={linuxSteps}
                              alt="Linux 磁盘扩容步骤"
                              style={{ maxWidth: '100%', borderRadius: 8 }}
                            />
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: 'windows',
                      label: (
                        <span>
                          <WindowsOutlined /> Windows
                        </span>
                      ),
                      children: (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <img src={winStep1} alt="Windows 扩容步骤 1" style={{ maxWidth: '100%', borderRadius: 8 }} />
                            <img src={winStep2} alt="Windows 扩容步骤 2" style={{ maxWidth: '100%', borderRadius: 8 }} />
                            <img src={winStep3} alt="Windows 扩容步骤 3" style={{ maxWidth: '100%', borderRadius: 8 }} />
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
        style={{ marginBottom: 24, background: '#ffffff', borderRadius: 8 }}
      />
    </>
  );
};

export default SystemDiskExpand;
