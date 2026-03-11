import React from 'react';
import { Form, Radio, Space, Button, List, Typography, Row, Col, Checkbox, message } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';
import { ReactComponent as GpuIcon } from '../../../../../assets/clouds/gpu.svg';

type Props = {
  form: any;
  gpuResources: any[];
  selectedGpuKeys: string[];
  setSelectedGpuKeys: (keys: string[]) => void;
  gpuLoading: boolean;
  reloadGpuResources: () => void;
};

const ChangeGpu: React.FC<Props> = ({
  form,
  gpuResources,
  selectedGpuKeys,
  setSelectedGpuKeys,
  gpuLoading,
  reloadGpuResources
}) => {
  return (
    <>
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
          <div style={{ lineHeight: '32px' }}>GPU模式</div>
        </Col>
        <Col span={18}>
          <Form.Item name="gpuMode" initialValue="none" noStyle>
            <Radio.Group
              buttonStyle="solid"
              onChange={() => {
                setSelectedGpuKeys([]);
                form.setFieldsValue({ gpuResourceNames: undefined });
              }}
            >
              <Radio.Button value="none">无</Radio.Button>
              <Radio.Button value="passthrough">直通GPU</Radio.Button>
              <Radio.Button value="vgpu">vGPU</Radio.Button>
              <Radio.Button value="sriov">SR-IOV GPU</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>
      <Form.Item noStyle shouldUpdate={(prev, curr) => prev.gpuMode !== curr.gpuMode}>
        {({ getFieldValue }) => {
            const mode = getFieldValue('gpuMode') || 'none';
            if (mode === 'none') return null;
            
            const list = Array.isArray(gpuResources) ? gpuResources : [];
            const byMode = list.filter((x: any) => String(x?.type) === mode);
            const onlyNode = byMode.filter((x: any) => !!(x?.node || x?.nodeName));
            const src = (onlyNode.length ? onlyNode : byMode.length ? byMode : list);
            
            const data = src.map((x: any) => ({
              key: `${(x?.raw?.metadata?.name || x?.name || x?.resourceName) || '-'}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`,
              node: x?.node || x?.nodeName || '-',
              bus: x?.pciAddress || x?.address || x?.pci || '-',
              name: x?.raw?.metadata?.name || x?.raw?.spec?.deviceName || x?.name || x?.description || x?.desc || x?.resourceName,
              resourceName: x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName,
              type: x?.type,
              raw: x
            }));

            const keyToResName = new Map<string, string>();
            const keyToNode = new Map<string, string>();
            data.forEach((r: any) => {
              if (r?.key) keyToResName.set(String(r.key), String(r.resourceName || ''));
              if (r?.key) keyToNode.set(String(r.key), String(r.node || ''));
            });

            const updateSelection = (nextKeys: string[]) => {
              const uniqueKeys = Array.from(new Set(nextKeys.filter(Boolean)));
              const nextResNames = uniqueKeys
                .map((k) => keyToResName.get(String(k)))
                .filter((x) => !!x);
              setSelectedGpuKeys(uniqueKeys);
              form.setFieldsValue({ gpuResourceNames: nextResNames });
            };

            const firstSelectedKey = (selectedGpuKeys || []).find((k) => keyToNode.has(String(k)));
            const lockedNode = firstSelectedKey ? keyToNode.get(String(firstSelectedKey)) : undefined;

            return (
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                  <div style={{ lineHeight: '32px' }}>可用GPU</div>
                </Col>
                <Col span={18}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Typography.Text>可用 GPU 资源</Typography.Text>
                      {gpuLoading ? (
                        <LoadingOutlined style={{ fontSize: 16, color: '#1677ff' }} />
                      ) : (
                        <Button
                          size="middle"
                          icon={<ReloadOutlined style={{ fontSize: 14, color: '#8c8c8c' }} />}
                          type="default"
                          onClick={reloadGpuResources}
                        />
                      )}
                    </div>
                    <List
                      bordered
                      loading={gpuLoading}
                      dataSource={data}
                      renderItem={(r: any) => {
                        const checked = (selectedGpuKeys || []).includes(String(r?.key));
                        return (
                          <List.Item
                            style={{ cursor: 'pointer', padding: '8px 12px', background: checked ? '#e6f4ff' : undefined }}
                            onClick={() => {
                              const k = String(r?.key);
                              const node = String(r?.node || '');
                              if (lockedNode && node && lockedNode !== node && !checked) {
                                message.error('多块GPU需在同一节点上');
                                return;
                              }
                              if (checked) {
                                updateSelection((selectedGpuKeys || []).filter((x) => String(x) !== k));
                              } else {
                                updateSelection([...(selectedGpuKeys || []), k]);
                              }
                            }}
                          >
                            <Space style={{ width: '100%' }} align="start">
                              <Checkbox
                                checked={checked}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const k = String(r?.key);
                                  const node = String(r?.node || '');
                                  if (lockedNode && node && lockedNode !== node && !checked) {
                                    message.error('多块GPU需在同一节点上');
                                    return;
                                  }
                                  if (e.target.checked) {
                                    updateSelection([...(selectedGpuKeys || []), k]);
                                  } else {
                                    updateSelection((selectedGpuKeys || []).filter((x) => String(x) !== k));
                                  }
                                }}
                              />
                              <List.Item.Meta
                                avatar={
                                  <div style={{
                                    width: 34, height: 34, borderRadius: 8, background: '#ffffff',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0
                                  }}>
                                    <GpuIcon width={24} height={24} style={{ fill: '#1890ff' }} />
                                  </div>
                                }
                                title={
                                  <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                    <Typography.Text strong style={{ wordBreak: 'break-word' }}>{r?.name || '-'}</Typography.Text>
                                    <Typography.Text type="secondary" style={{ wordBreak: 'break-word' }}>{r?.resourceName || '-'}</Typography.Text>
                                  </div>
                                }
                                description={
                                  <Typography.Text type="secondary">
                                    节点：{r?.node || '-'}　总线：{r?.bus || '-'}
                                  </Typography.Text>
                                }
                              />
                            </Space>
                          </List.Item>
                        );
                      }}
                    />
                    <Form.Item
                      name="gpuResourceNames"
                      hidden
                      rules={[
                        {
                          validator: async (_, value) => {
                            const m = form.getFieldValue('gpuMode') || 'none';
                            if (m === 'none') return;
                            if (!Array.isArray(value) || value.length === 0) throw new Error('请选择GPU');
                          }
                        }
                      ]}
                    />
                  </div>
                  <div style={{ marginBottom: 24 }} />
                </Col>
              </Row>
            );
        }}
      </Form.Item>
    </>
  );
};

export default ChangeGpu;
