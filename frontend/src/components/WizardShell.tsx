import React from 'react';
import { Modal, Steps, Typography, Divider } from 'antd';
import type { ModalProps } from 'antd';
import type { StepProps } from 'antd/es/steps';

export const WizardModal: React.FC<{
  open: boolean;
  onCancel: () => void;
  title?: React.ReactNode;
  width?: number | string;
  bodyVh?: number;
  centered?: boolean;
  footer?: ModalProps['footer'];
  children?: React.ReactNode;
  bodyPaddingTop?: number;
}> = ({ open, onCancel, title, width = '70vw', bodyVh = 75, centered = true, footer = null, children, bodyPaddingTop = 12 }) => {
  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      destroyOnClose
      footer={footer}
      width={width}
      centered={centered}
      styles={{ body: { height: `${bodyVh}vh`, maxHeight: `${bodyVh}vh`, overflow: 'hidden', paddingTop: bodyPaddingTop } }}
    >
      {children}
    </Modal>
  );
};

export const WizardSteps: React.FC<{
  current: number;
  items: Array<{ title: string; description?: string }>;
  onChange?: (index: number) => void;
}> = ({ current, items, onChange }) => {
  const stepsItems: StepProps[] = items.map((it) => ({ title: it.title, description: it.description }));
  return (
    <Steps
      direction="vertical"
      size="small"
      current={current}
      onChange={(i) => onChange && onChange(i)}
      items={stepsItems}
    />
  );
};

export const WizardLayout: React.FC<{
  leftTitle?: React.ReactNode;
  steps: Array<{ title: string; description?: string }>;
  current: number;
  onStepChange?: (index: number) => void;
  children?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ leftTitle, steps, current, onStepChange, children, right }) => {
  const { Title, Text } = Typography;
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 240, background: '#fafafa', borderRight: '1px solid #f0f0f0', padding: '32px 24px', display: 'flex', flexDirection: 'column' }}>
        {leftTitle && (
          <div style={{ marginBottom: 32, paddingLeft: 8 }}>
            {typeof leftTitle === 'string' ? <Title level={4} style={{ margin: 0 }}>{leftTitle}</Title> : leftTitle}
            {typeof leftTitle === 'string' ? <Text type="secondary" style={{ fontSize: 12 }}>Wizard</Text> : null}
          </div>
        )}
        <WizardSteps current={current} items={steps} onChange={onStepChange} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, padding: 24 }}>
          {children}
        </div>
      </div>
      {right && (
        <div style={{ width: 320, borderLeft: '1px solid #f0f0f0', padding: 16 }}>
          {right}
        </div>
      )}
    </div>
  );
};
