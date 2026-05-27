/**
 * VirtualMachine **资源清单**（YAML，只读）+ 注解 / 标签编辑（新抽屉，与旧 Opsinfo / ViewLinkTab 解耦）。
 * 当前实现：VirtualMachine，经 `patchHarvesterVm` 提交 JSON Patch。
 *
 * 落位：`Harvester/shared/components/` —— Harvester 多云下多域复用（ECS 详情、回收站、VNE 等），非 ECS 专属。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormInstance } from 'antd/es/form';
import { Tabs, Button, Form, Input, message, Row, Col, ConfigProvider, theme, Typography } from 'antd';
import { ArrowLeftOutlined, PlusOutlined, MinusCircleOutlined, SyncOutlined } from '@ant-design/icons';
import yaml from 'js-yaml';
import CodeEditor from '../../../../../../components/CodeEditor';
import { fetchHarvesterResourceByLink, patchHarvesterVm } from '../../../../../../services/harvesterApi';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import VmSecondaryDrawerShell from '../../ecs/drawers/shared/components/VmSecondaryDrawerShell';

const VLT = {
  shell: '#0d1117',
  surface: '#161b22',
  header: '#21262d',
  border: 'rgba(230, 237, 243, 0.12)',
  text: '#e6edf3',
  muted: '#8b949e',
  err: '#f85149',
} as const;

/** Tab 与正文区 flex 贯通（YAML 编辑器高度由 CrdManifestYamlPanel 内 ResizeObserver 决定） */
const TAB_CSS = `
.crd-meta-drawer-tabs.ant-tabs {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.crd-meta-drawer-tabs .ant-tabs-nav {
  flex-shrink: 0;
  margin-bottom: 0;
  padding: 0;
}
.crd-meta-drawer-tabs .ant-tabs-content-holder {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 12px 0 0;
  box-sizing: border-box;
}
.crd-meta-drawer-tabs .ant-tabs-content {
  height: 100%;
  min-height: 0;
}
.crd-meta-drawer-tabs .ant-tabs-tabpane {
  height: 100%;
  overflow: hidden;
}
.crd-meta-drawer-tabs .ant-tabs-tabpane-active {
  display: flex !important;
  flex-direction: column;
  min-height: 0;
}
`;

export function resolveHarvesterVirtualMachineViewLink(record: any): string | null {
  const v = record?.links?.view;
  if (typeof v === 'string' && v.trim()) return v.trim();
  const ns = record?.metadata?.namespace;
  const name = record?.metadata?.name;
  if (!ns || !name) return null;
  return `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(ns)}/virtualmachines/${encodeURIComponent(name)}`;
}

export type HarvesterCrdMetadataDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** 当前 VM 行数据 / vmData */
  record: any;
  onBack?: () => void;
  onSuccess?: () => void;
};

const LABEL_KEY_RULE = {
  pattern:
    /^([A-Za-z0-9][-A-Za-z0-9_.]*[A-Za-z0-9]\/)?([A-Za-z0-9][-A-Za-z0-9_.]*[A-Za-z0-9])$/,
  message: '须为合法的 Kubernetes 标签键',
} as const;

const CRD_MANIFEST_EDITOR_MIN_H = 160;

type CrdManifestYamlPanelProps = {
  drawerOpen: boolean;
  manifestActive: boolean;
  viewLink: string | null;
  crdLoading: boolean;
  crdYaml: string;
  crdError: string;
  loadCrdYaml: () => void;
};

/** YAML 区：ResizeObserver → CodeMirror 像素高度（避免 flex/% 推导失败导致无法滚动） */
const CrdManifestYamlPanel: React.FC<CrdManifestYamlPanelProps> = ({
  drawerOpen,
  manifestActive,
  viewLink,
  crdLoading,
  crdYaml,
  crdError,
  loadCrdYaml,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editorHeightPx, setEditorHeightPx] = useState(CRD_MANIFEST_EDITOR_MIN_H);

  useLayoutEffect(() => {
    if (!drawerOpen || !manifestActive) return;
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const measure = () => {
      const { height } = el.getBoundingClientRect();
      const next = Math.floor(height);
      if (next >= CRD_MANIFEST_EDITOR_MIN_H) {
        setEditorHeightPx(next);
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawerOpen, manifestActive, crdLoading, crdYaml, crdError]);

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          background: VLT.surface,
          color: VLT.text,
          border: `1px solid ${VLT.border}`,
          borderRadius: 6,
          margin: 0,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            padding: '10px 16px',
            background: VLT.header,
            borderBottom: `1px solid ${VLT.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, color: VLT.muted, wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
            {viewLink || '无 View Link'}
          </span>
          <Button
            size="small"
            icon={<SyncOutlined spin={crdLoading} />}
            onClick={() => void loadCrdYaml()}
            loading={crdLoading}
          >
            刷新
          </Button>
        </div>
        <div
          ref={hostRef}
          style={{
            flex: 1,
            minHeight: CRD_MANIFEST_EDITOR_MIN_H,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {crdLoading && !crdYaml ? (
            <div style={{ padding: 16, color: VLT.muted }}>加载中…</div>
          ) : crdError && !crdYaml ? (
            <div style={{ padding: 16, color: VLT.err }}>
              {crdError}{' '}
              <Button type="link" size="small" onClick={() => void loadCrdYaml()}>
                重试
              </Button>
            </div>
          ) : (
            <CodeEditor
              readOnly
              value={crdYaml}
              language="yaml"
              cmTheme="dark"
              height={editorHeightPx}
              minHeight={CRD_MANIFEST_EDITOR_MIN_H}
              style={{
                width: '100%',
                border: 'none',
                borderRadius: 0,
                background: VLT.surface,
              }}
            />
          )}
        </div>
      </div>
    </ConfigProvider>
  );
};

const HarvesterCrdMetadataDrawer: React.FC<HarvesterCrdMetadataDrawerProps> = ({
  open,
  onClose,
  cloudId,
  record,
  onBack,
  onSuccess,
}) => {
  const { user } = useAuth();
  const canPatch = useMemo(() => {
    const perms = (user?.permissions ?? []) as string[];
    return (
      hasPermissionForAction(perms, 'clouds.ecs:write') || hasPermissionForAction(perms, 'clouds:write')
    );
  }, [user?.permissions]);

  const viewLink = useMemo(() => resolveHarvesterVirtualMachineViewLink(record), [record]);
  const ns = record?.metadata?.namespace || record?.namespace || 'default';
  const name = record?.metadata?.name || record?.name;

  const drawerTitle = useMemo(() => {
    const n = name || '';
    return n ? `VirtualMachine: ${n}` : 'VirtualMachine';
  }, [name]);

  const [activeKey, setActiveKey] = useState('manifest');
  const [crdYaml, setCrdYaml] = useState('');
  const [crdLoading, setCrdLoading] = useState(false);
  const [crdError, setCrdError] = useState('');
  const [crdNonce, setCrdNonce] = useState(0);

  const [annoForm] = Form.useForm();
  const [labelForm] = Form.useForm();
  const [annoSubmitting, setAnnoSubmitting] = useState(false);
  const [labelSubmitting, setLabelSubmitting] = useState(false);

  const loadCrdYaml = useCallback(async () => {
    if (!cloudId || !viewLink) return;
    setCrdLoading(true);
    setCrdError('');
    try {
      const res = await fetchHarvesterResourceByLink(cloudId, viewLink);
      let doc: unknown = res;
      if (typeof res === 'string') {
        doc = JSON.parse(res);
      }
      setCrdYaml(yaml.dump(doc as object, { lineWidth: 120, noRefs: true, sortKeys: false }));
    } catch (e: any) {
      setCrdError(e?.message || '加载失败');
      setCrdYaml('');
    } finally {
      setCrdLoading(false);
    }
  }, [cloudId, viewLink]);

  useEffect(() => {
    if (!open) return;
    void loadCrdYaml();
  }, [open, loadCrdYaml, crdNonce]);

  useEffect(() => {
    if (!open || !record) return;
    const ann = record?.metadata?.annotations || {};
    const lbl = record?.metadata?.labels || {};
    annoForm.setFieldsValue({
      pairs: Object.entries(ann).map(([key, value]) => ({ key, value: value != null ? String(value) : '' })),
    });
    labelForm.setFieldsValue({
      pairs: Object.entries(lbl).map(([key, value]) => ({ key, value: value != null ? String(value) : '' })),
    });
  }, [open, record, annoForm, labelForm]);

  const buildPairsObject = (pairs: { key?: string; value?: string }[] | undefined) => {
    const out: Record<string, string> = {};
    (pairs || []).forEach((p) => {
      const k = String(p?.key || '').trim();
      if (!k) return;
      out[k] = p?.value !== undefined && p?.value !== null ? String(p.value) : '';
    });
    return out;
  };

  const submitAnnotations = async () => {
    if (!canPatch) {
      message.warning('无云主机写权限，无法保存');
      return;
    }
    try {
      const values = await annoForm.validateFields();
      setAnnoSubmitting(true);
      const next = buildPairsObject(values.pairs);
      const orig = record?.metadata?.annotations || {};
      const patchOps: any[] = [];
      if (Object.keys(orig).length === 0) {
        patchOps.push({ op: 'add', path: '/metadata/annotations', value: next });
      } else {
        patchOps.push({ op: 'replace', path: '/metadata/annotations', value: next });
      }
      if (!name) throw new Error('缺少资源名称');
      await patchHarvesterVm(cloudId, ns, name, patchOps, 'application/json-patch+json');
      message.success('注解已更新');
      onSuccess?.();
      setCrdNonce((n) => n + 1);
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '保存失败');
    } finally {
      setAnnoSubmitting(false);
    }
  };

  const submitLabels = async () => {
    if (!canPatch) {
      message.warning('无云主机写权限，无法保存');
      return;
    }
    try {
      const values = await labelForm.validateFields();
      setLabelSubmitting(true);
      const next = buildPairsObject(values.pairs);
      const orig = record?.metadata?.labels || {};
      const patchOps: any[] = [];
      if (Object.keys(orig).length === 0) {
        patchOps.push({ op: 'add', path: '/metadata/labels', value: next });
      } else {
        patchOps.push({ op: 'replace', path: '/metadata/labels', value: next });
      }
      if (!name) throw new Error('缺少资源名称');
      await patchHarvesterVm(cloudId, ns, name, patchOps, 'application/json-patch+json');
      message.success('标签已更新');
      onSuccess?.();
      setCrdNonce((n) => n + 1);
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '保存失败');
    } finally {
      setLabelSubmitting(false);
    }
  };

  const renderKvList = (
    form: FormInstance,
    rules: typeof LABEL_KEY_RULE | undefined,
    placeholderKey: string,
    disabled: boolean,
  ) => (
    <div style={{ padding: '0 16px', flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Form form={form} layout="vertical" disabled={disabled} style={{ paddingBottom: 8 }}>
        <Form.List name="pairs">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name: fieldName, ...rest }) => (
                <Row key={key} gutter={[12, 12]} align="top" style={{ marginBottom: 12 }}>
                  <Col span={7}>
                    <Form.Item
                      {...rest}
                      name={[fieldName, 'key']}
                      style={{ marginBottom: 0 }}
                      rules={rules ? [{ required: true, message: '键必填' }, rules] : [{ required: true, message: '键必填' }]}
                    >
                      <Input placeholder={placeholderKey} />
                    </Form.Item>
                  </Col>
                  <Col span={16}>
                    <Form.Item {...rest} name={[fieldName, 'value']} style={{ marginBottom: 0 }}>
                      <Input.TextArea rows={2} placeholder="值" />
                    </Form.Item>
                  </Col>
                  <Col span={1} style={{ textAlign: 'center', paddingTop: 4 }}>
                    <MinusCircleOutlined onClick={() => remove(fieldName)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                  </Col>
                </Row>
              ))}
              <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} style={{ marginTop: 4, marginBottom: 0 }}>
                添加一行
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </div>
  );

  return (
    <VmSecondaryDrawerShell open={open} onClose={onClose} fillViewport>
      {onBack ? (
        <div
          style={{
            flexShrink: 0,
            padding: '0 0 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}>
            返回
          </Button>
          <Typography.Text ellipsis={{ tooltip: drawerTitle }} style={{ flex: 1, minWidth: 0 }}>
            {drawerTitle}
          </Typography.Text>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <style>{TAB_CSS}</style>
        <Tabs
          className="crd-meta-drawer-tabs"
          style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          activeKey={activeKey}
          onChange={setActiveKey}
          items={[
            {
              key: 'manifest',
              label: '资源清单 (YAML)',
              children: (
                <CrdManifestYamlPanel
                  drawerOpen={open}
                  manifestActive={activeKey === 'manifest'}
                  viewLink={viewLink}
                  crdLoading={crdLoading}
                  crdYaml={crdYaml}
                  crdError={crdError}
                  loadCrdYaml={loadCrdYaml}
                />
              ),
            },
            {
              key: 'annotations',
              label: '注解',
              children: (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {renderKvList(annoForm, undefined, '注解键', !canPatch)}
                  <div
                    style={{
                      flexShrink: 0,
                      padding: '12px 16px 16px',
                      borderTop: '1px solid #f0f0f0',
                    }}
                  >
                    <Button type="primary" onClick={() => void submitAnnotations()} loading={annoSubmitting} disabled={!canPatch}>
                      保存注解
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'labels',
              label: '标签',
              children: (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                  {renderKvList(labelForm, LABEL_KEY_RULE, '标签键', !canPatch)}
                  <div
                    style={{
                      flexShrink: 0,
                      padding: '12px 16px 16px',
                      borderTop: '1px solid #f0f0f0',
                    }}
                  >
                    <Button type="primary" onClick={() => void submitLabels()} loading={labelSubmitting} disabled={!canPatch}>
                      保存标签
                    </Button>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </VmSecondaryDrawerShell>
  );
};

export default HarvesterCrdMetadataDrawer;
