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

const IDENTITY_HINT =
  '注销成功后会回写设备，只清 .registration_finish，不改 uuid、不停 agent。本机 IBR状态先变为 OFFLINE，同一 uuid 会在下一轮重新注册，列表可能再出现空行，请用登记时间区分。';

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
    return { binders, message: getApiErrorMessage(err, '该 IBR 仍被其它业务引用') };
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
        setLoadError(getApiErrorMessage(err, '无法预览删除'));
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
    if (!preview || blockedBinders.length || !preview.hasSnapshot) return;
    setSubmitting(true);
    const hideWait = message.loading({
      content: '正在回退设备并等待 applied…',
      key: 'vr_delete',
      duration: 0,
    });
    try {
      const resp = await deleteVrInstanceOnPlatform(uuid, {
        acknowledgeDrift: true,
      });
      const payload = (resp?.data ?? resp) as {
        registrationFinishCleared?: boolean;
        registrationClearError?: string;
      };
      hideWait();
      if (payload?.registrationFinishCleared) {
        message.success({
          content: '已回退设备并注销实例，本机 IBR状态已改为 OFFLINE。同一 uuid 会在下一轮重新注册',
          key: 'vr_delete',
        });
      } else {
        message.warning({
          content: payload?.registrationClearError
            ? `实例已从控制器注销。本机 finish 未清掉：${payload.registrationClearError}`
            : '实例已从控制器注销。本机 finish 未清掉，设备侧可能仍显示 ONLINE',
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
  const conflicts = preview?.conflicts || [];
  const okText = blocked || (preview && !preview.hasSnapshot && !loadError) ? '知道了' : '确认覆盖并删除';
  const okClosesOnly = blocked || Boolean(preview && !preview.hasSnapshot);

  return (
    <Modal
      title={okClosesOnly ? '无法删除该 IBR 实例' : '删除 IBR 实例'}
      open={open}
      onCancel={onClose}
      onOk={okClosesOnly ? onClose : handleOk}
      okText={okText}
      okButtonProps={{
        danger: !okClosesOnly,
        disabled: loading || Boolean(loadError && !blocked),
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
              <Typography.Paragraph>
                该实例仍被其它业务引用，请先按待办拆除后再删除。不要在删 VR 时隐式拆隧道 / HA / IPsec。
              </Typography.Paragraph>
              {renderBinders(binders)}
            </>
          ) : loadError ? (
            <Typography.Paragraph type="danger">{loadError}</Typography.Paragraph>
          ) : preview?.hasSnapshot ? (
            <>
              <Typography.Paragraph>
                该实例有角色前快照。删除会先把设备盖回快照，等到 agent 回报 applied 后再注销；任一步失败则实例仍在，可重试。
              </Typography.Paragraph>
              {conflicts.length > 0 ? (
                <>
                  <Typography.Paragraph>设备现网与角色前快照不一致，确认后将覆盖：</Typography.Paragraph>
                  <ul style={{ paddingLeft: 18 }}>
                    {conflicts.map((c, idx) => (
                      <li key={`${c.key || 'c'}-${idx}`}>{c.message}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <Typography.Paragraph type="secondary">
                  设备现网已接近角色前快照，将等待设备 applied 后再注销。
                </Typography.Paragraph>
              )}
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {IDENTITY_HINT}
              </Typography.Paragraph>
            </>
          ) : (
            <>
              <Typography.Paragraph>
                该实例没有角色前快照，无法回退设备 CLI，因此不能删除。历史已设角色的实例不会补录快照。
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                需要清设备时请走专家模式或设备侧，不要在此仅注销平台。
              </Typography.Paragraph>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default DeleteVrInstanceModal;
