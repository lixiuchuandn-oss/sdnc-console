import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Input, Row, Col, Select, Switch, Space, Button, message, Cascader } from 'antd';
import { apiPost, apiPut } from '../../../../../../services/api';
import {
  Cloud,
  getCredentialLabels,
  resolvePoolTypeLabel,
  getCloudProviderRegionField,
} from '../../../../pools/lib/poolProviders';
import { provinces, cityOptionsByProvince } from '../../../../../../constants/chinaRegions';

interface CloudEditModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  cloud: Cloud | null;
}

/** Cloudmap 私有云：stored region 字符串 → 级联控件初值（与 CloudWizard submit 语义一致） */
function parseStoredRegionForCascader(stored: string | undefined): (string | number)[] | undefined {
  const s = stored?.trim() || '';
  if (!s || s === 'default') return undefined;
  const idx = s.indexOf('/');
  if (idx === -1) return [s];
  return [s.slice(0, idx).trim(), s.slice(idx + 1).trim()];
}

function normalizeRegionSubmit(
  providerId: string | undefined,
  raw: unknown,
): string {
  if (providerId === 'cloudmap.private') {
    if (Array.isArray(raw) && raw.length >= 2) {
      const a = String(raw[0] ?? '').trim();
      const b = String(raw[1] ?? '').trim();
      if (a && b) return `${a}/${b}`;
    }
    if (Array.isArray(raw) && raw.length === 1 && String(raw[0] ?? '').trim()) {
      return String(raw[0]).trim();
    }
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    return 'default';
  }
  if (raw == null) return '';
  return typeof raw === 'string' ? raw.trim() : String(raw);
}

const CloudEditModal: React.FC<CloudEditModalProps> = ({ visible, onCancel, onSuccess, cloud }) => {
  const [form] = Form.useForm();
  const [revealVisible, setRevealVisible] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [revealLoading, setRevealLoading] = useState(false);
  const [akVisible, setAkVisible] = useState(false);
  const [skVisible, setSkVisible] = useState(false);

  const regionCascaderOptions = useMemo(
    () =>
      provinces.map((province) => ({
        value: province,
        label: province,
        children: (cityOptionsByProvince[province] || []).map((city) => ({
          value: city,
          label: city,
        })),
      })),
    []
  );

  const providerId = cloud?.config?.provider as string | undefined;
  const regionField = useMemo(() => getCloudProviderRegionField(providerId), [providerId]);
  const regionRequired = !(regionField && regionField.required === false);

  const getTypeText = (type: string) => resolvePoolTypeLabel(type);

  useEffect(() => {
    if (!visible) {
      setRevealVisible(false);
      setAdminPassword('');
      setAkVisible(false);
      setSkVisible(false);
    }
  }, [visible]);

  const handleRevealConfirm = async () => {
    if (!adminPassword) {
      message.error('请输入管理员密码');
      return;
    }
    setRevealLoading(true);
    try {
      const res = await apiPost(`/api/clouds/${cloud?.id}/reveal`, {
        password: adminPassword,
      });

      form.setFieldsValue({
        accessKey: res.accessKey,
        secretKey: res.secretKey,
      });

      setAkVisible(true);
      setSkVisible(true);

      message.success('凭证已回显');
      setRevealVisible(false);
      setAdminPassword('');
    } catch (error: any) {
      message.error(error.response?.data?.message || '验证失败');
    } finally {
      setRevealLoading(false);
    }
  };

  useEffect(() => {
    if (visible && cloud) {
      const provider = (cloud as any)?.config?.provider as string | undefined;
      const isCloudmapPrivate = provider === 'cloudmap.private' || provider === 'cloudmap.edge';

      let regionInit: unknown = cloud.region;
      if (provider === 'cloudmap.private') {
        regionInit = parseStoredRegionForCascader(cloud.region);
      }

      form.setFieldsValue({
        name: cloud.name,
        description: cloud.description,
        region: regionInit,
        endpoint: cloud.endpoint,
        accessKey: isCloudmapPrivate ? '' : cloud.accessKey || '',
        secretKey: cloud.secretKey || (cloud as any)?.config?.apiToken || '',
        ignoreTls: cloud?.config?.ignoreTls !== undefined ? !!cloud?.config?.ignoreTls : true,
        harvesterVersion: cloud?.config?.harvesterVersion || 'auto',
      });
    }
  }, [visible, cloud, form]);

  const handleEditSubmit = async (values: any) => {
    try {
      if (!cloud?.id) {
        message.error('资源池ID不存在，无法更新');
        return;
      }

      const prevCfg = (cloud as any)?.config || {};
      const pv = providerId;
      const regionOut = normalizeRegionSubmit(pv, values.region);

      const submitData: any = {
        name: values.name,
        description: values.description,
        region: regionOut,
        endpoint: values.endpoint,
      };

      const isCloudmapPrivate = pv === 'cloudmap.private' || pv === 'cloudmap.edge';

      if (!isCloudmapPrivate && values.accessKey && values.accessKey !== cloud?.accessKey) {
        submitData.accessKey = values.accessKey;
      }
      if (values.secretKey && values.secretKey !== cloud?.secretKey) {
        submitData.secretKey = values.secretKey;
      }

      submitData.config = {
        ...prevCfg,
        ignoreTls: !!values.ignoreTls,
        harvesterVersion: isCloudmapPrivate ? '1.6' : values.harvesterVersion || prevCfg.harvesterVersion || 'auto',
        provider: prevCfg.provider,
      };

      await apiPut(`/api/clouds/${cloud.id}`, submitData);

      message.success('云资源更新成功');
      onSuccess();
    } catch (error: any) {
      const errorMessage = error?.response?.data?.message || error?.message || '未知错误';
      const status = error?.response?.status || error?.status;
      if (status === 404) {
        message.error(`更新失败：资源池不存在 (ID: ${cloud?.id})`);
      } else {
        message.error('更新失败：' + errorMessage);
      }
    }
  };

  const regionLabel = regionField?.label || '地域';
  const regionPlaceholder =
    regionField?.placeholder || (providerId === 'cloudmap.private' ? '请选择省份/城市，默认为default' : '请输入地域');

  const regionRules = regionRequired
    ? [
        {
          required: true,
          message: regionField?.type === 'select' ? '请选择地域' : '请输入地域',
        },
      ]
    : [];

  const renderRegionControl = () => {
    if (providerId === 'cloudmap.private' && regionField?.type === 'cascader') {
      return (
        <Cascader
          placeholder={regionPlaceholder}
          options={regionCascaderOptions}
          style={{ width: '100%' }}
          showSearch={{
            filter: (inputValue, path) =>
              path.some((option: { label?: React.ReactNode }) =>
                String(option.label).toLowerCase().includes(inputValue.toLowerCase())
              ),
          }}
          changeOnSelect={false}
        />
      );
    }

    if (regionField?.type === 'select' && regionField.options?.length) {
      return (
        <Select placeholder={regionPlaceholder} style={{ width: '100%' }} allowClear={false}>
          {regionField.options.map((option) => (
            <Select.Option key={option.value} value={option.value}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
      );
    }

    return <Input placeholder={regionPlaceholder} />;
  };

  return (
    <>
      <Modal title="编辑云资源" open={visible} onCancel={onCancel} footer={null} width={600} centered destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleEditSubmit}>
          <div className="modal-group-title" style={{ marginTop: 16 }}>
            基础信息
          </div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="资源类型">
                <Input value={getTypeText(String(cloud?.type || ''))} disabled />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label="云资源池名称"
                rules={[{ required: true, message: '请输入云资源池名称' }]}
              >
                <Input placeholder="请输入云资源池名称" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="描述" rules={[{ required: true, message: '请输入描述' }]}>
            <Input.TextArea placeholder="请输入描述" rows={1} />
          </Form.Item>

          <div className="modal-group-title">连接信息</div>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="region" label={regionLabel} rules={regionRules}>
                {renderRegionControl()}
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="endpoint" label="端点" rules={[{ required: true, message: '请输入端点' }]}>
                <Input placeholder="https://api.example.com" />
              </Form.Item>
            </Col>
          </Row>

          {(() => {
            const provider = cloud?.config?.provider as string | undefined;
            const { akLabel, skLabel, akPlaceholder, skPlaceholder } = getCredentialLabels(provider);
            const isHarvester = provider === 'harvester' || provider === 'cloudmap';
            const isCloudmapPriv = provider === 'cloudmap.private' || provider === 'cloudmap.edge';

            return (
              <>
                <div className="modal-group-title">认证配置</div>
                <Row gutter={16}>
                  {!isHarvester && !isCloudmapPriv && (
                    <Col span={12}>
                      <Form.Item name="accessKey" label={akLabel}>
                        <Input.Password
                          placeholder={akPlaceholder}
                          visibilityToggle={{
                            visible: akVisible,
                            onVisibleChange: (v) => {
                              if (v) {
                                const currentVal = form.getFieldValue('accessKey');
                                if (
                                  currentVal &&
                                  (currentVal === cloud?.accessKey || String(currentVal).startsWith('***'))
                                ) {
                                  setRevealVisible(true);
                                  return;
                                }
                              }
                              setAkVisible(v);
                            },
                          }}
                        />
                      </Form.Item>
                    </Col>
                  )}
                  <Col span={isHarvester || isCloudmapPriv ? 24 : 12}>
                    <Form.Item name="secretKey" label={skLabel}>
                      <Input.Password
                        placeholder={skPlaceholder}
                        visibilityToggle={{
                          visible: skVisible,
                          onVisibleChange: (v) => {
                            if (v) {
                              const currentVal = form.getFieldValue('secretKey');
                              if (
                                currentVal &&
                                (currentVal === cloud?.secretKey || String(currentVal).startsWith('***'))
                              ) {
                                setRevealVisible(true);
                                return;
                              }
                            }
                            setSkVisible(v);
                          },
                        }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </>
            );
          })()}

          <div className="modal-group-title">高级选项</div>
          <Form.Item name="ignoreTls" label="忽略TLS证书校验" valuePropName="checked">
            <Switch />
          </Form.Item>

          {(() => {
            const provider = cloud?.config?.provider as string | undefined;
            if (provider === 'harvester' || provider === 'cloudmap') {
              return (
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="harvesterVersion" label="Harvester版本">
                      <Select placeholder="自动识别" defaultValue="auto" style={{ width: '100%' }}>
                        <Select.Option value="auto">自动</Select.Option>
                        <Select.Option value="1.5">1.5</Select.Option>
                        <Select.Option value="1.6">1.6</Select.Option>
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
              );
            }
            return null;
          })()}

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                更新
              </Button>
              <Button onClick={onCancel}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="验证管理员密码"
        open={revealVisible}
        onOk={handleRevealConfirm}
        confirmLoading={revealLoading}
        onCancel={() => setRevealVisible(false)}
        width={400}
        destroyOnHidden
        centered
        okText="确定"
        cancelText="取消"
      >
        <Input.Password
          placeholder="请输入管理员密码"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
          onPressEnter={handleRevealConfirm}
          autoComplete="new-password"
        />
      </Modal>
    </>
  );
};

export default CloudEditModal;
