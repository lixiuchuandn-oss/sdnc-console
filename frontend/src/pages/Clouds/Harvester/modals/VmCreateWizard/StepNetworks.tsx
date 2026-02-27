/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机创建向导 - 网络配置步骤 (StepNetworks)
 * 文件路径: frontend/src/pages/Clouds/Harvester/modals/VmCreateWizard/StepNetworks.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 负责配置虚拟机的网络接口，包含主网卡 (Primary NIC) 和辅助网卡 (Secondary NICs)。
 * 支持多种网络模式：扁平网络 (Flat/NAD)、VPC 网络 (Kube-OVN)、直通网络 (SR-IOV/Macvtap)。
 *
 * [核心逻辑]
 * 1. [主网卡 (Primary NIC)]:
 *    - 必须存在，作为虚拟机的默认网关接口。
 *    - 模式切换：切换 Flat/VPC/Passthrough 时，会自动重置关联字段 (VPC/Subnet/NAD)。
 * 2. [辅助网卡 (Secondary NICs)]:
 *    - 支持动态添加多块网卡，每块网卡可独立配置模式。
 *    - 支持混合使用不同类型的网络接口。
 * 3. [网络类型过滤]:
 *    - 扁平网络 (Flat): 排除 kube-ovn 相关的 NAD。
 *    - 直通网络 (Passthrough): 仅显示 sriov 或 macvtap 类型的 NAD。
 *    - VPC 网络: 联动选择 VPC 和 Subnet，自动填充 CIDR。
 *
 * ------------------------------------------------------------------------------
 * [交互/依赖说明 (Dependencies & Interactions)]
 * ------------------------------------------------------------------------------
 * 说明模块的数据流向、依赖关系或 API 交互。
 *
 * 1. 数据流向:
 *    [父组件 Wizard] -> [Props 注入列表数据] -> [StepNetworks 表单渲染] -> [Form 状态更新]
 *
 * 2. 关键依赖/接口:
 *    - [GET] /k8s/apis/k8s.cni.cncf.io/v1/network-attachment-definitions (NAD列表)
 *    - [GET] /k8s/apis/kube-ovn.io/v1/vpcs (VPC列表)
 *    - [GET] /k8s/apis/kube-ovn.io/v1/subnets (Subnet列表)
 *    - [外部回调] reloadNads, reloadKubeVpcs, reloadKubeSubnets
 *
 * 3. 数据提交映射:
 *    - Form Values -> Harvester VM Spec (spec.template.spec.networks)
 * ==============================================================================
 */
import React from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Card, Typography } from 'antd';
import { MinusCircleOutlined } from '@ant-design/icons';

/**
 * [接口定义] StepNetworksProps
 * 定义了网络配置步骤所需的数据源和状态控制方法。
 */
interface StepNetworksProps {
  /** Form 实例，用于数据绑定和操作 (Ant Design FormInstance) */
  form: any;
  /** 
   * 当前主网卡网络模式状态 ('flat' | 'vpc' | 'passthrough')
   * 用于控制 UI 布局显示不同的配置表单 (NAD 选择 vs VPC/Subnet 选择)
   */
  netModeState: string;
  /** 更新主网卡网络模式状态的回调函数 */
  setNetModeState: (mode: string) => void;
  /** 
   * 扁平网络 (NAD) 选项列表
   * 包含 ClusterNetwork 和 Harvester 默认网络，需过滤掉 Kube-OVN 相关网络
   */
  nadOptions: any[];
  /** 触发重新加载 NAD 数据的回调 (通常在下拉框展开时调用) */
  reloadNads: () => void;
  /** VPC 选项列表 (Kube-OVN VPCs) */
  kubeVpcOptions: any[];
  /** 触发重新加载 VPC 数据的回调 */
  reloadKubeVpcs: () => void;
  /** 子网数据列表 (包含详细信息，如 cidr, vpc 所属关系) */
  kubeSubnets: any[];
  /** 触发重新加载子网数据的回调 */
  reloadKubeSubnets: () => void;
  /** 当前选中的网卡索引 (用于高亮显示或定位，暂未深度使用) */
  selectedNetIdx: number | null;
  /** 设置当前选中网卡索引的函数 */
  setSelectedNetIdx: (idx: number | null) => void;
}

// --- 常量定义 ---

/**
 * [配置常量] 支持的网卡接口类型
 * - bridge: 默认桥接模式
 * - sriov: 物理网卡 SR-IOV 直通 (高性能)
 * - macvtap: MacVTap 模式
 */
const NIC_TYPES = [
  { label: 'bridge', value: 'bridge' },
  { label: 'sriov', value: 'sriov' },
  { label: 'macvtap', value: 'macvtap' }
];

/**
 * [配置常量] 虚拟网卡模型
 * - virtio: 性能最好 (默认)
 * - e1000/e1000e: 兼容性好，模拟 Intel 网卡
 * - rtl8139: 兼容旧系统
 */
const NIC_MODELS = [
  { label: 'virtio', value: 'virtio' },
  { label: 'e1000', value: 'e1000' },
  { label: 'e1000e', value: 'e1000e' },
  { label: 'rtl8139', value: 'rtl8139' }
];

const StepNetworks: React.FC<StepNetworksProps> = ({
  form,
  netModeState,
  setNetModeState,
  nadOptions,
  reloadNads,
  kubeVpcOptions,
  reloadKubeVpcs,
  kubeSubnets,
  reloadKubeSubnets,
  selectedNetIdx,
  setSelectedNetIdx,
}) => {
  return (
    <>
      <Typography.Paragraph type="secondary">设定新建云主机的网络接口配置</Typography.Paragraph>
      
      {/* ==================== 主网卡配置区域 ==================== */}
      <div className="wizard-group-title">主网卡</div>
      <Row gutter={12}>
        {/* 1. 网络类型选择 (扁平网络 / VPC网络 / 直通网卡) */}
        <Col span={8}>
          <Form.Item label="网络类型" name="netMode" initialValue={netModeState || 'flat'} rules={[{ required: true, message: '请选择网络类型' }]}>
            <Select
              options={[{ label: '扁平网络', value: 'flat' }, { label: 'VPC网络', value: 'vpc' }, { label: '直通网卡', value: 'passthrough' }]}
              placeholder="选择网络类型"
              onChange={(v) => { 
                // [状态重置] 切换网络模式时，重置主网卡配置并初始化类型
                setNetModeState(v); 
                const initialType = v === 'vpc' ? 'bridge' : (v === 'passthrough' ? 'sriov' : 'bridge');
                try { 
                  form.setFieldsValue({ 
                    netMode: v, 
                    primaryNic: { 
                      type: initialType, 
                      model: 'virtio', 
                      name: undefined, 
                      vpc: undefined, 
                      subnet: undefined, 
                      macAddress: undefined, 
                      ipAddress: undefined, 
                      gateway: undefined, 
                      dns: undefined 
                    } 
                  }); 
                } catch { } 
                if (v === 'vpc') { reloadKubeVpcs(); reloadKubeSubnets(); } 
              }}
            />
          </Form.Item>
        </Col>

        {/* 2. 根据网络类型动态渲染配置项 */}
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
          {({ getFieldValue }) => {
            const mode = getFieldValue('netMode') || 'flat';
            return (mode === 'flat' || mode === 'passthrough') ? (
              // --- 扁平网络 / 直通网络 模式配置 ---
              <Col span={8}>
                <Form.Item label={mode === 'passthrough' ? '直通网络' : '选择网络'} name={["primaryNic", 'name']} rules={[{ required: true, message: '请选择网络' }]}>
                  <Select
                    placeholder={mode === 'passthrough' ? '选择直通网络（SR-IOV/macvtap NAD）' : '选择网络'}
                    options={mode === 'passthrough' 
                      ? (nadOptions || []).filter((x: any) => {
                          // [过滤逻辑] 直通模式仅显示 SR-IOV 或 Macvtap 类型的 NAD
                          const t = String((x as any)?._type || '').toLowerCase();
                          if (t) return t === 'sriov' || t === 'macvtap';
                          const lbl = String(x?.label || '').toLowerCase();
                          return lbl.includes('sriov') || lbl.includes('macvtap');
                        }) 
                      : (function () {
                          // [业务规则] 扁平网络模式下排除 Kube-OVN 类型的 NAD，因其属于 VPC 网络范畴
                          const filtered = (nadOptions || []).filter((x: any) => !String(x?.label || '').toLowerCase().includes('kube-ovn'));
                          return filtered;
                        })()}
                    onDropdownVisibleChange={async (open) => { if (open) reloadNads(); }}
                    onChange={(val) => {
                      // [业务规则] 默认 Pod 网络需使用 masquerade 模式以支持 SNAT，指定 NAD 时使用 bridge
                      try {
                        const curr = form.getFieldValue('primaryNic') || {};
                        const m = form.getFieldValue('netMode') || 'flat';
                        if (m === 'flat') {
                          const isPod = !val; // 空值为默认 Pod 网络
                          const nextType = isPod ? 'masquerade' : 'bridge';
                          form.setFieldsValue({ primaryNic: { ...curr, name: val, type: nextType } });
                        } else {
                          form.setFieldsValue({ primaryNic: { ...curr, name: val } });
                        }
                      } catch {}
                    }}
                    allowClear={mode !== 'passthrough'}
                  />
                </Form.Item>
              </Col>
            ) : (
              // --- VPC 网络模式配置 ---
              <>
                <Col span={8}>
                  <Form.Item label="VPC" name={["primaryNic", 'vpc']} rules={[{ required: true }]}>
                    <Select
                      placeholder="选择 VPC"
                      options={kubeVpcOptions}
                      onDropdownVisibleChange={(open) => { if (open) reloadKubeVpcs(); }}
                      onChange={(val) => { 
                        try { 
                          const curr = form.getFieldValue('primaryNic') || {}; 
                          // [状态同步] 切换 VPC 时，重置子网和网络名称
                          const next = { ...curr, vpc: val, subnet: undefined, name: undefined }; 
                          form.setFieldsValue({ primaryNic: next }); 
                        } catch { } 
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="子网" name={["primaryNic", 'subnet']} rules={[{ required: true }]}>
                    <Select
                      placeholder="选择 VPC 子网"
                      options={(function () { 
                        // [过滤逻辑] 仅显示当前选中 VPC 下的子网
                        const vpc = form.getFieldValue(['primaryNic', 'vpc']); 
                        const list = kubeSubnets || []; 
                        const filtered = vpc ? list.filter((x: any) => x?.vpc === vpc) : []; 
                        return filtered.map((x: any) => ({ label: `${x?.name || '-'} (${x?.vpc || '-'})`, value: x?.name })); 
                      })()}
                      onDropdownVisibleChange={(open) => { if (open) reloadKubeSubnets(); }}
                      onChange={(val) => { 
                        try { 
                          const curr = form.getFieldValue('primaryNic') || {}; 
                          // [状态同步] 选择子网时，自动将其名称作为网络名称
                          const next = { ...curr, name: val }; 
                          form.setFieldsValue({ primaryNic: next }); 
                        } catch { } 
                      }}
                    />
                  </Form.Item>
                </Col>
                {/* 仅用于显示选中子网的 CIDR 信息，不可编辑 */}
                <Col span={8}>
                  <Form.Item
                    label="子网网段"
                    shouldUpdate={(prev, curr) =>
                      prev.primaryNic?.subnet !== curr.primaryNic?.subnet
                    }
                  >
                    {({ getFieldValue }) => {
                      const subnetName = getFieldValue(['primaryNic', 'subnet']);
                      const vpc = getFieldValue(['primaryNic', 'vpc']);
                      // [匹配逻辑] 需同时匹配名称和 VPC ID，避免跨 VPC 同名子网冲突
                      const subnet = (kubeSubnets || []).find((x: any) => x?.name === subnetName && x?.vpc === vpc);
                      return <Input value={subnet?.cidr || ''} disabled />;
                    }}
                  </Form.Item>
                </Col>
              </>
            );
          }}
        </Form.Item>

        {/* 3. 通用物理属性配置 (类型、模型、MAC、IP) */}
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode || prev.primaryNic?.type !== curr.primaryNic?.type || prev.primaryNic?.name !== curr.primaryNic?.name}>
          {({ getFieldValue }) => {
            const mode = getFieldValue('netMode') || 'flat';
            const t = getFieldValue(['primaryNic','type']);
            const netName = getFieldValue(['primaryNic','name']) || '';
            const isPod = mode === 'flat' && !netName;
            
            // [选项逻辑] 根据模式生成可用的网卡类型选项
            const typeOptions = mode === 'passthrough'
              ? [{ label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]
              : (mode === 'vpc'
                ? [{ label: 'bridge', value: 'bridge' }]
                : (isPod ? [{ label: 'masquerade', value: 'masquerade' }, { label: 'bridge', value: 'bridge' }] : [{ label: 'bridge', value: 'bridge' }]));
            
            const initialType = mode === 'passthrough' ? 'sriov' : (mode === 'vpc' ? 'bridge' : (isPod ? 'masquerade' : 'bridge'));
            
            return (
              <>
                <Col span={8}>
                  <Form.Item label="类型" name={["primaryNic", 'type']} initialValue={initialType}>
                    <Select options={typeOptions} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="模型" name={["primaryNic", 'model']} initialValue="virtio">
                    <Select disabled={t === 'sriov'} options={NIC_MODELS} />
                  </Form.Item>
                </Col>
              </>
            );
          }}
        </Form.Item>
        <Col span={8}>
          <Form.Item label="MAC 地址" name={["primaryNic", 'macAddress']} rules={[{ pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/, message: '格式如 52:54:00:12:34:56' }]} >
            <Input placeholder="52:54:00:12:34:56" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="静态IP" name={["primaryNic", 'ipAddress']} rules={[{ pattern: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/, message: '请输入有效的 IP 地址 (如 192.168.1.10 或 192.168.1.10/24)' }]} >
            <Input placeholder="192.168.1.10/24" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="网关" name={["primaryNic", 'gateway']}>
            <Input placeholder="192.168.1.1" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="DNS" name={["primaryNic", 'dns']}>
            <Input placeholder="8.8.8.8" />
          </Form.Item>
        </Col>
      </Row>


      {/* 
        ========================================
        2. 辅助网卡配置区域 
        ========================================
      */}
      <div className="wizard-group-title">辅助网卡</div>
      <Form.List name="netIfaces" initialValue={[]}>
        {(fields, { add, remove }) => (
          <div>
            {/* 遍历渲染所有辅助网卡 */}
            {fields.map(({ key, name }, idx) => {
              const nm = form.getFieldValue(['netIfaces', name, 'name']) || '(未选择)';
              const tp = form.getFieldValue(['netIfaces', name, 'type']) || 'masquerade';
              const mode = form.getFieldValue(['netIfaces', name, 'mode']) || 'flat';
              
              // 卡片标题：包含序号、网络名称和类型
              const title = (
                <div>
                  {`#${idx + 2} ${nm} · ${String(tp).toUpperCase()}`}
                </div>
              );
              const canRemove = true;
              return (
                <Card
                  key={key}
                  size="small"
                  title={title}
                  extra={canRemove ? (
                    <Button
                      type="text"
                      icon={<MinusCircleOutlined />}
                      onClick={(e) => { 
                        e.stopPropagation?.(); 
                        // [状态更新] 删除网卡时，如果删除的是当前选中项或其前面的项，需更新选中索引
                        if (selectedNetIdx === idx) {
                          setSelectedNetIdx(null);
                        } 
                        else if (selectedNetIdx !== null && idx < selectedNetIdx) {
                          setSelectedNetIdx(selectedNetIdx - 1);
                        }
                        remove(name); 
                      }}
                      danger
                    />
                  ) : undefined}
                  className="wizard-disk-card"
                  style={{ marginBottom: 12 }}
                >
                  <Row gutter={12}>
                    {/* 根据辅助网卡的模式 (flat/vpc) 渲染不同的配置表单 */}
                    {(['flat', 'passthrough'].includes(form.getFieldValue(['netIfaces', name, 'mode']) || 'flat')) ? (
                      // --- 辅助网卡：扁平网络 / 直通网络 模式 ---
                      <Col span={8}>
                        <Form.Item label={(form.getFieldValue(['netIfaces', name, 'mode']) || 'flat') === 'passthrough' ? '直通网络' : '扁平网络'} name={[name, 'name']} rules={[{ required: true }]}>
                          <Select
                            placeholder="选择网络"
                            options={(form.getFieldValue(['netIfaces', name, 'mode']) || 'flat') === 'passthrough' 
                              ? (nadOptions || []).filter((x: any) => {
                                  // [业务规则] 直通模式仅显示 SR-IOV 或 Macvtap 类型的 NAD
                                  const t = String((x as any)?._type || '').toLowerCase();
                                  if (t) return t === 'sriov' || t === 'macvtap';
                                  const lbl = String(x?.label || '').toLowerCase();
                                  return lbl.includes('sriov') || lbl.includes('macvtap');
                                }) 
                              : (nadOptions || []).filter((x: any) => {
                                  // [业务规则] 扁平网络模式下排除 Kube-OVN 类型的 NAD
                                  return !String(x?.label || '').toLowerCase().includes('kube-ovn');
                                })}
                            onDropdownVisibleChange={async (open) => { if (open) reloadNads(); }}
                            onChange={(val) => {
                              try {
                                const curr = form.getFieldValue('netIfaces') || [];
                                const next = [...curr];
                                const m = form.getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                                // [业务规则] 扁平辅助网卡选择 NAD 时，类型强制为 bridge (不支持 masquerade)
                                next[name] = { ...next[name], name: val, ...(m === 'flat' ? { type: 'bridge' } : {}) };
                                form.setFieldsValue({ netIfaces: next });
                              } catch {}
                            }}
                          />
                        </Form.Item>
                      </Col>
                    ) : (
                      // --- 辅助网卡：VPC 网络模式 ---
                      <>
                        <Col span={8}>
                          <Form.Item label="VPC" name={[name, 'vpc']} rules={[{ required: true }]}>
                            <Select
                              placeholder="选择 VPC"
                              options={kubeVpcOptions}
                              onDropdownVisibleChange={(open) => { if (open) reloadKubeVpcs(); }}
                              onChange={(val) => { 
                                try { 
                                  const curr = form.getFieldValue('netIfaces') || []; 
                                  const next = [...curr]; 
                                  // [状态同步] 切换 VPC 时重置子网和名称
                                  next[name] = { ...next[name], vpc: val, subnet: undefined, name: undefined }; 
                                  form.setFieldsValue({ netIfaces: next }); 
                                } catch { } 
                              }}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="子网" name={[name, 'subnet']} rules={[{ required: true }]}>
                            <Select
                              placeholder="选择 VPC 子网"
                              options={(function () { 
                                // [过滤逻辑] 根据当前网卡的 VPC 过滤子网
                                const vpc = form.getFieldValue(['netIfaces', name, 'vpc']); 
                                const list = kubeSubnets || []; 
                                const filtered = vpc ? list.filter((x: any) => x?.vpc === vpc) : []; 
                                return filtered.map((x: any) => ({ label: `${x?.name || '-'} (${x?.vpc || '-'})`, value: x?.name })); 
                              })()}
                              onDropdownVisibleChange={(open) => { if (open) reloadKubeSubnets(); }}
                              onChange={(val) => { 
                                try { 
                                  const curr = form.getFieldValue('netIfaces') || []; 
                                  const next = [...curr]; 
                                  // [状态同步] 选择子网时，自动设置网络名称，且类型设为 bridge
                                  next[name] = { ...next[name], name: val, type: 'bridge' }; 
                                  form.setFieldsValue({ netIfaces: next }); 
                                } catch { } 
                              }}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            label="子网网段"
                            shouldUpdate={(prev, curr) =>
                              prev.netIfaces?.[name]?.subnet !== curr.netIfaces?.[name]?.subnet
                            }
                          >
                            {({ getFieldValue }) => {
                              const subnetName = getFieldValue(['netIfaces', name, 'subnet']);
                              const vpc = getFieldValue(['netIfaces', name, 'vpc']);
                              const subnet = (kubeSubnets || []).find((x: any) => x?.name === subnetName && x?.vpc === vpc);
                              return <Input value={subnet?.cidr || ''} disabled />;
                            }}
                          </Form.Item>
                        </Col>
                      </>
                    )}

                    {/* --- 通用物理属性 (类型/模型/MAC/IP/Gateway/DNS) --- */}
                    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netIfaces?.[name]?.mode !== curr.netIfaces?.[name]?.mode || prev.netIfaces?.[name]?.type !== curr.netIfaces?.[name]?.type}>
                      {({ getFieldValue }) => {
                        const mode2 = getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                        // [选项逻辑] 根据模式生成可用的网卡类型选项
                        const opts = mode2 === 'passthrough'
                          ? [{ label: 'sriov', value: 'sriov' }, { label: 'macvtap', value: 'macvtap' }]
                          : (mode2 === 'vpc' ? [{ label: 'bridge', value: 'bridge' }] : [{ label: 'bridge', value: 'bridge' }]);
                        const initType2 = mode2 === 'passthrough' ? 'sriov' : (mode2 === 'vpc' ? 'bridge' : 'bridge');
                        return (
                          <Col span={8}>
                            <Form.Item label="类型" name={[name, 'type']} initialValue={initType2}>
                              <Select options={opts} />
                            </Form.Item>
                          </Col>
                        );
                      }}
                    </Form.Item>
                    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netIfaces?.[name]?.type !== curr.netIfaces?.[name]?.type}>
                      {({ getFieldValue }) => {
                        const typ = getFieldValue(['netIfaces', name, 'type']);
                        return (
                          <Col span={8}>
                            <Form.Item label="模型" name={[name, 'model']} initialValue="virtio">
                              <Select disabled={typ === 'sriov'} options={NIC_MODELS} />
                            </Form.Item>
                          </Col>
                        );
                      }}
                    </Form.Item>
                    <Col span={8}>
                      <Form.Item label="MAC 地址" name={[name, 'macAddress']} rules={[{ pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/, message: '格式如 52:54:00:12:34:56' }]} >
                        <Input placeholder="52:54:00:12:34:56" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="静态IP" name={[name, 'ipAddress']} rules={[{ pattern: /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/, message: '请输入有效的 IP 地址' }]} style={{ marginBottom: (form.getFieldValue(['netIfaces', name, 'mode']) || 'flat') === 'vpc' ? 0 : undefined }}>
                        <Input placeholder="192.168.1.10/24" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="网关" name={[name, 'gateway']} style={{ marginBottom: (form.getFieldValue(['netIfaces', name, 'mode']) || 'flat') === 'vpc' ? 0 : undefined }}>
                        <Input placeholder="192.168.1.1" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="DNS" name={[name, 'dns']} style={{ marginBottom: 0 }}>
                        <Input placeholder="8.8.8.8" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item label="网络模式" name={[name, 'mode']} initialValue="flat" hidden>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
            
            {/* 按钮区域：添加辅助网卡 */}
            <Space>
              <Button onClick={() => { reloadNads(); add({ mode: 'flat', type: 'bridge', model: 'virtio' }); }}>添加扁平网络网卡</Button>
              <Button onClick={() => { reloadKubeVpcs(); reloadKubeSubnets(); add({ mode: 'vpc', type: 'bridge', model: 'virtio' }); }}>添加VPC网卡</Button>
              <Button onClick={() => { reloadNads(); add({ mode: 'passthrough', type: 'sriov', model: 'virtio' }); }}>添加直通网卡</Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepNetworks;
