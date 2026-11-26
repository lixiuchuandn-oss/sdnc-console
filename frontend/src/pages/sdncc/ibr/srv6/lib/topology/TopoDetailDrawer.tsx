/**
 * SRv6 架构拓扑：右侧详情抽屉（点击节点 / 隧道）。
 */
import React from 'react';
import { Button, Descriptions, Drawer, Empty, List, Space, Tag, Typography } from 'antd';
import { abbrIfName, type Srv6Topology } from './buildTopology';
import {
  RUNTIME_COLOR,
  RUNTIME_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  isStopped,
  runtimeOf,
  tunnelEndUuids,
  tunnelPeOffline,
  tunnelStatus,
  type ConfigStatus,
  type RuntimeStatus,
  type Selection,
  type VrStatus,
} from './status';

const StatusTag: React.FC<{ status: ConfigStatus }> = ({ status }) => (
  <Tag color={status === 'ok' ? 'success' : status === 'issue' ? 'error' : status === 'repaired' ? 'warning' : 'default'}>
    {STATUS_LABEL[status]}
  </Tag>
);

const RuntimeTag: React.FC<{ runtime: RuntimeStatus }> = ({ runtime }) => (
  <Tag color={runtime === 'running' ? 'success' : runtime === 'stopped' ? 'error' : runtime === 'warning' ? 'warning' : 'default'}>
    {RUNTIME_LABEL[runtime]}
  </Tag>
);

const ROLE_TEXT: Record<string, string> = { hub: 'Hub PE', spoke: 'Spoke PE', pe: 'PE', ce: 'CE' };

type Props = {
  topo: Srv6Topology;
  selection: Selection;
  statusMap: Record<string, VrStatus>;
  runtimeMap: Record<string, RuntimeStatus>;
  nameOf: (uuid: string) => string;
  onClose: () => void;
  onSelectTunnel: (tunnelId: string) => void;
  onEnterTunnel: (tunnelId: string) => void;
};

const TopoDetailDrawer: React.FC<Props> = ({
  topo,
  selection,
  statusMap,
  runtimeMap,
  nameOf,
  onClose,
  onSelectTunnel,
  onEnterTunnel,
}) => {
  const open = !!selection;
  const st = (uuid: string): ConfigStatus => statusMap[uuid]?.status || 'unknown';
  const rt = (uuid: string): RuntimeStatus => runtimeOf(runtimeMap, uuid);
  const uuidOf = new Map(topo.nodes.map((n) => [n.id, n.uuid]));
  const roleOf = new Map(topo.nodes.map((n) => [n.uuid, n.role]));

  let title: React.ReactNode = '详情';
  let body: React.ReactNode = <Empty />;

  if (selection?.kind === 'tunnel') {
    const t = topo.tunnels.find((x) => x.id === selection.id);
    if (t) {
      const ends = tunnelEndUuids(topo, t.id);
      const attaches = topo.attaches.filter((a) => a.tunnelIds.includes(t.id));
      const offline = tunnelPeOffline(topo, t.id, runtimeMap);
      title = (
        <Space>
          {t.name}
          {t.focus ? <Tag color="blue">当前</Tag> : null}
          {offline ? <Tag color="error">端点离线</Tag> : null}
        </Space>
      );
      body = (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="配置态">
              <StatusTag status={tunnelStatus(topo, t.id, statusMap)} />
            </Descriptions.Item>
            <Descriptions.Item label="运行态">
              {offline ? <Tag color="error">端点离线</Tag> : <Tag color="success">端点在线</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="类型">{t.topology === 'H' ? 'Hub-Spoke' : '点对点'}</Descriptions.Item>
            <Descriptions.Item label={topo.mode === 'hub' ? 'Hub PE' : 'PE-A'}>{nameOf(t.sourceUuid)}</Descriptions.Item>
            <Descriptions.Item label={topo.mode === 'hub' ? 'Spoke PE' : 'PE-B'}>{nameOf(t.targetUuid)}</Descriptions.Item>
            {t.hubWanIf ? <Descriptions.Item label="Hub WAN">{abbrIfName(t.hubWanIf)}</Descriptions.Item> : null}
            {t.lanIf ? <Descriptions.Item label="Hub LAN">{t.lanIf}</Descriptions.Item> : null}
            {t.peerPublicNeighbor ? (
              <Descriptions.Item label="公网邻居">{t.peerPublicNeighbor}</Descriptions.Item>
            ) : null}
            {t.vrfMode ? (
              <Descriptions.Item label="VRF 模式">{t.vrfMode === 'REUSE_VRF' ? '复用 VRF' : '独立 VRF'}</Descriptions.Item>
            ) : null}
            {attaches.map((a) => (
              <Descriptions.Item key={a.id} label={`接入 ${nameOf(uuidOf.get(a.ceNodeId) || '')}`}>
                {a.innerIf ? abbrIfName(a.innerIf) : '-'}
              </Descriptions.Item>
            ))}
          </Descriptions>
          <Typography.Title level={5} style={{ marginTop: 16 }}>
            四端状态
          </Typography.Title>
          <List
            size="small"
            dataSource={ends}
            renderItem={(u) => (
              <List.Item>
                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                  <div className="srv6-topo-end-row">
                    <Space wrap size={6} className="srv6-topo-end-row-main">
                      <i className="srv6-topo-status-dot" style={{ background: STATUS_COLOR[st(u)] }} />
                      <span>{ROLE_TEXT[roleOf.get(u) || 'pe']}</span>
                      <b>{nameOf(u)}</b>
                      <StatusTag status={st(u)} />
                    </Space>
                    <RuntimeTag runtime={rt(u)} />
                  </div>
                  {(statusMap[u]?.issues || []).map((i) => (
                    <Typography.Text key={i.code + i.message} type="danger" style={{ fontSize: 12 }}>
                      [{i.code}] {i.message}
                    </Typography.Text>
                  ))}
                </Space>
              </List.Item>
            )}
          />
          {!t.focus ? (
            <Button type="primary" block style={{ marginTop: 12 }} onClick={() => onEnterTunnel(t.id)}>
              以此为入口
            </Button>
          ) : null}
        </>
      );
    }
  } else if (selection?.kind === 'node') {
    const n = topo.nodes.find((x) => x.id === selection.id);
    if (n) {
      const s = statusMap[n.uuid];
      title = (
        <Space>
          <span>{ROLE_TEXT[n.role]}</span>
          {nameOf(n.uuid)}
          {isStopped(rt(n.uuid)) ? <Tag color="error">已停止</Tag> : null}
        </Space>
      );
      body = (
        <>
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="UUID">
              <Typography.Text copyable style={{ fontSize: 12 }}>
                {n.uuid}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="配置态">
              <StatusTag status={st(n.uuid)} />
            </Descriptions.Item>
            <Descriptions.Item label="运行状态">
              <RuntimeTag runtime={rt(n.uuid)} />
            </Descriptions.Item>
            <Descriptions.Item label="关联隧道">{n.tunnelIds.length} 条</Descriptions.Item>
          </Descriptions>
          {s?.issues?.length ? (
            <List
              size="small"
              style={{ marginTop: 12 }}
              header="对账差异"
              dataSource={s.issues}
              renderItem={(i) => (
                <List.Item>
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    [{i.code}] {i.message}
                  </Typography.Text>
                </List.Item>
              )}
            />
          ) : null}
          <List
            size="small"
            style={{ marginTop: 12 }}
            header="关联隧道"
            dataSource={topo.tunnels.filter((t) => n.tunnelIds.includes(t.id))}
            renderItem={(t) => (
              <List.Item
                actions={[
                  <Button key="v" type="link" size="small" onClick={() => onSelectTunnel(t.id)}>
                    查看
                  </Button>,
                ]}
              >
                <Space>
                  <i
                    className="srv6-topo-status-dot"
                    style={{
                      background: tunnelPeOffline(topo, t.id, runtimeMap)
                        ? RUNTIME_COLOR.stopped
                        : STATUS_COLOR[tunnelStatus(topo, t.id, statusMap)],
                    }}
                  />
                  {t.name}
                  {t.focus ? <Tag color="blue">当前</Tag> : null}
                  {tunnelPeOffline(topo, t.id, runtimeMap) ? <Tag color="error">端点离线</Tag> : null}
                </Space>
              </List.Item>
            )}
          />
        </>
      );
    }
  }

  return (
    <Drawer title={title} open={open} onClose={onClose} width={420} mask={false} destroyOnHidden>
      {body}
    </Drawer>
  );
};

export default TopoDetailDrawer;
