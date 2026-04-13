import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, Col, Form, Input, message, Modal, Row, Select } from 'antd';
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
  onRefresh?: (force?: boolean) => void;
  onRefreshNads?: (force?: boolean, silent?: boolean) => void;
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
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
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
      });
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
  }, [open, isEditMode, editingRecord, cloudId, form]);

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
      submitInFlightRef.current = true;
      const excludeIpsParsed =
        values.excludeIps && typeof values.excludeIps === 'string'
          ? String(values.excludeIps)
              .split(/[\n,]/)
              .map((s: string) => s.trim())
              .filter(Boolean)
          : values.excludeIps;

      try {
        setSubmitting(true);

        if (isEditMode && editingRecord) {
          const name = editingRecord.name || editingRecord.metadata?.name;

          let usingVms: string[] = [];
          try {
            const ecsRes = await fetchCloudProviderEcs(cloudId, true);
            const vms: any[] = ecsRes?.data || ecsRes || [];
            usingVms = collectVmDisplayNamesUsingSubnet(String(name), vms);
          } catch {
            /* ignore */
          }

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
          };
          await createKubeOvnSubnet(cloudId, createPayload);
          message.success('创建子网成功');
          onRefreshNads?.(true, true);
        }

        handleClose();
        onRefresh?.(true);
      } catch (e: any) {
        console.error(e);
        if (e?.errorFields) throw e;
        message.error(formatSubnetMutationError(e, isEditMode));
        throw e;
      } finally {
        submitInFlightRef.current = false;
        setSubmitting(false);
      }
    },
    [cloudId, editingRecord, handleClose, hasVpcsWrite, isEditMode, onRefresh, onRefreshNads],
  );

  return (
    <Modal
      title={isEditMode ? '编辑 VPC 子网' : '新建 VPC 子网'}
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
        <Form.Item name="alias" label="名称" rules={vpcSubnetAliasFormRules}>
          <Input placeholder="例如 subnet-a3f2-k2z9" style={{ width: '100%' }} />
        </Form.Item>

        <Form.Item name="vpc" label="所属 VPC" rules={[{ required: true, message: '请选择 VPC' }]}>
          <Select
            showSearch
            optionFilterProp="data-search"
            optionLabelProp="label"
            placeholder="请选择 VPC"
            style={{ width: '100%' }}
            disabled={isEditMode}
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

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="cidrBlock"
              label="CIDR 网段"
              rules={[
                { required: true, message: '请输入 CIDR' },
                { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/, message: '格式错误' },
              ]}
            >
              <Input placeholder="10.0.1.0/24" style={{ width: '100%' }} disabled={isEditMode} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="gateway"
              label="网关地址"
              rules={
                isEditMode
                  ? []
                  : [
                      { required: true, message: '请输入网关地址' },
                      { pattern: /^([0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '格式错误' },
                    ]
              }
            >
              <Input placeholder="10.0.1.1" style={{ width: '100%' }} disabled={isEditMode} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="nat" valuePropName="checked" initialValue={true}>
              <Checkbox>启用 NAT 出网</Checkbox>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="allowDhcp" valuePropName="checked" initialValue={true}>
              <Checkbox>启用 DHCP 服务</Checkbox>
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="excludeIps" label="排除 IP 范围">
          <Input.TextArea
            placeholder="支持单 IP 或范围 (e.g. 10.0.1.1..10.0.1.10)，用逗号分隔。这些 IP 将不会被分配给虚拟机。"
            rows={3}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateVpcSubnetModal;
