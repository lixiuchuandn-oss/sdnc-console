import React, { useEffect, useState } from 'react';
import { Button, Modal, Spin, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '../../../../services/api';
import {
  deleteVrInstanceOnPlatform,
  previewVrInstanceDelete,
  type VrInstanceBinder,
  type VrInstanceDeletePreview,
} from '../../../../services/vrInstanceDeleteApi';

const BINDER_LABEL: Record<VrInstanceBinder['type'], string> = {
  srv6: 'SRv6 隧道',
  ha: 'HA 组',
  ipsec: 'IPsec',
};

const REAPPEAR_HINT = '删除后设备可能再次出现在列表中，请用登记时间区分。';

type Props = {
  open: boolean;
  uuid: string;
  label: string;
  onClose: () => void;
  onDeleted: () => Promise<void> | void;
};

const binderError = (
  err: unknown,
): { binders: VrInstanceBinder[]; message: string } | null => {
  const e = err as { status?: number; binders?: VrInstanceBinder[]; responseData?: { binders?: VrInstanceBinder[] } };
  const binders = e?.binders ?? e?.responseData?.binders;
  if (e?.status === 409 && Array.isArray(binders) && binders.length) {
    return { binders, message: getApiErrorMessage(err, '该实例仍被其它业务引用') };
  }
  return null;
};

const DeleteVrInstanceModal: React.FC<Props> = ({ open, uuid, label, onClose, onDeleted }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<VrInstanceDeletePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [blockedBinders, setBlockedBinders] = useState<VrInstanceBinder[]>([]);

  useEffect(() => {
    if (!open || !uuid) return;
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setLoadError(null);
    setBlockedBinders([]);
    previewVrInstanceDelete(uuid)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
        setBlockedBinders(data.binders || []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const blocked = binderError(err);
        if (blocked) {
          setBlockedBinders(blocked.binders);
          setLoadError(blocked.message);
          return;
        }
        setLoadError(getApiErrorMessage(err, '暂时无法读取实例状态，请稍后重试'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, uuid]);

  const goBinder = (binder: VrInstanceBinder) => {
    onClose();
    navigate(binder.href);
  };

  const renderBinders = (binders: VrInstanceBinder[]) => (
    <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
      {binders.map((b) => (
        <li key={`${b.type}-${b.id}`} style={{ marginBottom: 6 }}>
          <span>
            {BINDER_LABEL[b.type] || b.type}：{b.name}
            {b.detail ? `（${b.detail}）` : ''}
          </span>
          <Button type="link" size="small" onClick={() => goBinder(b)}>
            去处理
          </Button>
        </li>
      ))}
    </ul>
  );

  const handleOk = async () => {
    const canDelete = Boolean(preview && (preview.hasSnapshot || preview.neverConfigured));
    if (!preview || blockedBinders.length || !canDelete) return;
    setSubmitting(true);
    const hideWait = message.loading({
      content: '正在删除…',
      key: 'vr_delete',
      duration: 0,
    });
    try {
      const resp = await deleteVrInstanceOnPlatform(uuid, {
        acknowledgeDrift: Boolean(preview.hasSnapshot),
      });
      const payload = (resp?.data ?? resp) as {
        registrationFinishCleared?: boolean;
        registrationClearError?: string;
      };
      hideWait();
      if (payload?.registrationFinishCleared) {
        message.success({
          content: '已删除',
          key: 'vr_delete',
        });
      } else {
        message.warning({
          content: '已删除。请刷新列表确认。',
          key: 'vr_delete',
          duration: 8,
        });
      }
      onClose();
      await onDeleted();
    } catch (err: unknown) {
      hideWait();
      const blocked = binderError(err);
      if (blocked) {
        setBlockedBinders(blocked.binders);
        message.error(blocked.message);
        return;
      }
      message.error(getApiErrorMessage(err, '删除失败'));
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const binders = blockedBinders.length ? blockedBinders : preview?.binders || [];
  const blocked = binders.length > 0;
  const leftover = Boolean(preview && !preview.hasSnapshot && !preview.neverConfigured);
  const canDelete = Boolean(preview && (preview.hasSnapshot || preview.neverConfigured) && !blocked && !loadError);
  const okClosesOnly = blocked || leftover || Boolean(loadError);
  const conflicts = preview?.conflicts || [];

  return (
    <Modal
      title={okClosesOnly ? '无法删除该 IBR 实例' : '删除 IBR 实例'}
      open={open}
      onCancel={onClose}
      onOk={okClosesOnly ? onClose : handleOk}
      okText="确定"
      okButtonProps={{
        danger: canDelete,
        disabled: loading,
      }}
      confirmLoading={submitting}
      cancelText="取消"
      destroyOnHidden
      width={560}
    >
      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      ) : (
        <div>
          <Typography.Paragraph>
            目标实例：<b>{label}</b>
          </Typography.Paragraph>
          {blocked ? (
            <>
              <Typography.Paragraph>该实例仍被其它业务引用，请先处理后再删除。</Typography.Paragraph>
              {renderBinders(binders)}
            </>
          ) : loadError ? (
            <Typography.Paragraph type="danger">{loadError}</Typography.Paragraph>
          ) : preview?.hasSnapshot ? (
            <>
              <Typography.Paragraph>删除后设备将恢复为配置角色前的状态。</Typography.Paragraph>
              {conflicts.length > 0 ? (
                <Typography.Paragraph>当前设备配置与恢复目标不一致，确认后将覆盖。</Typography.Paragraph>
              ) : null}
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {REAPPEAR_HINT}
              </Typography.Paragraph>
            </>
          ) : preview?.neverConfigured ? (
            <>
              <Typography.Paragraph>该实例尚未配置角色，确认后将从列表中移除。</Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {REAPPEAR_HINT}
              </Typography.Paragraph>
            </>
          ) : (
            <>
              <Typography.Paragraph>当前无法删除该实例。</Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                请先到专家模式或设备侧清理后再试。
              </Typography.Paragraph>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default DeleteVrInstanceModal;
