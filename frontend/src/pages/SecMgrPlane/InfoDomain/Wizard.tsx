import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Divider, Form, Input, Radio, Row, Col, Select, Space, Steps, message, Descriptions } from 'antd';
import { ArrowLeftOutlined, UserOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import { fetchVrCachePageList, normalizeVrRows } from '../../../services/vrCacheApi';
import { fetchClouds, fetchCloudProviderVpcs, createCloudProviderVpc } from '../../../services/api';
import { createInfoDomain, InfoDomainPayload } from '../../../services/infoDomainApi';

interface VRRowOpt { uuid: string; name: string; }

const InfoDomainWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const [current, setCurrent] = useState<number>(0);
  const [form] = Form.useForm();

  const [vrOptions, setVrOptions] = useState<VRRowOpt[]>([]);
  const [vrLoading, setVrLoading] = useState<boolean>(false);

  const [clouds, setClouds] = useState<any[]>([]);
  const [cloudLoading, setCloudLoading] = useState<boolean>(false);
  const [normalizedVpcs, setNormalizedVpcs] = useState<Array<{ id: string; name: string; label: string }>>([]);
  const [vpcLoading, setVpcLoading] = useState<boolean>(false);

  const stepTitle = useMemo(() => {
    if (current === 0) return '设定基础信息';
    if (current === 1) return '设定信息域';
    return '确认信息域';
  }, [current]);

  const loadVRList = async () => {
    setVrLoading(true);
    try {
      const res = await fetchVrCachePageList(50, 1);
      const list = (res?.data?.page || res?.data || res?.page || res?.list || []) as any[];
      const opts: VRRowOpt[] = normalizeVrRows(list);
      setVrOptions(opts);
    } catch (e: any) {
      message.warning('VR 列表获取失败');
      setVrOptions([]);
    } finally { setVrLoading(false); }
  };

  const providerName = (p?: string, type?: string) => {
    const key = (p || type || '').toLowerCase();
    if (key.includes('aliyun') || key === 'aliyun') return '阿里云';
    if (key.includes('huaweicloud') || key === 'huaweicloud') return '华为云';
    if (key.includes('tencent') || key === 'tencentcloud') return '腾讯云';
    if (key.includes('aws')) return 'AWS';
    if (key.includes('gcp')) return 'GCP';
    return type || p || '未知云';
  };

  const cloudLabel = (c: any) => {
    const prov = providerName(c?.config?.provider, c?.type);
    const region = c?.region || '-';
    const name = c?.name || c?.id || '未命名资源池';
    return `${name}（${prov} / ${region}）`;
  };

  const loadClouds = async () => {
    setCloudLoading(true);
    try {
      const res = await fetchClouds();
      const list = (res?.data || res || []);
      setClouds(Array.isArray(list) ? list : []);
    } catch (e: any) {
      message.warning('云资源池获取失败');
      setClouds([]);
    } finally { setCloudLoading(false); }
  };

  const loadCloudVpcs = async (cloudId: string) => {
    if (!cloudId) { setNormalizedVpcs([]); return; }
    setVpcLoading(true);
    try {
      const res = await fetchCloudProviderVpcs(String(cloudId));
      const data = (res?.data || res || {});
      const cloud = clouds.find((c) => String(c?.id || c?._id || c?.uuid || c?.cloudId) === String(cloudId));
      const provider = (cloud?.config?.provider || cloud?.type || '').toLowerCase();
      let arr: any[] = [];
      if (provider === 'aliyun') {
        arr = (data?.Vpcs?.Vpc) || (data?.VpcSets) || [];
      } else if (provider === 'huaweicloud') {
        arr = (data?.vpcs) || (data?.data?.vpcs) || [];
      } else if (provider === 'tencentcloud') {
        arr = (data?.VpcSet) || [];
      } else {
        arr = Array.isArray((data as any)) ? (data as any) : (data?.list || []);
      }
      const normalized = (Array.isArray(arr) ? arr : []).map((v: any) => {
        const id = v.VpcId || v.id || v.uuid || v.vpc_id || v.vpcId || v.ID || v.Name || '';
        const name = v.VpcName || v.name || v.Vpc || v.DisplayName || id || 'VPC';
        const cidr = v.CidrBlock || v.cidr || v.cidrBlock || v.network || v.address || v.vpc_cidr || '';
        const label = `${name}（${id ? String(id).slice(0,8) : '—'}）${cidr ? ' / ' + cidr : ''}`;
        return { id: String(id), name: String(name), label };
      }).filter(x => !!x.id);
      setNormalizedVpcs(normalized);
    } catch (e: any) {
      message.warning('云端 VPC 获取失败');
      setNormalizedVpcs([]);
    } finally { setVpcLoading(false); }
  };

  useEffect(() => { loadVRList(); loadClouds(); }, []);

  const onPrev = () => setCurrent((c) => Math.max(0, c - 1));
  const onNext = async () => {
    try {
      if (current === 0) {
        await form.validateFields(['name','category','subType']);
      } else if (current === 1) {
        const isVpc = form.getFieldValue('category') === 'vpc';
        if (isVpc) {
          await form.validateFields(['cloudId','vpcMode']);
          if (form.getFieldValue('vpcMode') === 'existing') {
            await form.validateFields(['vpcId','vrBindingMode']);
            if (form.getFieldValue('vrBindingMode') === 'existing') await form.validateFields(['vrUuid']);
          } else {
            await form.validateFields(['newVpcName','newVpcCidr','vrBindingMode']);
            if (form.getFieldValue('enableIpv6')) {
              await form.validateFields(['newVpcIpv6Cidr']);
            }
            if (form.getFieldValue('vrBindingMode') === 'existing') await form.validateFields(['vrUuid']);
          }
        } else {
          await form.validateFields(['vrUuid']);
        }
      }
      setCurrent((c) => c + 1);
    } catch (e) {}
  };

  const onCreate = async () => {
    try {
      const values = form.getFieldsValue(true);
      const isVpc = form.getFieldValue('category') === 'vpc';
      if (isVpc && values.vpcMode === 'new' && values.cloudId && values.newVpcCidr) {
        try {
          await createCloudProviderVpc(String(values.cloudId), {
            VpcName: values.newVpcName,
            CidrBlock: values.newVpcCidr,
            EnableIpv6: !!values.enableIpv6,
            Ipv6CidrBlock: values.enableIpv6 ? values.newVpcIpv6Cidr : undefined,
          });
          message.success('云端 VPC 创建请求已提交');
        } catch (e: any) {
          message.warning('云端 VPC 创建失败，信息域仍将创建');
        }
      }

      const subType = form.getFieldValue('subType');
      const payload: InfoDomainPayload = {
        name: values.name,
        category: values.category,
        subType,
        cidr: !isVpc ? String(values.cidr || '') : undefined,
        cidr6: !isVpc ? String(values.cidr6 || '') : undefined,
        cloudId: isVpc ? String(values.cloudId || '') : undefined,
        vpcMode: isVpc ? values.vpcMode : undefined,
        vpcId: isVpc && values.vpcMode === 'existing' ? String(values.vpcId || '') : undefined,
        newVpcName: isVpc && values.vpcMode === 'new' ? String(values.newVpcName || '') : undefined,
        newVpcCidr: isVpc && values.vpcMode === 'new' ? String(values.newVpcCidr || '') : undefined,
        vrUuid: !isVpc ? String(values.vrUuid || '') : (values.vrBindingMode === 'existing' ? String(values.vrUuid || '') : undefined),
        vrName: (() => {
          const id = values.vrUuid;
          return id ? (vrOptions.find(v => v.uuid === id)?.name) : undefined;
        })(),
        tags: (() => {
          const extra = Array.isArray(values.tags) ? values.tags : (values.tags ? String(values.tags).split(',').map(s=>s.trim()).filter(Boolean) : []);
          return extra.join(',');
        })(),
        description: values.description,
        status: 'active',
      };

      await createInfoDomain(payload);
      message.success('信息域已创建');
      navigate('/admin/sec-mgr-plane/info-domain');
    } catch (e) {}
  };

  return (
    <PageContainer
      title={<span><UserOutlined style={{ marginRight: 6, color: '#1677ff' }} />信息域设置向导</span>}
      titleLevel={3}
      subtitle="按照步骤设定信息域大类/子类、选择资源池与 VPC 或绑定 VR 实例，并最终确认配置。"
      extra={<Space><Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button><Button icon={<ReloadOutlined />} onClick={() => { loadVRList(); loadClouds(); const cid = form.getFieldValue('cloudId'); if (cid) loadCloudVpcs(cid); }}>刷新</Button></Space>}
      asCard={false}
    >
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps direction="vertical" size="small" current={current} onChange={(idx) => setCurrent(idx)} items={[{ title: '设定基础信息' }, { title: '设定信息域' }, { title: '确认信息域' }]} />
          </Card>
        </Col>
        <Col span={19}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${current + 1} 步：${stepTitle}`}</span>} variant="outlined">
            <Form
              form={form}
              layout="vertical"
              initialValues={{ vpcMode: 'existing', vrBindingMode: 'auto', enableIpv6: false }}
              onValuesChange={(changed, all) => {
                if (changed.cloudId) loadCloudVpcs(changed.cloudId);
                if (changed.category) {
                  form.setFieldsValue({ subType: undefined, cloudId: undefined, vpcMode: 'existing', vpcId: undefined, newVpcName: undefined, newVpcCidr: undefined, vrUuid: undefined, vrBindingMode: 'auto' });
                }
                if (changed.subType) {
                  form.setFieldsValue({ cloudId: undefined, vpcMode: 'existing', vpcId: undefined, newVpcName: undefined, newVpcCidr: undefined, vrUuid: undefined, vrBindingMode: 'auto' });
                }
                if (changed.vpcMode) {
                  if (changed.vpcMode === 'existing') { form.setFieldsValue({ newVpcName: undefined, newVpcCidr: undefined }); }
                  else if (changed.vpcMode === 'new') { form.setFieldsValue({ vpcId: undefined }); }
                }
              }}
            >
              {current === 0 && (
                <>
                  <Form.Item name="name" label="信息域名称" rules={[{ required: true, message: '请输入信息域名称' }]}> 
                    <Input placeholder="如：华东生产VPC / 总部办公网" />
                  </Form.Item>
                  <Form.Item name="category" label="信息域大类" rules={[{ required: true, message: '请选择大类' }]}> 
                    <Select placeholder="请选择大类" options={[{ value: 'vpc', label: 'VPC网络' }, { value: 'flat', label: '扁平网络' }]} />
                  </Form.Item>
                  <Form.Item shouldUpdate={(prev, cur) => prev.category !== cur.category} noStyle>
                    {() => (
                      <Form.Item name="subType" label="信息域子类" rules={[{ required: true, message: '请选择子类' }]}> 
                        <Select showSearch optionFilterProp="label" disabled={!form.getFieldValue('category')} placeholder={form.getFieldValue('category') ? '请选择子类' : '请先选择大类'} notFoundContent={form.getFieldValue('category') ? '暂无选项' : '请先选择大类'} options={(() => {
                          const cat = form.getFieldValue('category');
                          const vpcSubs = [{ value: '公有云VPC网络', label: '公有云VPC网络' }, { value: '私有云VPC网络', label: '私有云VPC网络' }];
                          const flatSubs = [{ value: '虚拟化网络', label: '虚拟化网络' }, { value: 'IDC网络', label: 'IDC网络' }, { value: '办公网络', label: '办公网络' }];
                          if (cat === 'vpc') return vpcSubs;
                          if (cat === 'flat') return flatSubs;
                          return [];
                        })()} />
                      </Form.Item>
                    )}
                  </Form.Item>
                  <Form.Item name="description" label="用途说明"> 
                    <Input.TextArea rows={3} placeholder="设定信息域用途与说明" />
                  </Form.Item>
                  <Form.Item name="tags" label="标签"> 
                    <Select mode="tags" tokenSeparators={[',', ' ']} placeholder="如：prod,east,office" />
                  </Form.Item>
                </>
              )}

              {current === 1 && (
                <>
                  {form.getFieldValue('category') === 'vpc' ? (
                    <>
                      <Form.Item name="cloudId" label="选择已接入的云资源池" rules={[{ required: true, message: '请选择资源池' }]}> 
                        <Select placeholder="请选择资源池（含云厂商与地域）" loading={cloudLoading} options={clouds.map(c => ({ value: c.id || c._id || c.uuid || c.cloudId || c.name, label: cloudLabel(c) }))} />
                      </Form.Item>
                      <Form.Item name="vpcMode" label="VPC来源" rules={[{ required: true, message: '请选择 VPC 来源' }]}> 
                        <Radio.Group>
                          <Radio value="existing">选择已有 VPC</Radio>
                          <Radio value="new">新建 VPC（云端）</Radio>
                        </Radio.Group>
                      </Form.Item>
                      <Form.Item shouldUpdate={(prev, cur) => prev.vpcMode !== cur.vpcMode} noStyle>
                        {() => (
                          form.getFieldValue('vpcMode') === 'existing' && (
                            <Form.Item name="vpcId" label="选择 VPC" rules={[{ required: true, message: '请选择 VPC' }]}> 
                              <Select placeholder="从云端拉取（自动适配云厂商接口）" loading={vpcLoading} options={normalizedVpcs.map(v => ({ value: v.id, label: v.label }))} />
                            </Form.Item>
                          )
                        )}
                      </Form.Item>
                      <Form.Item shouldUpdate={(prev, cur) => prev.vpcMode !== cur.vpcMode || prev.enableIpv6 !== cur.enableIpv6} noStyle>
                        {() => (
                          form.getFieldValue('vpcMode') === 'new' && (
                            <>
                              <Form.Item name="newVpcName" label="VPC名称" rules={[{ required: true, message: '请输入 VPC 名称' }]}> 
                                <Input placeholder="例如：prod-vpc-shanghai" />
                              </Form.Item>
                              <Form.Item name="newVpcCidr" label="VPC CIDR"> 
                                <Input placeholder="例如：10.0.0.0/16" />
                              </Form.Item>
                              <Form.Item name="enableIpv6" label="启用 IPv6"> 
                                <Radio.Group>
                                  <Radio value={true}>开启</Radio>
                                  <Radio value={false}>关闭</Radio>
                                </Radio.Group>
                              </Form.Item>
                              <Form.Item shouldUpdate={(p,c)=>p.enableIpv6!==c.enableIpv6} noStyle>
                                {() => (
                                  form.getFieldValue('enableIpv6') && (
                                    <Form.Item name="newVpcIpv6Cidr" label="VPC IPv6 CIDR" rules={[{ required: true, message: '请输入 IPv6 CIDR' }]}> 
                                      <Input placeholder="例如：2001:db8::/32" />
                                    </Form.Item>
                                  )
                                )}
                              </Form.Item>
                            </>
                          )
                        )}
                      </Form.Item>
                      <Form.Item name="vrBindingMode" label="VR 绑定" rules={[{ required: true, message: '请选择 VR 绑定方式' }]}> 
                        <Radio.Group>
                          <Radio value="auto">自动部署 VR 实例</Radio>
                          <Radio value="existing">绑定已有 VR 实例（仅限 CE）</Radio>
                        </Radio.Group>
                      </Form.Item>
                      <Form.Item shouldUpdate={(prev, cur) => prev.vrBindingMode !== cur.vrBindingMode} noStyle>
                        {() => (
                          form.getFieldValue('vrBindingMode') === 'existing' && (
                            <Form.Item name="vrUuid" label="选择 VR 实例" rules={[{ required: true, message: '请选择 VR 实例' }]}> 
                              <Select showSearch optionFilterProp="label" placeholder={vrLoading ? '加载中...' : '选择已部署的 VR 实例'} options={vrOptions.map(v => ({ value: v.uuid, label: `${v.name} (${String(v.uuid).slice(0,8)})` }))} loading={vrLoading} notFoundContent={vrLoading ? '加载中...' : '暂无数据'} filterOption={(input, option) => { const text = String((option as any)?.label ?? (option as any)?.value ?? '').toLowerCase(); return text.includes(String(input).toLowerCase()); }} onDropdownVisibleChange={(open) => { if (open) { loadVRList(); } }} onFocus={() => { loadVRList(); }} allowClear />
                            </Form.Item>
                          )
                        )}
                      </Form.Item>
                    </>
                  ) : (
                    <>
                      <Form.Item name="vrUuid" label="选择 VR 实例" rules={[{ required: true, message: '请选择 VR 实例' }]}> 
                        <Select showSearch optionFilterProp="label" placeholder={vrLoading ? '加载中...' : '选择已部署的 VR 实例'} options={vrOptions.map(v => ({ value: v.uuid, label: `${v.name} (${String(v.uuid).slice(0,8)})` }))} loading={vrLoading} notFoundContent={vrLoading ? '加载中...' : '暂无数据'} filterOption={(input, option) => { const text = String((option as any)?.label ?? (option as any)?.value ?? '').toLowerCase(); return text.includes(String(input).toLowerCase()); }} onDropdownVisibleChange={(open) => { if (open) { loadVRList(); } }} onFocus={() => { loadVRList(); }} allowClear />
                      </Form.Item>
                      <Form.Item name="cidr" label="IPv4 CIDR"> 
                        <Input placeholder="例如：10.0.0.0/16" />
                      </Form.Item>
                      <Form.Item name="cidr6" label="IPv6 CIDR"> 
                        <Input placeholder="例如：2001:db8::/32,2001:db8:1::/48" />
                      </Form.Item>
                    </>
                  )}
                </>
              )}

              {current === 2 && (
                <>
                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="信息域名称">{String(form.getFieldValue('name')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="大类/子类">{String(form.getFieldValue('category')||'—')} / {String(form.getFieldValue('subType')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="VPC 来源">{String(form.getFieldValue('vpcMode')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="云资源池">{String(form.getFieldValue('cloudId')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="VPC">{String(form.getFieldValue('vpcId')||form.getFieldValue('newVpcName')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="CIDR">{String(form.getFieldValue('newVpcCidr')||form.getFieldValue('cidr')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="VR">{String(form.getFieldValue('vrUuid')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="用途说明">{String(form.getFieldValue('description')||'—')}</Descriptions.Item>
                    <Descriptions.Item label="标签">{((form.getFieldValue('tags')||[]) as string[]).join(', ')||'—'}</Descriptions.Item>
                  </Descriptions>
                </>
              )}

            </Form>
          </Card>
        </Col>
      </Row>

      <div style={{ display:'flex', justifyContent:'space-between', marginTop: 16 }}>
        <Space>
          <Button onClick={onPrev}>上一步</Button>
          <Button type="primary" onClick={() => { if (current < 2) onNext(); else onCreate(); }}>{current<2? '下一步':'提交创建'}</Button>
        </Space>
      </div>
    </PageContainer>
  );
};

export default InfoDomainWizardPage;