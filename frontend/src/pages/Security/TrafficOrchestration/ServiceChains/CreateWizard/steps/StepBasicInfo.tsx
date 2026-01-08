import React from 'react';
import { Alert, Form, Tabs, Row, Col, Tag, Popover, Input, Segmented, Select, Space, InputNumber } from 'antd';
import { SafetyCertificateOutlined, FileProtectOutlined, CheckCircleFilled, CodeOutlined, SubnodeOutlined, SisternodeOutlined, CloudServerOutlined, NumberOutlined } from '@ant-design/icons';
import { SCENARIOS } from '../constants';

export default function StepBasicInfo(props: any) {
  const {
    form,
    scenarioType,
    setScenarioType,
    selectedTemplate,
    setSelectedTemplate,
    hoveredTemplate,
    setHoveredTemplate,
    cloudPools,
    tenants,
    orgOptions,
    setOrgOptions,
    flattenOrganizations,
    user,
    fetchOrganizationsByTenant,
  } = props;

  return (
    <div>
      <Alert
        message="欢迎使用服务链创建向导，请设定服务链的应用场景"
        type="info"
        showIcon
        style={{ marginBottom: 4, fontSize: 14, color: '#1f1f1f' }}
      />

      <Form form={form} layout="vertical">
        <Form.Item>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Tabs
              items={[
                {
                  key: 'detection',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <SafetyCertificateOutlined />
                      流量检测/防护模式
                    </span>
                  )
                },
                {
                  key: 'encryption',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <FileProtectOutlined />
                      应用加密改造模式
                    </span>
                  )
                }
              ]}
              activeKey={scenarioType}
              onChange={(val) => {
                setScenarioType(val as 'detection' | 'encryption');
                setSelectedTemplate(SCENARIOS[val as 'detection' | 'encryption'].options[0].value);
              }}
              style={{ marginBottom: 8 }}
            />

            <Row gutter={[24, 24]}>
              {SCENARIOS[scenarioType].options.map((option: any) => {
                const isSelected = selectedTemplate === option.value;
                const isHovered = hoveredTemplate === option.value;

                const popoverContent = (
                  <div style={{ width: 750, padding: 0 }}>
                    <div style={{
                      background: '#f0f5ff',
                      padding: 50,
                      display: 'flex',
                      justifyContent: 'center',
                      borderBottom: '1px solid #1165ff'
                    }}>
                      <img
                        src={option.image}
                        alt={option.label}
                        style={{
                          width: '100%',
                          height: 240,
                          objectFit: 'contain',
                          filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.1))',
                          transform: 'scale(1.1)',
                          transition: 'transform 0.3s'
                        }}
                      />
                    </div>
                    <div style={{ padding: '16px 20px' }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: '#1f1f1f', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                        {option.label}
                        <Tag color="blue" style={{ margin: 0, fontSize: 12, lineHeight: '20px' }}>模式详情</Tag>
                      </div>
                      <div style={{ fontSize: 14, color: '#666', textAlign: 'justify' }}>
                        {option.description}
                      </div>
                    </div>
                  </div>
                );

                return (
                  <Col span={6} key={option.value}>
                    <Popover
                      content={popoverContent}
                      placement="right"
                      overlayInnerStyle={{ padding: 0, borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}
                      mouseEnterDelay={0.2}
                    >
                      <div
                        onClick={() => setSelectedTemplate(option.value)}
                        onMouseEnter={() => setHoveredTemplate(option.value)}
                        onMouseLeave={() => setHoveredTemplate(null)}
                        style={{
                          cursor: 'pointer',
                          borderRadius: 12,
                          border: isSelected ? '2px solid #1677ff' : (isHovered ? '1px solid #1677ff' : '1px solid #e8e8e8'),
                          background: isSelected ? '#f0f5ff' : '#fff',
                          overflow: 'hidden',
                          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                          position: 'relative',
                          height: '100%',
                          boxShadow: isSelected
                            ? '0 8px 20px rgba(22, 119, 255, 0.15)'
                            : (isHovered ? '0 8px 20px rgba(0,0,0,0.08)' : '0 2px 8px rgba(0,0,0,0.02)'),
                          transform: isSelected || isHovered ? 'translateY(-4px)' : 'none'
                        }}
                      >
                        {isSelected && (
                          <div style={{
                            position: 'absolute', top: 0, right: 0,
                            width: 0, height: 0,
                            borderTop: '40px solid #1677ff',
                            borderLeft: '40px solid transparent',
                            zIndex: 1
                          }}>
                            <CheckCircleFilled style={{ position: 'absolute', top: -34, right: 6, color: '#fff', fontSize: 16 }} />
                          </div>
                        )}

                        <div style={{ padding: 4 }}>
                          <div style={{
                            background: isSelected ? '#fff' : '#f5f7fa',
                            borderRadius: 8,
                            height: 120,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            transition: 'all 0.3s'
                          }}>
                            <img
                              alt={option.label}
                              src={option.image}
                              style={{
                                maxWidth: '80%',
                                maxHeight: '80%',
                                objectFit: 'contain',
                                filter: isSelected ? 'none' : 'grayscale(100%) opacity(0.7)',
                                transition: 'all 0.3s'
                              }}
                            />
                          </div>
                        </div>

                        <div style={{ padding: '12px 16px', textAlign: 'center' }}>
                          <div style={{ fontWeight: isSelected ? 600 : 500, color: isSelected ? '#1677ff' : '#595959', fontSize: 14 }}>
                            {option.label}
                          </div>
                        </div>
                      </div>
                    </Popover>
                  </Col>
                );
              })}
            </Row>
          </div>
        </Form.Item>

        <div>
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="name" label="服务链名称" rules={[{ required: true, message: '请输入名称' }]}>
                <Input
                  placeholder="请输入服务链名称"
                  prefix={<CodeOutlined style={{ color: '#bfbfbf' }} />}
                  size="middle"
                  style={{ borderRadius: 6 }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="type" label="服务链类型" initialValue="serial" rules={[{ required: true, message: '请选择类型' }]}>
                <Segmented
                  options={[
                    { label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SubnodeOutlined style={{ fontSize: 14 }} /> 串行</span>, value: 'serial' },
                    { label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><SisternodeOutlined style={{ fontSize: 14 }} /> 旁路</span>, value: 'bypass' },
                  ]}
                  size="middle"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="vrf_id" label="VRF ID" initialValue={0} rules={[{ required: true, message: '请输入VRF ID' }]}>
                <InputNumber
                  placeholder="0"
                  prefix={<NumberOutlined style={{ color: '#bfbfbf' }} />}
                  size="middle"
                  style={{ width: '100%', borderRadius: 6 }}
                  min={0}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={24}>
            <Col span={12}>
              <Form.Item name="cluster" label="安全资源池" rules={[{ required: true, message: '请选择安全资源池' }]}>
                <Select
                  placeholder="请选择安全资源池"
                  size="middle"
                  suffixIcon={<CloudServerOutlined style={{ color: '#bfbfbf' }} />}
                  style={{ borderRadius: 6 }}
                >
                  {(cloudPools || []).map((c: any) => (
                    <Select.Option key={c.id} value={c.id}>
                      <Space>
                        <CloudServerOutlined />
                        {c.name} ({String(c?.config?.provider || '').toUpperCase()})
                      </Space>
                    </Select.Option>
                  ))}
                  {(!cloudPools || cloudPools.length === 0) && (
                    <Select.Option value="" disabled>
                      暂无已接入的云安全资源池
                    </Select.Option>
                  )}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              {user?.role === 'super_admin' ? (
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="tenantId" label="所属租户" rules={[{ required: true, message: '请选择租户' }]}>
                      <Select
                        placeholder="请选择租户"
                        options={tenants.map((t: any) => ({ value: t.id, label: t.name }))}
                        onChange={async (tid: string) => {
                          form.setFieldsValue({ organizationId: undefined });
                          setOrgOptions([]);
                          try {
                            const orgs = await fetchOrganizationsByTenant(tid);
                            const flat = flattenOrganizations(orgs);
                            setOrgOptions(flat.map((o: any) => ({ value: o.id, label: o.name })));
                          } catch {}
                        }}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="organizationId" label="所属组织" rules={[{ required: true, message: '请选择组织' }]}>
                      <Select
                        placeholder="请选择组织"
                        options={orgOptions}
                        disabled={!form.getFieldValue('tenantId')}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              ) : (
                <Form.Item label="所属租户/组织">
                  <Input disabled placeholder="由登录上下文自动归属" />
                </Form.Item>
              )}
            </Col>
          </Row>

          <Form.Item name="description" label="描述" style={{ paddingBottom: 0 }}>
            <Input.TextArea
              rows={2}
              placeholder="请输入描述信息"
              style={{ borderRadius: 6 }}
              showCount
              maxLength={200}
            />
          </Form.Item>
        </div>
      </Form>
    </div>
  );
}
