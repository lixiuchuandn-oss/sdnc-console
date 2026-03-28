import React, { useCallback, useEffect, useMemo } from 'react';
import { Form, Modal, message } from 'antd';
import { createKubeOvnSubnet } from '../../../../../services/harvesterApi';
import { generateHarvesterEntityId } from '../../../../../utils/harvesterUtils';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import { CLOUD_SUBNETS_PUBLIC_WRITE } from '../../../../../constants/cloudPermissions';
import UnderlaySubnetFormFields from './UnderlaySubnetFormFields';
import {
  SUBNET_FINALIZER,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  KUBE_OVN_PUBLIC_VPC,
} from './constants';
import { defaultVlanCrNameByMinVlanId } from './vlanUtils';

export type CreatePublicSubnetModalProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  vlans: any[];
  providers: any[];
  /** 用于别名重复校验（公共子网 CR 列表） */
  aliasDupCheckItems: any[];
  onSuccess?: () => void | Promise<void>;
  /** 打开时预填 VLAN（CR metadata.name）；未传时按 VLAN spec.id 最小默认 */
  initialVlanCrName?: string | null;
  title?: string;
};

const CreatePublicSubnetModal: React.FC<CreatePublicSubnetModalProps> = ({
  open,
  onClose,
  cloudId,
  vlans,
  providers,
  aliasDupCheckItems,
  onSuccess,
  initialVlanCrName,
  title = '创建公共子网',
}) => {
  const [form] = Form.useForm();
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const isTenantUser = useMemo(() => user?.role === 'tenant' || !!user?.tenantId, [user]);
  const canSubmit = useMemo(() => {
    const hasWrite =
      hasPermissionForAction(perms, CLOUD_SUBNETS_PUBLIC_WRITE) ||
      hasPermissionForAction(perms, 'clouds.subnets:write') ||
      hasPermissionForAction(perms, 'clouds.vpcs:write') ||
      hasPermissionForAction(perms, 'clouds:write');
    return hasWrite && !isTenantUser;
  }, [perms, isTenantUser]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const vlanPreset =
      (initialVlanCrName && String(initialVlanCrName).trim()) || defaultVlanCrNameByMinVlanId(vlans);
    if (vlanPreset) {
      form.setFieldsValue({ vlan: vlanPreset });
    }
  }, [open, initialVlanCrName, vlans, form]);

  const handleSubmit = useCallback(
    async (values: any) => {
      if (!canSubmit) {
        message.error('当前账号没有公共子网操作权限（租户角色仅允许查看）');
        return;
      }
      try {
        const { alias, ...rest } = values;
        const aliasTrim = String(alias ?? '').trim();
        const subnetId = generateHarvesterEntityId('sn');
        const excludeIps = rest.excludeIps
          ? String(rest.excludeIps)
              .split('\n')
              .map((s: string) => s.trim())
              .filter((s: string) => s)
          : [];

        const payload: Record<string, unknown> = {
          ...rest,
          name: subnetId,
          excludeIps,
          protocol: 'IPv4',
          allowEWTraffic: false,
          vpc: rest.vpc || KUBE_OVN_PUBLIC_VPC,
          gatewayType: rest.gatewayType || 'distributed',
          private: rest.private ?? false,
          natOutgoing: true,
          annotations: {
            ...(rest?.annotations || {}),
            [SUBNET_TYPE_ANNOTATION_KEY]: 'public',
            ...(aliasTrim ? { [TOWER_ALIAS_ANNOTATION]: aliasTrim } : {}),
          },
          finalizers: Array.from(
            new Set([...(Array.isArray(rest?.finalizers) ? rest.finalizers : []), SUBNET_FINALIZER]),
          ),
        };
        await createKubeOvnSubnet(cloudId, payload);
        message.success('创建公共子网成功');
        form.resetFields();
        onClose();
        await onSuccess?.();
      } catch (error: any) {
        const rd = error?.responseData;
        let detail = String(error?.message || '').trim() || '未知错误';
        if (rd?.details != null) {
          const ds = typeof rd.details === 'string' ? rd.details : JSON.stringify(rd.details);
          const head = ds.slice(0, 48);
          if (head && !detail.includes(head)) {
            const more = ds.length > 400 ? `${ds.slice(0, 400)}…` : ds;
            detail = `${detail} | ${more}`;
          }
        }
        message.error(`创建公共子网失败: ${detail}`);
      }
    },
    [canSubmit, cloudId, form, onClose, onSuccess],
  );

  return (
    <Modal
      title={title}
      open={open}
      centered
      onOk={() => form.submit()}
      onCancel={() => {
        onClose();
        form.resetFields();
      }}
      okButtonProps={{ disabled: !canSubmit }}
      width={600}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} className="std-form">
        <UnderlaySubnetFormFields
          form={form}
          isFlatMode={false}
          vlans={vlans}
          providers={providers}
          aliasDupCheckItems={aliasDupCheckItems}
          aliasFieldTooltip="展示名称，支持中文；写入注解 tower.io/alias。子网在集群中的资源名（metadata.name）为自动生成，格式 id-sn- 加 11 位随机字符。"
        />
      </Form>
    </Modal>
  );
};

export default CreatePublicSubnetModal;
