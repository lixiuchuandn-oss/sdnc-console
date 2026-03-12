import React from 'react';
import { Form, Button, Card, Select, Row, Col, Input, message } from 'antd';
import { MinusCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

type Props = {
  form: any;
  usbResources: any[];
  selectedUsbKeys: string[];
  setSelectedUsbKeys: (keys: string[]) => void;
  usbLoading: boolean;
  reloadUsbResources: () => void;
};

const ChangeUsb: React.FC<Props> = ({
  form,
  usbResources,
  selectedUsbKeys,
  setSelectedUsbKeys,
  usbLoading,
  reloadUsbResources
}) => {
  const updateSelection = (nextKeys: string[]) => {
    const list = Array.isArray(nextKeys) ? nextKeys : [];
    const uniqueKeys = Array.from(new Set(list.map((k) => String(k || '')).filter(Boolean)));
    setSelectedUsbKeys(list);
    form.setFieldsValue({ usbResourceNames: uniqueKeys });
  };

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ color: '#999' }}>变更 USB 设备配置（需重启生效）</div>
        <Button type="link" icon={<ReloadOutlined />} onClick={() => reloadUsbResources()} disabled={usbLoading} style={{ padding: 0 }}>
          刷新
        </Button>
      </div>
      <Form.Item noStyle shouldUpdate>
        {() => {
          const list = Array.isArray(usbResources) ? usbResources : [];
          const data = list
            .map((x: any) => {
              const rn = String(x?.resourceName || x?.raw?.resourceName || x?.name || '');
              if (!rn) return null;
              const vendorId = String(x?.vendorId || x?.vendor || x?.raw?.vendorId || '');
              const productId = String(x?.productId || x?.product || x?.raw?.productId || '');
              const description = String(
                x?.description ||
                  x?.raw?.status?.description ||
                  x?.raw?.spec?.description ||
                  x?.raw?.description ||
                  x?.name ||
                  '',
              );
              const name = String(x?.name || x?.raw?.metadata?.name || '');
              const nodeName = String(x?.nodeName || x?.raw?.status?.nodeName || x?.raw?.spec?.nodeName || '');
              const vendor = String(
                x?.vendorName ||
                  x?.vendor ||
                  x?.raw?.status?.vendorName ||
                  x?.raw?.status?.vendor ||
                  x?.raw?.spec?.vendorName ||
                  x?.raw?.spec?.vendor ||
                  '',
              );
              const enabled =
                x?.enabled !== undefined
                  ? !!x.enabled
                  : (x?.raw?.status?.enabled !== undefined
                      ? !!x.raw.status.enabled
                      : (x?.raw?.spec?.enabled !== undefined ? !!x.raw.spec.enabled : false));
              return { key: rn, resourceName: rn, name, description, nodeName, vendor, vendorId, productId, enabled, raw: x };
            })
            .filter(Boolean) as any[];

          const keyToRow = new Map<string, any>();
          data.forEach((r: any) => {
            if (r?.key) keyToRow.set(String(r.key), r);
          });

          const keys = Array.isArray(selectedUsbKeys) ? selectedUsbKeys : [];

          const addSlot = () => {
            const hasEmpty = keys.some((x) => !String(x || ''));
            if (hasEmpty) {
              message.warning('请先选择USB设备或删除空卡片');
              return;
            }
            updateSelection([...keys, '']);
          };

          const removeSlot = (idx: number) => {
            const next = keys.filter((_, i) => i !== idx);
            updateSelection(next);
          };

          const updateSlot = (idx: number, nextKey?: string) => {
            if (String(keys?.[idx] || '') && String(nextKey || '') && String(nextKey || '') !== String(keys?.[idx] || '')) {
              message.warning('已添加USB不支持变更，请先解绑');
              return;
            }
            const normalized = String(nextKey || '');
            const next = [...keys];
            next[idx] = normalized;
            updateSelection(next);
          };

          const buildOptions = (idx: number) => {
            const used = new Set(keys.filter((k, i) => i !== idx).map((k) => String(k || '')).filter(Boolean));
            return data
              .filter((r: any) => {
                const k = String(r?.key || '');
                if (!k) return false;
                if (used.has(k)) return false;
                if (r?.enabled !== true) return false;
                return true;
              })
              .map((r: any) => {
                const code = (r?.vendorId && r?.productId) ? `${String(r.vendorId)}:${String(r.productId)}` : '';
                const displayName = String(r?.description || r?.name || '');
                const node = String(r?.nodeName || '');
                const v = String(r?.vendor || '');
                const parts = [
                  displayName || '未命名设备',
                  node ? `@${node}` : '',
                  v ? `| ${v}` : '',
                  code ? `(${code})` : '',
                ].filter(Boolean);
                const label = parts.join(' ');
                return { label, value: String(r?.key) };
              });
          };

          const parseKey = (k: string) => {
            return { key: String(k), resourceName: String(k || '-'), name: '-', description: '-', nodeName: '-', vendor: '-', vendorId: '-', productId: '-', enabled: false };
          };

          return (
            <>
              {keys.map((k, idx) => {
                const r = keyToRow.get(String(k)) || parseKey(String(k));
                const locked = !!String(k || '');
                const displayName = String(r?.description || r?.name || '-') || '-';
                const node = String(r?.nodeName || '-') || '-';
                const vendor = String(r?.vendor || r?.vendorId || '-') || '-';
                return (
                  <Card
                    key={`${idx}-${String(k || '')}`}
                    size="small"
                    title={`USB #${idx + 1}`}
                    extra={<Button type="text" icon={<MinusCircleOutlined />} onClick={() => removeSlot(idx)} danger />}
                    style={{ marginBottom: 12, border: '1px solid #d9d9d9' }}
                  >
                    <Row gutter={12}>
                      <Col span={24}>
                        {locked ? (
                          <Form.Item label="名称" style={{ marginBottom: 12 }}>
                            <Input value={displayName} disabled />
                          </Form.Item>
                        ) : (
                          <Form.Item label="选择USB" required style={{ marginBottom: 12 }}>
                            <Select
                              placeholder="选择 USB 资源"
                              options={buildOptions(idx)}
                              value={k ? String(k) : undefined}
                              loading={usbLoading}
                              notFoundContent={usbLoading ? '加载中...' : '暂无可选USB'}
                              onDropdownVisibleChange={(open) => {
                                if (open) reloadUsbResources();
                              }}
                              onChange={(val) => updateSlot(idx, val)}
                            />
                          </Form.Item>
                        )}
                      </Col>
                      <Col span={12}>
                        <Form.Item label="节点" style={{ marginBottom: 0 }}>
                          <Input value={node} disabled />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item label="厂商" style={{ marginBottom: 0 }}>
                          <Input value={vendor} disabled />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                );
              })}

              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  type="dashed"
                  onClick={addSlot}
                  style={{ flex: 1 }}
                  icon={<PlusOutlined />}
                  disabled={usbLoading}
                >
                  添加USB设备
                </Button>
              </div>

              <Form.Item
                name="usbResourceNames"
                hidden
                rules={[
                  {
                    validator: async () => {
                      const ks = Array.isArray(selectedUsbKeys) ? selectedUsbKeys : [];
                      if (ks.some((x) => !String(x || ''))) throw new Error('请选择USB设备');
                    }
                  }
                ]}
              />
            </>
          );
        }}
      </Form.Item>
    </>
  );
};

export default ChangeUsb;
