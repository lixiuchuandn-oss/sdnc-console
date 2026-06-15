import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
  message,
  Alert,
} from 'antd';
import type { FormListFieldData } from 'antd/es/form';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import {
  defaultOvnMirrorFilterRule,
  defaultOvnMirrorSourceNicEntry,
  defaultOvnMirrorSourceVm,
  defaultOvnMirrorFormValues,
  flattenOvnMirrorFormNicEntries,
  ovnMirrorSourceNicKey,
  validateOvnMirrorOptionalIpv4,
  validateOvnMirrorOptionalPort,
  vmDisplayAlias,
  vmRowKey,
  type OvnMirrorFormValues,
} from '../lib/ovnMirrorSectionUtils';
import {
  vmHasOvnMirrorEligibleNic,
  vmNicOptionsForOvnMirror,
} from '../lib/ovnMirrorVmNetworkEligibility';
import { isVmInRecycleBin } from '../lib/vmSectionUtils';

const OVN_MIRROR_ANY_PLACEHOLDER = 'any';

function ovnMirrorPortFormItemRules() {
  return [
    {
      validator: async (_: unknown, value: unknown) => {
        const err = validateOvnMirrorOptionalPort(value);
        if (err) throw new Error(err);
      },
    },
  ];
}

function ovnMirrorTargetIpFormItemRules() {
  return [
    {
      validator: async (_: unknown, value: unknown) => {
        const err = validateOvnMirrorOptionalIpv4(value);
        if (err) throw new Error(err);
      },
    },
  ];
}

const { Text } = Typography;

/** 弹窗内行内表单项：固定标签列 + 选择框宽度，避免各行参差不齐 */
const OVN_MIRROR_ROW_LABEL_WIDTH = 96;
const OVN_MIRROR_ROW_SELECT_WIDTH = 320;

type MirrorFormRowProps = {
  label: React.ReactNode;
  required?: boolean;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

const MirrorFormRow: React.FC<MirrorFormRowProps> = ({
  label,
  required = false,
  actions,
  style,
  children,
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 12,
      ...style,
    }}
  >
    <div
      style={{
        width: OVN_MIRROR_ROW_LABEL_WIDTH,
        flexShrink: 0,
        lineHeight: '32px',
        textAlign: 'right',
        color: 'rgba(0,0,0,.88)',
      }}
    >
      {required ? (
        <>
          <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>
          {label}
        </>
      ) : (
        label
      )}
    </div>
    <div style={{ width: OVN_MIRROR_ROW_SELECT_WIDTH, flexShrink: 0, minWidth: 0 }}>
      {children}
    </div>
    {actions ? <div style={{ flexShrink: 0 }}>{actions}</div> : null}
  </div>
);

type VmOption = { value: string; label: string; ns: string; name: string; vm: unknown };

type SourceNicFieldsProps = {
  vmField: FormListFieldData;
  nicField: FormListFieldData;
  nicIndex: number;
  form: ReturnType<typeof Form.useForm<OvnMirrorFormValues>>[0];
  sourceVmKey: string;
  sourceVm: unknown | undefined;
  kubeOvnSubnets: unknown[];
  usedSourceNicKeys: Set<string>;
  readOnlySource?: boolean;
  canRemoveNic: boolean;
  canAddNic: boolean;
  onAddNic: () => void;
  onRemoveNic: () => void;
};

const SourceNicFields: React.FC<SourceNicFieldsProps> = ({
  vmField,
  nicField,
  nicIndex,
  form,
  sourceVmKey,
  sourceVm,
  kubeOvnSubnets,
  usedSourceNicKeys,
  readOnlySource = false,
  canRemoveNic,
  canAddNic,
  onAddNic,
  onRemoveNic,
}) => {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const networkNad = Form.useWatch(
    ['sourceVms', vmField.name, 'nicEntries', nicField.name, 'networkNad'],
    form,
  );

  const nicOptions = useMemo(() => {
    const all = sourceVm ? vmNicOptionsForOvnMirror(sourceVm, kubeOvnSubnets) : [];
    const vmKey = String(sourceVmKey || '').trim();
    const currentNic = String(networkNad || '').trim();
    return all.filter((o) => {
      const key = ovnMirrorSourceNicKey(vmKey, o.value);
      const currentKey = ovnMirrorSourceNicKey(vmKey, currentNic);
      return key === currentKey || !usedSourceNicKeys.has(key);
    });
  }, [sourceVm, sourceVmKey, networkNad, usedSourceNicKeys, kubeOvnSubnets]);

  return (
    <div style={{ marginBottom: nicIndex > 0 ? 16 : 8 }}>
      <MirrorFormRow
        label="IP 地址"
        style={{ marginBottom: advancedOpen ? 8 : nicIndex > 0 ? 16 : 8 }}
        actions={
          <Space size={4}>
            <Button type="link" size="small" onClick={() => setAdvancedOpen((v) => !v)}>
              高级
            </Button>
            {!readOnlySource ? (
              <>
                {canAddNic ? (
                  <Button
                    type="text"
                    icon={<PlusOutlined />}
                    onClick={onAddNic}
                    aria-label="添加网卡"
                  />
                ) : null}
                {canRemoveNic ? (
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={onRemoveNic}
                    aria-label="删除网卡"
                  />
                ) : null}
              </>
            ) : null}
          </Space>
        }
      >
        <Form.Item
          name={[nicField.name, 'networkNad']}
          rules={[{ required: true, message: '请选择 IP 地址' }]}
          style={{ marginBottom: 0 }}
        >
          <Select
            showSearch
            style={{ width: '100%' }}
            placeholder={sourceVm ? '选择 IP 地址' : '请先选择虚拟机'}
            disabled={readOnlySource || !sourceVm}
            options={nicOptions.map((o) => ({ value: o.value, label: o.label }))}
          />
        </Form.Item>
      </MirrorFormRow>

      {advancedOpen ? (
        <div
          style={{
            marginLeft: OVN_MIRROR_ROW_LABEL_WIDTH + 12,
            marginBottom: nicIndex > 0 ? 16 : 8,
            padding: 12,
            border: '1px solid #e5e6eb',
            borderRadius: 6,
            background: '#fff',
          }}
        >
          <Form.List name={[nicField.name, 'filterRules']}>
            {(ruleFields, { add: addRule, remove: removeRule }) => (
              <>
                {ruleFields.map((ruleField, ruleIndex) => (
                  <div
                    key={ruleField.key}
                    style={{
                      marginBottom: ruleIndex < ruleFields.length - 1 ? 12 : 0,
                      paddingBottom: ruleIndex < ruleFields.length - 1 ? 12 : 0,
                      borderBottom:
                        ruleIndex < ruleFields.length - 1 ? '1px solid #f0f0f0' : undefined,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                      }}
                    >
                      <Text type="secondary">规则 {ruleIndex + 1}</Text>
                      {ruleFields.length > 1 ? (
                        <Button
                          type="text"
                          danger
                          size="small"
                          icon={<MinusCircleOutlined />}
                          onClick={() => removeRule(ruleField.name)}
                        >
                          删除
                        </Button>
                      ) : null}
                    </div>
                    <Space size="middle" wrap style={{ width: '100%' }}>
                      <Form.Item
                        name={[ruleField.name, 'direct']}
                        label="流量方向"
                        initialValue="all"
                        style={{ minWidth: 120, marginBottom: 0 }}
                      >
                        <Select
                          options={[
                            { value: 'all', label: '全部' },
                            { value: 'inbound', label: '入方向' },
                            { value: 'outbound', label: '出方向' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[ruleField.name, 'protocol']}
                        label="协议"
                        initialValue="all"
                        style={{ minWidth: 120, marginBottom: 0 }}
                      >
                        <Select
                          options={[
                            { value: 'all', label: '全部' },
                            { value: 'tcp', label: 'TCP' },
                            { value: 'udp', label: 'UDP' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[ruleField.name, 'port']}
                        label="源端口"
                        style={{ minWidth: 120, marginBottom: 0 }}
                        rules={ovnMirrorPortFormItemRules()}
                      >
                        <InputNumber
                          min={0}
                          max={65535}
                          precision={0}
                          placeholder={OVN_MIRROR_ANY_PLACEHOLDER}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item
                        name={[ruleField.name, 'targetIp']}
                        label="目的 IP"
                        style={{ minWidth: 160, marginBottom: 0 }}
                        rules={ovnMirrorTargetIpFormItemRules()}
                      >
                        <Input placeholder={OVN_MIRROR_ANY_PLACEHOLDER} />
                      </Form.Item>
                      <Form.Item
                        name={[ruleField.name, 'targetPort']}
                        label="目的端口"
                        style={{ minWidth: 120, marginBottom: 0 }}
                        rules={ovnMirrorPortFormItemRules()}
                      >
                        <InputNumber
                          min={0}
                          max={65535}
                          precision={0}
                          placeholder={OVN_MIRROR_ANY_PLACEHOLDER}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Space>
                  </div>
                ))}
                <Button
                  type="dashed"
                  onClick={() => addRule(defaultOvnMirrorFilterRule())}
                  icon={<PlusOutlined />}
                  block
                  style={{ marginTop: 12 }}
                >
                  添加镜像规则
                </Button>
              </>
            )}
          </Form.List>
        </div>
      ) : null}
    </div>
  );
};

type SourceVmFieldsProps = {
  field: FormListFieldData;
  entryIndex: number;
  form: ReturnType<typeof Form.useForm<OvnMirrorFormValues>>[0];
  vmOptions: VmOption[];
  kubeOvnSubnets: unknown[];
  occupiedSourceNicKeys: Set<string>;
  occupiedSourceVmKeys: Set<string>;
  vms: unknown[];
  canRemoveVm: boolean;
  readOnlySource?: boolean;
  onRemoveVm: () => void;
};

const SourceVmFields: React.FC<SourceVmFieldsProps> = ({
  field,
  entryIndex,
  form,
  vmOptions,
  kubeOvnSubnets,
  occupiedSourceNicKeys,
  occupiedSourceVmKeys,
  vms,
  canRemoveVm,
  readOnlySource = false,
  onRemoveVm,
}) => {
  const sourceVmKey = Form.useWatch(['sourceVms', field.name, 'sourceVmKey'], form);
  const nicEntriesRaw = Form.useWatch(['sourceVms', field.name, 'nicEntries'], form);
  const nicEntriesWatch = useMemo(
    () => (Array.isArray(nicEntriesRaw) ? nicEntriesRaw : []),
    [nicEntriesRaw],
  );

  const selectableVmOptions = useMemo(() => {
    const current = String(sourceVmKey || '').trim();
    return vmOptions.filter((o) => {
      if (o.value === current) return true;
      if (occupiedSourceVmKeys.has(o.value)) return false;
      const nics = vmNicOptionsForOvnMirror(o.vm, kubeOvnSubnets);
      return nics.some((n) => {
        const key = ovnMirrorSourceNicKey(o.value, n.value);
        return key && !occupiedSourceNicKeys.has(key);
      });
    });
  }, [vmOptions, occupiedSourceNicKeys, occupiedSourceVmKeys, sourceVmKey, kubeOvnSubnets]);

  const sourceVm = useMemo(() => {
    if (!sourceVmKey) return undefined;
    return (Array.isArray(vms) ? vms : []).find((vm) => vmRowKey(vm) === sourceVmKey);
  }, [sourceVmKey, vms]);

  const usedNicKeysInVm = useMemo(() => {
    const keys = new Set<string>();
    const vmKey = String(sourceVmKey || '').trim();
    (nicEntriesWatch as { networkNad?: string }[]).forEach((nic) => {
      const key = ovnMirrorSourceNicKey(vmKey, String(nic?.networkNad || ''));
      if (key) keys.add(key);
    });
    return keys;
  }, [nicEntriesWatch, sourceVmKey]);

  const canAddMoreNic = useMemo(() => {
    const vmKey = String(sourceVmKey || '').trim();
    if (!vmKey || !sourceVm) return false;
    return vmNicOptionsForOvnMirror(sourceVm, kubeOvnSubnets).some((n) => {
      const key = ovnMirrorSourceNicKey(vmKey, n.value);
      return key && !occupiedSourceNicKeys.has(key) && !usedNicKeysInVm.has(key);
    });
  }, [sourceVm, sourceVmKey, occupiedSourceNicKeys, usedNicKeysInVm, kubeOvnSubnets]);

  const handleVmChange = (key: string) => {
    const hit = vmOptions.find((o) => o.value === key);
    form.setFieldValue(['sourceVms', field.name, 'sourceNamespace'], hit?.ns || '');
    form.setFieldValue(['sourceVms', field.name, 'sourceVmKey'], key);
    form.setFieldValue(['sourceVms', field.name, 'nicEntries'], [defaultOvnMirrorSourceNicEntry()]);
  };

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 16,
        border: '1px solid #e5e6eb',
        borderRadius: 8,
        background: '#fafafa',
      }}
    >
      <Form.Item name={[field.name, 'sourceNamespace']} hidden>
        <Input />
      </Form.Item>

      <MirrorFormRow
        label={`源虚拟机 ${entryIndex + 1}`}
        actions={
          canRemoveVm && !readOnlySource ? (
            <Button type="text" danger icon={<MinusCircleOutlined />} onClick={onRemoveVm}>
              删除
            </Button>
          ) : undefined
        }
      >
        <Form.Item
          name={[field.name, 'sourceVmKey']}
          rules={[{ required: true, message: '请选择虚拟机' }]}
          style={{ marginBottom: 0 }}
        >
          <Select
            showSearch
            style={{ width: '100%' }}
            placeholder="选择源虚拟机"
            optionFilterProp="label"
            disabled={readOnlySource}
            options={selectableVmOptions.map((o) => ({ value: o.value, label: o.label }))}
            onChange={handleVmChange}
          />
        </Form.Item>
      </MirrorFormRow>

      <Form.List name={[field.name, 'nicEntries']}>
        {(nicFields, { add: addNic, remove: removeNic }) => (
          <>
            {nicFields.map((nicField, nicIndex) => {
              const vmKey = String(sourceVmKey || '').trim();
              const usedSourceNicKeys = new Set(occupiedSourceNicKeys);
              (nicEntriesWatch as { networkNad?: string }[]).forEach((nic, idx) => {
                if (idx === nicField.name) return;
                const key = ovnMirrorSourceNicKey(vmKey, String(nic?.networkNad || ''));
                if (key) usedSourceNicKeys.add(key);
              });
              const isLastNic = nicIndex === nicFields.length - 1;
              return (
                <SourceNicFields
                  key={nicField.key}
                  vmField={field}
                  nicField={nicField}
                  nicIndex={nicIndex}
                  form={form}
                  sourceVmKey={vmKey}
                  sourceVm={sourceVm}
                  kubeOvnSubnets={kubeOvnSubnets}
                  usedSourceNicKeys={usedSourceNicKeys}
                  readOnlySource={readOnlySource}
                  canRemoveNic={nicFields.length > 1 && !readOnlySource}
                  canAddNic={isLastNic && canAddMoreNic && !readOnlySource}
                  onAddNic={() => addNic(defaultOvnMirrorSourceNicEntry())}
                  onRemoveNic={() => removeNic(nicField.name)}
                />
              );
            })}
          </>
        )}
      </Form.List>
    </div>
  );
};

type Props = {
  open: boolean;
  cloudId: string;
  vms: unknown[];
  kubeOvnSubnets?: unknown[];
  subnetsLoading?: boolean;
  editingName?: string;
  initialValues?: OvnMirrorFormValues;
  occupiedSourceNicKeys?: string[];
  occupiedSourceVmKeys?: string[];
  onClose: () => void;
  onSubmit: (values: OvnMirrorFormValues) => Promise<void>;
};

const OvnMirrorRuleModal: React.FC<Props> = ({
  open,
  vms,
  kubeOvnSubnets = [],
  subnetsLoading = false,
  editingName,
  initialValues,
  occupiedSourceNicKeys = [],
  occupiedSourceVmKeys = [],
  onClose,
  onSubmit,
}) => {
  const [form] = Form.useForm<OvnMirrorFormValues>();
  const isEdit = !!editingName;

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(initialValues || defaultOvnMirrorFormValues());
  }, [open, initialValues, form]);

  const vmOptions = useMemo(
    () =>
      (Array.isArray(vms) ? vms : [])
        .filter((vm) => !isVmInRecycleBin(vm))
        .map((vm) => {
          const key = vmRowKey(vm);
          if (!key) return null;
          const [ns, name] = key.split('/');
          return { value: key, label: vmDisplayAlias(vm), ns, name, vm };
        })
        .filter((o): o is VmOption => {
          if (!o) return false;
          return isEdit || vmHasOvnMirrorEligibleNic(o.vm, kubeOvnSubnets);
        }),
    [vms, kubeOvnSubnets, isEdit],
  );

  const sourceVmsRaw = Form.useWatch('sourceVms', form);
  const sourceVmsWatch = useMemo(
    () => (Array.isArray(sourceVmsRaw) ? sourceVmsRaw : []),
    [sourceVmsRaw],
  );
  const destVmKey = String(Form.useWatch(['mirrorDestination', 'destVmKey'], form) || '').trim();

  const occupiedNicSet = useMemo(
    () => new Set(occupiedSourceNicKeys.map((k) => String(k || '').trim()).filter(Boolean)),
    [occupiedSourceNicKeys],
  );

  const occupiedVmSet = useMemo(
    () => new Set(occupiedSourceVmKeys.map((k) => String(k || '').trim()).filter(Boolean)),
    [occupiedSourceVmKeys],
  );

  const formUsedSourceVmKeys = useMemo(() => {
    return (sourceVmsWatch as OvnMirrorFormValues['sourceVms'])
      .map((entry) => String(entry?.sourceVmKey || '').trim())
      .filter(Boolean);
  }, [sourceVmsWatch]);

  const allUsedSourceNicKeys = useMemo(() => {
    const keys = new Set(occupiedNicSet);
    flattenOvnMirrorFormNicEntries({ mirrorDestination: { destVmKey: '', networkNad: '' }, sourceVms: sourceVmsWatch as OvnMirrorFormValues['sourceVms'] }).forEach(
      (entry) => {
        const key = ovnMirrorSourceNicKey(entry.sourceVmKey, entry.networkNad);
        if (key) keys.add(key);
      },
    );
    return keys;
  }, [sourceVmsWatch, occupiedNicSet]);

  const destVmOptions = useMemo(() => {
    const reserved = new Set([...formUsedSourceVmKeys, ...occupiedSourceVmKeys]);
    return vmOptions.filter((o) => {
      if (o.value === destVmKey) return true;
      if (reserved.has(o.value)) return false;
      return vmHasOvnMirrorEligibleNic(o.vm, kubeOvnSubnets);
    });
  }, [vmOptions, formUsedSourceVmKeys, occupiedSourceVmKeys, destVmKey, kubeOvnSubnets]);

  const canAddMoreSourceVm = useMemo(
    () =>
      vmOptions.some((o) => {
        if (occupiedVmSet.has(o.value)) return false;
        if (formUsedSourceVmKeys.includes(o.value)) return false;
        const nics = vmNicOptionsForOvnMirror(o.vm, kubeOvnSubnets);
        return nics.some((n) => {
          const key = ovnMirrorSourceNicKey(o.value, n.value);
          return key && !allUsedSourceNicKeys.has(key);
        });
      }),
    [vmOptions, occupiedVmSet, formUsedSourceVmKeys, allUsedSourceNicKeys, kubeOvnSubnets],
  );

  const destVm = useMemo(() => {
    if (!destVmKey) return undefined;
    return vmOptions.find((o) => o.value === destVmKey)?.vm;
  }, [destVmKey, vmOptions]);

  const destNicOptions = useMemo(
    () => (destVm ? vmNicOptionsForOvnMirror(destVm, kubeOvnSubnets) : []),
    [destVm, kubeOvnSubnets],
  );

  const subnetsNotReady = !subnetsLoading && kubeOvnSubnets.length === 0;

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await onSubmit(values);
    } catch (e: unknown) {
      const err = e as { message?: string; errorFields?: unknown[] };
      if (err?.errorFields) return;
      message.error(err?.message || '表单校验失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `编辑流量镜像 · ${editingName}` : '创建流量镜像规则'}
      open={open}
      centered
      width={760}
      destroyOnClose
      maskClosable={false}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} disabled={subnetsNotReady && !isEdit} onClick={() => void handleOk()}>
            {isEdit ? '保存' : '创建'}
          </Button>
        </Space>
      }
      styles={{ body: { maxHeight: '75vh', overflowY: 'auto', paddingTop: 8 } }}
    >
      {subnetsNotReady && !isEdit ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="子网数据尚未加载"
          description="请稍候或刷新页面后再创建规则；未加载子网时无法准确识别扁平子网/VPC 网卡。"
        />
      ) : null}
      <Form form={form} layout="vertical" initialValues={defaultOvnMirrorFormValues()}>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>
          镜像流量接收端
        </Text>
        <MirrorFormRow label="接收端虚拟机" required>
          <Form.Item
            name={['mirrorDestination', 'destVmKey']}
            rules={[{ required: true, message: '必选' }]}
            style={{ marginBottom: 0 }}
          >
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder="选择接收端虚拟机"
              optionFilterProp="label"
              options={destVmOptions.map((o) => ({ value: o.value, label: o.label }))}
              onChange={() => {
                form.setFieldValue(['mirrorDestination', 'networkNad'], undefined);
              }}
            />
          </Form.Item>
        </MirrorFormRow>
        <MirrorFormRow label="IP 地址" style={{ marginBottom: 16 }}>
          <Form.Item
            name={['mirrorDestination', 'networkNad']}
            rules={[{ required: true, message: '请选择 IP 地址' }]}
            style={{ marginBottom: 0 }}
          >
            <Select
              showSearch
              style={{ width: '100%' }}
              placeholder={destVm ? '选择 IP 地址' : '请先选择虚拟机'}
              disabled={!destVm}
              options={destNicOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Form.Item>
        </MirrorFormRow>

        <Form.List name="sourceVms">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field, entryIndex) => (
                <SourceVmFields
                  key={field.key}
                  field={field}
                  entryIndex={entryIndex}
                  form={form}
                  vmOptions={vmOptions}
                  kubeOvnSubnets={kubeOvnSubnets}
                  occupiedSourceNicKeys={occupiedNicSet}
                  occupiedSourceVmKeys={occupiedVmSet}
                  vms={vms}
                  canRemoveVm={fields.length > 1}
                  readOnlySource={isEdit}
                  onRemoveVm={() => remove(field.name)}
                />
              ))}
              {!isEdit ? (
                <Button
                  type="dashed"
                  onClick={() => add(defaultOvnMirrorSourceVm())}
                  icon={<PlusOutlined />}
                  block
                  disabled={!canAddMoreSourceVm}
                >
                  添加源虚拟机
                </Button>
              ) : null}
            </>
          )}
        </Form.List>
      </Form>
    </Modal>
  );
};

export default OvnMirrorRuleModal;
