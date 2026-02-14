import React, { useState, useEffect } from 'react';
import { Form, Input, Button, Transfer, message, Select, Descriptions, Tag, Row, Col, Card, Divider, Typography, Space } from 'antd';
import { SafetyCertificateOutlined, GlobalOutlined, DesktopOutlined, CheckCircleOutlined, CheckOutlined, ProfileOutlined, SettingOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { fetchAllInstances, createService, updateService, fetchClouds, fetchCloudProviderEcs } from '../../../services/api';
import { listSecurityDomains } from '../../../services/securityDomainApi';
import { WizardModal } from '../../../components/WizardShell';
import '../../../pages/Clouds/Harvester/modals/VmCreateWizard/InstanceWizard.css';

interface AppWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingApp?: any;
}

const { Title, Text } = Typography;

// Mock Policies for Network and Host
const MOCK_NETWORK_POLICIES = [
  { label: '默认允许 (Permit All)', value: 'np-default-permit', desc: '允许所有出入站流量' },
  { label: '默认拒绝 (Deny All)', value: 'np-default-deny', desc: '拒绝所有非明确允许的流量' },
  { label: 'Web 服务通用策略', value: 'np-web-common', desc: '开放 80/443 端口，允许内网 SSH' },
  { label: '数据库专用策略', value: 'np-db-dedicated', desc: '仅允许应用层访问 3306/5432' },
];

const MOCK_HOST_POLICIES = [
  { label: 'Linux 基础防护', value: 'hp-linux-basic', desc: 'SSH 爆破防护、异常登录检测' },
  { label: 'Windows 防勒索', value: 'hp-win-ransom', desc: '关键目录保护、诱饵文件' },
  { label: '等级保护三级加固', value: 'hp-compliance-l3', desc: '满足等保三级主机安全要求' },
  { label: '容器运行时防护', value: 'hp-container-runtime', desc: '容器逃逸检测、敏感挂载检测' },
];

export const AppWizard: React.FC<AppWizardProps> = ({ open, onClose, onSuccess, editingApp }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [domainLoading, setDomainLoading] = useState(false);
  const [instances, setInstances] = useState<any[]>([]);
  const [cloudmapInstances, setCloudmapInstances] = useState<any[]>([]);
  const [domains, setDomains] = useState<any[]>([]);
  const [clouds, setClouds] = useState<any[]>([]);
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const [basicInfo, setBasicInfo] = useState<any>({});
  const [strategyInfo, setStrategyInfo] = useState<any>({});
  const [policyOptions, setPolicyOptions] = useState<{ label: string; value: string; original: any }[]>([]);
  const [allPolicies, setAllPolicies] = useState<any[]>([]);
  
  const [formBasic] = Form.useForm();
  const [formStrategy] = Form.useForm();
  const [formResource] = Form.useForm();
  const selectedDomainId = Form.useWatch?.('domainId', formBasic);
  const selectedType = Form.useWatch?.('type', formBasic) || formBasic.getFieldValue('type') || 'vm';

  useEffect(() => {
    if (open) {
      loadInstances();
      loadDomains();
      loadClouds();
      loadPolicies();

      if (editingApp) {
        formBasic.setFieldsValue({
            name: editingApp.name,
            version: editingApp.version,
            owner: editingApp.owner,
            domainId: editingApp.domainId,
            type: editingApp.type,
            description: editingApp.description,
        });
        setBasicInfo({
            name: editingApp.name,
            version: editingApp.version,
            owner: editingApp.owner,
            domainId: editingApp.domainId,
            type: editingApp.type,
            description: editingApp.description,
        });

        const allPolicies = editingApp.policyIds || [];
        const networkPolicies = allPolicies.filter((p:string) => p.startsWith('np-'));
        const hostPolicies = allPolicies.filter((p:string) => p.startsWith('hp-'));
        
        formStrategy.setFieldsValue({
            strategies: editingApp.strategies || [],
            networkPolicies: networkPolicies,
            hostPolicies: hostPolicies,
        });
        setStrategyInfo({
            strategies: editingApp.strategies || [],
            networkPolicies: networkPolicies,
            hostPolicies: hostPolicies,
        });

        if (editingApp.type === 'service_address') {
             formResource.setFieldsValue({
                 serviceAddresses: editingApp.serviceAddresses || []
             });
        } else {
             setTargetKeys(editingApp.instances || []);
             formResource.setFieldsValue({
                 servicePorts: editingApp.servicePorts || []
             });
        }
        setCurrentStep(0);
      } else {
        setCurrentStep(0);
        formBasic.resetFields();
        formStrategy.resetFields();
        formResource.resetFields();
        setTargetKeys([]);
        setBasicInfo({});
        setStrategyInfo({});
      }
    }
  }, [open, editingApp]);

  const loadClouds = async () => {
    try {
      const res: any = await fetchClouds();
      const list = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setClouds(list);
    } catch (e) {
      console.error(e);
    }
  };

  const loadPolicies = () => {
    try {
      const raw = localStorage.getItem('ct_policies_custom') || '[]';
      const arr = JSON.parse(raw) || [];
      setAllPolicies(Array.isArray(arr) ? arr : []);
      const opts = (Array.isArray(arr) ? arr : []).map((p: any) => ({ 
        label: p.name || p.id, 
        value: p.id,
        original: p
      }));
      setPolicyOptions(opts);
    } catch { 
      setPolicyOptions([]); 
      setAllPolicies([]);
    }
  };

  const currentDomain = React.useMemo(() => {
    const id = selectedDomainId || formBasic.getFieldValue('domainId');
    return domains.find((d: any) => String(d.id) === String(id));
  }, [domains, selectedDomainId]);

  const vrIdsInDomain: string[] = React.useMemo(() => {
    const raw = (currentDomain as any)?.vrInstanceIds;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((x: any) => String(x)).filter(Boolean);
    return String(raw).split(',').map(s => s.trim()).filter(Boolean);
  }, [currentDomain]);

  useEffect(() => {
    const fetchCloudmapResources = async () => {
      setCloudmapInstances([]);
      if (!currentDomain) return;
      const cid = (currentDomain as any)?.cloudId;
      if (!cid) return;
      
      const cloud = clouds.find((c: any) => String(c.id || c._id || c.uuid) === String(cid));
      const provider = String(cloud?.config?.provider || cloud?.type || '').toLowerCase();
      
      if (provider === 'harvester' || provider.includes('cloudmap')) {
        try {
          setLoading(true);
          const ecsJson: any = await fetchCloudProviderEcs(cid);
          const data = ecsJson?.data || ecsJson;
          const ecsList = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
          
          // Transform to match instance structure
          const mapped = ecsList.map((x: any) => ({
            id: String(x?.InstanceId || x?.id || x?.uuid || ''),
            name: x?.InstanceName || x?.name || x?.id,
            provider: provider, // 'harvester' or 'cloudmap'
            region: cloud?.region || '',
            privateIps: x?.PrivateIpAddress ? [x.PrivateIpAddress] : 
                        (Array.isArray(x?.fixed_ips) ? x.fixed_ips.map((ip:any)=>ip.ip_address) : []),
            vpcId: x?.VpcId || x?.vpcId || x?.vpc_id || '',
            status: x?.State?.Name || x?.status || 'unknown',
            extra: x // Keep original data
          })).filter((x: any) => !!x.id);
          
          setCloudmapInstances(mapped);
        } catch (e) {
          console.error("Failed to fetch cloudmap instances", e);
          setCloudmapInstances([]);
        } finally {
          setLoading(false);
        }
      }
    };
    
    fetchCloudmapResources();
  }, [currentDomain, clouds]);

  const filteredInstances = React.useMemo(() => {
    const vpcId = (currentDomain as any)?.vpcId;
    const vpcStr = vpcId ? String(vpcId) : '';
    
    // Merge instances and cloudmapInstances (avoid duplicates)
    const allCandidates = [...instances];
    cloudmapInstances.forEach(ci => {
      if (!allCandidates.find(i => String(i.id) === String(ci.id))) {
        allCandidates.push(ci);
      }
    });

    return allCandidates
      .filter((i: any) => {
        const ivpc = String(i.vpcId || (i.extra && (i.extra.vpcId || i.extra.vpc_id)) || '');
        return vpcStr ? (ivpc === vpcStr) : true;
      })
      .filter((i: any) => !vrIdsInDomain.includes(String(i.id)));
  }, [instances, cloudmapInstances, currentDomain, vrIdsInDomain]);

  useEffect(() => {
    // 当安全域发生变化时，重置穿梭框选择，避免误清空已选数据的副作用
    if (selectedDomainId !== undefined) {
      if (editingApp && String(editingApp.domainId) === String(selectedDomainId)) {
          return;
      }
      setTargetKeys([]);
      formResource.setFieldsValue({ instances: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDomainId, editingApp]);

  const loadInstances = async () => {
    try {
      setLoading(true);
      const res: any = await fetchAllInstances();
      const list = Array.isArray(res?.data) ? res.data : [];
      setInstances(list);
    } catch (e) {
      console.error(e);
      message.error('加载资源列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadDomains = async () => {
    try {
      setDomainLoading(true);
      const list = await listSecurityDomains();
      const domainList = Array.isArray(list) ? list : [];
      setDomains(domainList);
      
      if (domainList.length > 0) {
        const currentDomainId = formBasic.getFieldValue('domainId');
        if (!currentDomainId) {
          formBasic.setFieldsValue({ domainId: domainList[0].id });
        }
      }
    } catch (e) {
      console.error('Failed to fetch security domains:', e);
      message.error('加载安全域失败');
    } finally {
      setDomainLoading(false);
    }
  };

  const handleNext = async () => {
    if (currentStep === 0) {
      try {
        await formBasic.validateFields();
        setBasicInfo(formBasic.getFieldsValue());
        setCurrentStep(prev => prev + 1);
      } catch {}
    } else if (currentStep === 1) {
      const basic = formBasic.getFieldsValue();
      if (basic.type === 'service_address') {
        try {
          const values = await formResource.validateFields();
          const list = Array.isArray(values.serviceAddresses) ? values.serviceAddresses : [];
          if (!list.length) {
            message.error('请至少配置一个服务地址');
            return;
          }
          setCurrentStep(prev => prev + 1);
        } catch {}
      } else {
        setCurrentStep(prev => prev + 1);
      }
    } else if (currentStep === 2) {
      try {
        await formStrategy.validateFields();
        setStrategyInfo(formStrategy.getFieldsValue());
        setCurrentStep(prev => prev + 1);
      } catch {}
    }
  };

  const handlePrev = () => {
    setCurrentStep(prev => prev - 1);
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await formBasic.validateFields();
      const basic = Object.keys(basicInfo).length ? basicInfo : formBasic.getFieldsValue();
      const resourceType = basic.type || 'vm';
      
      // Always validate resource form to ensure ports/addresses are correct
      await formResource.validateFields();

      const strategy = Object.keys(strategyInfo).length ? strategyInfo : formStrategy.getFieldsValue();
      const dom = domains.find((d: any) => String(d.id) === String(basic.domainId));
      const domainName = dom?.name || undefined;

      const policyIds = (strategy.policyIds || []).map((x: any) => String(x));
      const networkPolicyIds = (strategy.networkPolicyIds || []).map((x: any) => String(x));
      const hostPolicyIds = (strategy.hostPolicyIds || []).map((x: any) => String(x));

      // Auto-detect RBAC/ABAC based on Web Policies
      const hasAbac = policyIds.some((pid: string) => {
        const p = allPolicies.find(x => x.id === pid);
        return p?.conditions && (p.conditions.timeWindow || p.conditions.ipRange);
      });
      const strategies: ('RBAC' | 'ABAC')[] = hasAbac ? ['RBAC', 'ABAC'] : ['RBAC'];

      // Construct payload
      const payload: any = {
        ...basic,
        domainName,
        strategies,
        policyIds,
        networkPolicyIds,
        hostPolicyIds,
        // Legacy support for ACL auto-creation if network policy is selected
        // We map specific mock policies to ACL rules for demonstration
        networkConfig: {
          enableAcl: networkPolicyIds.length > 0,
          allowedSourceCidrs: [], // Default to empty (depends on backend logic or specific policy content)
          defaultAction: networkPolicyIds.includes('np-default-deny') ? 'deny' : 'permit'
        },
        status: 'running',
        type: resourceType
      };

      if (resourceType === 'service_address') {
        const resourceValues = formResource.getFieldsValue();
        const serviceAddresses = Array.isArray(resourceValues.serviceAddresses)
          ? resourceValues.serviceAddresses.filter((x: any) => x && x.protocol && x.ip && x.port)
          : [];
        payload.serviceAddresses = serviceAddresses;
      } else {
        const resourceValues = formResource.getFieldsValue();
        const servicePorts = Array.isArray(resourceValues.servicePorts)
          ? resourceValues.servicePorts.filter((x: any) => x && x.protocol && x.port)
          : [];
        payload.servicePorts = servicePorts;

        const instanceIps = instances
          .filter(i => targetKeys.includes(i.id))
          .flatMap(i => i.privateIps || [])
          .filter(Boolean);
        payload.instanceIps = instanceIps;
        payload.instances = targetKeys;
        payload.instanceCount = targetKeys.length;
      }

      if (editingApp && editingApp.id) {
        await updateService(editingApp.id, payload);
        message.success('应用更新成功');
      } else {
        await createService(payload);
        message.success('应用创建成功');
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      message.error(e.message || (editingApp ? '更新失败' : '创建失败'));
    } finally {
      setLoading(false);
    }
  };

  const transferDataSource = filteredInstances.map(i => ({
    key: i.id,
    title: i.name || i.id,
    description: `${i.provider} / ${i.region} / ${i.privateIps?.join(', ')}`,
    tag: i.provider
  }));

  const renderPolicyCard = (title: string, icon: React.ReactNode, field: string, options: any[], help: string) => (
    <Card 
            title={<Space>{icon}<span>{title}</span></Space>} 
            variant="borderless"
            style={{ height: '100%', background: '#f5f7fa' }}
      headStyle={{ borderBottom: '1px solid #e8e8e8', minHeight: 48 }}
      bodyStyle={{ padding: 16 }}
    >
      <div style={{ marginBottom: 16, height: 40, color: '#666', fontSize: 13 }}>{help}</div>
      <Form.Item name={field} style={{ marginBottom: 0 }}>
        <Select
          mode="multiple"
          allowClear
          placeholder="请选择策略..."
          style={{ width: '100%' }}
          options={options}
          maxTagCount="responsive"
        />
      </Form.Item>
    </Card>
  );

  const basicForSummary = React.useMemo(() => {
    const b = Object.keys(basicInfo).length ? basicInfo : formBasic.getFieldsValue();
    return b || {};
  }, [basicInfo, formBasic]);
  const strategyForSummary = React.useMemo(() => {
    const s = Object.keys(strategyInfo).length ? strategyInfo : formStrategy.getFieldsValue();
    return s || {};
  }, [strategyInfo, formStrategy]);
  const domainNameForSummary = React.useMemo(() => {
    const dom = domains.find((d: any) => String(d.id) === String(basicForSummary.domainId));
    return dom?.name || basicForSummary.domainId || '-';
  }, [domains, basicForSummary]);
  const getLabels = (ids: string[], options: any[]) => {
    if (!ids || !ids.length) return <Text type="secondary">未配置</Text>;
    return ids.map(id => {
      const opt = options.find(o => o.value === id);
      return <Tag key={id}>{opt?.label || id}</Tag>;
    });
  };

  const Step0 = (
    <Form form={formBasic} layout="vertical" initialValues={{ type: 'vm' }} preserve style={{ minHeight: 420 }}>
      <Form.Item name="name" label="应用名称" rules={[{ required: true, message: '请输入应用名称' }]}>
        <Input placeholder="例如：核心交易系统" />
      </Form.Item>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item name="domainId" label="所属安全域" rules={[{ required: true, message: '请选择安全域' }]}>
             <Select 
               placeholder="选择安全域" 
               loading={domainLoading}
               options={domains.map((d: any) => ({ label: d.name || d.id, value: d.id }))}
             />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="version" label="版本">
            <Input placeholder="例如：v1.0.0" />
          </Form.Item>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={12}>
           <Form.Item name="owner" label="负责人">
            <Input placeholder="例如：张三" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="type" label="资源类型">
            <Select
              options={[
                { label: '虚拟机', value: 'vm' },
                { label: '容器', value: 'container' },
                { label: '混合', value: 'mixed' },
                { label: '服务地址', value: 'service_address' }
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="description" label="描述">
        <Input.TextArea rows={4} placeholder="应用的功能描述..." />
      </Form.Item>
    </Form>
  );

  const Step1 = (
    <Form form={formResource} layout="vertical" preserve style={{ height: 450, display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 12, color: '#666' }}>
        {selectedType === 'service_address'
          ? '根据应用暴露的服务地址进行关联，请填写协议、IP、端口。'
          : '请选择属于该应用的资源，关联后将自动下发安全策略。'}
      </div>
      <Form.Item name="instances" hidden>
        <Input type="hidden" />
      </Form.Item>
      {selectedType === 'service_address' ? (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <Form.List name="serviceAddresses">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Row key={field.key} gutter={8} style={{ marginBottom: 8 }}>
                    <Col span={6}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'protocol']}
                        rules={[{ required: true, message: '请选择协议' }]}
                      >
                        <Select placeholder="协议">
                          <Select.Option value="HTTP">HTTP</Select.Option>
                          <Select.Option value="HTTPS">HTTPS</Select.Option>
                          <Select.Option value="TCP">TCP</Select.Option>
                          <Select.Option value="UDP">UDP</Select.Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'ip']}
                        rules={[{ required: true, message: '请输入IP地址' }]}
                      >
                        <Input placeholder="IP 地址" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item
                        {...field}
                        name={[field.name, 'port']}
                        rules={[{ required: true, message: '请输入端口' }]}
                      >
                        <Input placeholder="端口" />
                      </Form.Item>
                    </Col>
                    <Col span={2} style={{ display: 'flex', alignItems: 'center' }}>
                      <Button type="link" danger onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Col>
                  </Row>
                ))}
                <Form.Item>
                  <Button type="dashed" onClick={() => add()} block>
                    新增服务地址
                  </Button>
                </Form.Item>
              </>
            )}
          </Form.List>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Transfer
            dataSource={transferDataSource}
            titles={['待选资源池', '已关联资源']}
            targetKeys={targetKeys}
            onChange={(keys) => {
              setTargetKeys(keys as string[]);
              formResource.setFieldsValue({ instances: keys });
            }}
            render={(item) => (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span>
                  {item.title} <Tag style={{ marginLeft: 8 }}>{item.tag}</Tag>
                </span>
                <span style={{ fontSize: 12, color: '#999' }}>{item.description}</span>
              </div>
            )}
            showSearch
            filterOption={(inputValue, item) =>
              item.title.indexOf(inputValue) > -1 || item.description.indexOf(inputValue) > -1
            }
            listStyle={{
              width: '45%',
              height: 280
            }}
            style={{ flex: 1 }}
          />
          <div style={{ marginTop: 16, border: '1px solid #f0f0f0', padding: 12, borderRadius: 4, background: '#fafafa' }}>
            <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 13, color: '#666' }}>服务端口配置 (应用于所有选定实例)</div>
            <Form.List name="servicePorts">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                      <Form.Item
                        {...restField}
                        name={[name, 'protocol']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Select placeholder="协议" style={{ width: 100 }}>
                          <Select.Option value="TCP">TCP</Select.Option>
                          <Select.Option value="UDP">UDP</Select.Option>
                        </Select>
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'port']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input placeholder="端口 (如 80)" style={{ width: 120 }} />
                      </Form.Item>
                      <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                    </Space>
                  ))}
                  <Form.Item style={{ marginBottom: 0 }}>
                    <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />} size="small">
                      添加端口
                    </Button>
                  </Form.Item>
                </>
              )}
            </Form.List>
          </div>
        </div>
      )}
    </Form>
  );

  const Step2 = (
    <Form form={formStrategy} layout="vertical" preserve >
      <div style={{ marginBottom: 16, color: '#666' }}>
        统一管理 Web 访问、网络传输与主机系统的安全策略。请从策略库中选择已定义的策略模板。
      </div>
      <Row gutter={16} style={{ height: 420 }}>
        <Col span={8} style={{ height: '100%' }}>
          {renderPolicyCard(
            'Web 访问控制', 
            <GlobalOutlined style={{ color: '#1890ff' }} />, 
            'policyIds',
            policyOptions,
            '基于身份 (RBAC) 与属性 (ABAC) 的细粒度 Web 资源访问控制。'
          )}
        </Col>
        <Col span={8} style={{ height: '100%' }}>
          {renderPolicyCard(
            '网络访问控制', 
            <SafetyCertificateOutlined style={{ color: '#52c41a' }} />, 
            'networkPolicyIds',
            MOCK_NETWORK_POLICIES,
            '基于网络 ACL 与微隔离技术的流量访问控制策略。'
          )}
        </Col>
        <Col span={8} style={{ height: '100%' }}>
          {renderPolicyCard(
            '主机安全控制', 
            <DesktopOutlined style={{ color: '#722ed1' }} />, 
            'hostPolicyIds',
            MOCK_HOST_POLICIES,
            '操作系统层面的入侵检测、防病毒与基线合规策略。'
          )}
        </Col>
      </Row>
    </Form>
  );

  const Step3 = (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <CheckCircleOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 16 }} />
        <Title level={3}>确认应用配置</Title>
        <Text type="secondary">请核对以下信息，提交后将自动下发安全策略。</Text>
      </div>
      
      <Descriptions bordered column={1} labelStyle={{ width: 160 }}>
        <Descriptions.Item label="应用名称">{basicForSummary.name}</Descriptions.Item>
        <Descriptions.Item label="所属安全域">{domainNameForSummary}</Descriptions.Item>
        <Descriptions.Item label="关联实例资源">{targetKeys.length} 个实例</Descriptions.Item>
        
        <Descriptions.Item label={<Space><GlobalOutlined /> Web 策略</Space>}>
          {getLabels(strategyForSummary.policyIds || [], policyOptions)}
        </Descriptions.Item>
        
        <Descriptions.Item label={<Space><SafetyCertificateOutlined /> 网络策略</Space>}>
          {getLabels(strategyForSummary.networkPolicyIds || [], MOCK_NETWORK_POLICIES)}
        </Descriptions.Item>
        
        <Descriptions.Item label={<Space><DesktopOutlined /> 主机策略</Space>}>
          {getLabels(strategyForSummary.hostPolicyIds || [], MOCK_HOST_POLICIES)}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );

  const stepTitles = ['基础信息', '资源关联', '策略配置', '确认完成'];
  const getStepIcon = (idx: number) => {
    switch (idx) {
      case 0: return <ProfileOutlined />;
      case 1: return <DesktopOutlined />;
      case 2: return <SettingOutlined />;
      default: return <GlobalOutlined />;
    }
  };

  return (
    <WizardModal open={open} onCancel={onClose} title="创建应用" width={'65vw'} bodyVh={75} centered bodyPaddingTop={12}>
      <Row gutter={[0, 0]} style={{ height: '100%' }}>
        <Col span={5}>
          <div className="wizard-sidebar">
            <div>
              {stepTitles.map((t, idx) => (
                <div
                  key={t}
                  className={`wizard-step ${currentStep===idx?'active':''} ${idx < currentStep ? 'completed' : ''}`}
                  onClick={()=> setCurrentStep(idx)}
                >
                  <div className="wizard-step-icon">
                    {idx < currentStep ? (<CheckOutlined />) : (getStepIcon(idx))}
                  </div>
                  <span className="wizard-step-text">{t}</span>
                </div>
              ))}
            </div>
          </div>
        </Col>
        <Col span={19} style={{ height: '100%' }}>
          <div className="wizard-section" style={{ paddingLeft: 30, paddingRight: 0 }}>
            <div className="wizard-section-title">
              {['填写应用基础信息', '关联资源', '配置安全策略', '确认并创建'][currentStep]}
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
              <div style={{ flex: 1, minHeight: 0 }}>
                <div style={{ display: currentStep === 0 ? 'block' : 'none', height: '100%' }}>
                  {Step0}
                </div>
                <div style={{ display: currentStep === 1 ? 'block' : 'none', height: '100%' }}>
                  {Step1}
                </div>
                <div style={{ display: currentStep === 2 ? 'block' : 'none', height: '100%' }}>
                  {Step2}
                </div>
                <div style={{ display: currentStep === 3 ? 'block' : 'none', height: '100%' }}>
                  {Step3}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
                <Space>
                  <Button onClick={onClose}>取消</Button>
                  {currentStep > 0 && <Button onClick={handlePrev}>上一步</Button>}
                  {currentStep < 3 && <Button type="primary" onClick={handleNext}>下一步</Button>}
                  {currentStep === 3 && (
                    <Button type="primary" onClick={handleSubmit} loading={loading}>提交创建</Button>
                  )}
                </Space>
              </div>
            </div>
          </div>
        </Col>
      </Row>
    </WizardModal>
  );
};
