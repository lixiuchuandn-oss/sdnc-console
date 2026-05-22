/**
 * 物理网络详情抽屉：Kube-OVN ProviderNetwork 描述信息。
 * 集群 YAML 视图见物理网络列表行操作「查看YAML」（ResourceLinkYamlDrawer）。
 * VLAN / 扁平与公共子网规划见 {@link ProviderNetworkVlanPlanDrawer}。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Drawer, Empty, Select, Space, Spin, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import { fetchKubeOvnProviderNetworks } from '../../../../../../../services/harvesterApi';
import { TOWER_IO_ALIES_ANNOTATION } from '../../../../../../../utils/towerKubeOvnNames';
import { formatOriginNicsDetailLines, parseProviderNetworkOriginNics } from '../../lib/providerNetworkOriginNics';

export type ProviderNetworkDetailDrawerProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  /** 外层列表等在写操作后按需刷新（本抽屉主要为只读） */
  onSuccess?: () => void | Promise<void>;
  /** 从某条物理网络打开时锁定 Provider */
  lockProviderName?: string | null;
};

const TAB_PANEL_NETWORK: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const ProviderNetworkDetailDrawer: React.FC<ProviderNetworkDetailDrawerProps> = ({
  open,
  onClose,
  cloudId,
  lockProviderName,
}) => {
  const [providers, setProviders] = useState<any[]>([]);
  const [userSelectedPn, setUserSelectedPn] = useState<string | undefined>();
  const [providersLoading, setProvidersLoading] = useState(false);

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
    void loadProviders();
  }, [open, cloudId, loadProviders]);

  useEffect(() => {
    if (!open || lockProviderName || providers.length === 0) return;
    setUserSelectedPn((prev) => prev ?? providers[0]?.metadata?.name);
  }, [open, lockProviderName, providers]);

  const effectiveProviderName = useMemo(() => {
    if (lockProviderName) return lockProviderName;
    return userSelectedPn ?? providers[0]?.metadata?.name ?? '';
  }, [lockProviderName, userSelectedPn, providers]);

  const effectivePn = useMemo(
    () =>
      providers.find((p) => String(p?.metadata?.name || '').trim() === String(effectiveProviderName).trim()),
    [providers, effectiveProviderName],
  );

  const providerOptions = useMemo(() => {
    const options: { label: string; value: string }[] = [];
    (providers || []).forEach((p) => {
      const name = String(p?.metadata?.name ?? '').trim();
      if (!name) return;
      const ann = p?.metadata?.annotations || {};
      const alias = String(ann[TOWER_IO_ALIES_ANNOTATION] || '').trim();
      const display = alias || name;
      const label = alias && alias !== name ? `${alias} (${name})` : display;
      options.push({ label, value: name });
    });
    return options;
  }, [providers]);

  const pnAnn = effectivePn?.metadata?.annotations || {};
  const pnDisplayName = String(pnAnn[TOWER_IO_ALIES_ANNOTATION] || '').trim();
  const pnMetaName = String(effectivePn?.metadata?.name || '').trim();
  const pnCustom = Array.isArray(effectivePn?.spec?.customInterfaces) ? effectivePn.spec.customInterfaces : [];

  const pnOriginNics = useMemo(() => {
    const ann = effectivePn?.metadata?.annotations as Record<string, string> | undefined;
    return parseProviderNetworkOriginNics(ann);
  }, [effectivePn]);

  const pnOriginNicsDescriptionText = useMemo(
    () => (pnOriginNics?.bondFromAnnotation ? formatOriginNicsDetailLines(pnOriginNics, undefined) : null),
    [pnOriginNics],
  );

  const pnStatusVlanIds = useMemo(() => {
    const raw = effectivePn?.status?.vlans;
    if (!Array.isArray(raw)) return [] as string[];
    return raw.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
  }, [effectivePn]);

  const drawerExtra = (
    <Space>
      <Button size="small" loading={providersLoading} onClick={() => void loadProviders()}>
        刷新
      </Button>
    </Space>
  );

  return (
    <Drawer
      title="物理网络详情"
      extra={drawerExtra}
      placement="right"
      width="min(1000px, 96vw)"
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <div style={TAB_PANEL_NETWORK}>
        {!lockProviderName && (
          <div>
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
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="显示名称">{pnDisplayName || '—'}</Descriptions.Item>
            <Descriptions.Item label="资源 ID">
              {pnMetaName ? (
                <Typography.Text copyable={{ text: pnMetaName }} code style={{ fontSize: 13 }}>
                  {pnMetaName}
                </Typography.Text>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="UID">
              {effectivePn?.metadata?.uid ? (
                <Typography.Text copyable={{ text: String(effectivePn.metadata.uid) }} code style={{ fontSize: 13 }}>
                  {String(effectivePn.metadata.uid)}
                </Typography.Text>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="默认接口">
              <Space size={4} wrap align="start">
                {String(effectivePn?.spec?.defaultInterface || '').trim() ? (
                  <Tag>{String(effectivePn?.spec?.defaultInterface || '').trim()}</Tag>
                ) : (
                  <span style={{ color: '#999' }}>—</span>
                )}
                {pnOriginNics?.bondFromAnnotation ? <Tag color="processing">Bond</Tag> : null}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="网卡 Bond">
              {pnOriginNics?.bondFromAnnotation ? (
                pnOriginNicsDescriptionText ? (
                  <div
                    style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,0.85)' }}
                  >
                    {pnOriginNicsDescriptionText}
                  </div>
                ) : (
                  '—'
                )
              ) : (
                <span style={{ color: '#999' }}>未在注解中声明</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="自定义映射">
              {pnCustom.length ? (
                <span style={{ wordBreak: 'break-word' }}>
                  {pnCustom.map((ci: any, i: number) => {
                    const iface = String(ci?.interface ?? ci?.name ?? '').trim();
                    const nodes = Array.isArray(ci?.nodes) ? ci.nodes : [];
                    return (
                      <span key={`${iface}-${i}`} style={{ display: 'block', marginBottom: 4 }}>
                        <Typography.Text code>{iface || '—'}</Typography.Text>
                        {nodes.length ? (
                          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                            → {nodes.join(', ')}
                          </Typography.Text>
                        ) : null}
                      </span>
                    );
                  })}
                </span>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="关联 VLAN">
              {pnStatusVlanIds.length ? (
                <span>
                  {pnStatusVlanIds.map((v) => (
                    <Tag key={v} color="blue" style={{ marginBottom: 4 }}>
                      {v}
                    </Tag>
                  ))}
                </span>
              ) : (
                <span style={{ color: '#999' }}>无</span>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {effectivePn?.metadata?.creationTimestamp
                ? dayjs(effectivePn.metadata.creationTimestamp).format('YYYY-MM-DD HH:mm:ss')
                : '—'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </div>
    </Drawer>
  );
};

export default ProviderNetworkDetailDrawer;
