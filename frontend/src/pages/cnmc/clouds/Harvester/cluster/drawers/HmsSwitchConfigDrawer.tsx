import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QuestionCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Drawer, Flex, Form, Input, InputNumber, Row, Select, Tooltip } from 'antd';
import type { HmsSwitchCr } from 'services/harvester/cluster';
import { fetchHmsDeviceProfiles } from 'services/harvester/cluster';
import { getHarvesterDrawerSectionCardProps } from '../../shared/drawerSectionCard';
import {
  HMS_SWITCH_DEFAULT_DIAL_TIMEOUT,
  HMS_SWITCH_DEFAULT_EXEC_TIMEOUT,
  HMS_SWITCH_DEVICE_PROFILE_FALLBACK_OPTIONS,
  HMS_SWITCH_DEVICE_PROFILE_GENERIC,
  HMS_SWITCH_VENDOR_OPTIONS,
  buildHmsSwitchDialTimeoutSelectOptions,
  buildHmsSwitchExecTimeoutSelectOptions,
  dedupeHmsDeviceProfileOptions,
  formatHmsDeviceProfileLabel,
  inferHmsDeviceProfileFromVendor,
  hmsSwitchCrToFormValues,
  hmsSwitchFormValuesToSpec,
  resolveHmsSwitchDeviceProfile,
  type HmsSwitchFormValues,
} from '../lib/hmsSwitchCrForm';

export type HmsSwitchConfigDrawerProps = {
  open: boolean;
  cloudId: string;
  /** 拉取 HSM 设备模板时使用的 Switch 名（编辑=当前 CR；添加=集群内已有任一台，与编辑逻辑一致） */
  profileContextSwitchName?: string;
  editing?: HmsSwitchCr | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (payload: { name: string; spec: Record<string, unknown> }) => Promise<void>;
};

type ProfileOption = { label: string; value: string };

const HELP_ICON_STYLE: React.CSSProperties = {
  marginLeft: 6,
  color: 'rgba(0,0,0,.45)',
  cursor: 'help',
  fontSize: 12,
};

const ADVANCED_SECTION_TOOLTIP =
  '自定义 CLI 与 CORS；留空则使用设备模板或厂商默认命令。关分页命令单独配置时优先于模板内置命令。';

function cardTitleWithTooltip(title: string, tip: string) {
  return (
    <span>
      {title}
      <Tooltip title={tip}>
        <QuestionCircleOutlined style={HELP_ICON_STYLE} />
      </Tooltip>
    </span>
  );
}

function mergeProfileOptions(
  remote: ProfileOption[],
  currentValue?: string,
  fallback: ProfileOption[] = HMS_SWITCH_DEVICE_PROFILE_FALLBACK_OPTIONS,
): ProfileOption[] {
  const seen = new Set<string>();
  const out: ProfileOption[] = [];
  const push = (opt: ProfileOption) => {
    const v = String(opt.value || '').trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ value: v, label: formatHmsDeviceProfileLabel(v, opt.label) });
  };
  for (const o of remote) push(o);
  const cur = String(currentValue || '').trim();
  if (cur) push({ value: cur, label: formatHmsDeviceProfileLabel(cur) });
  if (out.length === 0) {
    for (const o of fallback) push(o);
  }
  return dedupeHmsDeviceProfileOptions(out);
}

const HmsSwitchConfigDrawer: React.FC<HmsSwitchConfigDrawerProps> = ({
  open,
  cloudId,
  profileContextSwitchName = '',
  editing,
  saving,
  onClose,
  onSubmit,
}) => {
  const [form] = Form.useForm<HmsSwitchFormValues>();
  const isEdit = !!editing?.metadata?.name;
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>(
    HMS_SWITCH_DEVICE_PROFILE_FALLBACK_OPTIONS,
  );
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const currentDeviceProfile = Form.useWatch('deviceProfile', form);
  const vendorValue = Form.useWatch('vendor', form);
  const dialTimeoutValue = Form.useWatch('dialTimeout', form);
  const execTimeoutValue = Form.useWatch('execTimeout', form);
  const vendorProfileAutoSkipRef = useRef(true);
  const profilesResolvedOnceRef = useRef(false);

  const dialTimeoutOptions = useMemo(
    () => buildHmsSwitchDialTimeoutSelectOptions(dialTimeoutValue),
    [dialTimeoutValue],
  );
  const execTimeoutOptions = useMemo(
    () => buildHmsSwitchExecTimeoutSelectOptions(execTimeoutValue),
    [execTimeoutValue],
  );

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue(hmsSwitchCrToFormValues(editing));
    } else {
      form.resetFields();
      form.setFieldsValue({
        user: 'root',
        port: 22,
        dialTimeout: HMS_SWITCH_DEFAULT_DIAL_TIMEOUT,
        execTimeout: HMS_SWITCH_DEFAULT_EXEC_TIMEOUT,
        deviceProfile: HMS_SWITCH_DEVICE_PROFILE_GENERIC,
        corsAllowedOriginsText: '*',
      });
    }
    vendorProfileAutoSkipRef.current = true;
    profilesResolvedOnceRef.current = false;
  }, [open, editing, form]);

  const profileLookupName = useMemo(
    () => String(profileContextSwitchName || editing?.metadata?.name || '').trim(),
    [profileContextSwitchName, editing],
  );

  useEffect(() => {
    if (!open || !cloudId) {
      setProfileOptions(HMS_SWITCH_DEVICE_PROFILE_FALLBACK_OPTIONS);
      setProfilesError(null);
      setProfilesLoading(false);
      return;
    }

    const presetProfile =
      editing?.spec?.deviceProfile != null ? String(editing.spec.deviceProfile).trim() : '';

    let cancelled = false;
    setProfilesLoading(true);
    setProfilesError(null);

    void (async () => {
      try {
        const res = (await fetchHmsDeviceProfiles(cloudId, {
          switchName: profileLookupName || undefined,
        })) as {
            items?: ProfileOption[];
            message?: string;
            configured?: boolean;
            profilesUnavailable?: boolean;
            needsSwitchName?: boolean;
          };
          if (cancelled) return;
          const remote = Array.isArray(res?.items)
            ? res.items
                .map((x) => ({
                  value: String(x?.value ?? '').trim(),
                  label: String(x?.label ?? x?.value ?? '').trim(),
                }))
                .filter((x) => x.value)
            : [];
          if (remote.length > 0) {
            setProfileOptions(mergeProfileOptions(remote, presetProfile));
            setProfilesError(null);
          } else {
            setProfileOptions(mergeProfileOptions([], presetProfile));
            if (res?.configured === false && res?.message) {
              setProfilesError(res.message);
            } else if (res?.needsSwitchName) {
              setProfilesError(null);
            } else if (res?.profilesUnavailable && res?.message) {
              setProfilesError(res.message);
            } else if (remote.length === 0 && res?.configured !== false) {
              setProfilesError('HMS 未返回可用设备模板');
            }
          }
        } catch (e: unknown) {
          if (cancelled) return;
          const err = e as { responseData?: { message?: string }; message?: string };
          const msg = err?.responseData?.message || err?.message || '拉取 HSM 设备模板失败';
          if (!/missing switch name/i.test(msg)) {
            setProfilesError(msg);
          } else {
            setProfilesError(null);
          }
          setProfileOptions(mergeProfileOptions([], presetProfile));
        } finally {
          if (!cancelled) setProfilesLoading(false);
        }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, cloudId, editing, profileLookupName]);

  const selectOptions = useMemo(
    () => mergeProfileOptions(profileOptions, currentDeviceProfile),
    [profileOptions, currentDeviceProfile],
  );

  useEffect(() => {
    profilesResolvedOnceRef.current = false;
  }, [profileOptions]);

  useEffect(() => {
    if (!open || profilesLoading) return;
    if (profilesResolvedOnceRef.current || selectOptions.length === 0) return;
    profilesResolvedOnceRef.current = true;
    const next = resolveHmsSwitchDeviceProfile({
      vendor: form.getFieldValue('vendor'),
      currentProfile: form.getFieldValue('deviceProfile'),
      remoteOptions: selectOptions,
    });
    form.setFieldValue('deviceProfile', next);
  }, [open, selectOptions, profilesLoading, form]);

  useEffect(() => {
    if (!open) return;
    if (vendorProfileAutoSkipRef.current) {
      vendorProfileAutoSkipRef.current = false;
      return;
    }
    const next = inferHmsDeviceProfileFromVendor(
      vendorValue,
      selectOptions.map((o) => o.value),
    );
    form.setFieldValue('deviceProfile', next);
  }, [open, vendorValue, selectOptions, form]);

  const handleFinish = useCallback(
    async (values: HmsSwitchFormValues) => {
      const name = String(values.name || '').trim();
      const spec = hmsSwitchFormValuesToSpec(values, isEdit);
      await onSubmit({ name, spec });
    },
    [isEdit, onSubmit],
  );

  return (
    <Drawer
      title={isEdit ? `编辑交换机 · ${editing?.metadata?.name}` : '添加交换机'}
      width={720}
      open={open}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Flex justify="flex-end" gap="small">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            {isEdit ? '保存' : '创建'}
          </Button>
        </Flex>
      }
    >
      <Form form={form} layout="vertical" disabled={!!saving} onFinish={handleFinish}>
        <Flex vertical gap="middle" style={{ width: '100%' }}>
          {profilesError ? (
            <Alert type="warning" showIcon message={profilesError} />
          ) : null}
          <Card title="基本信息" size="small" {...getHarvesterDrawerSectionCardProps()}>
            <Form.Item
              name="name"
              label="配置名称"
              rules={[
                { required: true, message: '请输入配置名称' },
                {
                  pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
                  message: '须为小写字母、数字与连字符（DNS 子域风格）',
                },
              ]}
            >
              <Input placeholder="huawei-01" disabled={isEdit} />
            </Form.Item>

            <Form.Item
              name="primaryHost"
              label="管理地址"
              rules={[{ required: true, message: '请输入管理 IP 或主机名' }]}
            >
              <Input placeholder="172.31.0.1" />
            </Form.Item>

            <Form.Item name="hostsText" label="备用管理地址">
              <Input.TextArea rows={2} placeholder="可选，每行一个" />
            </Form.Item>

            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name="vendor" label="厂商">
                  <Select allowClear placeholder="选择厂商" options={HMS_SWITCH_VENDOR_OPTIONS} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="deviceProfile"
                  label="设备模板"
                  rules={[{ required: true, message: '请选择设备模板' }]}
                  tooltip="根据所选厂商自动推荐模板；列表中无匹配项时使用「通用」。不可留空。"
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    loading={profilesLoading}
                    placeholder={profilesLoading ? '正在加载设备模板…' : '选择设备模板'}
                    options={selectOptions}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card title="SSH 登录" size="small" {...getHarvesterDrawerSectionCardProps()}>
            <Row gutter={12}>
              <Col xs={24} sm={10}>
                <Form.Item name="user" label="用户" initialValue="root">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={6}>
                <Form.Item name="port" label="端口" initialValue={22}>
                  <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={8}>
                <Form.Item
                  name="password"
                  label="密码"
                  rules={isEdit ? [] : [{ required: true, message: '创建时须填写密码' }]}
                >
                  <Input.Password
                    autoComplete="new-password"
                    placeholder={isEdit ? '留空则不修改' : undefined}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="dialTimeout"
                  label="连接超时（秒）"
                  initialValue={HMS_SWITCH_DEFAULT_DIAL_TIMEOUT}
                  tooltip="SSH 建连与登录的最长等待。终端能较快出现提示符时通常 15 秒即可；跨网段或偶发连不上可试 20～30 秒。"
                >
                  <Select options={dialTimeoutOptions} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="execTimeout"
                  label="命令超时（秒）"
                  initialValue={HMS_SWITCH_DEFAULT_EXEC_TIMEOUT}
                  tooltip="交换机侧单条 CLI 最长等待（写入 Switch CR）。含 | include 时建议 60～90 秒。Tower 探测 HSM 的 HTTP 超时取 max(本值+15秒, 120秒)，过短会导致 interfaces 为 null 且报 ASW-CTL 请求超时。"
                >
                  <Select options={execTimeoutOptions} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card
            title={cardTitleWithTooltip('高级（可选）', ADVANCED_SECTION_TOOLTIP)}
            size="small"
            {...getHarvesterDrawerSectionCardProps()}
          >
            <Form.Item
              name="screenLengthCmd"
              label="关分页命令"
              tooltip="留空使用设备模板默认（如 h3c-huawei-like 的 screen-length 0 temporary）。H3C 部分型号需改为 screen-length disable。"
            >
              <Input placeholder="screen-length disable" allowClear />
            </Form.Item>
            <Form.Item
              name="infoCommandsText"
              label="基本信息命令"
              tooltip="覆盖 infoCommands，每行一条 CLI；留空则使用设备模板默认。"
            >
              <Input.TextArea rows={2} placeholder="display version" />
            </Form.Item>
            <Form.Item
              name="interfaceCommandsText"
              label="接口状态命令"
              tooltip="覆盖 interfaceCommands。带 | include 的整条命令须写在同一行（勿把 | include 换到第二行，否则 HSM 会当成第二条命令而失败）。须配合关分页 screen-length disable、命令超时建议 60～90 秒。"
            >
              <Input.TextArea
                rows={2}
                placeholder="display interface brief | include XGE"
                style={{ fontFamily: 'Consolas, monospace' }}
              />
            </Form.Item>
            <Form.Item
              name="performanceCommandsText"
              label="性能探测命令"
              tooltip="覆盖 performanceCommands，每行一条 CLI；留空则使用设备模板默认。"
            >
              <Input.TextArea rows={2} placeholder="display cpu-usage" />
            </Form.Item>
            <Form.Item
              name="vlanCommandsText"
              label="VLAN 命令"
              tooltip="覆盖 vlanCommands，每行一条 CLI；留空则使用设备模板默认。"
            >
              <Input.TextArea rows={2} placeholder="display vlan brief" />
            </Form.Item>
            <Form.Item
              name="corsAllowedOriginsText"
              label="CORS 来源"
              tooltip="每行一个允许来源；留空保存为 *（允许全部）。"
            >
              <Input.TextArea rows={2} placeholder="*" />
            </Form.Item>
          </Card>
        </Flex>
      </Form>
    </Drawer>
  );
};

export default HmsSwitchConfigDrawer;
