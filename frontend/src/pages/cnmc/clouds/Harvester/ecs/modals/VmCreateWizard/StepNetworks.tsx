/**
 * ==============================================================================
 * 模块名称: Harvester 虚拟机创建向导 - 网络配置步骤 (StepNetworks)
 * 文件路径: frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/VmCreateWizard/StepNetworks.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 负责配置虚拟机的网络接口，包含主网卡 (Primary NIC) 和辅助网卡 (Secondary NICs)。
 * 支持多种网络模式：NAD 网络（Multus NAD，排除 kube-ovn）、VPC 网络 (Kube-OVN)、直通整卡 PCI、直通 SR-IOV（VF PCI）、Multus 直通（SR-IOV/macvtap/macvlan）。
 *
 * [核心逻辑]
 * 1. [主网卡 (Primary NIC)]:
 *    - 必须存在，作为虚拟机的默认网关接口。
 *    - 模式切换：切换 Flat/VPC/直通类模式时，会自动重置关联字段 (VPC/Subnet/NAD)。
 * 2. [辅助网卡 (Secondary NICs)]:
 *    - 支持动态添加多块网卡，每块网卡可独立配置模式。
 *    - 支持混合使用不同类型的网络接口。
 * 3. [网络类型过滤]:
 *    - NAD 网络 (flat): 排除 kube-ovn 类型的 NAD。
 *    - 直通整卡 (passthrough): PCI 组仅展示非 SR-IOV VF 的网卡类设备；另含 Multus（sriov/macvtap/macvlan）NAD。
 *    - 直通 SR-IOV (passthrough_sriov): PCI 组仅展示启发式识别为 SR-IOV 虚拟功能（VF）的设备；另含同上 Multus 直通项。
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
 *    - [GET] /api/clouds/{cloudId}/resources/harvester/pci-devices（PCI 网卡直通选项）
 *    - [外部回调] reloadNads, reloadKubeVpcs, reloadKubeSubnets, reloadPciDevices
 *
 * 3. 数据提交映射:
 *    - Form Values -> Harvester VM Spec (spec.template.spec.networks)
 *    - VPC/扁平子网静态 IP -> metadata.annotations harvesterhci.io/custom-ip（Kube-OVN），非 Cloud-Init network-config
 * ==============================================================================
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form, Input, Select, Space, Button, Row, Col, Typography } from 'antd';
import { FileSearchOutlined, MinusCircleOutlined } from '@ant-design/icons';
import {
  ifaceTypeOption,
  NAD_MULTUS_INTERFACE_TYPES,
} from './harvesterVmIfaceTypeOptions';
import {
  PT_PREFIX_MULTUS,
  PT_PREFIX_PCI,
  buildGroupedPassthroughSelectOptions,
  buildPciNicPassthroughSelectOptions,
  collectWizardPassthroughExclusions,
  isWizardPciPassthroughNetMode,
  passthroughExclusionToFilterOpts,
  pciPassthroughSelectScopeFromWizardNetMode,
  wizardPassthroughPickFieldLabel,
  wizardPassthroughPickRequiredMessage,
} from '../../lib/passthroughNicSelectOptions';
import { KUBE_OVN_FLAT_VPC, isFlatKubeOvnSubnetVpc } from '../../../kube-ovn/lib/kubeOvnSubnetConstants';
import { kubeSubnetChoiceLabel } from '../../../kube-ovn/lib/kubeOvnUiHelpers';
import SubnetDetailDrawer from '../../../kube-ovn/drawers/subnet-detail-drawer';
import { isKubeOvnSubnetNadReady, resolveMultusNetNameForKubeOvnSubnetNic } from './kubeOvnNadRefForVmWizard';
import { fetchCloudProviderEcs } from '../../../../../../../services/api';
import {
  extractCloudProviderEcsList,
  WIZARD_MAC_FIELD_PATTERN,
  WIZARD_STATIC_IP_FIELD_PATTERN,
  wizardIpFieldInlineError,
  wizardMacFieldInlineError,
} from '../../lib/vmNicMacIpValidation';

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
   * 当前主网卡网络类型状态（含直通整卡 / 直通 SR-IOV VF）
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
  /** 原始 PCI 清单（用于按「直通绑定节点」再过滤） */
  pciDevices?: any[];
  /** 集群节点列表（直通模式下先选节点） */
  nodes?: any[];
  nodesLoading?: boolean;
  reloadNodes?: () => void | Promise<void>;
  /** 与基础信息步一致：指定节点调度时预填直通绑定节点 */
  scheduleHostMode?: string;
  scheduleSelectedNode?: string | null;
  /** 刷新 PCI 设备缓存 */
  reloadPciDevices: () => void | Promise<void>;
  /** 当前选中的网卡索引 (用于高亮显示或定位，暂未深度使用) */
  selectedNetIdx: number | null;
  /** 设置当前选中网卡索引的函数 */
  setSelectedNetIdx: (idx: number | null) => void;
  /** 当前云 ID：用于打开子网详情抽屉（拓扑 / ACL） */
  cloudId?: string;
  /** 同云 ECS 列表（用于 MAC/静态 IP 与其它虚机冲突的即时校验；本步内会防抖刷新） */
  existingVms?: any[];
}

// --- 常量定义 ---

/** 切换「网络类型」时主网卡类型的默认值（模型默认 virtio，见 handleNetModeChange） */
const DEFAULT_PRIMARY_NIC_TYPE_BY_NET_MODE: Record<string, string> = {
  flat: 'bridge',
  vpc: 'managedtap',
  flat_subnet: 'managedtap',
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
  pciDevices,
  nodes,
  nodesLoading,
  reloadNodes,
  scheduleHostMode,
  scheduleSelectedNode,
  reloadPciDevices,
  selectedNetIdx,
  setSelectedNetIdx,
  cloudId,
  existingVms = [],
}) => {
  const passthroughBindNode = Form.useWatch(['primaryNic', 'passthroughBindNode'], form);
  const netModeWatch = Form.useWatch('netMode', form);
  const primaryNicWatch = Form.useWatch('primaryNic', form);
  const netIfacesWatch = Form.useWatch('netIfaces', form);
  const watchNamespace = Form.useWatch('namespace', form);

  const [livePeerVms, setLivePeerVms] = useState<any[]>(() =>
    Array.isArray(existingVms) ? existingVms : [],
  );
  const livePeerVmsRef = useRef<any[]>([]);
  livePeerVmsRef.current = livePeerVms;
  useEffect(() => {
    setLivePeerVms(Array.isArray(existingVms) ? existingVms : []);
  }, [existingVms]);

  const peerRefreshFingerprint = useMemo(
    () =>
      JSON.stringify({
        ns: watchNamespace,
        nm: netModeWatch,
        pn: primaryNicWatch,
        nf: netIfacesWatch,
      }),
    [watchNamespace, netModeWatch, primaryNicWatch, netIfacesWatch],
  );

  const refreshLivePeerVms = useCallback(() => {
    const cid = String(cloudId || '').trim();
    const ns = String(watchNamespace || '').trim();
    if (!cid || !ns) return;
    void fetchCloudProviderEcs(cid, true)
      .then((json: any) => {
        const extracted = extractCloudProviderEcsList(json);
        setLivePeerVms(Array.isArray(extracted) ? extracted : []);
      })
      .catch(() => {});
  }, [cloudId, watchNamespace]);

  useEffect(() => {
    refreshLivePeerVms();
  }, [refreshLivePeerVms]);

  const peerFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const cid = String(cloudId || '').trim();
    const ns = String(watchNamespace || '').trim();
    if (!cid || !ns) return;
    if (peerFetchTimerRef.current) clearTimeout(peerFetchTimerRef.current);
    peerFetchTimerRef.current = setTimeout(() => {
      peerFetchTimerRef.current = null;
      refreshLivePeerVms();
    }, 300);
    return () => {
      if (peerFetchTimerRef.current) clearTimeout(peerFetchTimerRef.current);
    };
  }, [peerRefreshFingerprint, refreshLivePeerVms, cloudId, watchNamespace]);

  useEffect(() => {
    const nm = String(form.getFieldValue("netMode") || "");
    const paths: (string | number)[][] = [];
    if (nm === "vpc" || nm === "flat_subnet") {
      paths.push(["primaryNic", "macAddress"], ["primaryNic", "ipAddress"]);
    }
    const nf = form.getFieldValue("netIfaces");
    if (Array.isArray(nf)) {
      nf.forEach((row: any, i: number) => {
        const m = String(row?.mode || "");
        if (m === "vpc" || m === "flat_subnet") {
          paths.push(["netIfaces", i, "macAddress"], ["netIfaces", i, "ipAddress"]);
        }
      });
    }
    if (paths.length > 0) {
      try {
        void form.validateFields(paths);
      } catch {
        /* 仅刷新占用类提示，忽略未填完整项 */
      }
    }
  }, [livePeerVms, form]);

  const primaryPassthroughFilter = useMemo(() => {
    const ex = collectWizardPassthroughExclusions({
      netMode: netModeWatch,
      primaryNic: primaryNicWatch,
      netIfaces: netIfacesWatch,
      skipPrimary: true,
    });
    return passthroughExclusionToFilterOpts(
      ex,
      String(primaryNicWatch?.passthroughPick || ''),
    );
  }, [netModeWatch, primaryNicWatch, netIfacesWatch]);

  const pciPassthroughOptsForBindNode = useMemo(() => {
    const bn = String(passthroughBindNode || '').trim();
    const list = Array.isArray(pciDevices) ? pciDevices : [];
    const filtered =
      bn
        ? list.filter((raw: any) => {
            const n = String(raw?.status?.nodeName ?? raw?.spec?.nodeName ?? '').trim();
            return n === bn;
          })
        : [];
    const nm = String(netModeWatch || '');
    const pciScope = isWizardPciPassthroughNetMode(nm)
      ? pciPassthroughSelectScopeFromWizardNetMode(nm)
      : 'any';
    return buildPciNicPassthroughSelectOptions(filtered, pciScope, primaryPassthroughFilter);
  }, [pciDevices, passthroughBindNode, netModeWatch, primaryPassthroughFilter]);

  const groupedPassthroughForPrimary = useMemo(() => {
    return buildGroupedPassthroughSelectOptions(
      pciPassthroughOptsForBindNode,
      nadOptions || [],
      {
        compactPassthroughLabels: true,
        ...primaryPassthroughFilter,
      },
    );
  }, [pciPassthroughOptsForBindNode, nadOptions, primaryPassthroughFilter]);
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

  /** 直通模式：从 legacy 字段补齐 passthroughPick（Multus 值带 multus: 前缀） */
  React.useEffect(() => {
    if (!isWizardPciPassthroughNetMode(String(netModeState || ''))) return;
    try {
      const p = form.getFieldValue('primaryNic') || {};
      if (p.passthroughPick) return;
      if (String(p.passthroughSource || '') === 'pci-host' && p.pciDeviceName) {
        form.setFieldsValue({
          primaryNic: { ...p, passthroughPick: `${PT_PREFIX_PCI}${p.pciDeviceName}` },
        });
      } else if (p.name) {
        form.setFieldsValue({
          primaryNic: {
            ...p,
            passthroughPick: `${PT_PREFIX_MULTUS}${p.name}`,
            passthroughSource: p.passthroughSource || 'multus',
          },
        });
      }
    } catch {
      /* ignore */
    }
  }, [form, netModeState, pciPassthroughOptsForBindNode]);

  const handleNetModeChange = (v: string) => {
    // [状态重置] 切换网络模式时，重置主网卡并同步该模式下的默认网桥类型（须每次 onChange 都执行：
    // Form 往往在触发 onChange 前已写入 netMode，若用「v !== getFieldValue(netMode)」判断会跳过，导致 type 不随模式变）
    setNetModeState(v);
    const initialType = DEFAULT_PRIMARY_NIC_TYPE_BY_NET_MODE[v] ?? 'bridge';

    try {
      const isPt = v === 'passthrough' || v === 'passthrough_sriov';
      const preBindNode =
        isPt &&
        String(scheduleHostMode || '').trim() === 'node' &&
        String(scheduleSelectedNode || '').trim()
          ? String(scheduleSelectedNode).trim()
          : undefined;
      form.setFieldsValue({
        netMode: v,
        primaryNic: {
          name: undefined,
          passthroughPick: undefined,
          passthroughSource: undefined,
          pciDeviceName: undefined,
          pciResourceName: undefined,
          pciNodeName: undefined,
          passthroughBindNode: isPt ? preBindNode : undefined,
          vpc: v === 'flat_subnet' ? KUBE_OVN_FLAT_VPC : undefined,
          subnet: undefined,
          macAddress: undefined,
          ipAddress: undefined,
          ...(isPt
            ? { type: undefined, model: undefined }
            : { type: initialType, model: 'virtio' }),
        },
      });
    } catch {
      /* ignore */
    }

    if (v === 'vpc' || v === 'flat_subnet' || v === 'flat' || v === 'passthrough' || v === 'passthrough_sriov') {
      reloadNads();
    }
    if (v === 'passthrough' || v === 'passthrough_sriov') {
      try {
        void reloadPciDevices();
        if (reloadNodes) void reloadNodes();
      } catch {
        /* ignore */
      }
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
                { label: '直通SR-IOV', value: 'passthrough_sriov' },
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

            if (isWizardPciPassthroughNetMode(mode)) {
              const nodeOpts = (Array.isArray(nodes) ? nodes : [])
                .map((node: any) => {
                  const nm = String(node?.metadata?.name || node?.name || '').trim();
                  if (!nm) return null;
                  return { label: nm, value: nm };
                })
                .filter(Boolean) as { label: string; value: string }[];
              return (
                <>
                  <Col span={8}>
                    <Form.Item
                      label="节点"
                      name={['primaryNic', 'passthroughBindNode']}
                      preserve
                      rules={[
                        ({ getFieldValue }) => ({
                          validator(_, val) {
                            if (!isWizardPciPassthroughNetMode(String(getFieldValue('netMode') || ''))) {
                              return Promise.resolve();
                            }
                            if (!String(val || '').trim()) {
                              return Promise.reject(new Error('请选择节点'));
                            }
                            return Promise.resolve();
                          },
                        }),
                      ]}
                      key="primary-nic-passthrough-node"
                    >
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="选择宿主机节点"
                        loading={!!nodesLoading}
                        allowClear
                        options={nodeOpts}
                        onOpenChange={(open) => {
                          if (open && reloadNodes) void reloadNodes();
                        }}
                        onChange={() => {
                          try {
                            const curr = form.getFieldValue('primaryNic') || {};
                            form.setFieldsValue({
                              primaryNic: {
                                ...curr,
                                passthroughPick: undefined,
                                passthroughSource: undefined,
                                pciDeviceName: undefined,
                                pciResourceName: undefined,
                                pciNodeName: undefined,
                              },
                            });
                          } catch {
                            /* ignore */
                          }
                        }}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      label={wizardPassthroughPickFieldLabel(mode)}
                      name={['primaryNic', 'passthroughPick']}
                      preserve
                      rules={[
                        {
                          required: true,
                          message: wizardPassthroughPickRequiredMessage(mode),
                        },
                      ]}
                      key="primary-nic-passthrough"
                    >
                      <Select
                        placeholder={
                          String(passthroughBindNode || '').trim()
                            ? '选择 PCI 网卡或 Multus 直通网络'
                            : '请先选择节点，再选择本节点 PCI 直通网卡（Multus 可不依赖节点）'
                        }
                        options={groupedPassthroughForPrimary}
                        onOpenChange={async (open) => {
                          if (open) {
                            reloadNads();
                            try {
                              void reloadPciDevices();
                              if (reloadNodes) void reloadNodes();
                            } catch {
                              /* ignore */
                            }
                          }
                        }}
                        onChange={(val) => {
                          try {
                            const s = String(val || '');
                            const curr = form.getFieldValue('primaryNic') || {};
                            if (s.startsWith(PT_PREFIX_PCI)) {
                              const cr = s.slice(PT_PREFIX_PCI.length);
                              const hit = (pciPassthroughOptsForBindNode || []).find(
                                (x: any) => String(x?.value) === s,
                              );
                              form.setFieldsValue({
                                primaryNic: {
                                  ...curr,
                                  passthroughPick: val,
                                  passthroughSource: 'pci-host',
                                  pciDeviceName: cr,
                                  pciResourceName: String(hit?._pciResourceName || '').trim(),
                                  pciNodeName: String(hit?._pciNodeName || '').trim(),
                                  name: undefined,
                                  type: undefined,
                                  model: undefined,
                                },
                              });
                            } else if (s.startsWith(PT_PREFIX_MULTUS)) {
                              const multusVal = s.slice(PT_PREFIX_MULTUS.length);
                              form.setFieldsValue({
                                primaryNic: {
                                  ...curr,
                                  passthroughPick: val,
                                  passthroughSource: 'multus',
                                  pciDeviceName: undefined,
                                  pciResourceName: undefined,
                                  pciNodeName: undefined,
                                  name: multusVal,
                                  type: undefined,
                                  model: undefined,
                                },
                              });
                            }
                          } catch {
                            /* ignore */
                          }
                        }}
                        allowClear={false}
                      />
                    </Form.Item>
                  </Col>
                </>
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
      </Row>

      <Row gutter={12}>
        {/* 3. 通用物理属性配置 (类型、模型、MAC、静态IP) */}
        <Form.Item
          noStyle
          shouldUpdate={(prev, curr) =>
            prev.netMode !== curr.netMode ||
            prev.primaryNic?.type !== curr.primaryNic?.type ||
            prev.primaryNic?.name !== curr.primaryNic?.name
          }
        >
          {({ getFieldValue }) => {
            const mode = getFieldValue('netMode') || 'flat_subnet';
            if (isWizardPciPassthroughNetMode(mode)) return null;

            const t = getFieldValue(['primaryNic', 'type']);
            const hideIfaceType = mode === 'vpc' || mode === 'flat_subnet';
            const typeOptions =
              mode === 'vpc'
                ? [ifaceTypeOption('managedtap')]
                : mode === 'flat_subnet'
                  ? [ifaceTypeOption('managedtap')]
                  : mode === 'flat'
                    ? NAD_MULTUS_INTERFACE_TYPES
                    : [ifaceTypeOption('bridge')];

            return (
              <>
                {hideIfaceType ? (
                  <Form.Item name={['primaryNic', 'type']} preserve hidden>
                    <Input type="hidden" />
                  </Form.Item>
                ) : (
                  <Col span={8}>
                    <Form.Item label="接口类型" name={['primaryNic', 'type']} preserve>
                      <Select options={typeOptions} />
                    </Form.Item>
                  </Col>
                )}
                <Col span={8}>
                  <Form.Item label="模型" name={['primaryNic', 'model']} preserve>
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
            if (nm === 'flat' || isWizardPciPassthroughNetMode(nm)) return null;
            return (
              <Col span={8}>
                <Form.Item
                  label="MAC 地址"
                  name={['primaryNic', 'macAddress']}
                  preserve
                  dependencies={['netIfaces', 'netMode', 'primaryNic', 'namespace']}
                  validateTrigger={['onChange', 'onBlur']}
                  rules={[
                    {
                      validator: async (_rule, value) => {
                        const s = String(value ?? '').trim();
                        if (s && !WIZARD_MAC_FIELD_PATTERN.test(s)) {
                          return Promise.reject(new Error('格式须如 52:54:00:12:34:56'));
                        }
                        const v = form.getFieldsValue(true) as any;
                        const ns = String(form.getFieldValue('namespace') || '').trim();
                        const err = wizardMacFieldInlineError(
                          v,
                          'primary',
                          value,
                          livePeerVmsRef.current,
                          ns,
                        );
                        return err ? Promise.reject(new Error(err)) : Promise.resolve();
                      },
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
                  tooltip="可选，指定该网卡在子网内的固定 IPv4（如 192.168.1.10），不填则由子网侧自动分配。"
                  dependencies={[
                    'netIfaces',
                    'netMode',
                    'primaryNic',
                    'namespace',
                  ]}
                  validateTrigger={['onChange', 'onBlur']}
                  rules={[
                    {
                      validator: async (_rule, value) => {
                        const s = String(value ?? '').trim();
                        if (s && !WIZARD_STATIC_IP_FIELD_PATTERN.test(s)) {
                          return Promise.reject(
                            new Error('请输入有效的 IP 地址 (如 192.168.1.10 )'),
                          );
                        }
                        const v = form.getFieldsValue(true) as any;
                        const ns = String(form.getFieldValue('namespace') || '').trim();
                        const err = wizardIpFieldInlineError(
                          v,
                          'primary',
                          value,
                          kubeSubnets || [],
                          livePeerVmsRef.current,
                          ns,
                        );
                        return err ? Promise.reject(new Error(err)) : Promise.resolve();
                      },
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


      <Form.List name="netIfaces">
        {(fields, { add, remove }) => (
          <div className="wizard-net-ifaces-list">
            {fields.map(({ key, name }, idx) => {
              const canRemove = true;
              const slotTitle = `网卡 ${idx + 2}`;
              return (
                <div key={key} className="wizard-secondary-nic-wrap">
                  <div className="wizard-secondary-nic-block">
                    <div className="wizard-secondary-nic-head">
                      <span className="wizard-secondary-nic-slot-title">{slotTitle}</span>
                      {canRemove ? (
                        <Button
                          color="danger"
                          variant="filled"
                          icon={<MinusCircleOutlined />}
                          onClick={(e) => {
                            e.stopPropagation?.();
                            if (selectedNetIdx === idx) {
                              setSelectedNetIdx(null);
                            } else if (selectedNetIdx !== null && idx < selectedNetIdx) {
                              setSelectedNetIdx(selectedNetIdx - 1);
                            }
                            remove(name);
                          }}
                        />
                      ) : null}
                    </div>
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
                       
                       if (isWizardPciPassthroughNetMode(mode)) {
                          const pciScope = pciPassthroughSelectScopeFromWizardNetMode(mode);
                          const secBind = String(
                            form.getFieldValue(['netIfaces', name, 'passthroughBindNode']) || '',
                          ).trim();
                          const list = Array.isArray(pciDevices) ? pciDevices : [];
                          const filtered = secBind
                            ? list.filter((raw: any) => {
                                const n = String(
                                  raw?.status?.nodeName ?? raw?.spec?.nodeName ?? '',
                                ).trim();
                                return n === secBind;
                              })
                            : [];
                          const pciOptsForSecondary = buildPciNicPassthroughSelectOptions(
                            filtered,
                            pciScope,
                            passthroughExclusionToFilterOpts(
                              collectWizardPassthroughExclusions({
                                netMode: netModeWatch,
                                primaryNic: primaryNicWatch,
                                netIfaces: netIfacesWatch,
                                skipSecondaryIndex: name,
                              }),
                              String(
                                form.getFieldValue(['netIfaces', name, 'passthroughPick']) || '',
                              ),
                            ),
                          );
                          const grouped = buildGroupedPassthroughSelectOptions(
                            pciOptsForSecondary,
                            nadOptions || [],
                            {
                              compactPassthroughLabels: true,
                              ...passthroughExclusionToFilterOpts(
                                collectWizardPassthroughExclusions({
                                  netMode: netModeWatch,
                                  primaryNic: primaryNicWatch,
                                  netIfaces: netIfacesWatch,
                                  skipSecondaryIndex: name,
                                }),
                                String(
                                  form.getFieldValue(['netIfaces', name, 'passthroughPick']) ||
                                    '',
                                ),
                              ),
                            },
                          );
                          const nodeOptsSecondary = (Array.isArray(nodes) ? nodes : [])
                            .map((node: any) => {
                              const nm = String(node?.metadata?.name || node?.name || '').trim();
                              if (!nm) return null;
                              return { label: nm, value: nm };
                            })
                            .filter(Boolean) as { label: string; value: string }[];
                          return (
                            <>
                              <Col span={8}>
                                <Form.Item
                                  label="节点"
                                  name={[name, 'passthroughBindNode']}
                                  preserve
                                  rules={[
                                    ({ getFieldValue }) => ({
                                      validator(_, val) {
                                        const m = String(
                                          getFieldValue(['netIfaces', name, 'mode']) || '',
                                        );
                                        if (!isWizardPciPassthroughNetMode(m)) {
                                          return Promise.resolve();
                                        }
                                        if (!String(val || '').trim()) {
                                          return Promise.reject(new Error('请选择节点'));
                                        }
                                        return Promise.resolve();
                                      },
                                    }),
                                  ]}
                                  key={`secondary-nic-pt-node-${name}`}
                                >
                                  <Select
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder="选择宿主机节点"
                                    loading={!!nodesLoading}
                                    allowClear
                                    options={nodeOptsSecondary}
                                    onOpenChange={(open) => {
                                      if (open && reloadNodes) void reloadNodes();
                                    }}
                                    onChange={() => {
                                      try {
                                        const curr = form.getFieldValue('netIfaces') || [];
                                        const next = [...curr];
                                        const entry = { ...(next[name] || {}) };
                                        next[name] = {
                                          ...entry,
                                          passthroughPick: undefined,
                                          passthroughSource: undefined,
                                          pciDeviceName: undefined,
                                          pciResourceName: undefined,
                                          pciNodeName: undefined,
                                        };
                                        form.setFieldsValue({ netIfaces: next });
                                      } catch {
                                        /* ignore */
                                      }
                                    }}
                                  />
                                </Form.Item>
                              </Col>
                              <Col span={8}>
                                <Form.Item
                                  label={wizardPassthroughPickFieldLabel(mode)}
                                  name={[name, 'passthroughPick']}
                                  rules={[
                                    {
                                      required: true,
                                      message: wizardPassthroughPickRequiredMessage(mode),
                                    },
                                  ]}
                                  key={`secondary-nic-passthrough-${name}`}
                                >
                                  <Select
                                    placeholder={
                                      secBind
                                        ? '选择 PCI 网卡或 Multus 直通网络'
                                        : '请先选择节点，再选择本节点 PCI 直通网卡（Multus 可不依赖节点）'
                                    }
                                    options={grouped}
                                    onOpenChange={async (open) => {
                                      if (open) {
                                        reloadNads();
                                        try {
                                          void reloadPciDevices();
                                          if (reloadNodes) void reloadNodes();
                                        } catch {
                                          /* ignore */
                                        }
                                      }
                                    }}
                                    onChange={(val) => {
                                      try {
                                        const s = String(val || '');
                                        const curr = form.getFieldValue('netIfaces') || [];
                                        const next = [...curr];
                                        const entry = { ...(next[name] || {}) };
                                        if (s.startsWith(PT_PREFIX_PCI)) {
                                          const cr = s.slice(PT_PREFIX_PCI.length);
                                          const hit = (pciOptsForSecondary || []).find(
                                            (x: any) => String(x?.value) === s,
                                          );
                                          next[name] = {
                                            ...entry,
                                            passthroughPick: val,
                                            passthroughSource: 'pci-host',
                                            pciDeviceName: cr,
                                            pciResourceName: String(hit?._pciResourceName || '').trim(),
                                            pciNodeName: String(hit?._pciNodeName || '').trim(),
                                            name: undefined,
                                            type: undefined,
                                            model: undefined,
                                          };
                                        } else if (s.startsWith(PT_PREFIX_MULTUS)) {
                                          const multusVal = s.slice(PT_PREFIX_MULTUS.length);
                                          next[name] = {
                                            ...entry,
                                            passthroughPick: val,
                                            passthroughSource: 'multus',
                                            pciDeviceName: undefined,
                                            pciResourceName: undefined,
                                            pciNodeName: undefined,
                                            name: multusVal,
                                            type: undefined,
                                            model: undefined,
                                          };
                                        }
                                        form.setFieldsValue({ netIfaces: next });
                                      } catch {
                                        /* ignore */
                                      }
                                    }}
                                  />
                                </Form.Item>
                              </Col>
                            </>
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

                    {/* --- 通用物理属性 (类型/模型/MAC/静态IP)；直通模式不展示类型与模型 --- */}
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) =>
                        prev.netIfaces?.[name]?.mode !== curr.netIfaces?.[name]?.mode ||
                        prev.netIfaces?.[name]?.type !== curr.netIfaces?.[name]?.type ||
                        prev.netIfaces?.[name]?.name !== curr.netIfaces?.[name]?.name
                      }
                    >
                      {({ getFieldValue }) => {
                        const mode2 = getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                        if (isWizardPciPassthroughNetMode(mode2)) return null;

                        const typ = getFieldValue(['netIfaces', name, 'type']);
                        const hideSecondaryIfaceType = mode2 === 'vpc' || mode2 === 'flat_subnet';
                        const opts =
                          mode2 === 'vpc'
                            ? [ifaceTypeOption('managedtap')]
                            : mode2 === 'flat_subnet'
                              ? [ifaceTypeOption('managedtap')]
                              : mode2 === 'flat'
                                ? NAD_MULTUS_INTERFACE_TYPES
                                : [ifaceTypeOption('bridge')];

                        return (
                          <>
                            {hideSecondaryIfaceType ? (
                              <Form.Item name={[name, 'type']} preserve hidden>
                                <Input type="hidden" />
                              </Form.Item>
                            ) : (
                              <Col span={8}>
                                <Form.Item label="接口类型" name={[name, 'type']}>
                                  <Select options={opts} />
                                </Form.Item>
                              </Col>
                            )}
                            <Col span={8}>
                              <Form.Item label="模型" name={[name, 'model']}>
                                <Select disabled={typ === 'sriov'} options={NIC_MODELS} />
                              </Form.Item>
                            </Col>
                          </>
                        );
                      }}
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, curr) => prev.netIfaces?.[name]?.mode !== curr.netIfaces?.[name]?.mode}
                    >
                      {({ getFieldValue }) => {
                        const m = getFieldValue(['netIfaces', name, 'mode']) || 'flat';
                        if (m === 'flat' || isWizardPciPassthroughNetMode(m)) return null;
                        return (
                          <Col span={8}>
                            <Form.Item
                              label="MAC 地址"
                              name={[name, 'macAddress']}
                              dependencies={[
                                'netIfaces',
                                'netMode',
                                'primaryNic',
                                'namespace',
                              ]}
                              validateTrigger={['onChange', 'onBlur']}
                              rules={[
                                {
                                  validator: async (_rule, value) => {
                                    const s = String(value ?? '').trim();
                                    if (s && !WIZARD_MAC_FIELD_PATTERN.test(s)) {
                                      return Promise.reject(new Error('格式须如 52:54:00:12:34:56'));
                                    }
                                    const v = form.getFieldsValue(true) as any;
                                    const ns = String(form.getFieldValue('namespace') || '').trim();
                                    const err = wizardMacFieldInlineError(
                                      v,
                                      name as number,
                                      value,
                                      livePeerVmsRef.current,
                                      ns,
                                    );
                                    return err ? Promise.reject(new Error(err)) : Promise.resolve();
                                  },
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
                              tooltip="可选，指定该网卡在子网内的固定 IPv4（如 192.168.1.10），不填则由子网侧自动分配。"
                              dependencies={[
                                'netIfaces',
                                'netMode',
                                'primaryNic',
                                'namespace',
                              ]}
                              validateTrigger={['onChange', 'onBlur']}
                              rules={[
                                {
                                  validator: async (_rule, value) => {
                                    const s = String(value ?? '').trim();
                                    if (s && !WIZARD_STATIC_IP_FIELD_PATTERN.test(s)) {
                                      return Promise.reject(
                                        new Error('请输入有效的 IP 地址 (如 192.168.1.10 )'),
                                      );
                                    }
                                    const v = form.getFieldsValue(true) as any;
                                    const ns = String(form.getFieldValue('namespace') || '').trim();
                                    const err = wizardIpFieldInlineError(
                                      v,
                                      name as number,
                                      value,
                                      kubeSubnets || [],
                                      livePeerVmsRef.current,
                                      ns,
                                    );
                                    return err ? Promise.reject(new Error(err)) : Promise.resolve();
                                  },
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
                  </div>
                </div>
              );
            })}
            
            {/* 按钮区域：添加辅助网卡（扁平子网 → VPC → 直通 → NAD） */}
            <Space wrap className="wizard-net-ifaces-actions">
              <Button
                color="primary"
                variant="filled"
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
                + 扁平子网
              </Button>
              <Button
                color="primary"
                variant="filled"
                onClick={() => {
                  reloadKubeVpcs();
                  reloadKubeSubnets();
                  add({ mode: 'vpc', type: 'managedtap', model: 'virtio' });
                }}
              >
                + VPC网络
              </Button>
              <Button
                color="primary"
                variant="filled"
                onClick={() => {
                  reloadNads();
                  const preBind =
                    String(scheduleHostMode || '').trim() === 'node' &&
                    String(scheduleSelectedNode || '').trim()
                      ? String(scheduleSelectedNode).trim()
                      : undefined;
                  add({
                    mode: 'passthrough_sriov',
                    type: undefined,
                    model: undefined,
                    passthroughBindNode: preBind,
                    passthroughPick: undefined,
                    passthroughSource: undefined,
                    pciDeviceName: undefined,
                    pciResourceName: undefined,
                    pciNodeName: undefined,
                  });
                }}
              >
                + 直通SR-IOV
              </Button>
              <Button
                color="primary"
                variant="filled"
                onClick={() => {
                  reloadNads();
                  const preBind =
                    String(scheduleHostMode || '').trim() === 'node' &&
                    String(scheduleSelectedNode || '').trim()
                      ? String(scheduleSelectedNode).trim()
                      : undefined;
                  add({
                    mode: 'passthrough',
                    type: undefined,
                    model: undefined,
                    passthroughBindNode: preBind,
                    passthroughPick: undefined,
                    passthroughSource: undefined,
                    pciDeviceName: undefined,
                    pciResourceName: undefined,
                    pciNodeName: undefined,
                  });
                }}
              >
                + 直通网卡
              </Button>
              <Button
                color="primary"
                variant="filled"
                onClick={() => {
                  reloadNads();
                  add({ mode: 'flat', type: 'bridge', model: 'virtio' });
                }}
              >
                + NAD网络
              </Button>
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
          subnet={subnetDrawerRecord}
          kindLabel={subnetDrawerKindLabel}
        />
      ) : null}
    </>
  );
};

export default StepNetworks;
