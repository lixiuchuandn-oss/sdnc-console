import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Form, Modal, message } from 'antd';
import { createKubeOvnSubnet } from '../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName } from '../../../../../utils/harvesterUtils';
import { useAuth } from '../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../utils/accessMapping';
import { CLOUD_SUBNETS_FLAT_WRITE } from '../../../../../constants/cloudPermissions';
import UnderlaySubnetFormFields from '../lib/UnderlaySubnetFormFields';
import {
  SUBNET_FINALIZER,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  KUBE_OVN_FLAT_VPC,
  KUBE_OVN_PUBLIC_VPC,
  buildFlatUnderlayOverlayAnnotations,
} from '../lib/kubeOvnSubnetConstants';

export type CreateFlatSubnetModalProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  vlans: any[];
  providers: any[];
  /** 用于名称重复校验（扁平子网 CR 列表） */
  aliasDupCheckItems: any[];
  onSuccess?: () => void | Promise<void>;
  /** 打开时预填 VLAN（CR metadata.name） */
  initialVlanCrName?: string | null;
  title?: string;
};

const CreateFlatSubnetModal: React.FC<CreateFlatSubnetModalProps> = ({
  open,
  onClose,
  cloudId,
  vlans,
  providers,
  aliasDupCheckItems,
  onSuccess,
  initialVlanCrName,
  title = '创建扁平子网',
}) => {
  const [form] = Form.useForm();
  /** 打开弹窗时预生成，与 CreateVpcSubnetModal / CreatePublicSubnetModal 一致，避免多次提交产生不同 CR 名 */
  const pendingUnderlaySubnetCrNameRef = useRef<string>('');
  const { user } = useAuth();
  const perms = useMemo(() => (user?.permissions ?? []) as string[], [user?.permissions]);
  const isTenantUser = useMemo(() => user?.role === 'tenant' || !!user?.tenantId, [user]);
  const canSubmit = useMemo(() => {
    const hasWrite =
      hasPermissionForAction(perms, CLOUD_SUBNETS_FLAT_WRITE) ||
      hasPermissionForAction(perms, 'clouds.subnets:write') ||
      hasPermissionForAction(perms, 'clouds.vpcs:write') ||
      hasPermissionForAction(perms, 'clouds:write');
    return hasWrite && !isTenantUser;
  }, [perms, isTenantUser]);

  useEffect(() => {
    if (!open) return;
    pendingUnderlaySubnetCrNameRef.current = generateHarvesterCrMetadataName('subnetUnderlay');
    form.resetFields();
    if (initialVlanCrName) {
      form.setFieldsValue({ vlan: initialVlanCrName });
    }
  }, [open, initialVlanCrName, form]);

  const handleSubmit = useCallback(
    async (values: any) => {
      if (!canSubmit) {
        message.error('当前账号没有扁平子网操作权限（租户角色仅允许查看）');
        return;
      }
      try {
        const { alias, ...rest } = values;
        const aliasTrim = String(alias ?? '').trim();
        const subnetId =
          String(pendingUnderlaySubnetCrNameRef.current || '').trim() ||
          generateHarvesterCrMetadataName('subnetUnderlay');
        const excludeIps = rest.excludeIps
          ? String(rest.excludeIps)
              .split('\n')
              .map((s: string) => s.trim())
              .filter((s: string) => s)
          : [];
        const vlanTrim = String(rest.vlan ?? '').trim();
        const vlanHit = vlanTrim
          ? vlans.find((v: any) => String(v?.metadata?.name ?? '').trim() === vlanTrim)
          : undefined;
        const providerFromVlan = String(vlanHit?.spec?.provider ?? '').trim();
        const defaultVpc = vlanTrim ? KUBE_OVN_PUBLIC_VPC : KUBE_OVN_FLAT_VPC;
        const flatSubnetHardcoded = {
          natOutgoing: true,
          private: false,
          gatewayType: 'distributed',
          disableGatewayCheck: true,
          allowDhcp: true,
          ...(vlanTrim ? { vlan: vlanTrim } : {}),
        };

        const payload: Record<string, unknown> = {
          ...rest,
          name: subnetId,
          excludeIps,
          ...(providerFromVlan ? { provider: providerFromVlan } : {}),
          protocol: 'IPv4',
          allowEWTraffic: false,
          vpc: rest.vpc || defaultVpc,
          ...flatSubnetHardcoded,
          annotations: {
            ...(rest?.annotations || {}),
            [SUBNET_TYPE_ANNOTATION_KEY]: 'flat',
            ...buildFlatUnderlayOverlayAnnotations(!!vlanTrim),
            ...(aliasTrim ? { [TOWER_ALIAS_ANNOTATION]: aliasTrim } : {}),
          },
          finalizers: Array.from(
            new Set([...(Array.isArray(rest?.finalizers) ? rest.finalizers : []), SUBNET_FINALIZER]),
          ),
        };
        await createKubeOvnSubnet(cloudId, payload);
        message.success('创建扁平子网成功');
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
        message.error(`创建扁平子网失败: ${detail}`);
      }
    },
    [canSubmit, cloudId, form, onClose, onSuccess, vlans],
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
          isFlatMode
          vlans={vlans}
          providers={providers}
          aliasDupCheckItems={aliasDupCheckItems}
          aliasFieldTooltip="展示名称，支持中文。集群内资源 ID（metadata.name）为系统自动生成，格式 id-sn- 加 11 位随机字符。"
        />
      </Form>
    </Modal>
  );
};

export default CreateFlatSubnetModal;
