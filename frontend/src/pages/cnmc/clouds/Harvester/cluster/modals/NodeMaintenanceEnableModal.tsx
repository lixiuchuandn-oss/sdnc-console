import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Divider, Input, Modal, Space, Spin, Tag, message } from 'antd';
import {
  enableNodeMaintenance,
  listNodeMaintenanceUnhealthyVms,
  precheckNodeMaintenance,
  type UnhealthyVmGroup,
} from 'services/harvester/nodeMaintenance';
import { getApiErrorMessage } from 'services/api';
import { nodeDisplayName } from '../lib/nodeMaintenanceStatus';
import type { NodeRow } from '../lib/nodesSectionUtils';

type Props = {
  open: boolean;
  node: NodeRow | null;
  cloudId: string;
  onClose: () => void;
  onSuccess: () => void;
};

const NodeMaintenanceEnableModal: React.FC<Props> = ({
  open,
  node,
  cloudId,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [precheckError, setPrecheckError] = useState<string | null>(null);
  const [possible, setPossible] = useState(false);
  const [unhealthyGroups, setUnhealthyGroups] = useState<UnhealthyVmGroup[]>([]);
  const [force, setForce] = useState(false);
  const [impactAck, setImpactAck] = useState(false);
  const [confirmNodeName, setConfirmNodeName] = useState('');

  const nodeName = nodeDisplayName(node);

  const resetFormState = useCallback(() => {
    setForce(false);
    setImpactAck(false);
    setConfirmNodeName('');
  }, []);

  const loadPrecheck = useCallback(async () => {
    if (!cloudId || !nodeName) return;
    setLoading(true);
    setPrecheckError(null);
    setPossible(false);
    setUnhealthyGroups([]);
    resetFormState();
    try {
      const res: any = await precheckNodeMaintenance(cloudId, nodeName);
      const data = res?.data ?? res;
      if (data?.possible === false) {
        setPrecheckError(String(data?.reason || '当前节点无法进入维护模式'));
        return;
      }
      setPossible(true);
      const vmRes: any = await listNodeMaintenanceUnhealthyVms(cloudId, nodeName);
      const items = vmRes?.data?.items ?? vmRes?.items ?? [];
      setUnhealthyGroups(Array.isArray(items) ? items : []);
    } catch (e: any) {
      setPrecheckError(String(e?.message || '预检失败'));
    } finally {
      setLoading(false);
    }
  }, [cloudId, nodeName, resetFormState]);

  useEffect(() => {
    if (open && nodeName) void loadPrecheck();
  }, [open, nodeName, loadPrecheck]);

  const hasBlockers = unhealthyGroups.some((g) => (g.vms?.length ?? 0) > 0);
  const nameConfirmed = !force || confirmNodeName.trim() === nodeName;
  const canSubmit =
    possible &&
    impactAck &&
    nameConfirmed &&
    (!hasBlockers || force) &&
    !loading &&
    !precheckError &&
    !submitting;

  const showConfirmFooter = possible && !precheckError && !loading;

  const handleSubmit = async () => {
    if (!canSubmit || !nodeName) return;
    setSubmitting(true);
    try {
      await enableNodeMaintenance(cloudId, nodeName, force);
      onSuccess();
      onClose();
    } catch (e) {
      message.error(getApiErrorMessage(e, '进入维护模式失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const footer = showConfirmFooter ? (
    <Space style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
      <Button onClick={onClose}>取消</Button>
      <Button type="primary" danger loading={submitting} disabled={!canSubmit} onClick={() => void handleSubmit()}>
        确认进入维护模式
      </Button>
    </Space>
  ) : (
    <div style={{ textAlign: 'right' }}>
      <Button onClick={onClose}>关闭</Button>
    </div>
  );

  return (
    <Modal
      title={`进入维护模式 · ${nodeName || '—'}`}
      open={open}
      onCancel={onClose}
      destroyOnClose
      width={560}
      maskClosable={false}
      keyboard={false}
      footer={footer}
    >
      <Spin spinning={loading}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: loading ? 96 : undefined }}>
          {precheckError ? <Alert type="error" showIcon message={precheckError} /> : null}

          {possible && !precheckError ? (
            <>
              <Alert
                type="warning"
                showIcon
                message="确认后将开始驱逐 / 迁移工作负载"
                description="节点将被 cordon；虚拟机按策略热迁移或关机。请核对下方预检结果后再确认。"
              />

              {!hasBlockers ? (
                <Alert type="success" showIcon message="预检通过：未发现阻塞迁移的虚拟机" />
              ) : (
                <>
                  <Alert
                    type="warning"
                    showIcon
                    message="以下虚拟机无法迁移，将阻塞进入维护模式"
                    description="可勾选「强制」关机所有虚拟机后进入；该操作会覆盖各 VM 的 maintain-mode-strategy 设置。"
                  />
                  {!force ? (
                    <div
                      style={{
                        maxHeight: 200,
                        overflow: 'auto',
                        padding: '8px 12px',
                        border: '1px solid #e5e6eb',
                        borderRadius: 6,
                        background: '#fafafa',
                      }}
                    >
                      {unhealthyGroups.map((g, idx) => (
                        <div key={`${idx}-${g.message}`} style={{ marginBottom: idx < unhealthyGroups.length - 1 ? 12 : 0 }}>
                          <div style={{ marginBottom: 6, color: 'rgba(0,0,0,.65)', fontSize: 13 }}>{g.message}</div>
                          <Space size={[4, 4]} wrap>
                            {(g.vms?.length ? g.vms : ['—']).map((vm) => (
                              <Tag key={`${idx}-${vm}`}>{vm}</Tag>
                            ))}
                          </Space>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}

              <Divider style={{ margin: '4px 0' }} />

              <Checkbox
                checked={force}
                onChange={(e) => {
                  setForce(e.target.checked);
                  if (!e.target.checked) setConfirmNodeName('');
                }}
              >
                强制（Force）：关机节点上所有虚拟机后进入维护模式
              </Checkbox>

              {force ? (
                <div
                  style={{
                    padding: '12px',
                    border: '1px solid #ffccc7',
                    borderRadius: 6,
                    background: '#fff2f0',
                  }}
                >
                  <div style={{ marginBottom: 8, color: 'rgba(0,0,0,.85)' }}>
                    强制模式将关机节点上全部虚拟机，且覆盖各 VM 的 maintain-mode-strategy。
                  </div>
                  <div style={{ marginBottom: 6, color: 'rgba(0,0,0,.65)', fontSize: 13 }}>
                    请输入节点名称 <strong>{nodeName}</strong> 以确认：
                  </div>
                  <Input
                    value={confirmNodeName}
                    onChange={(e) => setConfirmNodeName(e.target.value)}
                    placeholder={nodeName}
                    autoComplete="off"
                  />
                </div>
              ) : null}

              <Checkbox checked={impactAck} onChange={(e) => setImpactAck(e.target.checked)}>
                我已了解影响，确认对节点「{nodeName}」进入维护模式
              </Checkbox>
            </>
          ) : null}
        </div>
      </Spin>
    </Modal>
  );
};

export default NodeMaintenanceEnableModal;
