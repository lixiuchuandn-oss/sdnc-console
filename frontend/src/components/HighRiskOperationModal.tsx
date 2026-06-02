import React from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Spin } from 'antd';

export type HighRiskAlertConfig = {
  type?: 'warning' | 'error' | 'info' | 'success';
  message: React.ReactNode;
  description?: React.ReactNode;
};

export type HighRiskOperationModalProps = {
  open: boolean;
  title: React.ReactNode;
  width?: number;
  loading?: boolean;
  submitting?: boolean;
  precheckError?: string | null;
  alert?: HighRiskAlertConfig;
  description?: React.ReactNode;
  /** 风险要点列表（展示为无序列表） */
  riskItems?: readonly string[];
  /** 预检/详情等自定义区块 */
  extra?: React.ReactNode;
  impactAck?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: React.ReactNode;
  };
  /** 输入资源名等方式二次确认（如维护模式 Force） */
  typeConfirm?: {
    expected: string;
    value: string;
    onChange: (value: string) => void;
    label?: React.ReactNode;
    placeholder?: string;
  };
  confirmText: React.ReactNode;
  cancelText?: string;
  canConfirm: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/**
 * 高风险操作确认弹窗（统一 UI：警告区 + 可选风险列表 + 影响确认 + 可选输入确认）。
 */
const HighRiskOperationModal: React.FC<HighRiskOperationModalProps> = ({
  open,
  title,
  width = 560,
  loading = false,
  submitting = false,
  precheckError = null,
  alert,
  description,
  riskItems,
  extra,
  impactAck,
  typeConfirm,
  confirmText,
  cancelText = '取消',
  canConfirm,
  onCancel,
  onConfirm,
}) => {
  const showConfirmFooter = !precheckError && !loading;

  const footer = showConfirmFooter ? (
    <Space style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
      <Button onClick={onCancel}>{cancelText}</Button>
      <Button
        type="primary"
        danger
        loading={submitting}
        disabled={!canConfirm}
        onClick={() => void onConfirm()}
      >
        {confirmText}
      </Button>
    </Space>
  ) : (
    <div style={{ textAlign: 'right' }}>
      <Button onClick={onCancel}>关闭</Button>
    </div>
  );

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      destroyOnClose
      forceRender
      width={width}
      maskClosable={false}
      keyboard={false}
      footer={footer}
    >
      <Spin spinning={loading}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: loading ? 96 : undefined,
          }}
        >
          {precheckError ? <Alert type="error" showIcon message={precheckError} /> : null}

          {!precheckError && !loading ? (
            <>
              {alert ? (
                <Alert
                  type={alert.type ?? 'warning'}
                  showIcon
                  message={alert.message}
                  description={alert.description}
                />
              ) : null}

              {description ? <div style={{ color: 'rgba(0,0,0,.85)' }}>{description}</div> : null}

              {riskItems && riskItems.length > 0 ? (
                <div
                  style={{
                    padding: '8px 12px',
                    border: '1px solid #ffe58f',
                    borderRadius: 6,
                    background: '#fffbe6',
                  }}
                >
                  <div style={{ marginBottom: 6, fontWeight: 500, color: 'rgba(0,0,0,.85)' }}>
                    风险提示
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 20, color: 'rgba(0,0,0,.65)' }}>
                    {riskItems.map((item) => (
                      <li key={item} style={{ marginBottom: 4 }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {extra}

              {typeConfirm ? (
                <div
                  style={{
                    padding: 12,
                    border: '1px solid #ffccc7',
                    borderRadius: 6,
                    background: '#fff2f0',
                  }}
                >
                  {typeConfirm.label ?? (
                    <div style={{ marginBottom: 6, color: 'rgba(0,0,0,.65)', fontSize: 13 }}>
                      请输入 <strong>{typeConfirm.expected}</strong> 以确认执行此操作：
                    </div>
                  )}
                  <Input
                    value={typeConfirm.value}
                    onChange={(e) => typeConfirm.onChange(e.target.value)}
                    placeholder={typeConfirm.placeholder ?? typeConfirm.expected}
                    autoComplete="off"
                  />
                </div>
              ) : null}

              {impactAck ? (
                <Checkbox
                  checked={impactAck.checked}
                  onChange={(e) => impactAck.onChange(e.target.checked)}
                >
                  {impactAck.label}
                </Checkbox>
              ) : null}
            </>
          ) : null}
        </div>
      </Spin>
    </Modal>
  );
};

export default HighRiskOperationModal;
