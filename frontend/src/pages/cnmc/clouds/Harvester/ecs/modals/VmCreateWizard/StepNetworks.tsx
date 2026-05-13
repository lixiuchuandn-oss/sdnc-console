/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机创建向导 - 网络配置步骤 (StepNetworks)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/VmCreateWizard/StepNetworks.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 负责配置虚拟机的网络接口，包含主网卡 (Primary NIC) 和辅助网卡 (Secondary NICs)。
 * 支持多种网络模式：NAD 网络（Multus NAD，排除 kube-ovn）、VPC 网络 (Kube-OVN)、直通（SR-IOV/Macvtap）。
 *
 * [核心逻辑]
 * 1. [主网卡 (Primary NIC)]:
 *    - 必须存在，作为虚拟机的默认网关接口。
 *    - 模式切换：切换 Flat/VPC/Passthrough 时，会自动重置关联字段 (VPC/Subnet/NAD)。
 * 2. [辅助网卡 (Secondary NICs)]:
 *    - 支持动态添加多块网卡，每块网卡可独立配置模式。
 *    - 支持混合使用不同类型的网络接口。
 * 3. [网络类型过滤]:
 *    - NAD 网络 (flat): 排除 kube-ovn 类型的 NAD。
 *    - 直通 (Passthrough): 仅显示 CNI 为 sriov / macvtap / macvlan 等的 NAD。
 *    - VPC / 扁平子网: 联动 Subnet，接口类型选项见 harvesterVmIfaceTypeOptions.ts。
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
import React, { useCallback, useState } from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Card, Typography } from 'antd';
import { FileSearchOutlined, MinusCircleOutlined } from '@ant-design/icons';
import {
  ifaceTypeOption,
  NAD_MULTUS_INTERFACE_TYPES,
  PASSTHROUGH_VIRT_IFACE_OPTIONS,
} from './harvesterVmIfaceTypeOptions';
import { KUBE_OVN_FLAT_VPC, isFlatKubeOvnSubnetVpc } from '../../../kube-ovn/lib/kubeOvnSubnetConstants';
import { kubeSubnetChoiceLabel } from '../../../kube-ovn/lib/kubeOvnUiHelpers';
import SubnetDetailDrawer from '../../../kube-ovn/drawers/subnet-detail-drawer';
import { isKubeOvnSubnetNadReady, resolveMultusNetNameForKubeOvnSubnetNic } from './kubeOvnNadRefForVmWizard';

/**
 * 子网选项：NAD 未同步时置灰，当前已选可保留以提示「同步中」。
 * vpcIdForNad 须与 isKubeOvnSubnetNadReady 的 vpc 入参一致（业务 VPC 或子网自己的 vpc/flat）。
 */
function kubeOvnSubnetNadOption(
  x: any,
  nadOptions: any[],
  vpcIdForNad: string,
  currentName: any,
  buildLabel: (x: any) => string,
) {
  const ready = isKubeOvnSubnetNadReady(x, vpcIdForNad, nadOptions);
  const isCurrent = currentName != null && String(x?.name) === String(currentName);
  const base = buildLabel(x);
  let label = base;
  if (!ready) {
    label = isCurrent
      ? `${base}（子网网络未就绪，请稍候重试或刷新后创建）`
      : `${base}（网络未就绪）`;
  }
  return { label, value: x?.name, disabled: !ready && !isCurrent };
}

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
   * NAD 网络选项列表（非 kube-ovn Multus NAD）
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
  /** 当前云 ID：用于打开子网详情抽屉（拓扑 / ACL） */
  cloudId?: string;
}

// --- 常量定义 ---

/** 切换「网络类型」时主网卡类型的默认值（模型默认 virtio，见 handleNetModeChange） */
const DEFAULT_PRIMARY_NIC_TYPE_BY_NET_MODE: Record<string, string> = {
  flat: 'bridge',
  vpc: 'managedtap',
  flat_subnet: 'managedtap',
  passthrough: 'sriov',
};

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

const SUBNET_TYPE_ANNOTATION = 'tower.io/subnet-type';

/** 与 UnderlaySubnetsSection 一致：注解 tower.io/subnet-type=flat 的 Kube-OVN 子网 */
function isKubeOvnFlatSubnet(s: any): boolean {
  const t = String(s?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION] ?? '').trim().toLowerCase();
  return t === 'flat';
}

/** NAD spec.config.type → KubeVirt domain 接口类型（与 VmWizardUtils 中 sriov / macvtap 一致） */
function passthroughKubevirtIfaceTypeFromNad(nadOpt: any): 'sriov' | 'macvtap' {
  const t = String(nadOpt?._type || '').toLowerCase();
  if (t === 'sriov') return 'sriov';
  if (t === 'macvtap' || t === 'macvlan') return 'macvtap';
  return 'sriov';
}

const PASSTHROUGH_TYPE_TOOLTIP =
  '须与所选「直通网络」NAD 的 CNI 类型一致；选择 NAD 后自动设置，不可与 NAD 类型冲突。';

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
  cloudId,
}) => {
  const [subnetDrawerOpen, setSubnetDrawerOpen] = useState(false);
  const [subnetDrawerRecord, setSubnetDrawerRecord] = useState<any | null>(null);
  const [subnetDrawerKindLabel, setSubnetDrawerKindLabel] = useState('扁平子网');

  const openSubnetDrawer = useCallback(
    (record: any) => {
      if (!record || !cloudId) return;
      const t = String(record?.metadata?.annotations?.[SUBNET_TYPE_ANNOTATION] ?? '').trim().toLowerCase();
      const kind = t === 'vpc' ? 'VPC 子网' : t === 'public' ? '公共子网' : '扁平子网';
      setSubnetDrawerRecord(record);
      setSubnetDrawerKindLabel(kind);
      setSubnetDrawerOpen(true);
    },
    [cloudId],
  );
  // [修复] 初始加载时，如果主网卡名称为空字符串，需重置为 undefined 以便显示 Placeholder
  React.useEffect(() => {
    const pNic = form.getFieldValue('primaryNic') || {};
    if (pNic.name === '') {
      form.setFieldsValue({ primaryNic: { ...pNic, name: undefined } });
    }
  }, [form]);

  const handleNetModeChange = (v: string) => {
    // [状态重置] 切换网络模式时，重置主网卡并同步该模式下的默认网桥类型（须每次 onChange 都执行：
    // Form 往往在触发 onChange 前已写入 netMode，若用「v !== getFieldValue(netMode)」判断会跳过，导致 type 不随模式变）
    setNetModeState(v);
    const initialType = DEFAULT_PRIMARY_NIC_TYPE_BY_NET_MODE[v] ?? 'bridge';

    try {
      form.setFieldsValue({
        netMode: v,
        primaryNic: {
          type: initialType,
          model: 'virtio',
          name: undefined,
          vpc: v === 'flat_subnet' ? KUBE_OVN_FLAT_VPC : undefined,
          subnet: undefined,
          macAddress: undefined,
          ipAddress: undefined,
        },
      });
    } catch {
      /* ignore */
    }

    if (v === 'vpc' || v === 'flat_subnet' || v === 'flat' || v === 'passthrough') {
      reloadNads();
    }
    if (v === 'vpc') {
      reloadKubeVpcs();
    }
    if (v === 'vpc' || v === 'flat_subnet') {
      reloadKubeSubnets();
    }
  };

  return (
    <>
      <Typography.Paragraph type="secondary">设定新建云主机的网络接口配置</Typography.Paragraph>
      
      {/* ==================== 主网卡配置区域 ==================== */}
      <div className="wizard-group-title">主网卡</div>
      <Row gutter={12}>
        {/* 1. 网络类型选择（顺序：扁平子网 → VPC → 直通 → NAD） */}
        <Col span={8}>
          <Form.Item label="网络类型" name="netMode" preserve rules={[{ required: true, message: '请选择网络类型' }]}>
            <Select
              options={[
                { label: '扁平子网', value: 'flat_subnet' },
                { label: 'VPC网络', value: 'vpc' },
                { label: '直通网卡', value: 'passthrough' },
                { label: 'NAD网络', value: 'flat' },
              ]}
              placeholder="选择网络类型"
              onChange={handleNetModeChange}
            />
          </Form.Item>
        </Col>

        {/* 2. 根据网络类型动态渲染配置项 */}
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
          {({ getFieldValue }) => {
            const mode = getFieldValue('netMode') || 'flat_subnet';
            if (mode === 'flat') {
              // --- NAD 网络：选择 Multus NAD（排除 kube-ovn） ---
              return (
                <Col span={8}>
                  <Form.Item
                    label="选择网络"
                    name={["primaryNic", 'name']}
                    preserve
                    rules={[{ required: true, message: '请选择网络' }]}
                    key="primary-nic-flat"
                  >
                    <Select
                      placeholder="选择网络"
                      options={(function () {
                          // [业务规则] NAD 网络模式下排除 Kube-OVN 类型的 NAD，因其属于 VPC 网络范畴
                          const filtered = (nadOptions || []).filter((x: any) => !String(x?.label || '').toLowerCase().includes('kube-ovn'));
                          return filtered;
                        })()}
                      onOpenChange={async (open) => { if (open) reloadNads(); }}
                      onChange={(val) => {
                        try {
                          const curr = form.getFieldValue('primaryNic') || {};
                          // 必须显式写入 name: val，避免与 Select 写入竞态导致 name 丢失
                          form.setFieldsValue({ primaryNic: { ...curr, name: val, type: 'bridge' } });
                        } catch {}
                      }}
                      allowClear={false}
                    />
                  </Form.Item>
                </Col>
              );
            }

            if (mode === 'passthrough') {
              // --- 直通网络 (Passthrough) ---
              return (
                <Col span={8}>
                  <Form.Item
                    label="直通网络"
                    name={["primaryNic", 'name']}
                    preserve
                    rules={[{ required: true, message: '请选择直通网络' }]}
                    key="primary-nic-passthrough"
                  >
                    <Select
                      placeholder="选择直通网络（SR-IOV / macvlan）"
                      options={(nadOptions || []).filter((x: any) => {
                          const t = String((x as any)?._type || '').toLowerCase();
                          if (t) return t === 'sriov' || t === 'macvtap' || t === 'macvlan';
                          const lbl = String(x?.label || '').toLowerCase();
                          return (
                            lbl.includes('sriov') ||
                            lbl.includes('macvtap') ||
                            lbl.includes('macvlan')
                          );
                        })}
                      onOpenChange={async (open) => { if (open) reloadNads(); }}
                      onChange={(val) => {
                         try {
                           const curr = form.getFieldValue('primaryNic') || {};
                           const hit = (nadOptions || []).find((x: any) => String(x?.value) === String(val));
                           const ifaceType = passthroughKubevirtIfaceTypeFromNad(hit);
                           form.setFieldsValue({
                             primaryNic: { ...curr, name: val, type: ifaceType },
                           });
                         } catch {}
                      }}
                      allowClear={false}
                    />
                  </Form.Item>
                </Col>
              );
            }

            if (mode === 'flat_subnet') {
              // --- 扁平子网：内置 VPC ovn-internal + 注解 subnet-type=flat 的 Subnet，绑定同名 kube-ovn NAD ---
              return (
                <>
                  <Col span={8}>
                    <Form.Item name={['primaryNic', 'vpc']} hidden preserve>
                      <Input />
                    </Form.Item>
                    <Form.Item label="扁平子网" preserve>
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item
                          name={['primaryNic', 'subnet']}
                          noStyle
                          preserve
                          rules={[{ required: true, message: '请选择扁平子网' }]}
                        >
                          <Select
                            placeholder="选择扁平子网（Kube-OVN / tower.io/subnet-type=flat）"
                            style={{ width: 'calc(100% - 40px)' }}
                            options={(function () {
                              const used = new Set<string>();
                              try {
                                const netIfaces = form.getFieldValue('netIfaces') || [];
                                netIfaces.forEach((it: any) => {
                                  if (String(it?.mode || '') === 'flat_subnet' && it?.subnet) used.add(String(it.subnet));
                                });
                              } catch {}
                              const currentSelected = (function () {
                                try { return form.getFieldValue(['primaryNic', 'subnet']); } catch { return undefined; }
                              })();
                              return (kubeSubnets || [])
                                .filter(
                                  (x: any) =>
                                    isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) && isKubeOvnFlatSubnet(x),
                                )
                                .filter((x: any) => {
                                  const n = x?.name;
                                  if (!n) return false;
                                  if (currentSelected && String(currentSelected) === String(n)) return true;
                                  return !used.has(String(n));
                                })
                                .map((x: any) => {
                                  const flatVpcId =
                                    String(x?.spec?.vpc || x?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
                                    KUBE_OVN_FLAT_VPC;
                                  return kubeOvnSubnetNadOption(
                                    x,
                                    nadOptions,
                                    flatVpcId,
                                    currentSelected,
                                    (sx) => {
                                      const n = sx?.name || '-';
                                      const alias = String(
                                        sx?.metadata?.annotations?.['tower.io/alias'] ?? '',
                                      ).trim();
                                      const vpcDisp =
                                        String(
                                          sx?.spec?.vpc || sx?.vpc || KUBE_OVN_FLAT_VPC,
                                        ).trim() || KUBE_OVN_FLAT_VPC;
                                      return alias ? `${alias} (${n})` : `${n} (${vpcDisp})`;
                                    },
                                  );
                                });
                            })()}
                            onOpenChange={(open) => {
                              if (open) {
                                reloadKubeSubnets();
                                reloadNads();
                              }
                            }}
                            onChange={(val) => {
                              const subnet = (kubeSubnets || []).find((x: any) => x.name === val);
                              const netName = resolveMultusNetNameForKubeOvnSubnetNic(
                                subnet,
                                String(val),
                                nadOptions,
                              );
                              const flatVpc =
                                String(subnet?.spec?.vpc || subnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
                                KUBE_OVN_FLAT_VPC;
                              form.setFieldsValue({
                                primaryNic: {
                                  vpc: flatVpc,
                                  subnet: val,
                                  name: netName,
                                  type: 'managedtap',
                                },
                              });
                            }}
                            allowClear={false}
                          />
                        </Form.Item>
                        <Button
                          type="default"
                          icon={<FileSearchOutlined />}
                          title="查看子网"
                          disabled={!cloudId}
                          onClick={() => {
                            const sn = form.getFieldValue(['primaryNic', 'subnet']);
                            const rec = (kubeSubnets || []).find(
                              (x: any) =>
                                x?.name === sn &&
                                isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) &&
                                isKubeOvnFlatSubnet(x),
                            );
                            if (rec) openSubnetDrawer(rec);
                          }}
                        />
                      </Space.Compact>
                    </Form.Item>
                    <Form.Item name={['primaryNic', 'name']} hidden preserve>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      label="子网网段"
                      shouldUpdate={(prev, curr) => prev.primaryNic?.subnet !== curr.primaryNic?.subnet}
                    >
                      {({ getFieldValue }) => {
                        const subnetName = getFieldValue(['primaryNic', 'subnet']);
                        const subnet = (kubeSubnets || []).find(
                          (x: any) =>
                            x?.name === subnetName &&
                            isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) &&
                            isKubeOvnFlatSubnet(x),
                        );
                        return <Input value={subnet?.cidr || ''} disabled />;
                      }}
                    </Form.Item>
                  </Col>
                </>
              );
            }

            if (mode === 'vpc') {
            // --- VPC 网络模式配置 ---
            return (
              <>
                <Col span={8}>
                  <Form.Item label="VPC" name={["primaryNic", 'vpc']} preserve rules={[{ required: true }]}>
                    <Select
                      placeholder="选择 VPC"
                      options={kubeVpcOptions}
                      onOpenChange={(open) => { if (open) reloadKubeVpcs(); }}
                      onChange={(val) => { 
                        // [状态同步] 切换 VPC 时，重置子网和网络名称
                        // 使用合并更新，避免读取过期状态
                        form.setFieldsValue({ primaryNic: { vpc: val, subnet: undefined, name: undefined, type: 'managedtap' } }); 
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="子网" preserve>
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item name={['primaryNic', 'subnet']} noStyle preserve rules={[{ required: true }]}>
                        <Select
                          placeholder="选择 VPC 子网"
                          style={{ width: 'calc(100% - 40px)' }}
                          options={(function () { 
                            // [过滤逻辑] 仅显示当前选中 VPC 下的子网
                            const vpc = form.getFieldValue(['primaryNic', 'vpc']); 
                            const list = kubeSubnets || []; 
                            const currentSub = form.getFieldValue(['primaryNic', 'subnet']);
                            const filtered = vpc ? list.filter((x: any) => x?.vpc === vpc) : []; 
                            if (!vpc) return [];
                            return filtered.map((x: any) =>
                              kubeOvnSubnetNadOption(x, nadOptions, vpc, currentSub, (sx) =>
                                kubeSubnetChoiceLabel(sx),
                              ),
                            );
                          })()}
                          onOpenChange={(open) => { if (open) { reloadKubeSubnets(); reloadNads(); } }}
                          onChange={(val) => {
                            const vpcCur = form.getFieldValue(['primaryNic', 'vpc']);
                            const subnet = (kubeSubnets || []).find(
                              (x: any) => x.name === val && x?.vpc === vpcCur,
                            );
                            const netName = resolveMultusNetNameForKubeOvnSubnetNic(
                              subnet,
                              String(val),
                              nadOptions,
                            );
                            form.setFieldsValue({ primaryNic: { name: netName, type: 'managedtap' } });
                          }}
                        />
                      </Form.Item>
                      <Button
                        type="default"
                        icon={<FileSearchOutlined />}
                        title="查看子网"
                        disabled={!cloudId}
                        onClick={() => {
                          const sn = form.getFieldValue(['primaryNic', 'subnet']);
                          const vpcCur = form.getFieldValue(['primaryNic', 'vpc']);
                          const rec = (kubeSubnets || []).find(
                            (x: any) => x?.name === sn && x?.vpc === vpcCur,
                          );
                          if (rec) openSubnetDrawer(rec);
                        }}
                      />
                    </Space.Compact>
                  </Form.Item>
                  {/* [修复] 在 VPC 模式下必须注册 name 字段，否则 getFieldsValue 无法获取到该值，导致 payload 中丢失网络名称进而回退到 Management Network */}
                  <Form.Item name={["primaryNic", 'name']} hidden preserve>
                    <Input />
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
            }

            return null;
          }}
        </Form.Item>

        {/* 3. 通用物理属性配置 (类型、模型、MAC、静态IP) */}
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode || prev.primaryNic?.type !== curr.primaryNic?.type || prev.primaryNic?.name !== curr.primaryNic?.name}>
          {({ getFieldValue }) => {
            const mode = getFieldValue('netMode') || 'flat_subnet';
            const t = getFieldValue(['primaryNic','type']);
            const primaryTypeLabel = '接口类型';
            
            // [选项逻辑] 根据模式生成可用的网卡类型选项（文案均来自 harvesterVmIfaceTypeOptions）
            const typeOptions = mode === 'passthrough'
              ? PASSTHROUGH_VIRT_IFACE_OPTIONS
              : mode === 'vpc'
                ? [ifaceTypeOption('managedtap')]
                : mode === 'flat_subnet'
                  ? [ifaceTypeOption('managedtap')]
                  : mode === 'flat'
                    ? NAD_MULTUS_INTERFACE_TYPES
                    : [ifaceTypeOption('bridge')];
            
            return (
              <>
                <Col span={8}>
                  <Form.Item
                    label={primaryTypeLabel}
                    name={["primaryNic", 'type']}
                    preserve
                    tooltip={mode === 'passthrough' ? PASSTHROUGH_TYPE_TOOLTIP : undefined}
                  >
                    <Select options={typeOptions} disabled={mode === 'passthrough'} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label="模型" name={["primaryNic", 'model']} preserve>
                    <Select disabled={t === 'sriov'} options={NIC_MODELS} />
                  </Form.Item>
                </Col>
              </>
            );
          }}
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
          {({ getFieldValue }) => {
            const nm = getFieldValue('netMode') || 'flat_subnet';
            if (nm === 'flat' || nm === 'passthrough') return null;
            return (
              <Col span={8}>
                <Form.Item
                  label="MAC 地址"
                  name={['primaryNic', 'macAddress']}
                  preserve
                  rules={[
                    {
                      pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/,
                      message: '格式如 52:54:00:12:34:56',
                    },
                  ]}
                >
                  <Input placeholder="52:54:00:12:34:56" />
                </Form.Item>
              </Col>
            );
          }}
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netMode !== curr.netMode}>
          {({ getFieldValue }) => {
            const nm = getFieldValue('netMode') || 'flat_subnet';
            if (nm !== 'vpc' && nm !== 'flat_subnet') return null;
            return (
              <Col span={8}>
                <Form.Item
                  label="静态IP"
                  name={['primaryNic', 'ipAddress']}
                  preserve
                  rules={[
                    {
                      pattern:
                        /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/,
                      message: '请输入有效的 IP 地址 (如 192.168.1.10 或 192.168.1.10/24)',
                    },
                  ]}
                >
                  <Input placeholder="192.168.1.10/24" />
                </Form.Item>
              </Col>
            );
          }}
        </Form.Item>
      </Row>


      {/* 
        ========================================
        2. 辅助网卡配置区域 
        ========================================
      */}
      <div className="wizard-group-title">辅助网卡</div>
      <Form.List name="netIfaces">
        {(fields, { add, remove }) => (
          <div>
            {/* 遍历渲染所有辅助网卡 */}
            {fields.map(({ key, name }, idx) => {
              const nm = form.getFieldValue(['netIfaces', name, 'name']) || '(未选择)';
              const tp = form.getFieldValue(['netIfaces', name, 'type']) || 'bridge';
              
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
                    {(function () {
                      const mode = form.getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                      if (mode === 'flat') {
                         // --- 辅助网卡：NAD 网络 ---
                         return (
                           <Col span={8}>
                              <Form.Item
                                 label="NAD网络"
                                 name={[name, 'name']}
                                 rules={[{ required: true, message: '请选择网络' }]}
                                 key={`secondary-nic-flat-${name}`}
                               >
                                 <Select
                                   placeholder="选择网络"
                                   options={(nadOptions || []).filter((x: any) => {
                                       // 排除 Kube-OVN：以 CNI type 为准，避免 label 未含 kube-ovn 时误展示
                                       const t = String(x?._type || '').toLowerCase();
                                       if (t === 'kube-ovn') return false;
                                       return !String(x?.label || '').toLowerCase().includes('kube-ovn');
                                     })}
                                   onOpenChange={async (open) => { if (open) reloadNads(); }}
                                   onChange={(val) => {
                                     try {
                                       const curr = form.getFieldValue('netIfaces') || [];
                                       const next = [...curr];
                                       // 显式写入 name: val，避免与 Form.Item 写入竞态导致 name 丢失
                                       next[name] = { ...next[name], name: val, type: 'bridge' };
                                       form.setFieldsValue({ netIfaces: next });
                                     } catch {}
                                   }}
                                 />
                               </Form.Item>
                            </Col>
                          );
                       }
                       
                       if (mode === 'passthrough') {
                          // --- 辅助网卡：直通网络 ---
                          return (
                            <Col span={8}>
                              <Form.Item
                                 label="直通网络"
                                 name={[name, 'name']}
                                 rules={[{ required: true, message: '请选择直通网络' }]}
                                 key={`secondary-nic-passthrough-${name}`}
                               >
                                 <Select
                                   placeholder="选择直通网络（SR-IOV / macvlan）"
                                   options={(nadOptions || []).filter((x: any) => {
                                       const t = String((x as any)?._type || '').toLowerCase();
                                       if (t === 'kube-ovn') return false;
                                       if (t) return t === 'sriov' || t === 'macvtap' || t === 'macvlan';
                                       const lbl = String(x?.label || '').toLowerCase();
                                       return (
                                         lbl.includes('sriov') ||
                                         lbl.includes('macvtap') ||
                                         lbl.includes('macvlan')
                                       );
                                     })}
                                   onOpenChange={async (open) => { if (open) reloadNads(); }}
                                   onChange={(val) => {
                                     try {
                                       const curr = form.getFieldValue('netIfaces') || [];
                                       const next = [...curr];
                                       const hit = (nadOptions || []).find((x: any) => String(x?.value) === String(val));
                                       const ifaceType = passthroughKubevirtIfaceTypeFromNad(hit);
                                       next[name] = { ...next[name], name: val, type: ifaceType };
                                       form.setFieldsValue({ netIfaces: next });
                                     } catch {}
                                   }}
                                 />
                               </Form.Item>
                            </Col>
                          );
                       }

                      if (mode === 'flat_subnet') {
                        return (
                          <>
                            <Col span={8}>
                              <Form.Item name={[name, 'vpc']} initialValue={KUBE_OVN_FLAT_VPC} hidden>
                                <Input />
                              </Form.Item>
                              <Form.Item label="扁平子网" key={`secondary-nic-flat-subnet-${name}`}>
                                <Space.Compact style={{ width: '100%' }}>
                                  <Form.Item
                                    name={[name, 'subnet']}
                                    noStyle
                                    rules={[{ required: true, message: '请选择扁平子网' }]}
                                  >
                                    <Select
                                      placeholder="选择扁平子网"
                                      style={{ width: 'calc(100% - 40px)' }}
                                      options={(function () {
                                        const used = new Set<string>();
                                        try {
                                          const primarySubnet = form.getFieldValue(['primaryNic', 'subnet']);
                                          if (primarySubnet) used.add(String(primarySubnet));
                                          const netIfaces = form.getFieldValue('netIfaces') || [];
                                          netIfaces.forEach((it: any, idx2: number) => {
                                            if (idx2 === name) return;
                                            if (String(it?.mode || '') === 'flat_subnet' && it?.subnet) used.add(String(it.subnet));
                                          });
                                        } catch {}
                                        const currentSelected = (function () {
                                          try { return form.getFieldValue(['netIfaces', name, 'subnet']); } catch { return undefined; }
                                        })();
                                        return (kubeSubnets || [])
                                          .filter(
                                            (x: any) =>
                                              isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) &&
                                              isKubeOvnFlatSubnet(x),
                                          )
                                          .filter((x: any) => {
                                            const n = x?.name;
                                            if (!n) return false;
                                            if (currentSelected && String(currentSelected) === String(n)) return true;
                                            return !used.has(String(n));
                                          })
                                          .map((x: any) => {
                                            const flatVpcId =
                                              String(x?.spec?.vpc || x?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
                                              KUBE_OVN_FLAT_VPC;
                                            return kubeOvnSubnetNadOption(
                                              x,
                                              nadOptions,
                                              flatVpcId,
                                              currentSelected,
                                              (sx) => {
                                                const n = sx?.name || '-';
                                                const alias = String(
                                                  sx?.metadata?.annotations?.['tower.io/alias'] ?? '',
                                                ).trim();
                                                const vpcDisp =
                                                  String(
                                                    sx?.spec?.vpc || sx?.vpc || KUBE_OVN_FLAT_VPC,
                                                  ).trim() || KUBE_OVN_FLAT_VPC;
                                                return alias ? `${alias} (${n})` : `${n} (${vpcDisp})`;
                                              },
                                            );
                                          });
                                      })()}
                                      onOpenChange={(open) => {
                                        if (open) {
                                          reloadKubeSubnets();
                                          reloadNads();
                                        }
                                      }}
                                      onChange={(val) => {
                                    const subnet = (kubeSubnets || []).find(
                                      (x: any) => (x?.name || x?.metadata?.name) === val,
                                    );
                                    const netName = resolveMultusNetNameForKubeOvnSubnetNic(
                                      subnet,
                                      String(val),
                                      nadOptions,
                                    );
                                    try {
                                      const curr = form.getFieldValue('netIfaces') || [];
                                      const next = [...curr];
                                      const flatVpc =
                                        String(subnet?.spec?.vpc || subnet?.vpc || KUBE_OVN_FLAT_VPC).trim() ||
                                        KUBE_OVN_FLAT_VPC;
                                      next[name] = {
                                        ...next[name],
                                        mode: 'flat_subnet',
                                        vpc: flatVpc,
                                        subnet: val,
                                        name: netName,
                                        type: 'managedtap',
                                      };
                                      form.setFieldsValue({ netIfaces: next });
                                    } catch {}
                                  }}
                                    />
                                  </Form.Item>
                                  <Button
                                    type="default"
                                    icon={<FileSearchOutlined />}
                                    title="查看子网"
                                    disabled={!cloudId}
                                    onClick={() => {
                                      const sn = form.getFieldValue(['netIfaces', name, 'subnet']);
                                      const rec = (kubeSubnets || []).find(
                                        (x: any) =>
                                          x?.name === sn &&
                                          isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) &&
                                          isKubeOvnFlatSubnet(x),
                                      );
                                      if (rec) openSubnetDrawer(rec);
                                    }}
                                  />
                                </Space.Compact>
                              </Form.Item>
                              <Form.Item name={[name, 'name']} hidden>
                                <Input />
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
                                  const subnet = (kubeSubnets || []).find(
                                    (x: any) =>
                                      x?.name === subnetName &&
                                      isFlatKubeOvnSubnetVpc(x?.vpc || x?.spec?.vpc) &&
                                      isKubeOvnFlatSubnet(x),
                                  );
                                  return <Input value={subnet?.cidr || ''} disabled />;
                                }}
                              </Form.Item>
                            </Col>
                          </>
                        );
                      }

                      if (mode === 'vpc') {
                      // --- 辅助网卡：VPC 网络模式 ---
                      return (
                      <>
                        <Col span={8}>
                          <Form.Item label="VPC" name={[name, 'vpc']} rules={[{ required: true }]}>
                            <Select
                              placeholder="选择 VPC"
                              options={kubeVpcOptions}
                              onOpenChange={(open) => { if (open) reloadKubeVpcs(); }}
                              onChange={(val) => { 
                                try { 
                                  const curr = form.getFieldValue('netIfaces') || []; 
                                  const next = [...curr]; 
                                  // [状态同步] 切换 VPC 时重置子网和名称
                                  next[name] = { ...next[name], vpc: val, subnet: undefined, name: undefined, type: 'managedtap' }; 
                                  form.setFieldsValue({ netIfaces: next }); 
                                } catch { } 
                              }}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="子网">
                            <Space.Compact style={{ width: '100%' }}>
                              <Form.Item name={[name, 'subnet']} noStyle rules={[{ required: true }]}>
                                <Select
                                  placeholder="选择 VPC 子网"
                                  style={{ width: 'calc(100% - 40px)' }}
                                  options={(function () { 
                                    // [过滤逻辑] 根据当前网卡的 VPC 过滤子网
                                    const vpc = form.getFieldValue(['netIfaces', name, 'vpc']); 
                                    const list = kubeSubnets || [];
                                    const currentSub = form.getFieldValue(['netIfaces', name, 'subnet']);
                                    const filtered = vpc ? list.filter((x: any) => x?.vpc === vpc) : [];
                                    if (!vpc) return [];
                                    return filtered.map((x: any) =>
                                      kubeOvnSubnetNadOption(x, nadOptions, vpc, currentSub, (sx) =>
                                        kubeSubnetChoiceLabel(sx),
                                      ),
                                    );
                                  })()}
                                  onOpenChange={(open) => {
                                    if (open) {
                                      reloadKubeSubnets();
                                      reloadNads();
                                    }
                                  }}
                                  onChange={(val) => {
                                    try {
                                      const curr = form.getFieldValue('netIfaces') || [];
                                      const next = [...curr];
                                      const vpc = form.getFieldValue(['netIfaces', name, 'vpc']);
                                      const subnet = (kubeSubnets || []).find(
                                        (x: any) => x?.name === val && x?.vpc === vpc,
                                      );
                                      const netName = resolveMultusNetNameForKubeOvnSubnetNic(
                                        subnet,
                                        String(val),
                                        nadOptions,
                                      );
                                      next[name] = { ...next[name], subnet: val, name: netName, type: 'managedtap' };
                                      form.setFieldsValue({ netIfaces: next });
                                    } catch {}
                                  }}
                                />
                              </Form.Item>
                              <Button
                                type="default"
                                icon={<FileSearchOutlined />}
                                title="查看子网"
                                disabled={!cloudId}
                                onClick={() => {
                                  const sn = form.getFieldValue(['netIfaces', name, 'subnet']);
                                  const vpcCur = form.getFieldValue(['netIfaces', name, 'vpc']);
                                  const rec = (kubeSubnets || []).find(
                                    (x: any) => x?.name === sn && x?.vpc === vpcCur,
                                  );
                                  if (rec) openSubnetDrawer(rec);
                                }}
                              />
                            </Space.Compact>
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
                    );
                      }

                      return null;
                    })()}

                    {/* --- 通用物理属性 (类型/模型/MAC/静态IP) --- */}
                    <Form.Item noStyle shouldUpdate={(prev, curr) => prev.netIfaces?.[name]?.mode !== curr.netIfaces?.[name]?.mode || prev.netIfaces?.[name]?.type !== curr.netIfaces?.[name]?.type || prev.netIfaces?.[name]?.name !== curr.netIfaces?.[name]?.name}>
                      {({ getFieldValue }) => {
                        const mode2 = getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                        const secondaryTypeLabel = '接口类型';
                        // [选项逻辑] 根据模式生成可用的网卡类型选项（与主网卡、harvesterVmIfaceTypeOptions 同源）
                        const opts = mode2 === 'passthrough'
                          ? PASSTHROUGH_VIRT_IFACE_OPTIONS
                          : mode2 === 'vpc'
                            ? [ifaceTypeOption('managedtap')]
                            : mode2 === 'flat_subnet'
                              ? [ifaceTypeOption('managedtap')]
                              : mode2 === 'flat'
                                ? NAD_MULTUS_INTERFACE_TYPES
                                : [ifaceTypeOption('bridge')];
                        return (
                          <Col span={8}>
                            <Form.Item
                              label={secondaryTypeLabel}
                              name={[name, 'type']}
                              tooltip={mode2 === 'passthrough' ? PASSTHROUGH_TYPE_TOOLTIP : undefined}
                            >
                              <Select options={opts} disabled={mode2 === 'passthrough'} />
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
                            <Form.Item label="模型" name={[name, 'model']}>
                              <Select disabled={typ === 'sriov'} options={NIC_MODELS} />
                            </Form.Item>
                          </Col>
                        );
                      }}
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.netIfaces?.[name]?.mode !== curr.netIfaces?.[name]?.mode}
                    >
                      {({ getFieldValue }) => {
                        const m = getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                        if (m === 'flat' || m === 'passthrough') return null;
                        return (
                          <Col span={8}>
                            <Form.Item
                              label="MAC 地址"
                              name={[name, 'macAddress']}
                              rules={[
                                {
                                  pattern: /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/,
                                  message: '格式如 52:54:00:12:34:56',
                                },
                              ]}
                            >
                              <Input placeholder="52:54:00:12:34:56" />
                            </Form.Item>
                          </Col>
                        );
                      }}
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.netIfaces?.[name]?.mode !== curr.netIfaces?.[name]?.mode}
                    >
                      {({ getFieldValue }) => {
                        const m = getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                        if (m !== 'vpc' && m !== 'flat_subnet') return null;
                        return (
                          <Col span={8}>
                            <Form.Item
                              label="静态IP"
                              name={[name, 'ipAddress']}
                              rules={[
                                {
                                  pattern:
                                    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:3[0-2]|[12]?[0-9]|[0-9]))?$/,
                                  message: '请输入有效的 IP 地址',
                                },
                              ]}
                            >
                              <Input placeholder="192.168.1.10/24" />
                            </Form.Item>
                          </Col>
                        );
                      }}
                    </Form.Item>
                  </Row>
                  <Row gutter={12}>
                    <Col span={24}>
                      <Form.Item label="网络模式" name={[name, 'mode']} hidden>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              );
            })}
            
            {/* 按钮区域：添加辅助网卡（顺序：扁平子网 → VPC → 直通 → NAD） */}
            <Space>
              <Button
                onClick={() => {
                  reloadKubeSubnets();
                  add({
                    mode: 'flat_subnet',
                    type: 'managedtap',
                    model: 'virtio',
                    vpc: KUBE_OVN_FLAT_VPC,
                  });
                }}
              >
                添加扁平子网网卡
              </Button>
              <Button onClick={() => { reloadKubeVpcs(); reloadKubeSubnets(); add({ mode: 'vpc', type: 'managedtap', model: 'virtio' }); }}>添加VPC网卡</Button>
              <Button onClick={() => { reloadNads(); add({ mode: 'passthrough', type: 'sriov', model: 'virtio' }); }}>添加直通网卡</Button>
              <Button onClick={() => { reloadNads(); add({ mode: 'flat', type: 'bridge', model: 'virtio' }); }}>添加NAD网络网卡</Button>
            </Space>
          </div>
        )}
      </Form.List>

      {cloudId ? (
        <SubnetDetailDrawer
          open={subnetDrawerOpen}
          onClose={() => {
            setSubnetDrawerOpen(false);
            setSubnetDrawerRecord(null);
          }}
          cloudId={cloudId}
          subnet={subnetDrawerRecord}
          kindLabel={subnetDrawerKindLabel}
          onSubnetAclSaved={() => reloadKubeSubnets()}
        />
      ) : null}
    </>
  );
};

export default StepNetworks;
