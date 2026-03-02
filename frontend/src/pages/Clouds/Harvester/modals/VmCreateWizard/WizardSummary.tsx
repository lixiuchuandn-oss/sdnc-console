/**
 * ==============================================================================
 * 模块名称: Harvester VM 向导预览组件 (WizardSummary)
 * 文件路径: src/pages/Clouds/Harvester/modals/VmCreateWizard/WizardSummary.tsx
 * ==============================================================================
 *
 * [功能描述]
 * 在“虚拟机创建向导”右侧预览区域，汇总用户在表单中配置的关键信息，
 * 以只读方式展示，帮助用户在提交前快速核对。
 *
 * [核心逻辑]
 * 1. [数据聚合]: 使用 useMemo 聚合表单快照 (formSnapshot) 中的分散数据。
 * 2. [格式化展示]: 将技术参数（如 netMode=vpc）转换为人类可读的文案（如 "VPC网络"）。
 * 3. [条件渲染]: 仅展示已配置的项（如 GPU/USB 仅在有值时显示），保持界面整洁。
 * 4. [分类展示]: 按“位置、基础信息、计算、存储、网络、HA、固件”等维度分类展示。
 *
 * [交互依赖]
 * - 依赖 formSnapshot 获取实时表单数据。  
 * - 依赖外部传入的 clouds, kubeSubnets 等列表进行 ID 到名称的映射。
 */
import React, { useMemo } from 'react';
import { Divider } from 'antd';

/**
 * 组件 Props 定义
 */
interface WizardSummaryProps {
  /** 表单快照（来自各步骤的临时值集合） */
  formSnapshot: any;
  /** 当前资源池 ID（优先使用） */
  currentCloudId: string | undefined;
  /** 页面/上级传入的资源池 ID（当未选中“全部”时作为备选） */
  cloudId: string;
  /** 可用资源池列表（用于将 ID 映射为名称） */
  clouds: any[];
  /** 主机调度模式：node/label/auto */
  hostModeState: string;
  /** 当 hostModeState === 'node' 时指定的主机名 */
  selectedNodeName: string | null;
  /** 网络模式：vpc/flat（作为兜底） */
  netModeState: string;
  /** K8s 子网列表（用于显示 CIDR） */
  kubeSubnets: any[];
  /** 默认内存 Gi（当表单未填写时兜底显示） */
  memGi: number;
  /** 预览区域下方可扩展的自定义节点（如按钮/额外说明） */
  children?: React.ReactNode;
}

const WizardSummary: React.FC<WizardSummaryProps> = ({
  formSnapshot,
  currentCloudId,
  cloudId,
  clouds,
  hostModeState,
  selectedNodeName,
  netModeState,
  kubeSubnets,
  memGi,
  children
}) => {
  // [数据处理] 聚合计算预览数据
  const summary = useMemo(() => {
    // v：统一读取表单值，未填时使用空对象兜底，避免空指针
    const v = formSnapshot || {};

    // [存储] 系统盘来源类型、额外数据盘数量与总数、系统盘大小
    const rootType = String(v.rootSourceType || 'image');
    const extras: any[] = Array.isArray(v.extraDisks) ? v.extraDisks : [];
    const extraDiskCnt = extras.length;
    const diskCount = 1 + extraDiskCnt; // 1 = 系统盘
    const rootSize = v.rootSize || v.systemDisk || '40Gi';

    // [网络] 模式、主网卡对象、辅助网卡数组、主网卡显示文本、辅助网卡名称聚合、MAC、子网 CIDR
    const nm = String(v.netMode || netModeState || 'flat');
    const prim = v.primaryNic || {};
    const netExtras: any[] = Array.isArray(v.netIfaces) ? v.netIfaces : [];
    const primaryTxt = nm === 'vpc'
      ? `${prim.vpc || '-'} / ${prim.subnet || '-'}`
      : `${prim.name || '-'} · ${(prim.type || 'bridge')}/${(prim.model || 'virtio')}`;
    const extraNames = netExtras.map((x: any) => x?.name || x?.subnet || '').filter(Boolean).join(', ');
    const macTxt = String(prim?.macAddress || '').trim();
    const subnetCidr = (function () {
      try {
        const key = String(prim?.subnet || '');
        const it = (kubeSubnets || []).find((x: any) => x?.name === key);
        return String(it?.cidr || '');
      } catch {
        return '';
      }
    })();

    // [计算] 热扩容、CPU 拓扑/模式/绑定/隔离、QoS（请求/上限/内存上限）
    const hotExpand = v.hotExpandEnabled ? '启用' : '未启用';
    const cpuTopo = (function () {
      const s = Number(v.cpuSockets || 0);
      const c = Number(v.cpuCores || 0);
      if (s && c) return `${s} 插槽 × ${c} 核`;
      return '-';
    })();
    const cpuMode = String(v.cpuModel || 'host-passthrough');
    const cpuBind = v.dedicatedCPUPlacement ? '启用' : '未启用';
    const cpuIso = v.isolateEmulatorThread ? '启用' : '未启用';
    const cpuQos = (function () {
      const req = v.cpuRequest;
      const lim = v.cpuLimit;
      const memLim = v.memoryLimitGi ? `${v.memoryLimitGi}Gi` : undefined;
      const a = [];
      if (typeof req === 'number') a.push(`请求 ${req}`);
      if (typeof lim === 'number') a.push(`上限 ${lim}`);
      if (memLim) a.push(`内存上限 ${memLim}`);
      return a.length ? a.join('，') : '-';
    })();

    // [存储详情] 系统来源：镜像/现有磁盘；安装目标（预留位，当前未使用）；Cloud-Init 状态
    const rootSrc = String(v.rootSourceType || 'image');
    const rootDetail = (function () {
      if (rootSrc === 'image') {
        return v.image ? `镜像：${v.image}` : '镜像：-';
      }
      if (rootSrc === 'existing') {
        return v.rootPvc ? `磁盘：${v.rootPvc}` : '磁盘：-';
      }
      return '-';
    })();
    const installTarget = undefined; // 保留：用于将来扩展安装目标
    const cloudInit = (function () {
      const txt = String(v.userData || '').trim();
      return txt ? '启用' : '未配置';
    })();

    // [外设] GPU/USB 摘要：按模式/资源/数量生成可读文案；未配置时统一显示“未配置”
    const gpuSummary = (function () { 
      const mode = String(v.gpuMode || '').trim(); 
      const res = String(v.gpuResourceName || '').trim(); 
      const cnt = typeof v.gpuCount === 'number' ? v.gpuCount : 0; 
      if (mode === 'none') return '未配置';
      if (!mode && !res && !cnt) return '未配置'; 
      const modeTxt = (function () { 
        if (mode === 'passthrough') return '直通'; 
        if (mode === 'vgpu') return 'vGPU'; 
        if (mode === 'sriov') return 'SR-IOV'; 
        return '-'; 
      })(); 
      const cntTxt = cnt > 0 ? ` · 数量 ${cnt}` : ''; 
      return `${modeTxt} · ${res || '-'}` + cntTxt; 
    })();
    const usbSummary = (function () {
      const arr: any[] = Array.isArray(v.usbDevices) ? v.usbDevices : [];
      return arr.length ? `${arr.length} 个` : '未配置';
    })();

    // [策略] 运行策略（默认 RerunOnFailure）；资源池名称解析（ID -> 名称）
    const runStrategy = String(v.runStrategy || 'RerunOnFailure');
    const poolId = currentCloudId || (cloudId !== 'all' ? cloudId : undefined);
    const poolName = (function () {
      try {
        const it = (clouds || []).find((x: any) => x?.id === poolId);
        return it?.name || poolId || '-';
      } catch {
        return poolId || '-';
      }
    })();
    return {
      // 位置与主机调度：按模式生成对应文案
      location: {
        pool: poolName, host: (function () {
          if (hostModeState === 'node' && selectedNodeName) return `指定主机：${selectedNodeName}`;
          if (hostModeState === 'label') {
            const arr: any[] = Array.isArray((v as any).nodeSelectorPairs) ? (v as any).nodeSelectorPairs : [];
            const text = arr.map((p: any) => (p?.key && p?.value) ? `${p.key}=${p.value}` : '').filter(Boolean).join(', ');
            return `按标签调度：${text || '-'}`;
          }
          return '自动调度至合适的主机';
        })()
      },
      // 基础信息：名称/描述/分组（未填显示 '-'）
      info: { name: v.name || '-', desc: v.description || '-', group: v.group || '-' },

      // 计算：CPU/内存及可选项（热扩容、拓扑、模式、绑定、隔离、QoS）
      compute: {
        cpu: `${typeof v.cpu === 'number' ? v.cpu : 1} vCPU`,
        memory: v.memory || `${memGi}Gi`,
        hotExpand: v.hotExpandEnabled ? hotExpand : undefined,
        topo: cpuTopo !== '-' ? cpuTopo : undefined,
        cpuMode: (function () { const m = cpuMode; return (m && m !== 'host-passthrough') ? m : undefined; })(),
        cpuBind: v.dedicatedCPUPlacement ? cpuBind : undefined,
        cpuIso: v.isolateEmulatorThread ? cpuIso : undefined,
        qos: cpuQos !== '-' ? cpuQos : undefined
      },

      // 存储：总盘数与系统盘大小，系统来源详情，安装目标（保留）
      storage: { disks: `${diskCount} 虚拟盘（含系统盘 ${rootSize}）`, rootDetail, installTarget },

      // 网络：模式、主网卡文本、辅助网卡数量与名称聚合（可选）
      network: { mode: nm === 'vpc' ? 'VPC网络' : '扁平网络', primary: primaryTxt, extras: netExtras.length ? `${netExtras.length} 个辅助网卡：${extraNames || '-'}` : undefined },

      // 固件：默认 BIOS；EFI 展示在下方“固件”行（根据表单实时计算）
      boot: 'BIOS',

      // 更多：人类可读的自动开机提示
      more: undefined,

      // 附加信息：MAC、CIDR（仅当有值时显示）
      mac: macTxt || undefined,
      cidr: subnetCidr || undefined,

      // Cloud-Init：当 userData 非空时显示“启用”
      cloudInit: (function () { const enabled = String(v.userData || '').trim().length > 0; return enabled ? cloudInit : undefined; })(),

      // GPU/USB：当未配置时不显示该行
      gpu: (function () { return /未配置/.test(gpuSummary) ? undefined : gpuSummary; })(),
      usb: (function () { return usbSummary === '未配置' ? undefined : usbSummary; })(),

      // 数据盘：过滤掉 CD-ROM，仅统计真实数据盘，名称聚合展示
      dataDisks: (function () {
        const arr: any[] = Array.isArray(v.extraDisks) ? v.extraDisks : [];
        const disks = arr.filter((d: any) => String(d?.type || 'disk') !== 'cdrom');
        const names = disks.map((d: any) => d?.name || '').filter(Boolean).join(', ');
        return disks.length ? `${disks.length} 个：${names || '-'}` : undefined;
      })(),

      // 运行策略
      runStrategy,
    };
  }, [formSnapshot, hostModeState, selectedNodeName, kubeSubnets, netModeState, clouds, currentCloudId, cloudId, memGi]);

  return (
    <div className="wizard-preview">
      {/* === 1. 顶部标题 === */}
      <div className="wizard-preview-header">
        <div className="wizard-preview-title">配置预览</div>
      </div>

      {/* === 2. 滚动内容区域 === */}
      <div className="wizard-summary-scroll">
        <div className="wizard-summary-list">
          {/* 位置相关：资源池 & 主机调度策略 */}
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="资源池">资源池</span>
            <span className="wizard-summary-value" title={summary.location.pool}>{summary.location.pool}</span>
          </div>
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="主机调度">主机调度</span>
            <span className="wizard-summary-value" title={summary.location.host}>{summary.location.host}</span>
          </div>

          {/* 基础信息：名称、分组 */}
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="名称">名称</span>
            <span className="wizard-summary-value" title={summary.info.name}>{summary.info.name}</span>
          </div>
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="分组">分组</span>
            <span className="wizard-summary-value" title={summary.info.group}>{summary.info.group}</span>
          </div>

          {/* 计算资源：vCPU、内存及可选 CPU 相关高级配置 */}
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="vCPU">vCPU</span>
            <span className="wizard-summary-value" title={summary.compute.cpu}>{summary.compute.cpu}</span>
          </div>
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="内存">内存</span>
            <span className="wizard-summary-value" title={summary.compute.memory}>{summary.compute.memory}</span>
          </div>
          {summary.compute.hotExpand ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="热扩容">热扩容</span>
              <span className="wizard-summary-value" title={summary.compute.hotExpand}>{summary.compute.hotExpand}</span>
            </div>
          ) : null}
          {summary.compute.topo ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="CPU 拓扑">CPU 拓扑</span>
              <span className="wizard-summary-value" title={summary.compute.topo}>{summary.compute.topo}</span>
            </div>
          ) : null}
          {summary.compute.cpuMode ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="CPU 模式">CPU 模式</span>
              <span className="wizard-summary-value" title={summary.compute.cpuMode}>{summary.compute.cpuMode}</span>
            </div>
          ) : null}
          {summary.compute.cpuBind ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="CPU 绑定">CPU 绑定</span>
              <span className="wizard-summary-value" title={summary.compute.cpuBind}>{summary.compute.cpuBind}</span>
            </div>
          ) : null}
          {summary.compute.cpuIso ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="CPU 隔离">CPU 隔离</span>
              <span className="wizard-summary-value" title={summary.compute.cpuIso}>{summary.compute.cpuIso}</span>
            </div>
          ) : null}
          {summary.compute.qos ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="QoS">QoS</span>
              <span className="wizard-summary-value" title={summary.compute.qos}>{summary.compute.qos}</span>
            </div>
          ) : null}

          {/* 存储：系统盘与来源 */}
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="系统盘">系统盘</span>
            <span className="wizard-summary-value" title={summary.storage.disks}>{summary.storage.disks}</span>
          </div>
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="系统来源">系统来源</span>
            <span className="wizard-summary-value" title={summary.storage.rootDetail}>{summary.storage.rootDetail}</span>
          </div>

          {/* 网络：网络类型、主网卡以及可选的 MAC / 子网 CIDR / 辅助网卡 */}
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="网络类型">网络类型</span>
            <span className="wizard-summary-value" title={summary.network.mode}>{summary.network.mode}</span>
          </div>
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="主网卡">主网卡</span>
            <span className="wizard-summary-value" title={summary.network.primary}>{summary.network.primary}</span>
          </div>
          {summary.mac ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="MAC">MAC</span>
              <span className="wizard-summary-value" title={summary.mac}>{summary.mac}</span>
            </div>
          ) : null}
          {summary.cidr ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="子网CIDR">子网CIDR</span>
              <span className="wizard-summary-value" title={summary.cidr}>{summary.cidr}</span>
            </div>
          ) : null}
          {summary.network.extras ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="辅助网卡">辅助网卡</span>
              <span className="wizard-summary-value" title={summary.network.extras}>{summary.network.extras}</span>
            </div>
          ) : null}

          {/* 额外资源：数据盘 / Cloud-Init / GPU / USB（有值才展示） */}
          {summary.dataDisks ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="数据盘">数据盘</span>
              <span className="wizard-summary-value" title={summary.dataDisks}>{summary.dataDisks}</span>
            </div>
          ) : null}
          {summary.cloudInit ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="Cloud-Init">Cloud-Init</span>
              <span className="wizard-summary-value" title={summary.cloudInit}>{summary.cloudInit}</span>
            </div>
          ) : null}
          {summary.gpu ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="GPU">GPU</span>
              <span className="wizard-summary-value" title={summary.gpu}>{summary.gpu}</span>
            </div>
          ) : null}
          {summary.usb ? (
            <div className="wizard-summary-item">
              <span className="wizard-summary-label" title="USB">USB</span>
              <span className="wizard-summary-value" title={summary.usb}>{summary.usb}</span>
            </div>
          ) : null}

          {/* 策略与固件：运行策略、固件类型、更多说明 */}
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="运行策略">运行策略</span>
            <span className="wizard-summary-value" title={summary.runStrategy}>{summary.runStrategy}</span>
          </div>
          <div className="wizard-summary-item">
            <span className="wizard-summary-label" title="固件">固件</span>
            <span
              className="wizard-summary-value"
              title={(function () {
                const v: any = formSnapshot || {};
                if (v.bootUseEfi) {
                  const flags = [v.efiPersistent ? '持久' : '', v.efiSecureBoot ? '安全启动' : ''].filter(Boolean).join('、');
                  return flags ? `EFI（${flags}）` : 'EFI';
                }
                return 'BIOS';
              })()}
            >
              {(function () {
                const v: any = formSnapshot || {};
                if (v.bootUseEfi) {
                  const flags = [v.efiPersistent ? '持久' : '', v.efiSecureBoot ? '安全启动' : ''].filter(Boolean).join('、');
                  return flags ? `EFI（${flags}）` : 'EFI';
                }
                return 'BIOS';
              })()}
            </span>
          </div>
        </div>
      </div>

      {/* 底部分割线，下方可插入额外 children 内容 */}
      <Divider className="wizard-preview-divider" />
      {children}
    </div>
  );
};

export default WizardSummary;
