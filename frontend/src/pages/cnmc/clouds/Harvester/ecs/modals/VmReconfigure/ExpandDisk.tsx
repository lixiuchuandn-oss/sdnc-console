import React, { useMemo } from 'react';
import { Form, Select, InputNumber, Alert, Descriptions, Collapse, Tabs, Row, Col, Typography } from 'antd';
import { WindowsOutlined, CodeOutlined, InfoCircleOutlined } from '@ant-design/icons';
import type { ExpandDiskCandidate } from './lib/vmReconfigureDiskCandidates';

type Props = {
  form: any;
  expandDiskCandidates: ExpandDiskCandidate[];
  /** 拉取选中 PVC 的当前容量并回填「新容量」 */
  loadExpandDiskSize: (pvcName: string) => void | Promise<void>;
  expandDiskCurrentSizeGi?: number | null;
  loading?: boolean;
};

const ExpandDisk: React.FC<Props> = ({
  form,
  expandDiskCandidates,
  loadExpandDiskSize,
  expandDiskCurrentSizeGi,
  loading,
}) => {
  const hasTargets = expandDiskCandidates.length > 0;
  const selectedPvc = Form.useWatch('expandDiskPvc', form);

  const selectedCandidate = useMemo(
    () => expandDiskCandidates.find((c) => c.pvcName === selectedPvc),
    [expandDiskCandidates, selectedPvc],
  );
  const showSystemDiskExpandGuide = selectedCandidate?.isSystemDisk === true;

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

      {showSystemDiskExpandGuide ? (
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
                            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                              平台扩容 PVC 后，在虚拟机内识别新容量并扩展分区与文件系统（命令因发行版与文件系统而异）。
                            </Typography.Paragraph>
                            <ol style={{ margin: 0, paddingLeft: 20 }}>
                              <li>确认块设备已反映新容量（如 <code>lsblk</code>）。</li>
                              <li>
                                扩展分区（若使用 GPT + growpart）：<code>sudo growpart /dev/vda 1</code>（设备与分区号按实际调整）。
                              </li>
                              <li>
                                扩展文件系统：XFS 用 <code>sudo xfs_growfs /</code>；ext4 用{' '}
                                <code>sudo resize2fs /dev/vda1</code>（按实际挂载点/设备）。
                              </li>
                            </ol>
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
                            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                              平台扩容后，在系统内用「磁盘管理」将未分配空间并入卷。
                            </Typography.Paragraph>
                            <ol style={{ margin: 0, paddingLeft: 20 }}>
                              <li>以管理员打开「计算机管理」→「磁盘管理」。</li>
                              <li>对系统盘若出现「未分配」或可对 C: 执行「扩展卷」，按向导完成。</li>
                              <li>若无「扩展卷」，可先确认分区表与恢复环境；必要时重启后再试。</li>
                            </ol>
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
      ) : null}
    </>
  );
};

export default ExpandDisk;
