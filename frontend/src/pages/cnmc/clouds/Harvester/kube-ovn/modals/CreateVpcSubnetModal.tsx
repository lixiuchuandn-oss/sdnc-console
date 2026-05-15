import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, Form, Input, message, Modal, Select, Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { fetchCloudProviderEcs } from '../../../../../../services/api';
import { createKubeOvnSubnet, updateKubeOvnSubnet } from '../../../../../../services/harvesterApi';
import { generateHarvesterCrMetadataName, generateVmWizardStyleDisplayName } from '../../../../../../utils/harvesterUtils';
import type { BusinessVpcPickerRow } from '../lib/kubeOvnUiHelpers';
import {
  SUBNET_FINALIZER,
  SUBNET_TYPE_ANNOTATION_KEY,
  TOWER_ALIAS_ANNOTATION,
  isBuiltInKubeOvnVpc,
  isVpcOvnSubnetTableRow,
} from '../lib/kubeOvnSubnetConstants';
import {
  findExcludeIpUsedByAnyVm,
  friendlyMessageIfKubeOvnGatewayNotInCidr,
  isIpv4GatewayInCidr,
  validateFlatSubnetExcludeIpsLocal,
} from '../lib/flatSubnetExcludeIpValidation';

const TOWER_VM_ALIAS = TOWER_ALIAS_ANNOTATION;

function collectVmDisplayNamesUsingSubnet(subnetName: string, vms: any[]): string[] {
  const sn = String(subnetName || '').trim();
  if (!sn) return [];
  const targetRef = `default/${sn}`.toLowerCase();
  const tail = `/${sn.toLowerCase()}`;
  return vms
    .filter((vm: any) => Array.isArray(vm.networks))
    .filter((vm: any) =>
      vm.networks.some((n: string) => {
        const s = String(n || '').toLowerCase();
        const base = s.includes('@') ? s.split('@')[0] : s;
        return base === targetRef || base.endsWith(tail);
      }),
    )
    .map(
      (vm: any) =>
        vm?.metadata?.annotations?.[TOWER_VM_ALIAS] ||
        vm.InstanceName ||
        vm.name ||
        vm.metadata?.name,
    )
    .filter(Boolean) as string[];
}

function normalizeSubnetCidr(c: unknown): string {
  return String(c ?? '')
    .trim()
    .replace(/\s+/g, '');
}

function formatSubnetMutationError(e: any, isEdit: boolean): string {
  const rd = e?.responseData;
  let detail = String(e?.message || '').trim() || '未知错误';
  if (rd?.message) detail = typeof rd.message === 'string' ? rd.message : detail;
  if (rd?.error) {
    const ex = typeof rd.error === 'string' ? rd.error : JSON.stringify(rd.error);
    if (ex && !detail.includes(ex.slice(0, 40))) detail = `${detail}: ${ex}`;
  }
  if (rd?.details != null) {
    const ds = typeof rd.details === 'string' ? rd.details : JSON.stringify(rd.details);
    const head = ds.slice(0, 48);
    if (head && !detail.includes(head)) {
      const more = ds.length > 400 ? `${ds.slice(0, 400)}…` : ds;
      detail = `${detail} | ${more}`;
    }
  }
  return `${isEdit ? '更新' : '创建'}失败: ${detail}`;
}

export type CreateVpcSubnetModalProps = {
  open: boolean;
  onClose: () => void;
  isEditMode: boolean;
  /** 编辑时传入当前子网记录 */
  editingRecord: any | null;
  cloudId: string | undefined;
  hasVpcsWrite: boolean;
  vpcPickerRows: BusinessVpcPickerRow[];
  subnets: any[];
  onRefresh?: (force?: boolean, silent?: boolean, opts?: { vpcsAll?: boolean }) => void;
  onRefreshNads?: (force?: boolean, silent?: boolean) => void;
  /** 创建时预选的 VPC（CR 名）；设置后创建流程下「所属 VPC」不可改（如 VPC 列表页展开行内创建） */
  presetVpcId?: string | null;
  /** 创建子网请求体中的 namespace（NAD），与 VpcsSection 展开行创建一致 */
  createSubnetNamespace?: string | null;
  /** 追加在标题后的说明，例如 ` (所属VPC: 展示名)` */
  modalTitleSuffix?: string | null;
  /** 与 VpcsSection onRefresh 第三参一致，刷新 VPC/子网列表时带上运维开关 */
  refreshOpts?: { vpcsAll?: boolean };
};

const CreateVpcSubnetModal: React.FC<CreateVpcSubnetModalProps> = ({
  open,
  onClose,
  isEditMode,
  editingRecord,
  cloudId,
  hasVpcsWrite,
  vpcPickerRows,
  subnets,
  onRefresh,
  onRefreshNads,
  presetVpcId = null,
  createSubnetNamespace = null,
  modalTitleSuffix = null,
  refreshOpts,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [isSubnetInUse, setIsSubnetInUse] = useState(false);
  const [usingVms, setUsingVms] = useState<string[]>([]);
  const pendingVpcSubnetCrNameRef = useRef<string>('');
  /** 同步防抖：连点时 React 的 submitting 尚未更新，需 ref 阻止第二次 submit */
  const submitInFlightRef = useRef(false);

  useEffect(() => {
    if (!open || !cloudId) return;
    if (!isEditMode) {
      form.resetFields();
      pendingVpcSubnetCrNameRef.current = generateHarvesterCrMetadataName('vpcSubnet');
      form.setFieldsValue({
        alias: generateVmWizardStyleDisplayName('subnet'),
        nat: true,
        allowDhcp: true,
        ...(presetVpcId ? { vpc: presetVpcId } : {}),
      });
      setIsSubnetInUse(false);
      setUsingVms([]);
      return;
    }
    const record = editingRecord;
    if (!record) return;
    const crName = record.name || record.metadata?.name;
    const vpcVal = record.vpc || record.spec?.vpc;
    const aliasFromAnn = String(record?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
    const alias = aliasFromAnn || String(crName || '').trim();
    const cidr = record.cidr || record.cidrBlock || record.spec?.cidrBlock || record.spec?.cidr;
    const gateway = record.gateway || record.spec?.gateway;
    const excludeIps = record.excludeIps || record.spec?.excludeIps || [];
    const natVal = record.nat ?? record.spec?.natOutgoing ?? true;
    const allowDhcp = record.allowDhcp ?? record.spec?.enableDHCP ?? record.spec?.enableDhcp ?? true;
    form.setFieldsValue({
      alias,
      vpc: vpcVal,
      cidrBlock: cidr,
      gateway,
      nat: natVal,
      allowDhcp,
      excludeIps: Array.isArray(excludeIps) ? excludeIps.join('\n') : excludeIps,
    });

    // 检查子网是否被虚拟机使用
    fetchCloudProviderEcs(cloudId, true)
      .then((ecsRes: any) => {
        const vmList = Array.isArray(ecsRes?.data) ? ecsRes.data : Array.isArray(ecsRes) ? ecsRes : [];
        const vmsUsingSubnet = vmList.length > 0 ? collectVmDisplayNamesUsingSubnet(String(crName), vmList) : [];
        setIsSubnetInUse(vmsUsingSubnet.length > 0);
        setUsingVms(vmsUsingSubnet);
      })
      .catch(() => {
        setIsSubnetInUse(false);
        setUsingVms([]);
      });
  }, [open, isEditMode, editingRecord, cloudId, form, presetVpcId]);

  const vpcSubnetAliasFormRules = useMemo(
    () => [
      { required: true, message: '请输入名称' },
      {
        validator: async (_: unknown, value: unknown) => {
          const a = String(value ?? '').trim();
          if (!a) return;
          const curCr =
            isEditMode && editingRecord
              ? String(editingRecord?.metadata?.name || editingRecord?.name || '').trim()
              : '';
          const dup = (subnets || []).some((s: any) => {
            if (!isVpcOvnSubnetTableRow(s)) return false;
            const existingCr = String(s?.metadata?.name || s?.name || '').trim();
            if (curCr && existingCr === curCr) return false;
            const existingAlias = String(s?.metadata?.annotations?.[TOWER_ALIAS_ANNOTATION] ?? '').trim();
            return existingAlias === a;
          });
          if (dup) throw new Error('名称与已有 VPC 子网重复，请修改');
        },
      },
    ],
    [subnets, isEditMode, editingRecord],
  );

  const handleClose = useCallback(() => {
    onClose();
    form.resetFields();
  }, [form, onClose]);

  const handleSubmit = useCallback(
    async (values: any) => {
      if (!hasVpcsWrite) {
        message.error('无权限执行该操作');
        return;
      }
      if (!cloudId) return;
      if (submitInFlightRef.current) return;

      const excludeIpsParsed: string[] =
        values.excludeIps && typeof values.excludeIps === 'string'
          ? String(values.excludeIps)
              .split(/[\n,]/)
              .map((s: string) => s.trim())
              .filter(Boolean)
          : Array.isArray(values.excludeIps)
            ? values.excludeIps
            : [];

      const cidrTrim = normalizeSubnetCidr(values.cidrBlock);
      const gwTrim = String(values.gateway ?? '').trim();
      const cidrForExclude =
        isEditMode && editingRecord
          ? normalizeSubnetCidr(
              editingRecord.cidr ||
                editingRecord.cidrBlock ||
                editingRecord.spec?.cidrBlock ||
                editingRecord.spec?.cidr,
            )
          : cidrTrim;

      const excludeLocal = validateFlatSubnetExcludeIpsLocal(cidrForExclude, excludeIpsParsed);
      if (!excludeLocal.ok) {
        message.error(excludeLocal.message);
        return;
      }

      // 验证网关是否在CIDR范围内（创建和编辑模式都需要验证）
      const gwInCidr = isIpv4GatewayInCidr(gwTrim, cidrTrim);
      if (gwInCidr === false) {
        message.error(`${isEditMode ? '更新' : '创建'}VPC子网失败：网关不在CIDR 范围内`);
        return;
      }

      let vmList: any[] = [];
      try {
        const ecsRes: any = await fetchCloudProviderEcs(cloudId, true);
        vmList = Array.isArray(ecsRes?.data)
          ? ecsRes.data
          : Array.isArray(ecsRes)
            ? ecsRes
            : [];
      } catch {
        /* ignore */
      }

      const busy = findExcludeIpUsedByAnyVm(excludeIpsParsed, vmList);
      if (busy) {
        message.error(
          `${isEditMode ? '更新' : '创建'}失败：排除 IP「${busy.ip}」已被虚拟机「${busy.vmLabel}」占用，无法加入排除列表。`,
        );
        return;
      }

      submitInFlightRef.current = true;
      try {
        setSubmitting(true);

        if (isEditMode && editingRecord) {
          const name = editingRecord.name || editingRecord.metadata?.name;

          const usingVms =
            vmList.length > 0
              ? collectVmDisplayNamesUsingSubnet(String(name), vmList)
              : [];

          if (usingVms.length > 0) {
            const prevCidr = normalizeSubnetCidr(
              editingRecord.cidr ||
                editingRecord.cidrBlock ||
                editingRecord.spec?.cidrBlock ||
                editingRecord.spec?.cidr,
            );
            const nextCidr = normalizeSubnetCidr(values.cidrBlock);
            if (nextCidr !== prevCidr) {
              message.error(
                `当前子网 ${name} 正在被 ${usingVms.slice(0, 5).join('、')}${usingVms.length > 5 ? ' 等 VM 使用' : ''}，不能修改 CIDR 网段。可先改虚拟机网络或释放占用后再调整网段。`,
              );
              return;
            }
          }

          const patchBody: Record<string, unknown> = {
            excludeIps: excludeIpsParsed,
            natOutgoing: values.nat,
            enableDHCP: values.allowDhcp,
            annotations: {
              [TOWER_ALIAS_ANNOTATION]: String(values.alias ?? '').trim(),
            },
          };

          // 如果子网未被使用，允许修改CIDR和网关
          if (usingVms.length === 0) {
            patchBody.cidrBlock = values.cidrBlock;
            patchBody.gateway = values.gateway;
          }

          await updateKubeOvnSubnet(cloudId, name, patchBody);
          message.success('更新子网成功');
        } else {
          if (isBuiltInKubeOvnVpc(values?.vpc)) {
            message.error(
              'VPC 子网不能使用内置 VPC（ovn-cluster / ovn-internal / ovn-provider），请选择业务 VPC',
            );
            return;
          }
          const crName =
            String(pendingVpcSubnetCrNameRef.current || '').trim() || generateHarvesterCrMetadataName('vpcSubnet');
          const createPayload: Record<string, unknown> = {
            name: crName,
            vpc: values.vpc,
            cidrBlock: values.cidrBlock,
            gateway: values.gateway,
            protocol: 'IPv4',
            excludeIps: excludeIpsParsed,
            nat: values.nat,
            allowDhcp: values.allowDhcp,
            allowEWTraffic: false,
            annotations: {
              ...(values?.annotations || {}),
              [SUBNET_TYPE_ANNOTATION_KEY]: 'vpc',
              [TOWER_ALIAS_ANNOTATION]: String(values.alias ?? '').trim(),
            },
            finalizers: Array.from(
              new Set([...(Array.isArray(values?.finalizers) ? values.finalizers : []), SUBNET_FINALIZER]),
            ),
            ...(createSubnetNamespace ? { namespace: createSubnetNamespace } : {}),
          };
          await createKubeOvnSubnet(cloudId, createPayload);
          message.success('创建子网成功');
          onRefreshNads?.(true, true);
        }

        handleClose();
        onRefresh?.(true, true, refreshOpts);
      } catch (e: any) {
        console.error(e);
        if (e?.errorFields) throw e;
        const friendlyGw = friendlyMessageIfKubeOvnGatewayNotInCidr(e, 'vpc');
        if (friendlyGw) {
          message.error(friendlyGw);
          throw e;
        }
        message.error(formatSubnetMutationError(e, isEditMode));
        throw e;
      } finally {
        submitInFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [cloudId, createSubnetNamespace, editingRecord, handleClose, hasVpcsWrite, isEditMode, onRefresh, onRefreshNads, refreshOpts],
  );

  return (
    <Modal
      title={`${isEditMode ? '编辑 VPC 子网' : '新建 VPC 子网'}${modalTitleSuffix ?? ''}`}
      open={open}
      centered
      width={600}
      onOk={() => form.submit()}
      onCancel={handleClose}
      confirmLoading={submitting}
      destroyOnHidden
      okButtonProps={{ disabled: !hasVpcsWrite }}
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} className="std-form">
        <Form.Item
          name="alias"
          label="名称"
          rules={vpcSubnetAliasFormRules}
        >
          <Input placeholder="显示名称（支持中文）" />
        </Form.Item>

        <Form.Item name="vpc" label="所属 VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
          <Select
            showSearch
            optionFilterProp="data-search"
            optionLabelProp="label"
            placeholder="请选择 VPC"
            disabled={isEditMode || !!presetVpcId}
          >
            {vpcPickerRows.map((row) => (
              <Select.Option
                key={row.id}
                value={row.id}
                data-search={row.searchLabel}
                label={row.display}
              >
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.display}</div>
                  <div style={{ color: '#8c8c8c', fontSize: 12 }}>{`命名空间: ${row.namespacesDisplay}`}</div>
                </div>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="cidrBlock"
          label={
            <span>
              CIDR
              {isEditMode && isSubnetInUse && (
                <Tooltip title={`当前子网正在被云主机 ${usingVms.slice(0, 3).join('、')}${usingVms.length > 3 ? ' 等' : ''} 使用，无法修改 CIDR`}>
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999', cursor: 'help' }} />
                </Tooltip>
              )}
            </span>
          }
          rules={[
            { required: true, message: '请输入 CIDR' },
            { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/, message: '格式错误' },
          ]}
        >
          <Input placeholder="192.168.1.0/24" disabled={isEditMode && isSubnetInUse} />
        </Form.Item>

        <Form.Item
          name="gateway"
          label={
            <span>
              网关
              {isEditMode && isSubnetInUse && (
                <Tooltip title={`当前子网正在被云主机 ${usingVms.slice(0, 3).join('、')}${usingVms.length > 3 ? ' 等' : ''} 使用，无法修改网关`}>
                  <InfoCircleOutlined style={{ marginLeft: 4, color: '#999', cursor: 'help' }} />
                </Tooltip>
              )}
            </span>
          }
          rules={[
            { required: true, message: '请输入网关地址' },
            { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '格式错误' },
          ]}
        >
          <Input placeholder="192.168.1.1" disabled={isEditMode && isSubnetInUse} />
        </Form.Item>

        <Form.Item name="excludeIps" label="排除 IP">
          <Input.TextArea
            rows={3}
            placeholder="每行一个 IPv4 或 IPv4 范围（如 192.168.1.1..192.168.1.10），多行请换行输入。"
          />
        </Form.Item>

        <Form.Item name="nat" valuePropName="checked" initialValue={true}>
          <Checkbox>启用 NAT 出网</Checkbox>
        </Form.Item>

        <Form.Item name="allowDhcp" valuePropName="checked" initialValue={true}>
          <Checkbox>启用 DHCP 服务</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateVpcSubnetModal;
