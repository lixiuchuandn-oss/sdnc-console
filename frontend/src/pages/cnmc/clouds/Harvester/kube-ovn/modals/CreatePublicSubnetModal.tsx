import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Form, Input, Modal, Radio, message } from 'antd';
import { createKubeOvnSubnet } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName } from '../../../../../../utils/harvesterUtils';
import { useAuth } from '../../../../../../contexts/AuthContext';
import { hasPermissionForAction } from '../../../../../../utils/accessMapping';
import { CLOUD_SUBNETS_PUBLIC_WRITE } from '../../../../../../constants/cloudPermissions';
import UnderlaySubnetFormFields from '../lib/UnderlaySubnetFormFields';
import {
  SUBNET_FINALIZER,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  KUBE_OVN_PUBLIC_VPC,
  OVN_INTERNAL_ROUTE_CIDR_ANNOTATION,
} from '../lib/kubeOvnSubnetConstants';
import { defaultVlanCrNameByMinVlanId } from '../lib/vlanUtils';

function isValidIpv4Cidr(s: string): boolean {
  const t = String(s ?? '').trim();
  if (!t) return false;
  const m = t.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const n = parseInt(m[i], 10);
    if (n > 255) return false;
  }
  const pref = parseInt(m[5], 10);
  return pref >= 0 && pref <= 32;
}

export type CreatePublicSubnetModalProps = {
  open: boolean;
  onClose: () => void;
  cloudId: string;
  vlans: any[];
  providers: any[];
  /** 用于名称重复校验（公共子网 CR 列表） */
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
  /** 打开弹窗时预生成 CR metadata.name（与 CreateFlatSubnetModal / CreateVpcSubnetModal 一致） */
  const pendingUnderlaySubnetCrNameRef = useRef<string>('');
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
    pendingUnderlaySubnetCrNameRef.current = generateHarvesterCrMetadataName('subnetUnderlay');
    form.resetFields();
    const vlanPreset =
      (initialVlanCrName && String(initialVlanCrName).trim()) || defaultVlanCrNameByMinVlanId(vlans);
    if (vlanPreset) {
      form.setFieldsValue({ vlan: vlanPreset, accessScopeMode: 'unlimited' });
    } else {
      form.setFieldsValue({ accessScopeMode: 'unlimited' });
    }
  }, [open, initialVlanCrName, vlans, form]);

  const handleSubmit = useCallback(
    async (values: any) => {
      if (!canSubmit) {
        message.error('当前账号没有公共子网操作权限（租户角色仅允许查看）');
        return;
      }
      try {
        const { alias, accessScopeMode, accessRouteCidr, ...rest } = values;
        const aliasTrim = String(alias ?? '').trim();
        const routeCidr =
          accessScopeMode === 'unlimited' ? '0.0.0.0/0' : String(accessRouteCidr ?? '').trim();
        if (accessScopeMode === 'custom' && !isValidIpv4Cidr(routeCidr)) {
          message.error('请填写有效的 IPv4 CIDR（可访问范围）');
          return;
        }
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

        const payload: Record<string, unknown> = {
          ...rest,
          name: subnetId,
          excludeIps,
          ...(providerFromVlan ? { provider: providerFromVlan } : {}),
          protocol: 'IPv4',
          allowEWTraffic: false,
          vpc: rest.vpc || KUBE_OVN_PUBLIC_VPC,
          gatewayType: rest.gatewayType || 'distributed',
          private: rest.private ?? false,
          natOutgoing: true,
          annotations: {
            ...(rest?.annotations || {}),
            [SUBNET_TYPE_ANNOTATION_KEY]: 'public',
            [OVN_INTERNAL_ROUTE_CIDR_ANNOTATION]: routeCidr,
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
      width={640}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        className="std-form"
      >
        <UnderlaySubnetFormFields
          form={form}
          isFlatMode={false}
          vlans={vlans}
          providers={providers}
          aliasDupCheckItems={aliasDupCheckItems}
          aliasFieldTooltip="展示名称，支持中文。集群内资源 ID（metadata.name）为系统自动生成，格式 id-sn- 加 11 位随机字符。"
        />
        <Form.Item
          name="accessScopeMode"
          label="可访问的范围"
          initialValue="unlimited"
          rules={[{ required: true, message: '请选择可访问范围' }]}
        >
          <Radio.Group>
            <Radio value="unlimited">不限（0.0.0.0/0）</Radio>
            <Radio value="custom">指定 IP 范围（CIDR）</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.accessScopeMode !== cur.accessScopeMode}>
          {({ getFieldValue }) =>
            getFieldValue('accessScopeMode') === 'custom' ? (
              <Form.Item
                name="accessRouteCidr"
                label="路由目的网段"
                rules={[
                  { required: true, message: '请输入 CIDR' },
                  {
                    validator: async (_, v) => {
                      const s = String(v ?? '').trim();
                      if (!s) return Promise.resolve();
                      if (!isValidIpv4Cidr(s)) {
                        return Promise.reject(new Error('请输入有效的 IPv4 CIDR'));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <Input placeholder="例如 10.0.0.0/8" />
              </Form.Item>
            ) : null
          }
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreatePublicSubnetModal;
