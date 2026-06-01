import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Drawer, Flex, Form, Input, InputNumber, Row, Select, Typography } from 'antd';
import type { HmsSwitchCr } from 'services/harvester/cluster';
import { fetchHmsDeviceProfiles } from 'services/harvester/cluster';
import { getHarvesterDrawerSectionCardProps } from '../../shared/drawerSectionCard';
import {
  HMS_SWITCH_DEFAULT_DIAL_TIMEOUT,
  HMS_SWITCH_DEFAULT_EXEC_TIMEOUT,
  HMS_SWITCH_DEVICE_PROFILE_FALLBACK_OPTIONS,
  HMS_SWITCH_VENDOR_OPTIONS,
  hmsSwitchCrToFormValues,
  hmsSwitchFormValuesToSpec,
  formatHmsDeviceProfileLabel,
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
  return out;
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
        corsAllowedOriginsText: '*',
      });
    }
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

            <Form.Item name="hostsText" label="备用管理地址" extra="可选，每行一个">
              <Input.TextArea rows={2} placeholder="与主管理地址不同时可追加" />
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
                  extra="留空则使用厂商默认"
                >
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    loading={profilesLoading}
                    placeholder={profilesLoading ? '正在加载设备模板…' : '选择设备模板（可留空）'}
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
                  extra={
                    isEdit && editing?.spec?.passwordConfigured ? '留空不修改' : undefined
                  }
                >
                  <Input.Password
                    autoComplete="new-password"
                    placeholder={isEdit ? '留空则不修改' : ''}
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
                >
                  <InputNumber min={1} max={300} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="execTimeout"
                  label="命令超时（秒）"
                  initialValue={HMS_SWITCH_DEFAULT_EXEC_TIMEOUT}
                >
                  <InputNumber min={1} max={600} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Card>

          <Card title="高级（可选）" size="small" {...getHarvesterDrawerSectionCardProps()}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
              自定义 CLI 与 CORS；留空则使用设备模板或厂商默认命令。
            </Typography.Paragraph>
            <Form.Item name="infoCommandsText" label="基本信息命令">
              <Input.TextArea rows={2} placeholder="infoCommands，每行一条" />
            </Form.Item>
            <Form.Item name="interfaceCommandsText" label="接口状态命令">
              <Input.TextArea rows={2} placeholder="interfaceCommands，每行一条" />
            </Form.Item>
            <Form.Item name="performanceCommandsText" label="性能探测命令">
              <Input.TextArea rows={2} placeholder="performanceCommands，每行一条" />
            </Form.Item>
            <Form.Item name="vlanCommandsText" label="VLAN 命令">
              <Input.TextArea rows={2} placeholder="vlanCommands，每行一条" />
            </Form.Item>
            <Form.Item name="corsAllowedOriginsText" label="CORS 来源">
              <Input.TextArea rows={2} placeholder="每行一个，默认 *" />
            </Form.Item>
          </Card>
        </Flex>
      </Form>
    </Drawer>
  );
};

export default HmsSwitchConfigDrawer;
