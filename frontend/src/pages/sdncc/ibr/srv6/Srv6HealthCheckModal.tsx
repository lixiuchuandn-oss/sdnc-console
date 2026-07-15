import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Progress, message } from 'antd';
import {
  BranchesOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ClusterOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  RadarChartOutlined,
} from '@ant-design/icons';
import type { Srv6TunnelHealthReport } from '../../../../services/api';
import './Srv6HealthCheckModal.css';

export type Srv6HealthUiStatus = 'wait' | 'process' | 'finish' | 'error';

export type Srv6HealthUiStep = {
  key: string;
  title: string;
  status: Srv6HealthUiStatus;
  description?: string;
};

type TunnelLite = {
  id: string;
  name: string;
  peA: string;
  peB: string;
  ceA: string;
  ceB: string;
  status: string;
  tunnelTopology?: 'S' | 'H' | null;
};

type Props = {
  open: boolean;
  tunnel: TunnelLite | null;
  vrLabel: (uuid?: string | null) => string;
  onClose: () => void;
};

const INITIAL_STEPS: Srv6HealthUiStep[] = [
  { key: 'bgp', title: 'BGP 公网邻居', status: 'wait', description: '' },
  { key: 'privateBgp', title: 'BGP 私网邻居', status: 'wait', description: '' },
  { key: 'dataplane', title: 'SRv6 数据面', status: 'wait', description: '' },
  { key: 'ceReach', title: 'CE A → CE B 可达性', status: 'wait', description: '' },
];

const STEP_HINT: Record<string, string> = {
  bgp: '读取 PE 设备 BGP summary，校验公网邻居 Established',
  privateBgp: '校验 PE–CE / CE–PE 私网邻居会话状态',
  dataplane: '核对 PE 侧 SID / IPv6 路由是否按档案存在',
  ceReach: 'CE 双向 Ping（clish do ping，双方 LAN IPv4）',
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stepIcon(key: string) {
  switch (key) {
    case 'bgp':
      return <ClusterOutlined />;
    case 'privateBgp':
      return <NodeIndexOutlined />;
    case 'dataplane':
      return <BranchesOutlined />;
    case 'ceReach':
      return <RadarChartOutlined />;
    default:
      return <ClusterOutlined />;
  }
}

function statusLabel(status: Srv6HealthUiStatus): string {
  if (status === 'finish') return '通过';
  if (status === 'error') return '未通过';
  if (status === 'process') return '检查中';
  return '待检';
}

export const Srv6HealthCheckModal: React.FC<Props> = ({ open, tunnel, vrLabel, onClose }) => {
  const [steps, setSteps] = useState<Srv6HealthUiStep[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Srv6TunnelHealthReport | null>(null);
  const runSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setSteps(INITIAL_STEPS);
    setReport(null);
    setRunning(false);
    runSeq.current += 1;
  }, [open, tunnel?.id]);

  const passCount = steps.filter((s) => s.status === 'finish').length;
  const failCount = steps.filter((s) => s.status === 'error').length;
  const done = Boolean(report) && !running;
  const total = steps.length;

  const scoreTone = useMemo(() => {
    if (running) return 'is-run';
    if (!done) return 'is-idle';
    return failCount > 0 ? 'is-bad' : 'is-ok';
  }, [running, done, failCount]);

  const scoreValue = useMemo(() => {
    if (running) return '…';
    if (!done) return '—';
    return `${passCount}/${total}`;
  }, [running, done, passCount, total]);

  const scoreCaption = useMemo(() => {
    if (running) return '巡检中';
    if (!done) return '未开始';
    return failCount > 0 ? '存在异常' : '全部通过';
  }, [running, done, failCount]);

  const progressPercent = useMemo(() => {
    if (running) return undefined;
    if (!done) return 0;
    return Math.round((passCount / Math.max(total, 1)) * 100);
  }, [running, done, passCount, total]);

  const startHealthCheck = async () => {
    if (!tunnel?.id) return;
    const seq = ++runSeq.current;
    setRunning(true);
    setReport(null);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'wait', description: '' })));

    try {
      // 先逐项进入「检查中」，形成分诊节奏；结果仍一次从后端返回
      for (let i = 0; i < INITIAL_STEPS.length; i += 1) {
        if (runSeq.current !== seq) return;
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: 'process', description: '正在探测设备…' }
              : idx < i
                ? s
                : { ...s, status: 'wait', description: '' },
          ),
        );
        await sleep(160);
      }

      const { fetchSrv6TunnelHealth } = await import('../../../../services/api');
      const nextReport = await fetchSrv6TunnelHealth(tunnel.id);
      if (runSeq.current !== seq) return;
      setReport(nextReport);

      const mapped: Srv6HealthUiStep[] = INITIAL_STEPS.map((base) => {
        const step = nextReport.steps.find((s) => s.key === base.key);
        if (!step) return { ...base, status: 'wait', description: '无结果' };
        if (step.status === 'pass') return { ...base, status: 'finish', description: step.message };
        if (step.status === 'fail') return { ...base, status: 'error', description: step.message };
        return { ...base, status: 'wait', description: step.message };
      });

      // 逐项揭晓结果
      for (let i = 0; i < mapped.length; i += 1) {
        if (runSeq.current !== seq) return;
        setSteps((prev) =>
          prev.map((s, idx) => {
            if (idx < i) return mapped[idx]!;
            if (idx === i) return mapped[i]!;
            return { ...s, status: 'process', description: '正在汇总…' };
          }),
        );
        await sleep(220);
      }
      if (runSeq.current !== seq) return;
      setSteps(mapped);

      const failed = nextReport.steps.filter((s) => s.status === 'fail').length;
      if (failed) message.warning(`巡检完成：${failed} 项未通过`);
      else message.success('巡检完成：全部通过');
    } catch (e: any) {
      if (runSeq.current !== seq) return;
      const errMsg = e?.message || '巡检请求失败';
      message.error(`巡检失败：${errMsg}`);
      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'error', description: errMsg })));
    } finally {
      if (runSeq.current === seq) setRunning(false);
    }
  };

  const reset = () => {
    runSeq.current += 1;
    setRunning(false);
    setReport(null);
    setSteps(INITIAL_STEPS);
  };

  // 业务路径顺序：CE-A → PE-A → PE-B → CE-B
  const endpoints = [
    { role: 'CE-A', uuid: tunnel?.ceA },
    { role: 'PE-A', uuid: tunnel?.peA },
    { role: 'PE-B', uuid: tunnel?.peB },
    { role: 'CE-B', uuid: tunnel?.ceB },
  ];

  const lifecycleText =
    tunnel?.status === 'available'
      ? '可用'
      : tunnel?.status === 'degraded'
        ? '已降级'
        : tunnel?.status === 'error'
          ? '异常'
          : tunnel?.status === 'deploying'
            ? '下发中'
            : tunnel?.status || '创建中';

  return (
    <Modal
      open={open}
      onCancel={() => {
        runSeq.current += 1;
        onClose();
      }}
      footer={null}
      destroyOnHidden
      width={760}
      centered
      className="srv6-health-modal"
      closable
      title={null}
    >
      <div className="srv6-health-shell">
        <header className="srv6-health-hero">
          <div className="srv6-health-hero-top">
            <div>
              <p className="srv6-health-kicker">运行时诊断</p>
              <h3 className="srv6-health-title">隧道健康巡检</h3>
              <p className="srv6-health-subtitle">
                {tunnel?.name || '—'}
                <span style={{ margin: '0 8px', color: '#c9cdd4' }}>·</span>
                运行时探测：BGP · SRv6 数据面 · CE LAN 互通
              </p>
            </div>
            <div className={`srv6-health-score ${scoreTone}`} aria-live="polite">
              <div className="srv6-health-score-value">{scoreValue}</div>
              <div className="srv6-health-score-label">{scoreCaption}</div>
            </div>
          </div>
          <div className="srv6-health-meta">
            <span className="srv6-health-chip">
              拓扑 <strong>{tunnel?.tunnelTopology === 'H' ? 'Spoke – Hub' : '点对点'}</strong>
            </span>
            <span className="srv6-health-chip">
              生命周期 <strong>{lifecycleText}</strong>
            </span>
            {report?.checkedAt ? (
              <span className="srv6-health-chip">
                最近检查 <strong>{new Date(report.checkedAt).toLocaleString()}</strong>
              </span>
            ) : null}
          </div>
        </header>

        <div className="srv6-health-body">
          <p className="srv6-health-section-label">端点</p>
          <div className="srv6-health-endpoints">
            {endpoints.map((ep) => (
              <div key={ep.role} className="srv6-health-endpoint" title={vrLabel(ep.uuid)}>
                <div className="srv6-health-endpoint-role">{ep.role}</div>
                <div className="srv6-health-endpoint-name">{vrLabel(ep.uuid)}</div>
              </div>
            ))}
          </div>

          <p className="srv6-health-section-label">检查项</p>
          <div className="srv6-health-progress-wrap">
            <Progress
              percent={running ? 92 : progressPercent}
              status={running ? 'active' : failCount > 0 ? 'exception' : done ? 'success' : 'normal'}
              showInfo={!running}
              strokeColor={
                failCount > 0 && done
                  ? '#f53f3f'
                  : done
                    ? '#00b42a'
                    : { from: '#69b1ff', to: '#1677ff' }
              }
              trailColor="#eef2f8"
              size="small"
            />
          </div>

          <div className="srv6-health-checks">
            {steps.map((s) => {
              const desc =
                s.description ||
                (s.status === 'wait' ? STEP_HINT[s.key] || '等待开始' : '');
              const placeholder = !s.description && s.status === 'wait';
              return (
                <div key={s.key} className={`srv6-health-check is-${s.status}`}>
                  <div className="srv6-health-check-icon" aria-hidden>
                    {s.status === 'process' ? (
                      <LoadingOutlined spin />
                    ) : s.status === 'finish' ? (
                      <CheckCircleFilled />
                    ) : s.status === 'error' ? (
                      <CloseCircleFilled />
                    ) : (
                      stepIcon(s.key)
                    )}
                  </div>
                  <div>
                    <p className="srv6-health-check-title">{s.title}</p>
                    <p className={`srv6-health-check-desc${placeholder ? ' is-placeholder' : ''}`}>
                      {desc}
                    </p>
                  </div>
                  <span className={`srv6-health-status is-${s.status}`}>{statusLabel(s.status)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="srv6-health-footer">
          <div className="srv6-health-footer-hint">
            需四端已上报管理口 IP。CE 互通经设备 local-web 调 clish「do ping」，非整机操作系统 ping。
          </div>
          <div className="srv6-health-footer-actions">
            <Button onClick={onClose}>关闭</Button>
            <Button disabled={running} onClick={reset}>
              重置
            </Button>
            <Button type="primary" loading={running} onClick={() => void startHealthCheck()}>
              {done || failCount || passCount ? '重新巡检' : '开始巡检'}
            </Button>
          </div>
        </footer>
      </div>
    </Modal>
  );
};

export default Srv6HealthCheckModal;
