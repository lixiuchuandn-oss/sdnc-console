import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Button,
  Card,
  Form,
  Input,
  Select,
  List,
  Tag,
  message,
  Empty,
  Spin,
  Modal,
  Descriptions,
  Row,
  Col,
} from 'antd';
import {
  PartitionOutlined,
  CloseOutlined,
  DeleteOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  createKubeOvnVlan,
  deleteKubeOvnVlan,
  fetchKubeOvnProviderNetworks,
  fetchKubeOvnVlans,
} from '../../../../services/harvesterApi';
import { clearCache } from '../../../../utils/requestManager';
import { useAuth } from '../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../utils/accessMapping';
import { TOWER_IO_ALIES_ANNOTATION, generateKubeOvnTwelveCharName } from '../../../../utils/towerKubeOvnNames';

export type VlanPlanDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** 创建成功后回调（刷新外层列表等） */
  onSuccess?: () => void | Promise<void>;
  /** 从某条物理网络打开时锁定 Provider，列表仅展示该物理网络下的 VLAN */
  lockProviderName?: string | null;
};

const VlanPlanDrawer: React.FC<VlanPlanDrawerProps> = ({
  open,
  onClose,
  cloudId,
  onSuccess,
  lockProviderName,
}) => {
  const { user } = useAuth();
  const canWriteVlan = hasPermissionForAction(user?.permissions || [], 'clouds.vlans:write');

  const [form] = Form.useForm();
  const [providers, setProviders] = useState<any[]>([]);
  const [userSelectedPn, setUserSelectedPn] = useState<string | undefined>();
  const [vlanItems, setVlanItems] = useState<any[]>([]);
  const [vlanLoading, setVlanLoading] = useState(false);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const loadVlans = useCallback(
    async (force = true) => {
      if (!cloudId) return;
      setVlanLoading(true);
      try {
        const res = await fetchKubeOvnVlans(cloudId, force, false);
        const items = Array.isArray(res?.data?.items) ? res.data.items : [];
        setVlanItems(items);
        if (force && cloudId) {
          clearCache(`/api/clouds/${cloudId}/resources/vlans`, 'GET');
        }
      } catch (e: any) {
        message.error(e?.message || '加载 VLAN 列表失败');
        setVlanItems([]);
      } finally {
        setVlanLoading(false);
      }
    },
    [cloudId],
  );

  const loadProviders = useCallback(async () => {
    if (!cloudId) return;
    setProvidersLoading(true);
    try {
      const res = await fetchKubeOvnProviderNetworks(cloudId);
      setProviders(Array.isArray(res?.data?.items) ? res.data.items : []);
    } catch {
      setProviders([]);
    } finally {
      setProvidersLoading(false);
    }
  }, [cloudId]);

  useEffect(() => {
    if (!open || !cloudId) return;
    void loadVlans(true);
    void loadProviders();
  }, [open, cloudId, loadVlans, loadProviders]);

  useEffect(() => {
    if (!open || lockProviderName || providers.length === 0) return;
    setUserSelectedPn((prev) => prev ?? providers[0]?.metadata?.name);
  }, [open, lockProviderName, providers]);

  const effectiveProviderName = useMemo(() => {
    if (lockProviderName) return lockProviderName;
    return userSelectedPn ?? providers[0]?.metadata?.name ?? '';
  }, [lockProviderName, userSelectedPn, providers]);

  const effectivePn = useMemo(
    () => providers.find((p) => String(p?.metadata?.name || '').trim() === String(effectiveProviderName).trim()),
    [providers, effectiveProviderName],
  );

  /** 一次遍历生成下拉选项与别名映射，避免对 providers 重复扫描 */
  const { providerOptions, providerAliasMap } = useMemo(() => {
    const aliasMap = new Map<string, string>();
    const options: { label: string; value: string }[] = [];
    (providers || []).forEach((p) => {
      const name = String(p?.metadata?.name ?? '').trim();
      if (!name) return;
      const ann = p?.metadata?.annotations || {};
      const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
      const display = alias || name;
      aliasMap.set(name, display);
      const label = alias && alias !== name ? `${alias} (${name})` : display;
      options.push({ label, value: name });
    });
    return { providerOptions: options, providerAliasMap: aliasMap };
  }, [providers]);

  const lockProviderOption = useMemo(() => {
    if (!lockProviderName) return null;
    const hit = providerOptions.find((o) => o.value === lockProviderName);
    return { label: hit?.label || lockProviderName, value: lockProviderName };
  }, [lockProviderName, providerOptions]);

  useEffect(() => {
    if (!addModalOpen) return;
    form.resetFields();
    form.setFieldsValue({
      provider: lockProviderName ?? effectiveProviderName ?? undefined,
    });
  }, [addModalOpen, lockProviderName, effectiveProviderName, form]);

  const displayedVlans = useMemo(() => {
    if (!effectiveProviderName) return [];
    return vlanItems.filter(
      (v) => String(v?.spec?.provider || '').trim() === String(effectiveProviderName).trim(),
    );
  }, [vlanItems, effectiveProviderName]);

  const openAddModal = () => {
    if (!effectiveProviderName) {
      message.warning('请先选择物理网络');
      return;
    }
    setAddModalOpen(true);
  };

  const handleSubmit = async (values: any) => {
    if (!canWriteVlan) return;
    const providerName = lockProviderName ?? values.provider ?? effectiveProviderName;
    if (!providerName) {
      message.warning('请选择物理网络');
      return;
    }
    setSubmitLoading(true);
    try {
      const towerAlies = String(values.towerAlies ?? '').trim();
      if (!towerAlies) {
        message.warning('请输入名称');
        return;
      }
      const vlanTag = values.id;
      if (vlanTag === undefined || vlanTag === null || vlanTag === '') {
        message.warning('请输入 VLAN ID');
        return;
      }
      const idNum = Number(vlanTag);
      if (Number.isNaN(idNum)) {
        message.error('VLAN ID 无效');
        return;
      }

      const payload = {
        name: generateKubeOvnTwelveCharName(),
        annotations: { [TOWER_IO_ALIES_ANNOTATION]: towerAlies },
        id: idNum,
        provider: providerName,
      };
      await createKubeOvnVlan(cloudId, payload);
      message.success('VLAN 已添加');
      setAddModalOpen(false);
      form.resetFields();
      await loadVlans(true);
      await onSuccess?.();
    } catch (e: any) {
      message.error(e?.message || '创建失败');
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = (item: any) => {
    if (!canWriteVlan) return;
    const metaName = String(item?.metadata?.name || '').trim();
    if (!metaName) return;
    const ann = item?.metadata?.annotations || {};
    const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
    const label = displayAlias || metaName;
    Modal.confirm({
      title: '确认删除',
      content: `确定删除 VLAN「${label}」吗？若仍有子网引用，集群可能拒绝删除。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setDeletingName(metaName);
        try {
          await deleteKubeOvnVlan(cloudId, metaName);
          message.success('已删除');
          await loadVlans(true);
          await onSuccess?.();
        } catch (e: any) {
          message.error(e?.message || '删除失败');
        } finally {
          setDeletingName(null);
        }
      },
    });
  };

  const pnAnn = effectivePn?.metadata?.annotations || {};
  const pnDisplayName = String(pnAnn[TOWER_IO_ALIES_ANNOTATION] || '').trim();
  const pnMetaName = String(effectivePn?.metadata?.name || '').trim();
  const pnReady = !!effectivePn?.status?.ready;
  const pnReadyNodes = Array.isArray(effectivePn?.status?.readyNodes) ? effectivePn.status.readyNodes : [];
  const pnCustom = Array.isArray(effectivePn?.spec?.customInterfaces) ? effectivePn.spec.customInterfaces : [];

  /** 头部：主标题为资源展示名/资源名；副标题为集群 ID 或场景说明 */
  const headerTitle = useMemo(() => {
    if (pnMetaName) return pnDisplayName || pnMetaName;
    if (lockProviderName) return lockProviderName;
    return 'VLAN 规划';
  }, [pnDisplayName, pnMetaName, lockProviderName]);

  const headerSubtitle = useMemo(() => {
    if (pnMetaName) {
      if (pnDisplayName && pnDisplayName !== pnMetaName) return `${pnMetaName}`;
      return 'Kube-OVN · Provider Network';
    }
    if (lockProviderName) return `ID: ${lockProviderName}`;
    return '请选择物理网络或从列表进入';
  }, [pnMetaName, pnDisplayName, lockProviderName]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={900}
      placement="right"
      closable={false}
      destroyOnHidden
      styles={{
        body: {
          padding: 0,
          background: '#f5f7fa',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <style>{`
        .vlan-plan-drawer-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .vlan-plan-drawer-scroll::-webkit-scrollbar-track { background: transparent; }
        .vlan-plan-drawer-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        .vlan-plan-drawer-scroll::-webkit-scrollbar-thumb:hover { background: #ccc; }
      `}</style>

      <div
        style={{
          background: '#f5f7fa',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          borderBottom: '1px solid #f0f0f0',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <div className="harvester-drawer-title-icon-wrap">
            <PartitionOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2, wordBreak: 'break-word' }}>{headerTitle}</div>
            <div style={{ fontSize: 12, color: '#999' }}>{headerSubtitle}</div>
          </div>
          {effectivePn ? (
            <Tag color={pnReady ? 'success' : 'default'} style={{ margin: 0, flexShrink: 0 }}>
              {pnReady ? '已就绪' : '未就绪'}
            </Tag>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Button
            type="text"
            icon={<SyncOutlined spin={vlanLoading} />}
            onClick={() => void loadVlans(true)}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              padding: 0,
              color: '#666',
            }}
            title="从集群重新同步"
          />
          <Button
            type="text"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 4,
              fontSize: 16,
              padding: 0,
              color: '#666',
            }}
          >
            <CloseOutlined />
          </Button>
        </div>
      </div>

      <div
        className="vlan-plan-drawer-scroll"
        style={{
          padding: '16px 24px 24px',
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* 卡片样式对齐 HarvesterNodeDetailDrawer */}
        <Card variant="borderless" styles={{ body: { padding: 16 } }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>物理网络信息</div>
          {!lockProviderName && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>当前物理网络</div>
              <Select
                style={{ width: '100%' }}
                placeholder="选择物理网络"
                showSearch
                optionFilterProp="label"
                value={effectiveProviderName || undefined}
                onChange={(v) => setUserSelectedPn(v)}
                options={providerOptions}
              />
            </div>
          )}

          {providersLoading && providers.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Spin tip="加载物理网络…" />
            </div>
          ) : !effectivePn ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无物理网络数据或未选择物理网络" />
          ) : (
            <Row gutter={[24, 16]}>
              <Col xs={24} lg={12}>
                <Descriptions size="small" column={1} styles={{ label: { width: 96, color: '#888' } }}>
                  <Descriptions.Item label="展示名称">
                    {pnDisplayName || <span style={{ color: '#ccc' }}>—</span>}
                  </Descriptions.Item>
                  <Descriptions.Item label="资源 ID">
                    <span>{pnMetaName || '—'}</span>
                  </Descriptions.Item>
                  <Descriptions.Item label="默认接口">
                    {String(effectivePn?.spec?.defaultInterface || '').trim() || '—'}
                  </Descriptions.Item>
                </Descriptions>
              </Col>
              <Col xs={24} lg={12}>
                <Descriptions size="small" column={1} styles={{ label: { width: 96, color: '#888' } }}>
                  <Descriptions.Item label="就绪">
                    <Tag color={pnReady ? 'success' : 'default'}>{pnReady ? '就绪' : '未就绪'}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="就绪节点">
                    {pnReadyNodes.length ? `${pnReadyNodes.length} 个` : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="自定义接口">
                    {pnCustom.length ? (
                      <span>
                        {pnCustom.map((c: any, i: number) => (
                          <Tag key={i} color="orange" style={{ marginBottom: 4 }}>
                            {c?.interface ?? '—'}
                          </Tag>
                        ))}
                      </span>
                    ) : (
                      <span style={{ color: '#999' }}>无</span>
                    )}
                  </Descriptions.Item>
                </Descriptions>
              </Col>
            </Row>
          )}
        </Card>

        <Card variant="borderless" styles={{ body: { padding: 16 } }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500 }}>VLAN 规划</div>
            {canWriteVlan && (
              <Button type="primary" onClick={openAddModal}>
                添加 VLAN
              </Button>
            )}
          </div>

          {vlanLoading && vlanItems.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <Spin tip="加载 VLAN 列表…" />
            </div>
          ) : displayedVlans.length === 0 ? (
            <div style={{ padding: 24 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={effectiveProviderName ? '该物理网络下暂无 VLAN 规划' : '请选择物理网络'}
              />
            </div>
          ) : (
            <List
              size="small"
              split
              dataSource={displayedVlans}
              renderItem={(item) => {
                const ann = item?.metadata?.annotations || {};
                const displayAlias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
                const metaName = String(item?.metadata?.name || '').trim();
                const title = displayAlias || metaName || '—';
                const vlanId = item?.spec?.id;
                const provider = String(item?.spec?.provider || '').trim();
                const created = item?.metadata?.creationTimestamp;
                const busy = deletingName === metaName;
                return (
                  <List.Item
                    key={item?.metadata?.uid || metaName}
                    style={{ padding: '12px 0px' }}
                    actions={
                      canWriteVlan
                        ? [
                            <Button
                              key="del"
                              type="link"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              loading={busy}
                              disabled={!!deletingName && !busy}
                              onClick={() => handleDelete(item)}
                            >
                              删除
                            </Button>,
                          ]
                        : []
                    }
                  >
                    <div style={{ width: '100%', minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontWeight: 500, wordBreak: 'break-all' }}>{title}</span>
                        {provider ? (
                          <Tag color="geekblue" style={{ margin: 0 }}>
                            {providerAliasMap.get(provider) || provider}
                          </Tag>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>
                        VLAN ID: {vlanId !== undefined && vlanId !== null ? String(vlanId) : '—'}
                        {' · '}
                        ID:{' '}
                        <span style={{ fontFamily: 'ui-monospace, monospace' }}>{metaName || '—'}</span>
                        {created ? (
                          <>
                            {' · '}
                            <span className="std-time">{new Date(created).toLocaleString()}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Card>
      </div>

      <Modal
        title="添加 VLAN"
        open={addModalOpen}
        centered
        onCancel={() => setAddModalOpen(false)}
        footer={null}
        destroyOnHidden
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} className="std-form">
          <Form.Item name="towerAlies" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="支持中文，如：生产网 VLAN" allowClear />
          </Form.Item>
          <Form.Item name="id" label="VLAN ID" rules={[{ required: true, message: '请输入 VLAN ID' }]}>
            <Input type="number" placeholder="0 表示 Flat Network (无 Tag), 1-4095 为 VLAN Tag" />
          </Form.Item>
          <Form.Item name="provider" label="物理网络 (Provider Network)" rules={[{ required: true }]}>
            {lockProviderName ? (
              <Select
                disabled
                options={[lockProviderOption || { label: lockProviderName, value: lockProviderName }]}
              />
            ) : (
              <Select placeholder="选择物理网络" showSearch optionFilterProp="label" options={providerOptions} />
            )}
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Button onClick={() => setAddModalOpen(false)} style={{ marginRight: 8 }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit" loading={submitLoading}>
              确定
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Drawer>
  );
};

export default VlanPlanDrawer;
