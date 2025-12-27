import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Descriptions, Divider, Form, Input, Radio, Row, Select, Space, Spin, Steps, Switch, Tabs, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import PageContainer from '../../../components/PageContainer';
import { vrApi } from '../../../services/vrApi';
import { getVRConfig } from '../../../services/vrConfigApi';
import { createIPsecVPN } from '../../../services/api';
import { ReloadOutlined } from '@ant-design/icons';

const { Option } = Select;
// Tabs 用于配置预览，保持与 SRv6 创建页一致

const IPsecVPNWizard: React.FC = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [current, setCurrent] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [vrLoading, setVrLoading] = useState(false);
  const [vrs, setVrs] = useState<any[]>([]);
  const [ifaceLoading, setIfaceLoading] = useState<boolean>(false);
  const [peerPresetAvailable, setPeerPresetAvailable] = useState<boolean>(false);
  const [usePeerPreset, setUsePeerPreset] = useState<boolean>(false);
  const [localPreset, setLocalPreset] = useState<any>(null);
  const [peerPreset, setPeerPreset] = useState<any>(null);
  const [localPresetAvailable, setLocalPresetAvailable] = useState<boolean>(false);
  const [useLocalPreset, setUseLocalPreset] = useState<boolean>(false);

  const ipv4ToInt = (ip: string): number => {
    const parts = ip.split('.').map(p => parseInt(p, 10));
    if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return NaN;
    return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  };
  const intToIpv4 = (n: number): string => {
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
  };
  const cidrToNetwork = (cidr: string): string => {
    const s = String(cidr || '').trim();
    const [ip, maskStr] = s.split('/');
    const mask = parseInt(maskStr || '', 10);
    if (!ip || isNaN(mask) || mask < 0 || mask > 32) return s;
    const ipInt = ipv4ToInt(ip);
    if (isNaN(ipInt)) return s;
    const maskInt = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    const networkInt = (ipInt & maskInt) >>> 0;
    return `${intToIpv4(networkInt)}/${mask}`;
  };

  useEffect(() => {
    (async () => {
      await fetchVRs();
      form.setFieldsValue({
        ikeVersion: 'v2',
        encryption: 'aes-256',
        authentication: 'sha256',
        dhGroup: '14',
        pfs: 'group14',
        mode: 'tunnel',
      });
    })();
  }, []);

  const fetchVRs = async () => {
    setVrLoading(true);
    try {
      const resp: any = await vrApi.getVRInstances(200, 1);
      const data: any = resp?.data ?? resp;
      let list: any[] = Array.isArray(data?.page)
        ? data.page
        : Array.isArray(data?.list)
        ? data.list
        : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data)
        ? (data as any[])
        : [];
      // 后备方案：沿用 VR 列表页的直连拉取与解析，提升兼容性
      if (!list || list.length === 0) {
        const accesskey = 'Cloudmap%23123';
        const secretkey = 'Cloudmap%23123';
        const path = '/V2/ctcontrol/VR1/pagelist';
        const method = 'GET';
        const other = `page_size=${200}&page_num=${1}`;
        const authUrl = `/api-proxy/api/sign?url=${encodeURIComponent(path)}&method=${method}&other=${encodeURIComponent(other)}&accessKey=${accesskey}&secretKey=${secretkey}`;
        const signResp = await fetch(authUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '' });
        const signJson = await signResp.json();
        const info = (signJson && (signJson as any).data) ? (signJson as any).data : signJson;
        const listUrl = `/api-proxy${path}?${other}`;
        const res2 = await fetch(listUrl, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json', 'Authorization': info.Authorization, 'tonce': String(info.tonce) }
        });
        const response2 = await res2.json();
        const data2: any = (response2 && (response2 as any).data) ? (response2 as any).data : response2;
        list = Array.isArray(data2?.page)
          ? data2.page
          : Array.isArray(data2?.list)
          ? data2.list
          : Array.isArray(data2?.rows)
          ? data2.rows
          : Array.isArray(data2)
          ? (data2 as any[])
          : [];
      }
      setVrs(list || []);
    } catch (error: any) {
      console.error('获取VR列表失败:', error);
      message.error('获取VR列表失败');
    } finally {
      setVrLoading(false);
    }
  };

  const prefillFromVrPreset = async (which: 'local' | 'remote', vrUuid: string) => {
    // 立即设置 ID，确保即使获取配置失败，表单也能记录选中状态
    if (which === 'local') {
      form.setFieldsValue({ vrId: vrUuid });
    } else {
      form.setFieldsValue({ peerVrId: vrUuid });
    }

    try {
      const cfg = await getVRConfig(vrUuid);
      const preset = cfg?.ipsec_preset || null;
      if (which === 'local') {
        setLocalPreset(preset);
        const hasPreset = !!(preset?.local_subnet || preset?.public_ip);
        setLocalPresetAvailable(hasPreset);
        setUseLocalPreset(false);
        form.setFieldsValue({
          localSubnet: cidrToNetwork(preset?.local_subnet || form.getFieldValue('localSubnet')),
          localPublicIp: preset?.public_ip || form.getFieldValue('localPublicIp'),
        });
      } else {
        setPeerPreset(preset);
        const hasPreset = !!(preset?.local_subnet || preset?.public_ip);
        setPeerPresetAvailable(hasPreset);
        // 默认使用 VR 预设（关闭手动输入），仅当无预设时才允许手动
        setUsePeerPreset(false);
        form.setFieldsValue({
          remoteSubnet: cidrToNetwork(preset?.local_subnet || form.getFieldValue('remoteSubnet')),
          // 优先使用 v2 的 public_ip 作为对端设备公网 IP；旧版仍兼容
          remoteGateway: preset?.public_ip || form.getFieldValue('remoteGateway'),
        });
      }
    } catch (e: any) {
      message.warning((e?.message || '读取VR配置失败') + ` (${which})`);
    }
  };

  const next = async () => {
    try {
      if (current === 0) {
        await form.validateFields(['name']);
      } else if (current === 1) {
        await form.validateFields(['vrId', 'peerVrId', 'localSubnet', 'remoteGateway', 'remoteSubnet', 'psk']);
      }
      const n = Math.min(2, current + 1);
      setCurrent(n);
    } catch {}
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      const payload = {
        ...values,
        localSubnet: cidrToNetwork(values?.localSubnet),
        remoteSubnet: cidrToNetwork(values?.remoteSubnet),
      };
      console.log('Creating IPsec VPN with payload:', payload);
      await createIPsecVPN(payload);
      message.success('IPsec VPN 创建成功');
      navigate('/admin/interconnect/ipsec');
    } catch (error: any) {
      console.error('Creation failed:', error);
      message.error(error?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  const safeStringify = (obj: any): string => {
    try {
      return JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2);
    } catch {
      try {
        const cloned = JSON.parse(JSON.stringify(obj || {}));
        return JSON.stringify(cloned, null, 2);
      } catch {
        return String(obj);
      }
    }
  };
  const localPreview = useMemo(() => {
    const v = form.getFieldsValue(true) || {};
    return {
      name: v.name,
      vrId: v.vrId,
      peer_vr_id: v.peerVrId, // 显示对端VR ID，消除用户疑虑
      localSubnet: v.localSubnet,
      remote_gateway: v.remoteGateway, // 本端配置也需要知道对端网关
      remote_subnet: v.remoteSubnet,   // 本端配置也需要知道对端子网
    };
  }, [form, current]);
  const remotePreview = useMemo(() => {
    const v = form.getFieldsValue(true) || {};
    return {
      peerVrId: v.peerVrId,
      remoteGateway: v.remoteGateway,
      remoteSubnet: v.remoteSubnet,
      psk: v.psk ? '******' : undefined,
    };
  }, [form, current]);

  return (
    <PageContainer
      title="创建 IPsecVPN（向导）"
      titleLevel={3}
      subtitle="按步骤选择本端/对端VR、子网与安全参数，完成创建。"
      extra={<Button icon={<ReloadOutlined />} onClick={fetchVRs}>刷新VR列表</Button>}
      onBack={() => navigate(-1)}
      asCard={false}
      contentPadding={16}
    >
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 600 }}>步骤</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Steps
              direction="vertical"
              size="small"
              current={current}
              onChange={(idx) => setCurrent(idx)}
              items={[
                { title: '基础信息与模式' },
                { title: '选择本端与对端' },
                { title: '确认创建' },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<span style={{ fontSize: 13, color: '#000', fontWeight: 400 }}>{`第 ${current + 1} 步：${['基础信息与模式','选择本端与对端','确认创建'][current]} 配置编辑`}</span>} variant="outlined">
            <Form layout="vertical" form={form} hideRequiredMark>
              <div style={{ display: current === 0 ? 'block' : 'none' }}>
                <Form.Item name="name" label={<span style={{ fontSize: 13, color: '#595959' }}>名称</span>} rules={[{ required: true, message: '请输入VPN名称' }]}>
                  <Input placeholder="请输入VPN名称" />
                </Form.Item>
                <Form.Item name="description" label={<span style={{ fontSize: 13, color: '#595959' }}>描述</span>}>
                  <Input.TextArea rows={2} placeholder="请输入描述信息" />
                </Form.Item>
              </div>
              <div style={{ display: current === 1 ? 'block' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#1677ff' }}>本端网关</span>
                  <Space size={4}>
                    <span style={{ fontSize: 12, color: '#595959' }}>使用 VR 预设</span>
                    <Switch size="small" checked={!useLocalPreset} onChange={(v) => setUseLocalPreset(!v)} disabled={!localPresetAvailable} />
                  </Space>
                </div>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="vrId" label={<span style={{ fontSize: 13, color: '#595959' }}>本端网关 (VR实例)</span>} rules={[{ required: true, message: '请选择VR实例' }]}>
                      <Select
                        placeholder="选择VR实例"
                        loading={vrLoading}
                        showSearch
                        onChange={(val: string) => prefillFromVrPreset('local', val)}
                        filterOption={(input, option) => (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())}
                      >
                        {vrs.map(vr => (
                          <Option key={vr.uuid || vr.id} value={vr.uuid || vr.id}>
                            {vr.name || vr.uuid || vr.id}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="localPublicIp" label={<span style={{ fontSize: 13, color: '#595959' }}>本端公网 IP</span>}>
                      <Input placeholder="自动读取" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                </Row>
                
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item name="localSubnet" label={<span style={{ fontSize: 13, color: '#595959' }}>本端子网</span>} rules={[{ required: true, message: '请输入本端子网' }]}>
                      <Input placeholder="例如: 192.168.1.0/24" disabled={!useLocalPreset && localPresetAvailable} />
                    </Form.Item>
                  </Col>
                  <Col span={12}></Col>
                </Row>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>
        <span style={{ fontSize: 13, color: '#1677ff' }}>对端网关</span>
        <Space size={4}>
          <span style={{ fontSize: 12, color: '#595959' }}>使用 VR 预设</span>
          <Switch size="small" checked={!usePeerPreset} onChange={(v) => setUsePeerPreset(!v)} disabled={!peerPresetAvailable} />
        </Space>
      </div>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item name="peerVrId" label={<span style={{ fontSize: 13, color: '#595959' }}>对端网关 (VR实例)</span>} rules={[{ required: true, message: '请选择对端 VR 实例' }]}>
            <Select
              placeholder="选择对端 VR（可选）"
              loading={vrLoading}
              showSearch
              onChange={(val: string) => prefillFromVrPreset('remote', val)}
              filterOption={(input, option) => (option?.children as unknown as string).toLowerCase().includes(input.toLowerCase())}
            >
              {vrs.map(vr => (
                <Option key={vr.uuid || vr.id} value={vr.uuid || vr.id}>
                  {vr.name || vr.uuid || vr.id}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item name="remoteGateway" label={<span style={{ fontSize: 13, color: '#595959' }}>对端公网 IP</span>} rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端公网 IP' }]}>
            <Input placeholder="例如: 1.2.3.4" disabled={!usePeerPreset && peerPresetAvailable} />
          </Form.Item>
        </Col>
      </Row>
      
      <Row gutter={12} style={{ marginBottom: 8 }}>
        <Col span={12}>
          <Form.Item name="remoteSubnet" label={<span style={{ fontSize: 13, color: '#595959' }}>对端子网</span>} rules={[{ required: usePeerPreset || !peerPresetAvailable, message: '请输入对端子网' }]}>
            <Input placeholder="例如: 10.0.0.0/24" disabled={!usePeerPreset && peerPresetAvailable} />
          </Form.Item>
        </Col>
        <Col span={12}></Col>
      </Row>

                <div style={{ fontSize: 13, color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>高级参数配置</div>
                <Form.Item name="ikeVersion" label={<span style={{ fontSize: 13, color: '#595959' }}>IKE 版本</span>}>
                  <Radio.Group>
                    <Radio value="v1">IKEv1</Radio>
                    <Radio value="v2">IKEv2</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="psk" label={<span style={{ fontSize: 13, color: '#595959' }}>认证密钥 (PSK)</span>} rules={[{ required: true, message: '请输入预共享密钥' }]}>
                  <Input.Password placeholder="请输入预共享密钥" />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={8}>
                    <Form.Item name="encryption" label={<span style={{ fontSize: 13, color: '#595959' }}>加密算法</span>}>
                      <Select>
                        <Option value="aes-128">AES-128</Option>
                        <Option value="aes-192">AES-192</Option>
                        <Option value="aes-256">AES-256</Option>
                        <Option value="3des">3DES</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="authentication" label={<span style={{ fontSize: 13, color: '#595959' }}>认证算法</span>}>
                      <Select>
                        <Option value="sha1">SHA1</Option>
                        <Option value="sha256">SHA2-256</Option>
                        <Option value="sha384">SHA2-384</Option>
                        <Option value="sha512">SHA2-512</Option>
                        <Option value="md5">MD5</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="dhGroup" label={<span style={{ fontSize: 13, color: '#595959' }}>DH 组</span>}>
                      <Select>
                        <Option value="2">Group 2</Option>
                        <Option value="5">Group 5</Option>
                        <Option value="14">Group 14</Option>
                        <Option value="19">Group 19</Option>
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name="mode" label={<span style={{ fontSize: 13, color: '#595959' }}>IPsec 模式</span>}>
                  <Radio.Group>
                    <Radio value="tunnel">隧道模式 (Tunnel)</Radio>
                    <Radio value="transport">传输模式 (Transport)</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="pfs" label={<span style={{ fontSize: 13, color: '#595959' }}>PFS (Perfect Forward Secrecy)</span>}>
                  <Select style={{ width: 200 }}>
                    <Option value="disable">不启用</Option>
                    <Option value="group2">Group 2</Option>
                    <Option value="group5">Group 5</Option>
                    <Option value="group14">Group 14</Option>
                  </Select>
                </Form.Item>
                <Space style={{ display: 'flex' }} align="baseline">
                  <Form.Item name="natTraversal" label={<span style={{ fontSize: 13, color: '#595959' }}>NAT 穿越 (NAT-T)</span>} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                  <Form.Item name="dpd" label={<span style={{ fontSize: 13, color: '#595959' }}>DPD (死对端检测)</span>} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Space>
              </div>
              <div style={{ display: current === 2 ? 'block' : 'none' }}>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="名称">{form.getFieldValue('name') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端VR">{form.getFieldValue('vrId') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="本端子网">{form.getFieldValue('localSubnet') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端VR">{form.getFieldValue('peerVrId') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端网关">{form.getFieldValue('remoteGateway') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="对端子网">{form.getFieldValue('remoteSubnet') || '-'}</Descriptions.Item>
                  <Descriptions.Item label="IKE">{form.getFieldValue('ikeVersion') || 'v2'}</Descriptions.Item>
                  <Descriptions.Item label="加密">{form.getFieldValue('encryption') || 'aes-256'}</Descriptions.Item>
                  <Descriptions.Item label="认证">{form.getFieldValue('authentication') || 'sha256'}</Descriptions.Item>
                  <Descriptions.Item label="DH">{form.getFieldValue('dhGroup') || '14'}</Descriptions.Item>
                  <Descriptions.Item label="PFS">{form.getFieldValue('pfs') || 'group14'}</Descriptions.Item>
                  <Descriptions.Item label="模式">{form.getFieldValue('mode') || 'tunnel'}</Descriptions.Item>
                  <Descriptions.Item label="NAT-T">{form.getFieldValue('natTraversal') ? '开启' : '关闭'}</Descriptions.Item>
                  <Descriptions.Item label="DPD">{form.getFieldValue('dpd') ? '开启' : '关闭'}</Descriptions.Item>
                  <Descriptions.Item label="描述">{form.getFieldValue('description') || '-'}</Descriptions.Item>
                </Descriptions>
              </div>
            </Form>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Space>
                <Button onClick={() => navigate('/admin/interconnect/ipsec')}>返回列表</Button>
                {current > 0 && <Button onClick={prev}>上一步</Button>}
              </Space>
              <Space>
                {current < 2 && <Button type="primary" onClick={next}>下一步</Button>}
                {current === 2 && (
                  <Button type="primary" onClick={handleCreate} loading={loading}>创建 VPN</Button>
                )}
              </Space>
            </div>
          </Card>
        </Col>
        <Col span={7}>
          <Card size="small" title={<span style={{ fontSize: 13, fontWeight: 600 }}>配置 JSON预览</span>} variant="outlined" style={{ position: 'sticky', top: 16 }}>
            <Tabs
              size="small"
              defaultActiveKey="local"
              items={[
                {
                  key: 'local',
                  label: '本端预览',
                  children: (
                    <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>
                      {safeStringify({
                        ...localPreview,
                        localPublicIp: localPreset?.public_ip,
                      })}
                    </pre>
                  ),
                },
                {
                  key: 'remote',
                  label: '对端预览',
                  children: (
                    <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto' }}>
                      {safeStringify({
                        ...remotePreview,
                        remotePublicIp: peerPreset?.public_ip,
                      })}
                    </pre>
                  ),
                },
                {
                  key: 'raw',
                  label: 'VR源数据',
                  children: (
                    <div style={{ maxHeight: 400, overflow: 'auto' }}>
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff' }}>本端 VR (Preset)</div>
                        <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                          {safeStringify(localPreset)}
                        </pre>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1677ff' }}>对端 VR (Preset)</div>
                        <pre style={{ fontSize: 11, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                          {safeStringify(peerPreset)}
                        </pre>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </PageContainer>
  );
};

export default IPsecVPNWizard;
