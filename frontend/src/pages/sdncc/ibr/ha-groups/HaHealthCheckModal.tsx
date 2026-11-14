import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Progress, message } from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  ClusterOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  fetchIbrHaGroupLive,
  type IbrHaGroup,
  type IbrHaGroupLiveMember,
  type IbrHaGroupLiveReport,
} from '../../../../services/ibrHaGroupApi';
import { getApiErrorMessage } from '../../../../services/api';
import { readSideFromIntent, sideLabel } from './haGroupWizardLib';
import './HaHealthCheckModal.css';

type UiStatus = 'wait' | 'process' | 'finish' | 'error' | 'skip';

type UiStep = {
  key: 'role' | 'track' | 'vip';
  title: string;
  status: UiStatus;
  description?: string;
};

type Props = {
  open: boolean;
  group: IbrHaGroup | null;
  onClose: () => void;
};

const INITIAL_STEPS: UiStep[] = [
  { key: 'role', title: '主备角色', status: 'wait', description: '' },
  { key: 'track', title: 'Track 可达', status: 'wait', description: '' },
  { key: 'vip', title: 'VIP 挂载', status: 'wait', description: '' },
];

const STEP_HINT: Record<UiStep['key'], string> = {
  role: '读取两台 CE 的 keepalived 实例 State，期望一主一备',
  track: '读取 Sync Group Script Status，并展示 track 网关',
  vip: 'MASTER 上本组每条 VIP 均应为 scope global set；BACKUP 任一条已挂载则失败',
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stepIcon(key: UiStep['key']) {
  if (key === 'role') return <SwapOutlined />;
  if (key === 'track') return <NodeIndexOutlined />;
  return <ClusterOutlined />;
}

function statusLabel(status: UiStatus): string {
  if (status === 'finish') return '通过';
  if (status === 'error') return '未通过';
  if (status === 'process') return '检查中';
  if (status === 'skip') return '跳过';
  return '待检';
}

function lifecycleText(status?: string | null): string {
  if (status === 'configured') return '已配置';
  if (status === 'degraded') return '降级';
  if (status === 'draft') return '草稿';
  return status || '—';
}

function trackLabel(status: string | null | undefined): { text: string; tone: 'ok' | 'bad' | 'muted' } {
  const raw = String(status || '').trim();
  if (!raw) return { text: '未读到', tone: 'muted' };
  if (/^good$/i.test(raw)) return { text: '可达', tone: 'ok' };
  if (/^fault$/i.test(raw)) return { text: '不可达', tone: 'bad' };
  return { text: raw, tone: 'muted' };
}

/** 组1 · vrid 1  /  组1 · vrid 1,2；组2 · vrid 3 */
function formatVrrpBrief(live?: IbrHaGroupLiveMember): string {
  if (!live) return '—';
  const groupIds = Array.isArray(live.groupIds) ? live.groupIds.filter((n) => Number.isFinite(n)) : [];
  const vrids = Array.isArray(live.memberVrids)
    ? live.memberVrids.filter((n) => Number.isFinite(n))
    : live.vrid != null
      ? [live.vrid]
      : [];
  if (groupIds.length && vrids.length) {
    if (groupIds.length === 1) return `组${groupIds[0]} · vrid ${vrids.join(',')}`;
    return groupIds.map((g) => `组${g}`).join('、') + ` · vrid ${vrids.join(',')}`;
  }
  if (groupIds.length) return groupIds.map((g) => `组${g}`).join('、');
  if (vrids.length) return `vrid ${vrids.join(',')}`;
  return '未读到';
}

function memberByRole(
  group: IbrHaGroup | null,
  report: IbrHaGroupLiveReport | null,
  role: 'primary' | 'backup',
): { name: string; live?: IbrHaGroupLiveMember } {
  const live = report?.members.find((m) => m.role === role);
  const catalog = group?.members.find((m) => m.role === role);
  return {
    name: live?.name || catalog?.name || catalog?.vrUuid || live?.vrUuid || '—',
    live,
  };
}

const HaHealthCheckModal: React.FC<Props> = ({ open, group, onClose }) => {
  const [steps, setSteps] = useState<UiStep[]>(INITIAL_STEPS);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<IbrHaGroupLiveReport | null>(null);
  const runSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setSteps(INITIAL_STEPS);
    setReport(null);
    setRunning(false);
    runSeq.current += 1;
  }, [open, group?.id]);

  const passCount = steps.filter((s) => s.status === 'finish' || s.status === 'skip').length;
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
    if (!group?.id) return;
    const seq = ++runSeq.current;
    setRunning(true);
    setReport(null);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: 'wait', description: '' })));

    try {
      for (let i = 0; i < INITIAL_STEPS.length; i += 1) {
        if (runSeq.current !== seq) return;
        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: 'process', description: '正在读取设备 keepalived…' }
              : idx < i
                ? s
                : { ...s, status: 'wait', description: '' },
          ),
        );
        await sleep(140);
      }

      const nextReport = await fetchIbrHaGroupLive(group.id);
      if (runSeq.current !== seq) return;
      setReport(nextReport);

      const mapped: UiStep[] = INITIAL_STEPS.map((base) => {
        const step = nextReport.steps.find((s) => s.key === base.key);
        if (!step) return { ...base, status: 'wait', description: '无结果' };
        if (step.status === 'pass') return { ...base, status: 'finish', description: step.message };
        if (step.status === 'fail') return { ...base, status: 'error', description: step.message };
        return { ...base, status: 'skip', description: step.message };
      });

      for (let i = 0; i < mapped.length; i += 1) {
        if (runSeq.current !== seq) return;
        setSteps((prev) =>
          prev.map((s, idx) => {
            if (idx < i) return mapped[idx]!;
            if (idx === i) return mapped[i]!;
            return { ...s, status: 'process', description: '正在汇总…' };
          }),
        );
        await sleep(180);
      }
      if (runSeq.current !== seq) return;
      setSteps(mapped);

      const failed = nextReport.steps.filter((s) => s.status === 'fail').length;
      if (failed) message.warning(`巡检完成：${failed} 项未通过`);
      else message.success('巡检完成：全部通过');
    } catch (e) {
      if (runSeq.current !== seq) return;
      const errMsg = getApiErrorMessage(e, '巡检请求失败');
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

  const side = sideLabel(readSideFromIntent(group?.vrrpIntent) ?? undefined);
  const members: Array<{ role: 'primary' | 'backup'; intentLabel: string }> = [
    { role: 'primary', intentLabel: '意图主' },
    { role: 'backup', intentLabel: '意图备' },
  ];

  return (
    <Modal
      open={open}
      onCancel={() => {
        runSeq.current += 1;
        onClose();
      }}
      footer={null}
      destroyOnHidden
      width={680}
      centered
      className="ha-live-modal"
      closable
      title={null}
    >
      <div className="ha-live-shell">
        <header className="ha-live-hero">
          <div className="ha-live-hero-top">
            <div>
              <p className="ha-live-kicker">运行时诊断</p>
              <h3 className="ha-live-title">HA 组健康巡检</h3>
              <p className="ha-live-subtitle">
                {group?.name || '—'}
                <span style={{ margin: '0 8px', color: '#c9cdd4' }}>·</span>
                探测 keepalived：主备 · track · VIP
              </p>
            </div>
            <div className={`ha-live-score ${scoreTone}`} aria-live="polite">
              <div className="ha-live-score-value">{scoreValue}</div>
              <div className="ha-live-score-label">{scoreCaption}</div>
            </div>
          </div>
          <div className="ha-live-meta">
            <span className="ha-live-chip">
              侧 <strong>{side}</strong>
            </span>
            <span className="ha-live-chip">
              生命周期 <strong>{lifecycleText(report?.lifecycleStatus || group?.status)}</strong>
            </span>
            {report?.checkedAt ? (
              <span className="ha-live-chip">
                最近检查 <strong>{new Date(report.checkedAt).toLocaleString()}</strong>
              </span>
            ) : null}
          </div>
        </header>

        <div className="ha-live-body">
          <p className="ha-live-section-label">成员实时状态</p>
          <div className="ha-live-members">
            {members.map((slot) => {
              const { name, live } = memberByRole(group, report, slot.role);
              const state = String(live?.state || '').toUpperCase();
              const track = trackLabel(live?.trackStatus);
              const down = Boolean(live && !live.reachable);
              const master = state === 'MASTER';
              return (
                <div
                  key={slot.role}
                  className={`ha-live-member${down ? ' is-down' : master ? ' is-master' : ''}`}
                >
                  <div className="ha-live-member-role">{slot.intentLabel}</div>
                  <div className="ha-live-member-name" title={live?.vrUuid || name}>
                    {name}
                  </div>
                  <div className="ha-live-member-facts">
                    <div className="ha-live-fact">
                      <span className="ha-live-fact-k">实时角色</span>
                      <span className={`ha-live-fact-v${master ? ' is-ok' : ''}`}>
                        {!report ? '待探测' : down ? '不可达' : state || '无'}
                      </span>
                    </div>
                    <div className="ha-live-fact">
                      <span className="ha-live-fact-k">VRRP</span>
                      <span className="ha-live-fact-v">
                        {!report ? '待探测' : down ? '—' : formatVrrpBrief(live)}
                      </span>
                    </div>
                    <div className="ha-live-fact">
                      <span className="ha-live-fact-k">Track</span>
                      <span className={`ha-live-fact-v${track.tone === 'ok' ? ' is-ok' : track.tone === 'bad' ? ' is-bad' : ''}`}>
                        {!report
                          ? '待探测'
                          : down
                            ? live?.error || '不可达'
                            : live?.trackGateway
                              ? `${track.text} · ${live.trackGateway}`
                              : track.text}
                      </span>
                    </div>
                    <div className="ha-live-fact">
                      <span className="ha-live-fact-k">VIP</span>
                      <span className={`ha-live-fact-v${live?.vipInstalled ? ' is-ok' : ''}`}>
                        {!report
                          ? '待探测'
                          : down
                            ? '—'
                            : live?.virtualIps?.length
                              ? `${live.virtualIps.join(', ')}${live.vipInstalled ? ' · 已挂载' : ' · 未挂载'}`
                              : '未读到'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="ha-live-section-label">检查项</p>
          <div className="ha-live-progress-wrap">
            <Progress
              percent={running ? 88 : progressPercent}
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

          <div className="ha-live-checks">
            {steps.map((s) => {
              const desc = s.description || (s.status === 'wait' ? STEP_HINT[s.key] : '');
              const placeholder = !s.description && s.status === 'wait';
              return (
                <div key={s.key} className={`ha-live-check is-${s.status}`}>
                  <div className="ha-live-check-icon" aria-hidden>
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
                    <p className="ha-live-check-title">{s.title}</p>
                    <p className={`ha-live-check-desc${placeholder ? ' is-placeholder' : ''}`}>{desc}</p>
                  </div>
                  <span className={`ha-live-status is-${s.status}`}>{statusLabel(s.status)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="ha-live-footer">
          <div className="ha-live-footer-hint">
            经设备 local-web 调 clish「do show vrrp instances / groups」。不等于列表「配置健康」（VR2 意图对账）。
          </div>
          <div className="ha-live-footer-actions">
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

export default HaHealthCheckModal;
