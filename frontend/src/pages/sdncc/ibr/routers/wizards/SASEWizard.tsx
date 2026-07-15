import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Form, Input, message, Steps, Spin, Select, Switch, Modal, Checkbox } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { getVRConfig, saveVRConfig, setVRRole } from '../../../../../services/virtualRouterApi';
import { fetchSrv6VrReferences, proxyApiRequest } from '../../../../../services/api';
import { renderIfaceWizardSelectLabel } from '../vrWizardIfaceSelect';
import {
  handleWizardStepsChange,
  validateWizardStepsThrough,
  warnFormValidationFailure,
} from '../vrWizardFormUtils';
import {
  buildIpsecPresetVrConfigFromValues,
  stripIpsecPresetWizardPlatformBlocks,
} from '../ipsecPresetWizardLib';
import { sortVrConfigJsonKeys } from '../vrConfigJsonSort';
import IbrWizardCard, { ibrWizardStepCardTitle } from '../../lib/IbrWizardCard';
import IbrWizardPage from '../../lib/IbrWizardPage';
import IbrWizardStepPane from '../../lib/IbrWizardStepPane';

const SASEWizard: React.FC = () => {
  const navigate = useNavigate();
  const { uuid } = useParams();
  const [form] = Form.useForm();
  const [mirrorForm] = Form.useForm();
  const [current, setCurrent] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [deviceCfg, setDeviceCfg] = useState<any>(null);
  const [ifaceOptions, setIfaceOptions] = useState<string[]>([]);
  const [ifaceLoading, setIfaceLoading] = useState<boolean>(false);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [confirmChecked, setConfirmChecked] = useState<boolean>(false);
  /** 仅首包设备回读用于初始化右翼编辑表；之后「刷新设备回读」只更左翼 mirror，不覆盖已编辑内容 */
  const formSeededFromDeviceReadRef = React.useRef(false);
  useEffect(() => {
    formSeededFromDeviceReadRef.current = false;
  }, [uuid]);

  const watchWanIf = Form.useWatch('wanInterface', form);
  const watchLanIf = Form.useWatch('lanInterface', form);
  const wanIfTrim = watchWanIf ? String(watchWanIf).trim() : '';
  const lanIfTrim = watchLanIf ? String(watchLanIf).trim() : '';

  useEffect(() => {
    if (!deviceCfg) return;
    
    // 辅助函数：查找默认路由网关
    const findDefaultGateway = (dev: any) => {
      if (!dev || !Array.isArray(dev.ipv4_route)) return undefined;
      const route = dev.ipv4_route.find((r: any) => r.destination === '0.0.0.0/0');
      return route ? (route.via || route.dev) : undefined;
    };

    // 重新界定 wan口和 lan口识别
    // CSMCTL 扩展信息 (VR3)查询到的网卡名称，都是通过PCI号转换过来的
    // 按照标准顺序：第一块是WAN口，第二块是LAN口
    
    let wanIfObj: any = null;
    let lanIfObj: any = null;

    // 辅助函数：解析网卡名称中的 PCI 编号并排序
    // 格式如：GigabitEthernet 3/0/0
    // 排序规则：先按物理类型（过滤虚拟卡），再按 PCI 号从小到大排序
    const getSortedPhysicalInterfaces = (interfaces: any[]) => {
      if (!Array.isArray(interfaces)) return [];
      
      return interfaces
        .filter(iface => {
          const name = String(iface?.name || '').toLowerCase();
          // 排除非物理接口 (memif, loopback, tap, host-, etc.)
          // 只保留明确的物理接口标识，如 GigabitEthernet, Ethernet, GE 等
          return name.startsWith('gigabitethernet') || 
                 name.startsWith('ethernet') || 
                 name.startsWith('ge') ||
                 name.startsWith('ten-gigabitethernet') ||
                 name.startsWith('xe');
        })
        .sort((a, b) => {
          // 提取 PCI 编号字符串，例如 "3/0/0"
          const extractPci = (name: string) => {
            const match = name.match(/[\d]+\/[\d]+\/[\d]+/);
            return match ? match[0] : '';
          };
          
          const pciA = extractPci(String(a.name || ''));
          const pciB = extractPci(String(b.name || ''));
          
          // 如果都能提取到 PCI 号，按字符串（或拆分数字）排序
          // "2/0/0" < "3/0/0"
          if (pciA && pciB) {
             return pciA.localeCompare(pciB, undefined, { numeric: true, sensitivity: 'base' });
          }
          // 如果提取不到，回退到按名称排序
          return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
        });
    };

    // 1. 尝试从 deviceCfg.interfaces 中获取并排序
    if (deviceCfg.interfaces && Array.isArray(deviceCfg.interfaces)) {
      const sorted = getSortedPhysicalInterfaces(deviceCfg.interfaces);
      if (sorted.length > 0) wanIfObj = sorted[0]; // 第一块是 WAN
      if (sorted.length > 1) lanIfObj = sorted[1]; // 第二块是 LAN
    } 
    
    // 如果 interfaces 为空，尝试从其他 keys 收集 (兜底)
    if (!wanIfObj && !lanIfObj) {
        const all: any[] = [];
        Object.keys(deviceCfg).forEach(k => {
            if ((k.startsWith('interfaces_') || k.startsWith('subinterfaces_')) && Array.isArray(deviceCfg[k])) {
                all.push(...deviceCfg[k]);
            }
        });
        const sorted = getSortedPhysicalInterfaces(all);
        if (sorted.length > 0) wanIfObj = sorted[0];
        if (sorted.length > 1) lanIfObj = sorted[1];
    }

    const gateway = findDefaultGateway(deviceCfg);
    const wanNat = wanIfObj?.nat;
    const isNatEnabled = !!(wanNat && wanNat.type && wanNat.type !== '');

    const initialValues = {
      wanInterface: wanIfObj?.name,
      wanIpv4: wanIfObj?.ipv4_static,
      wanIpv6: wanIfObj?.ipv6_static,
      ipsecPublicIp: gateway,
      enableNat: isNatEnabled,
      lanInterface: lanIfObj?.name,
      lanIpv4: lanIfObj?.ipv4_static,
      lanIpv6: lanIfObj?.ipv6_static,
    };

    mirrorForm.setFieldsValue(initialValues);
    if (!formSeededFromDeviceReadRef.current) {
      formSeededFromDeviceReadRef.current = true;
      form.setFieldsValue(initialValues);
    }

  }, [deviceCfg, mirrorForm, form]);

  const fetchInterfaces = useCallback(async (silent = false) => {
    if (!uuid) return;
    setIfaceLoading(true);
    try {
      // 1. 获取接口列表 (参考 PEWizard)
      const method = 'GET';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR3/VRConfig/list';
      const raw = await proxyApiRequest(path, method, other);
      const unwrapData = (obj: any) => {
        let cur = obj;
        while (cur && typeof cur === 'object' && 'data' in cur) cur = (cur as any).data;
        return cur;
      };
      const data = unwrapData(raw);
      
      const names: string[] = [];
      const collectFromArray = (arr?: any[]) => { (arr || []).forEach((it) => { if (it && typeof it === 'object' && it.name) names.push(String(it.name)); }); };
      if (data && typeof data === 'object') {
        collectFromArray((data as any).interfaces);
        Object.keys(data).forEach((key) => {
          if (key.startsWith('interfaces_') || key.startsWith('subinterfaces_')) collectFromArray((data as any)[key]);
        });
      }
      const unique = Array.from(new Set(names)).filter((n) => !!n);
      if (unique.length) setIfaceOptions(unique);

      // 2. 使用 VR3 扩展信息作为设备配置 (用于回读显示)
      // CSMCTL 扩展信息 (VR3)查询到的网卡名称，都是通过PCI号转换过来的
      // 按照标准顺序：第一块是WAN口，第二块是LAN口
      setDeviceCfg(data || null);
      
      if (!silent) message.success('设备数据已刷新');
    } catch (err) {
      console.error(err);
      if (!silent) message.error('刷新失败');
    } finally {
      setIfaceLoading(false);
    }
  }, [uuid]);

  const refreshDeviceData = useCallback(
    async (silent = false) => {
      await fetchInterfaces(silent);
    },
    [fetchInterfaces],
  );

  useEffect(() => {
    if (uuid) {
      // 初始加载设备数据
      refreshDeviceData(true);
    }
  }, [uuid, refreshDeviceData]);

  const buildConfigFromValues = (v: any) => buildIpsecPresetVrConfigFromValues(v);

  // 使用 useWatch 实时预览
  const watchedValues = Form.useWatch([], form);
  const configPreview = useMemo(
    () => buildConfigFromValues(watchedValues || form.getFieldsValue(true) || {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchedValues, form],
  );

  const SASE_STEP0_FIELDS = ['wanInterface', 'wanIpv4', 'wanIpv6', 'ipsecPublicIp'];
  const SASE_STEP1_FIELDS = ['lanInterface', 'lanIpv4', 'lanIpv6'];

  const saseFieldsForStep = (step: number) =>
    step === 0 ? SASE_STEP0_FIELDS : step === 1 ? SASE_STEP1_FIELDS : [];

  const validateSaseStepsThrough = (from: number, to: number) =>
    validateWizardStepsThrough(form, from, to, saseFieldsForStep);

  const next = async () => {
    try {
      const ok = await validateSaseStepsThrough(current, current + 1);
      if (!ok) return;
      const newCurrent = Math.min(2, current + 1);
      setCurrent(newCurrent);
      if (newCurrent === 2) {
        await refreshDeviceData(true);
      }
    } catch (err) {
      warnFormValidationFailure(err);
    }
  };
  const prev = () => setCurrent((c) => Math.max(0, c - 1));

  const handleStepsChange = (idx: number) => {
    void handleWizardStepsChange(idx, current, setCurrent, async (from, to) => {
      const ok = await validateSaseStepsThrough(from, to);
      if (ok && to === 2) {
        await refreshDeviceData(true);
      }
      return ok;
    });
  };

  const sortJsonKeys = (obj: any) => sortVrConfigJsonKeys(obj, 'ipsec');

  const handleSave = async () => {
    if (!uuid) {
      message.error('缺少 IBR 的 UUID，无法下发配置');
      return;
    }
    try {
      const refs = await fetchSrv6VrReferences(uuid);
      if (refs?.count && refs.count > 0) {
        const names = Array.from(new Set((refs.refs || []).map((r) => r.tunnelName).filter(Boolean)));
        const namesPart = names.length ? `引用隧道：${names.join('、')}` : '当前 IBR 已被 SRv6 隧道引用';
        message.error(
          `为规避 SRv6 注入路由被向导全量覆盖的风险，当前阶段不允许在角色配置向导中保存/下发该 VR 配置。${namesPart}`,
          8,
        );
        return;
      }
    } catch (e: any) {
      console.warn('SASEWizard: fetchSrv6VrReferences failed:', e);
    }
    try {
      setLoading(true);
      const values = form.getFieldsValue(true);
      let cfg = buildConfigFromValues(values);
      if (uuid) cfg.uuid = uuid;
      cfg.role = 'SASE'; // 确保 role 存在

      // 1. 同步保存到本地数据库 (包含 ipsec_preset)
      try {
        const existing = await getVRConfig(uuid);
        // 合并并排序，确保本地存储也是有序的
        const newCfg = sortJsonKeys({ ...(existing || {}), ...cfg });
        await saveVRConfig(uuid, newCfg);
        await setVRRole(uuid, 'SASE');
      } catch (e: any) {
        console.warn('保存到本地数据库失败:', e);
        throw new Error(e?.message || '保存到平台失败，已中止设备下发');
      }

      // 2. 下发配置到设备 (专家模式接口)
      let deviceCfg = stripIpsecPresetWizardPlatformBlocks(cfg);
      
      // 对下发配置进行排序
      deviceCfg = sortJsonKeys(deviceCfg) as Record<string, unknown>;

      const method = 'POST';
      const other = `uuid=${uuid}`;
      const path = '/V2/ctcontrol/VR2/VRConfig';

      const data = await proxyApiRequest(path, method, other, deviceCfg);
      if (data && typeof data.code === 'number' && data.code !== 200) {
        throw new Error(data?.msg || `下发失败: ${JSON.stringify(data)}`);
      }
      
      message.success('配置已下发到设备');
    } catch (e: any) {
      message.error(e?.message || '下发失败');
    } finally {
      setLoading(false);
    }
  };

  const renderDeviceStatus = (cfg: any) => {
    if (!cfg || Object.keys(cfg).length === 0) {
      return <div style={{ padding: 12, background: '#fffbe6', border: '1px dashed #faad14', borderRadius: 6, color: '#faad14', fontSize: 12 }}>未获取到设备配置（设备回读为空）</div>;
    }

    if (current === 0) {
      return (
        <Form form={mirrorForm} layout="vertical" disabled>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置</div>
          <Form.Item label="外网接口 (WAN)" name="wanInterface"><Input /></Form.Item>
          <Form.Item label="外网 IPv4 (CIDR)" name="wanIpv4"><Input /></Form.Item>
          <Form.Item label="外网 IPv6 (CIDR)" name="wanIpv6"><Input /></Form.Item>
          <Form.Item label="公网网关 (IPv4)" name="ipsecPublicIp"><Input /></Form.Item>
          <Form.Item label="开启 NAT (SNAT)" name="enableNat" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      );
    }
    
    if (current === 1) {
      return (
        <Form form={mirrorForm} layout="vertical" disabled>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置</div>
          <Form.Item label="内网接口 (LAN)" name="lanInterface"><Input /></Form.Item>
          <Form.Item label="内网 IPv4 (CIDR)" name="lanIpv4"><Input /></Form.Item>
          <Form.Item label="内网 IPv6 (CIDR)" name="lanIpv6"><Input /></Form.Item>
        </Form>
      );
    }

    if (current === 2) {
      const values = mirrorForm.getFieldsValue(true);
      return (
        <div style={{ display: 'block' }}>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="外网接口 (WAN)">{values.wanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv4">{values.wanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv6">{values.wanIpv6 || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网网关">{values.ipsecPublicIp || '-'}</Descriptions.Item>
            <Descriptions.Item label="NAT (SNAT)">{values.enableNat ? '开启' : '关闭'}</Descriptions.Item>
          </Descriptions>

          <div style={{ height: 16 }} />

          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="内网接口 (LAN)">{values.lanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv4">{values.lanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv6">{values.lanIpv6 || '-'}</Descriptions.Item>
          </Descriptions>
        </div>
      );
    }

    return null;
  };

  const renderCoreContent = () => {
    // 3. 确认保存 - 准备预览数据
    const values = form.getFieldsValue(true);

    return (
      <Form form={form} layout="vertical">
        {/* Step 1: WAN 侧配置 */}
        <div style={{ display: current === 0 ? 'block' : 'none' }}>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置</div>
          <div style={{ marginBottom: 16 }}>
            <Form.Item
              name="wanInterface"
              label="外网接口 (WAN)"
              tooltip="用于建立隧道的接口（通常连接公网）"
              rules={[{ required: true, message: '请选择外网接口' }]}
            >
              <Select
                placeholder="请选择接口"
                showSearch
                allowClear
                options={ifaceOptions.map((n) => ({
                  value: n,
                  label: renderIfaceWizardSelectLabel(n, lanIfTrim && n === lanIfTrim ? '内网接口 (LAN)' : undefined),
                }))}
                filterOption={(input: string, option?: { value?: string }) =>
                  String(option?.value || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item
              name="wanIpv4"
              label="外网 IPv4 (CIDR)"
              rules={[{ pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/, message: 'IPv4 CIDR 示例：1.2.3.4/24' }]}
            >
              <Input placeholder="例如：1.2.3.4/24" />
            </Form.Item>
            <Form.Item
              name="wanIpv6"
              label="外网 IPv6 (CIDR)"
            >
              <Input placeholder="例如：2001:db8::1/64" />
            </Form.Item>
            <Form.Item
              name="ipsecPublicIp"
              label="公网网关 (IPv4)"
              tooltip="用于生成默认路由 (0.0.0.0/0 via Gateway)"
              rules={[{ pattern: /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, message: '请输入合法的 IPv4 地址' }]}
            >
              <Input placeholder="例如：1.2.3.1（网关地址）" />
            </Form.Item>
            
            <Form.Item
              name="enableNat"
              valuePropName="checked"
              label="开启 NAT (SNAT)"
              tooltip="开启后，LAN 侧访问外网时将自动进行源地址转换 (Masquerade)"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </div>
        </div>

        {/* Step 2: LAN 侧配置 */}
        <div style={{ display: current === 1 ? 'block' : 'none' }}>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置</div>
          <div>
            <Form.Item
              name="lanInterface"
              label="内网接口 (LAN)"
              tooltip="用于连接内部网络的接口"
              rules={[{ required: true, message: '请选择内网接口' }]}
            >
              <Select
                placeholder="请选择接口"
                showSearch
                allowClear
                options={ifaceOptions.map((n) => ({
                  value: n,
                  label: renderIfaceWizardSelectLabel(n, wanIfTrim && n === wanIfTrim ? '外网接口 (WAN)' : undefined),
                }))}
                filterOption={(input: string, option?: { value?: string }) =>
                  String(option?.value || '')
                    .toLowerCase()
                    .includes(input.toLowerCase())
                }
              />
            </Form.Item>
            <Form.Item
              name="lanIpv4"
              label="内网 IPv4 (CIDR)"
              rules={[{ required: true, message: '请输入内网 IPv4' }, { pattern: /^(?:(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}(?:[0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\/([0-9]|[1-2]\d|3[0-2])$/, message: 'IPv4 CIDR 示例：192.168.1.1/24' }]}
            >
              <Input placeholder="例如：192.168.1.1/24" />
            </Form.Item>
            <Form.Item
              name="lanIpv6"
              label="内网 IPv6 (CIDR)"
            >
              <Input placeholder="例如：fd00::1/64" />
            </Form.Item>
          </div>
        </div>

        {/* Step 3: 确认下发 */}
        <div style={{ display: current === 2 ? 'block' : 'none' }}>
          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>WAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="外网接口 (WAN)">{values.wanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv4">{values.wanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="外网 IPv6">{values.wanIpv6 || '-'}</Descriptions.Item>
            <Descriptions.Item label="公网网关">{values.ipsecPublicIp || '-'}</Descriptions.Item>
            <Descriptions.Item label="NAT (SNAT)">{values.enableNat ? '开启' : '关闭'}</Descriptions.Item>
          </Descriptions>

          <div style={{ height: 16 }} />

          <div style={{ color: '#1677ff', margin: '4px 0 12px 0', borderBottom: '1px solid #e8e8e8', paddingBottom: 6 }}>LAN 侧配置确认</div>
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="内网接口 (LAN)">{values.lanInterface || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv4">{values.lanIpv4 || '-'}</Descriptions.Item>
            <Descriptions.Item label="内网 IPv6">{values.lanIpv6 || '-'}</Descriptions.Item>
          </Descriptions>
        </div>
      </Form>
    );
  };

  return (
    <IbrWizardPage
      meta={uuid || undefined}
      subtitle="预置 IPsec 所需的非协商参数，用于后续建链快速预填"
      extra={<Button icon={<ReloadOutlined />} onClick={() => refreshDeviceData()}>刷新设备回读</Button>}
      layout="compare"
      steps={
        <Steps
          direction="vertical"
          size="small"
          current={current}
          onChange={handleStepsChange}
          items={[{ title: 'WAN 侧配置' }, { title: 'LAN 侧配置' }, { title: '确认下发' }]}
        />
      }
      mirror={
        <IbrWizardCard title={ibrWizardStepCardTitle(current, ['WAN 侧配置', 'LAN 侧配置', '确认下发'][current], '设备回读')}>
          {ifaceLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Spin />
            </div>
          ) : renderDeviceStatus(deviceCfg)}
        </IbrWizardCard>
      }
      main={
        <IbrWizardStepPane
          title={ibrWizardStepCardTitle(current, ['WAN 侧配置', 'LAN 侧配置', '确认下发'][current], '配置编辑')}
          footerLeft={
            <>
              <Button onClick={() => navigate('/admin/interconnect/vr')}>返回列表</Button>
              {current > 0 && <Button onClick={prev}>上一步</Button>}
            </>
          }
          footerRight={
            <>
              {current < 2 && <Button type="primary" onClick={next}>下一步</Button>}
              {current === 2 && (
                <Button
                  type="primary"
                  loading={loading}
                  onClick={() => {
                    setConfirmChecked(false);
                    setConfirmOpen(true);
                  }}
                >
                  下发配置
                </Button>
              )}
            </>
          }
        >
          {renderCoreContent()}
        </IbrWizardStepPane>
      }
      preview={
        <IbrWizardCard sticky title="配置 JSON预览">
          <pre style={{ fontSize: 12, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {JSON.stringify(uuid ? { uuid, ...configPreview } : configPreview, null, 2)}
          </pre>
        </IbrWizardCard>
      }
    >
      <Modal
        title="重要提示：配置下发为全量覆盖"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onOk={async () => {
          if (!confirmChecked) return;
          setConfirmOpen(false);
          await handleSave();
        }}
        okButtonProps={{ disabled: !confirmChecked }}
        okText="我已阅读并理解，继续下发"
        cancelText="取消"
        width={680}
      >
        <div style={{ color: '#595959' }}>
          <div style={{ marginBottom: 12 }}>
            本次下发属于全量覆盖。设备当前配置将被完全替换为向导生成的配置，不进行保留或增量合并。
          </div>
          <div style={{ marginBottom: 12 }}>
            影响范围包括但不限于：接口与子接口、IPv4/IPv6 地址与状态、静态路由、NAT 设置、BGP/VRF、SRv6 参数及可能相关的策略项。已有的手工修改可能被覆盖。
          </div>
          <div style={{ marginBottom: 12 }}>
            风险提醒：若默认路由或公网网关设置不正确，设备可能出现短暂不可达；NAT 开关变更会影响内网出网；路由/BGP 变更可能导致业务中断。
          </div>
          <div style={{ marginBottom: 12 }}>
            建议在维护时段执行，并在下发前使用“刷新设备回读”确认当前状态，必要时通过专家模式备份配置，确保具备回滚方案。
          </div>
          <div style={{ marginBottom: 12 }}>
            适用范围：标准、PE、CE、SASE 模式的配置下发均为全量覆盖。
          </div>
          <Checkbox checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)}>
            我已阅读并理解上述内容，确认继续执行全量覆盖下发
          </Checkbox>
        </div>
      </Modal>
    </IbrWizardPage>
  );
};

export default SASEWizard;
