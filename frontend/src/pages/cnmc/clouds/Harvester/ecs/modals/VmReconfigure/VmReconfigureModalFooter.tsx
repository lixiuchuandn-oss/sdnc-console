/**
 * 资源变配弹窗底部操作区（从 VmReconfigureModal 抽出）。
 */
import React, { useCallback } from 'react';
import { Button, Checkbox, Modal } from 'antd';
import type { FormInstance } from 'antd/es/form';

export type VmReconfigureModalFooterProps = {
  form: FormInstance<any>;
  selectedKey: string;
  onClose: () => void;
  handleSubmit: () => void | Promise<void>;
  okText: string;
  isHotPlugInProgress: boolean;
  newDiskCreated: boolean | undefined;
  newCdromCreated: boolean | undefined;
  newDiskSource: string | undefined;
  changeOsConfirmed: boolean | undefined;
  diskCreating: boolean;
  diskAttaching: boolean;
  cdromCreating: boolean;
  cdromAttaching: boolean;
  handleCreateDisk: () => void | Promise<void>;
  handleAttachDisk: () => void | Promise<void>;
  handleCreateCdrom: () => void | Promise<void>;
  handleAttachCdrom: () => void | Promise<void>;
};

function showChangeOsRiskModal(form: FormInstance<any>) {
  Modal.info({
    title: '更换系统盘风险说明',
    width: 520,
    content: (
      <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
        <p style={{ marginBottom: 4 }}>• 更换操作系统将删除当前的系统盘并重建实例，系统盘数据将会丢失。</p>
        <p style={{ marginBottom: 4 }}>• 挂载的数据盘将被保留，但在新系统启动后可能需要手动重新挂载。</p>
        <p style={{ marginBottom: 0 }}>• 虚拟机将会强制重启以应用更改，请在业务低峰期执行。</p>
      </div>
    ),
    okText: '我已知晓',
    onOk: () => {
      try {
        form.setFieldsValue({ changeOsConfirmed: true });
      } catch {
        /* ignore */
      }
    },
  });
}

export const VmReconfigureModalFooter: React.FC<VmReconfigureModalFooterProps> = (p) => {
  const onShowChangeOsRisk = useCallback(() => showChangeOsRiskModal(p.form), [p.form]);

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
      {p.selectedKey === 'add_disk' ? (
        <>
          <Button onClick={p.onClose}>取消</Button>
          <Button
            type="primary"
            onClick={p.handleCreateDisk}
            loading={p.diskCreating}
            disabled={p.diskAttaching || !!p.newDiskCreated || p.newDiskSource === 'existing'}
          >
            创建磁盘
          </Button>
          <Button
            type="primary"
            onClick={p.handleAttachDisk}
            loading={p.diskAttaching}
            disabled={p.diskCreating || !p.newDiskCreated}
          >
            挂载磁盘
          </Button>
        </>
      ) : p.selectedKey === 'add_cdrom' ? (
        <>
          <Button onClick={p.onClose}>取消</Button>
          <Button
            type="primary"
            onClick={p.handleCreateCdrom}
            loading={p.cdromCreating}
            disabled={p.cdromAttaching || !!p.newCdromCreated}
          >
            创建光盘卷
          </Button>
          <Button
            type="primary"
            onClick={p.handleAttachCdrom}
            loading={p.cdromAttaching}
            disabled={p.cdromCreating || !p.newCdromCreated}
          >
            挂载光盘
          </Button>
        </>
      ) : p.selectedKey === 'change_os' ? (
        <>
          <Checkbox checked={!!p.changeOsConfirmed} disabled>
            已确认风险
          </Checkbox>
          <Button type="link" onClick={onShowChangeOsRisk} style={{ paddingLeft: 0 }}>
            查看风险信息
          </Button>
          <Button onClick={p.onClose}>取消</Button>
          <Button
            type="primary"
            onClick={p.handleSubmit}
            disabled={p.isHotPlugInProgress || !p.changeOsConfirmed}
          >
            {p.okText}
          </Button>
        </>
      ) : (
        <>
          <Button onClick={p.onClose}>取消</Button>
          <Button type="primary" onClick={p.handleSubmit} disabled={p.isHotPlugInProgress}>
            {p.okText}
          </Button>
        </>
      )}
    </div>
  );
};
