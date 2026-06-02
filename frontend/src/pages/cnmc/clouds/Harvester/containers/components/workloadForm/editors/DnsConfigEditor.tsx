/**
 * Pod DNS 策略与 dnsConfig
 */
import React, { useState, useEffect } from 'react';
import { Form, Input, Select, Button, Card, Row, Col, Alert } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';

const DnsConfigEditor: React.FC = () => {
  const form = Form.useFormInstance();
  
  const [dnsPolicy, setDnsPolicy] = useState<string>(() => form.getFieldValue('dnsPolicy') || 'ClusterFirst');
  const [nameservers, setNameservers] = useState<string[]>(() => form.getFieldValue('dnsConfig')?.nameservers || []);
  const [searches, setSearches] = useState<string[]>(() => form.getFieldValue('dnsConfig')?.searches || []);
  const [options, setOptions] = useState<Array<{ name: string; value?: string }>>(() => form.getFieldValue('dnsConfig')?.options || []);

  // 编辑模式下 form 数据异步写入，需要再同步一次
  useEffect(() => {
    const policy = form.getFieldValue('dnsPolicy');
    const config = form.getFieldValue('dnsConfig') || {};
    if (policy) {
      setDnsPolicy(policy);
      setNameservers(config.nameservers || []);
      setSearches(config.searches || []);
      setOptions(config.options || []);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDnsPolicyChange = (value: string) => {
    setDnsPolicy(value);
    form.setFieldsValue({ dnsPolicy: value });
  };
  
  const addNameserver = () => {
    const updated = [...nameservers, ''];
    setNameservers(updated);
    updateDnsConfig({ nameservers: updated });
  };
  
  const removeNameserver = (index: number) => {
    const updated = nameservers.filter((_, i) => i !== index);
    setNameservers(updated);
    updateDnsConfig({ nameservers: updated });
  };
  
  const updateNameserver = (index: number, value: string) => {
    const updated = [...nameservers];
    updated[index] = value;
    setNameservers(updated);
    updateDnsConfig({ nameservers: updated });
  };
  
  const addSearch = () => {
    const updated = [...searches, ''];
    setSearches(updated);
    updateDnsConfig({ searches: updated });
  };
  
  const removeSearch = (index: number) => {
    const updated = searches.filter((_, i) => i !== index);
    setSearches(updated);
    updateDnsConfig({ searches: updated });
  };
  
  const updateSearch = (index: number, value: string) => {
    const updated = [...searches];
    updated[index] = value;
    setSearches(updated);
    updateDnsConfig({ searches: updated });
  };
  
  const addOption = () => {
    const updated = [...options, { name: '', value: '' }];
    setOptions(updated);
    updateDnsConfig({ options: updated });
  };
  
  const removeOption = (index: number) => {
    const updated = options.filter((_, i) => i !== index);
    setOptions(updated);
    updateDnsConfig({ options: updated });
  };
  
  const updateOption = (index: number, field: 'name' | 'value', value: string) => {
    const updated = [...options];
    updated[index] = { ...updated[index], [field]: value };
    setOptions(updated);
    updateDnsConfig({ options: updated });
  };
  
  const updateDnsConfig = (partial: Partial<{
    nameservers?: string[];
    searches?: string[];
    options?: Array<{ name: string; value?: string }>;
  }>) => {
    const currentDnsConfig = form.getFieldValue('dnsConfig') || {};
    const newDnsConfig = {
      ...currentDnsConfig,
      ...partial,
    };
    
    const hasConfig = 
      (newDnsConfig.nameservers && newDnsConfig.nameservers.length > 0) ||
      (newDnsConfig.searches && newDnsConfig.searches.length > 0) ||
      (newDnsConfig.options && newDnsConfig.options.length > 0);
    
    form.setFieldsValue({ 
      dnsConfig: hasConfig ? newDnsConfig : undefined 
    });
  };
  
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 500 }}>DNS 配置</span>
      </div>
      
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="DNS 配置用于自定义 Pod 的域名解析策略，适用于自定义 DNS 服务器或修改搜索域等场景"
      />
      
      {/* 隐藏的 Form.Item 用于向 antd 表单注册 dnsPolicy / dnsConfig 字段，使 getFieldValue/setFieldsValue 正常工作 */}
      <Form.Item name="dnsPolicy" hidden><Input /></Form.Item>
      <Form.Item name="dnsConfig" hidden><Input /></Form.Item>

      <Form.Item label="DNS 策略" style={{ marginBottom: 16 }}>
        <Select value={dnsPolicy} onChange={handleDnsPolicyChange}>
          <Select.Option value="Default">Default - 使用节点 DNS 配置</Select.Option>
          <Select.Option value="ClusterFirst">ClusterFirst - 使用集群 DNS（默认）</Select.Option>
          <Select.Option value="ClusterFirstWithHostNet">ClusterFirstWithHostNet - 主机网络使用集群 DNS</Select.Option>
          <Select.Option value="None">None - 自定义 DNS 配置</Select.Option>
        </Select>
      </Form.Item>
      
      {dnsPolicy === 'None' && (
        <>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="DNS 策略为 None 时，必须配置 DNS 配置（nameservers、searches 或 options）"
          />

          <Card size="small" title="DNS 服务器" style={{ marginBottom: 12 }}>
            {nameservers.map((ns, index) => (
              <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
                <Col span={20}>
                  <Input
                    placeholder="例如: 10.96.0.10"
                    value={ns}
                    onChange={(e) => updateNameserver(index, e.target.value)}
                  />
                </Col>
                <Col span={4}>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeNameserver(index)}
                  />
                </Col>
              </Row>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addNameserver}>
              添加 DNS 服务器
            </Button>
          </Card>

          <Card size="small" title="搜索域" style={{ marginBottom: 12 }}>
            {searches.map((s, index) => (
              <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
                <Col span={20}>
                  <Input
                    placeholder="例如: default.svc.cluster.local"
                    value={s}
                    onChange={(e) => updateSearch(index, e.target.value)}
                  />
                </Col>
                <Col span={4}>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeSearch(index)}
                  />
                </Col>
              </Row>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addSearch}>
              添加搜索域
            </Button>
          </Card>

          <Card size="small" title="DNS 选项">
            {options.map((opt, index) => (
              <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
                <Col span={10}>
                  <Input
                    placeholder="选项名称，例如: ndots"
                    value={opt.name}
                    onChange={(e) => updateOption(index, 'name', e.target.value)}
                  />
                </Col>
                <Col span={10}>
                  <Input
                    placeholder="选项值（可选）"
                    value={opt.value || ''}
                    onChange={(e) => updateOption(index, 'value', e.target.value)}
                  />
                </Col>
                <Col span={4}>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeOption(index)}
                  />
                </Col>
              </Row>
            ))}
            <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={addOption}>
              添加 DNS 选项
            </Button>
          </Card>
        </>
      )}
    </div>
  );
};

export default DnsConfigEditor;
