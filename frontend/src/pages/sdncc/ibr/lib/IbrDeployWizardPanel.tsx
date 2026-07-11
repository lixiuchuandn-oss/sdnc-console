import React from 'react';
import { Button, Card } from 'antd';
import type { IbrDeployWizardStep } from './vrConfigDeployFlow';
import type { IbrDeployWizardStatus } from './useIbrDeployWizard';

export type IbrDeployWizardPanelProps = {
  title?: string;
  hint?: string;
  steps: IbrDeployWizardStep[];
  activeStep: number;
  logs: Record<number, string>;
  status: Record<number, IbrDeployWizardStatus>;
  onRunStep: (index: number) => void;
};

const statusColor = (s?: IbrDeployWizardStatus) => {
  if (s === 'finish') return '#52c41a';
  if (s === 'error') return '#ff4d4f';
  if (s === 'process') return '#1677ff';
  return '#d9d9d9';
};

/** 统一 IBR 下发向导步骤列表 UI */
const IbrDeployWizardPanel: React.FC<IbrDeployWizardPanelProps> = ({
  title = '下发向导',
  hint = '进入本页后将自动依次执行各步；某步失败时可点击该步「执行」重试。',
  steps,
  activeStep,
  logs,
  status,
  onRunStep,
}) => (
  <div>
    <div style={{ marginBottom: 16, fontSize: 16, fontWeight: 600, color: '#1f1f1f' }}>{title}</div>
    {hint ? (
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>{hint}</div>
    ) : null}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {steps.map((step, idx) => (
        <Card
          key={`${step.kind}-${step.vrId}-${idx}`}
          size="small"
          type="inner"
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: statusColor(status[idx]),
                  color: '#fff',
                  textAlign: 'center',
                  lineHeight: '24px',
                  fontSize: 12,
                }}
              >
                {idx + 1}
              </div>
              <span>{step.title}</span>
              <span style={{ fontSize: 12, color: '#888', fontWeight: 'normal' }}>{step.desc}</span>
            </div>
          }
          extra={
            <Button
              type="primary"
              size="small"
              disabled={idx !== activeStep}
              loading={status[idx] === 'process'}
              onClick={() => onRunStep(idx)}
            >
              执行
            </Button>
          }
        >
          {logs[idx] ? (
            <pre
              style={{
                fontSize: 12,
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                background: '#1e1e1e',
                color: '#d4d4d4',
                padding: 12,
                borderRadius: 6,
                overflow: 'auto',
                maxHeight: 200,
                border: 'none',
                marginTop: 0,
              }}
            >
              {logs[idx]}
            </pre>
          ) : null}
        </Card>
      ))}
    </div>
  </div>
);

export default IbrDeployWizardPanel;
