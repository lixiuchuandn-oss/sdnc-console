import React from 'react';
import { Form, Button, Card, Select, Row, Col, Input, message } from 'antd';
import { MinusCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

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
  const updateSelection = (nextKeys: string[], keyToResName?: Map<string, string>, keyToDeviceName?: Map<string, string>, pinnedNode?: string | null) => {
    const list = Array.isArray(nextKeys) ? nextKeys : [];
    const normalized = list.map((k) => String(k || ''));
    const seen = new Set<string>();
    const orderedKeys = normalized.filter((k) => {
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const lockedKeys = orderedKeys.filter((k) => !!k);
    const nextResNames = keyToResName
      ? lockedKeys.map((k) => keyToResName.get(String(k))).filter((x) => !!x)
      : undefined;
    const nextDeviceNames = keyToDeviceName
      ? lockedKeys.map((k) => keyToDeviceName.get(String(k))).filter((x) => !!x)
      : undefined;
    setSelectedGpuKeys(orderedKeys);
    if (nextResNames) form.setFieldsValue({ gpuResourceNames: nextResNames });
    else form.setFieldsValue({ gpuResourceNames: undefined });
    if (nextDeviceNames) form.setFieldsValue({ gpuDeviceNames: nextDeviceNames });
    else form.setFieldsValue({ gpuDeviceNames: undefined });
    if (pinnedNode !== undefined) {
      form.setFieldsValue({ gpuNodeName: pinnedNode || null });
    }
  };

  const modeLabel = (m?: string) => {
    const v = String(m || '').toLowerCase();
    if (v === 'passthrough') return '直通';
    if (v === 'sriov') return 'SR-IOV';
    if (v === 'vgpu') return 'vGPU';
    if (v === 'none') return '无';
    return v || '-';
  };

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ color: '#999' }}>变更 GPU 资源配置（需重启生效）</div>
        <Button type="link" icon={<ReloadOutlined />} onClick={() => reloadGpuResources()} disabled={gpuLoading} style={{ padding: 0 }}>
          刷新
        </Button>
      </div>
      <Form.Item name="gpuMode" initialValue="none" hidden />
      <Form.Item name="gpuResourceNames" initialValue={[]} hidden />
      <Form.Item name="gpuDeviceNames" initialValue={[]} hidden />
      <Form.Item noStyle shouldUpdate={(prev, curr) => prev.gpuMode !== curr.gpuMode}>
        {({ getFieldValue }) => {
            const mode = getFieldValue('gpuMode') || 'none';
            
            const list = Array.isArray(gpuResources) ? gpuResources : [];
            const byMode = list.filter((x: any) => String(x?.type) === mode);
            const onlyNode = byMode.filter((x: any) => !!(x?.node || x?.nodeName));
            const src = (onlyNode.length ? onlyNode : byMode);

            const getGpuDisplayName = (x: any) => {
              return x?.raw?.status?.description
                || x?.status?.description
                || x?.raw?.status?.deviceName
                || x?.raw?.spec?.deviceName
                || x?.raw?.metadata?.name
                || x?.name
                || x?.description
                || x?.desc
                || x?.resourceName
                || '-';
            };
            
            const data = src.map((x: any) => ({
              key: `${(x?.raw?.metadata?.name || x?.name || x?.resourceName) || '-'}|${x?.node || x?.nodeName}|${x?.pciAddress || x?.address || x?.pci}`,
              node: x?.node || x?.nodeName || '-',
              bus: x?.pciAddress || x?.address || x?.pci || '-',
              name: getGpuDisplayName(x),
              resourceName: x?.resourceName || x?.raw?.status?.resourceName || x?.raw?.spec?.resourceName,
              type: x?.type,
              raw: x
            }));

            const keyToResName = new Map<string, string>();
            const keyToNode = new Map<string, string>();
            const keyToRow = new Map<string, any>();
            const keyToDeviceName = new Map<string, string>();
            data.forEach((r: any) => {
              if (r?.key) keyToResName.set(String(r.key), String(r.resourceName || ''));
              if (r?.key) keyToNode.set(String(r.key), String(r.node || ''));
              if (r?.key) keyToRow.set(String(r.key), r);
              if (r?.key) keyToDeviceName.set(String(r.key), String(String(r.key).split('|')[0] || ''));
            });

            const parseKey = (k: string) => {
              const [n, node, bus] = String(k || '').split('|');
              return { key: String(k), name: n || '-', node: node || '-', bus: bus || '-', resourceName: '-' };
            };
            const keys = Array.isArray(selectedGpuKeys) ? selectedGpuKeys : [];
            const selectedRows = keys.map((k) => keyToRow.get(String(k)) || parseKey(String(k))).filter((x) => !!x);
            const lockedNode = (() => {
              const first = selectedRows.find((x: any) => String(x?.node || '') && String(x?.node || '') !== '-');
              return first ? String(first?.node) : undefined;
            })();

            const trySetModeAndAdd = (targetMode: string) => {
              const currentMode = String(form.getFieldValue('gpuMode') || 'none');
              const hasLocked = keys.some((x) => !!String(x || ''));
              const hasEmpty = keys.some((x) => !String(x || ''));
              if (hasLocked && currentMode !== targetMode) {
                message.warning('请先解绑已添加GPU后再切换GPU模式');
                return;
              }
              if (hasEmpty && currentMode === targetMode) {
                message.warning('请先选择GPU或删除空卡片');
                return;
              }
              if (!hasLocked && hasEmpty && currentMode !== targetMode) {
                setSelectedGpuKeys([]);
                form.setFieldsValue({ gpuResourceNames: [] });
              }
              if (currentMode !== targetMode) {
                form.setFieldsValue({ gpuMode: targetMode });
              }
              reloadGpuResources();
              const base = hasLocked ? keys : [];
              const next = [...base, ''];
              updateSelection(next, keyToResName, keyToDeviceName, lockedNode || null);
            };
            const removeSlot = (idx: number) => {
              const next = keys.filter((_, i) => i !== idx);
              const hasAny = next.filter((x) => !!String(x || '')).length > 0;
              updateSelection(next, keyToResName, keyToDeviceName, hasAny ? (lockedNode || null) : null);
              if (next.filter((x) => !!String(x || '')).length === 0) {
                form.setFieldsValue({ gpuMode: 'none', gpuResourceNames: [], gpuDeviceNames: [] });
                setSelectedGpuKeys([]);
              }
            };
            const updateSlot = (idx: number, nextKey?: string) => {
              if (String(keys?.[idx] || '') && String(nextKey || '') && String(nextKey || '') !== String(keys?.[idx] || '')) {
                message.warning('已添加GPU不支持变更，请先解绑');
                return;
              }
              const normalized = String(nextKey || '');
              if (normalized) {
                const node = String(keyToNode.get(normalized) || '');
                const currentLocked = lockedNode;
                if (currentLocked && node && currentLocked !== node) {
                  message.error('多块GPU需在同一节点上');
                  return;
                }
              }
              const next = [...keys];
              next[idx] = normalized;
              const pinned = normalized ? (String(keyToNode.get(normalized) || '') || lockedNode || null) : (lockedNode || null);
              updateSelection(next, keyToResName, keyToDeviceName, pinned);
            };

            const buildOptions = (idx: number) => {
              const used = new Set(keys.filter((k, i) => i !== idx).map((k) => String(k || '')).filter(Boolean));
              return data
                .filter((r: any) => {
                  const k = String(r?.key || '');
                  if (!k) return false;
                  if (used.has(k)) return false;
                  if (lockedNode && String(r?.node || '') && String(r?.node || '') !== '-' && String(r?.node || '') !== lockedNode) return false;
                  return true;
                })
                .map((r: any) => {
                  return { label: String(r?.name || '-'), value: String(r?.key) };
                });
            };

            return (
              <>
                {mode !== 'none' && !gpuLoading && byMode.length === 0 ? (
                  <div style={{ marginBottom: 12, color: '#999' }}>
                    暂无可用{mode === 'passthrough' ? '直通GPU' : mode === 'sriov' ? 'SR-IOV GPU' : mode === 'vgpu' ? 'vGPU' : 'GPU'}资源
                  </div>
                ) : null}
                {mode === 'none' ? null : keys.map((k, idx) => {
                  const r = keyToRow.get(String(k)) || parseKey(String(k));
                  const locked = !!String(k || '');
                  return (
                    <Card
                      key={`${idx}-${String(k || '')}`}
                      size="small"
                      title={`GPU #${idx + 1}`}
                      extra={
                        <Button type="text" icon={<MinusCircleOutlined />} onClick={() => removeSlot(idx)} danger />
                      }
                      style={{ marginBottom: 12, border: '1px solid #d9d9d9' }}
                    >
                      <Row gutter={12}>
                        <Col span={24}>
                          {locked ? (
                            <Form.Item label="GPU名称" style={{ marginBottom: 12 }}>
                              <Input value={r?.name || '-'} disabled />
                            </Form.Item>
                          ) : (
                            <Form.Item label="选择GPU" required style={{ marginBottom: 12 }}>
                              <Select
                                placeholder="选择 GPU 资源"
                                options={buildOptions(idx)}
                                value={k ? String(k) : undefined}
                                loading={gpuLoading}
                                notFoundContent={gpuLoading ? '加载中...' : '暂无可选GPU'}
                                onDropdownVisibleChange={(open) => {
                                  if (open) reloadGpuResources();
                                }}
                                onChange={(val) => updateSlot(idx, val)}
                              />
                            </Form.Item>
                          )}
                        </Col>
                        <Col span={8}>
                          <Form.Item label="节点" style={{ marginBottom: 0 }}>
                            <Input value={r?.node || '-'} disabled />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="总线" style={{ marginBottom: 0 }}>
                            <Input value={r?.bus || '-'} disabled />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="类型" style={{ marginBottom: 0 }}>
                            <Input value={modeLabel(mode)} disabled />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  );
                })}
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    type="dashed"
                    onClick={() => trySetModeAndAdd('passthrough')}
                    style={{ flex: 1 }}
                    icon={<PlusOutlined />}
                    disabled={gpuLoading}
                  >
                    添加直通GPU
                  </Button>
                  <Button
                    type="dashed"
                    onClick={() => trySetModeAndAdd('vgpu')}
                    style={{ flex: 1 }}
                    icon={<PlusOutlined />}
                    disabled={gpuLoading}
                  >
                    添加vGPU
                  </Button>
                  <Button
                    type="dashed"
                    onClick={() => trySetModeAndAdd('sriov')}
                    style={{ flex: 1 }}
                    icon={<PlusOutlined />}
                    disabled={gpuLoading}
                  >
                    添加SR-IOV GPU
                  </Button>
                </div>
                <Form.Item
                  name="gpuResourceNames"
                  hidden
                  rules={[
                    {
                      validator: async () => {
                        const m = form.getFieldValue('gpuMode') || 'none';
                        if (m === 'none') return;
                        const ks = Array.isArray(selectedGpuKeys) ? selectedGpuKeys : [];
                        if (ks.length === 0) throw new Error('请添加GPU');
                        if (ks.some((x) => !String(x || ''))) throw new Error('请选择GPU');
                        const names = ks.map((x) => keyToResName.get(String(x))).filter((x) => !!x);
                        if (names.length !== ks.length) throw new Error('请选择GPU');
                      }
                    }
                  ]}
                />
                <Form.Item name="gpuNodeName" hidden />
              </>
            );
        }}
      </Form.Item>
    </>
  );
};

export default ChangeGpu;
