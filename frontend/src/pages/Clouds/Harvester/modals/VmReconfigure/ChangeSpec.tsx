import React, { useState } from 'react';
import { Form, InputNumber, Row, Col, Checkbox, Tooltip, Typography, Space, Alert, Radio, Switch, message } from 'antd';
import { InfoCircleOutlined, QuestionCircleOutlined, CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';

const { Text } = Typography;

/**
 * ChangeSpec Props 定义
 * @property form - Ant Design Form 实例，用于操作表单数据
 * @property currentCpu - 当前虚拟机的 CPU 核数
 * @property currentMemory - 当前虚拟机的内存大小 (GiB)
 * @property isHotPlugEnabledOnVm - 虚拟机当前是否已开启热扩容功能
 * @property isRestartRequired - 是否有未生效的变更需要重启
 * @property maxSockets - CPU 插槽数上限 (可选)
 * @property maxMemory - 内存热扩容上限 (可选)
 */
type Props = {
  form: any;
  currentCpu: number;
  currentMemory: number;
  isHotPlugEnabledOnVm: boolean;
  isRestartRequired?: boolean;
  maxSockets?: number;
  maxMemory?: number;
  architecture?: string;
  disabled?: boolean;
};

/**
 * ==============================================================================
 * 组件名称: ChangeSpec (虚拟机规格变更)
 * 文件路径: src/pages/Clouds/Harvester/modals/VmReconfigure/ChangeSpec.tsx
 * ==============================================================================
 * 
 * [功能描述]
 * 该组件用于在虚拟机变配弹窗中，提供 CPU 和内存规格的调整功能。
 * 它兼容并处理了“普通变配”和“热扩容变配”两种截然不同的交互逻辑。
 * 
 * [核心逻辑]
 * 1. CPU 拓扑管理: 
 *    - 负责将用户输入的 Sockets/Cores/Threads 转换为总核数。
 *    - 负责将后端返回的总核数解析为 UI 上的拓扑结构。
 * 
 * 2. 热扩容 (Hot Plug) 逻辑: 
 *    - 开启时: 强制 Cores=1, Threads=1 (Harvester 限制)，仅允许调整 Sockets。
 *    - 校验时: 确保用户输入的规格不超过预设的 maxSockets/maxMemory 上限。
 * 
 * 3. 内存预设: 
 *    - 提供 4/8/16 GiB 快捷选项，简化用户操作。
 *    - 支持自定义输入，自动切换预设状态。
 * 
 * 4. 状态反馈 (重启提示): 
 *    - 实时对比表单新值与原始 Props 值。
 *    - 智能判断变更是否触发生效条件（如修改上限必重启、超出范围必重启）。
 *
 * ------------------------------------------------------------------------------
 * [下游接口调用说明 (Downstream API Reference)]
 * ------------------------------------------------------------------------------
 * 本组件 (ChangeSpec) 本身是一个纯 UI 组件，不直接发起网络请求。
 * 数据流向如下：
 * 
 * 1. 数据提交路径:
 *    [ChangeSpec] (表单数据) 
 *       ↓
 *    [VmReconfigureModal] (父组件 handleSubmit) 
 *       ↓
 *    [useVmReconfigure Hook] (业务逻辑层)
 *       ↓
 *    [后端 API] (POST /api/v1/harvester/...)
 * 
 * 2. 涉及后端接口:
 *    - 接口: POST /api/v1/harvester/{cloudId}/vms/{namespace}/{name}/action?action=updateSpec
 *    - 作用: 更新 CPU、内存、热扩容开关等核心规格。
 * 
 * 3. 数据映射:
 *    - 入参 (Props): 
 *      currentCpu, currentMemory, maxSockets 等，源自 `useVmReconfigure.getCurrentSpec()`。
 *      (解析自 Harvester VM YAML: spec.template.spec.domain.cpu/memory)
 * 
 *    - 出参 (Form Values):
 *      cpu, memory, cpuSockets, cpuCores, cpuThreads, enableHotPlug, maxSockets, maxMemory。
 *      (将被组装成 Payload 发送给 API)
 * ==============================================================================
 */
const ChangeSpec: React.FC<Props> = ({ form, currentCpu, currentMemory, isHotPlugEnabledOnVm, isRestartRequired, maxSockets, maxMemory, architecture, disabled }) => {
  // 监听表单字段变化
  const cpu = Form.useWatch('cpu', form);
  const memory = Form.useWatch('memory', form);
  // [移除] enableHotPlug 不再在 ChangeSpec 中使用，热扩容开关已拆分为独立功能
  // const enableHotPlug = Form.useWatch('enableHotPlug', form);
  const cpuSockets = Form.useWatch('cpuSockets', form);
  const cpuCores = Form.useWatch('cpuCores', form);
  const cpuThreads = Form.useWatch('cpuThreads', form);
  // [移除] maxSocketsVal 和 maxMemoryVal 不再需要，因为热扩容上限设置已拆分为独立功能
  
  const isArm = architecture === 'arm64' || architecture === 'aarch64';

  // 本地状态: 控制高级选项显示和内存预设选中状态
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [memPreset, setMemPreset] = React.useState<string>(() => {
    const v = Number(currentMemory || 0);
    if (v === 4 || v === 8 || v === 16) return String(v);
    return 'custom';
  });
  const [memGi, setMemGi] = React.useState<number>(currentMemory || 0);

  // [本地状态] 记录关闭热扩容前的原始拓扑，用于取消勾选时回显
  // 场景说明：当用户开启热扩容时，系统会强制将 Cores 和 Threads 设为 1（单核模式）。
  // 如果用户后来反悔了（取消勾选），我们需要把他们之前的自定义拓扑（比如 2 Sockets * 2 Cores）还原回去，
  // 否则用户辛苦填的配置就丢了。这个 state 就是用来做这个“时光倒流”的备份。
  const [originalTopology, setOriginalTopology] = useState<{
    sockets: number;
    cores: number;
    threads: number;
  }>({
    sockets: form.getFieldValue('cpuSockets') || 1,
    cores: form.getFieldValue('cpuCores') || 1,
    threads: form.getFieldValue('cpuThreads') || 1
  });

  // [状态同步] 内存预设值跟随表单变化
  // 这里的逻辑是为了让 UI 上的“快捷选项”（4G/8G/16G）和“自定义输入框”保持同步。
  // 1. 如果用户在其他地方（比如重置表单）改了 memory 字段，这里会监听到。
  // 2. 如果新值正好是 4/8/16，就点亮对应的快捷按钮。
  // 3. 如果是其他值（比如 5G），就切换到“自定义”模式。
  React.useEffect(() => {
    const v = Number(memory || 0);
    if (v > 0) {
      setMemGi(v);
      if (v === 4 || v === 8 || v === 16) {
        setMemPreset(String(v));
      } else {
        setMemPreset('custom');
      }
    }
  }, [memory]);

  // [Effect] 自动计算 CPU 总核数
  // 这里的逻辑是：CPU 总核数 = 插槽数(Sockets) * 每插槽核数(Cores) * 线程数(Threads)
  // 当用户在 UI 上调整任意一个参数时，我们需要实时算出总核数，填入隐藏的 'cpu' 字段，
  // 因为后端 API 最终看的是这个总数（或者某些校验逻辑依赖总数）。
  // [修复] 如果已开启热扩容，cores=1, threads=1，所以总核数 = sockets
  React.useEffect(() => {
    if (isHotPlugEnabledOnVm) {
      // 已开启热扩容模式：总核数 = sockets（因为cores=1, threads=1）
      const s = Number(cpuSockets) || 0;
      const currentCpuVal = form.getFieldValue('cpu');
      // 如果 sockets 有值，且 cpu 字段为空或与 sockets 不一致，则同步
      if (s > 0 && (currentCpuVal === undefined || currentCpuVal === null || currentCpuVal === 0 || currentCpuVal !== s)) {
        form.setFieldsValue({ cpu: s });
      }
    } else {
      // 非热扩容模式：正常计算
      const s = Number(cpuSockets) || 0;
      const c = Number(cpuCores) || 0;
      const t = Number(cpuThreads) || 0;
      if (s > 0 && c > 0 && t > 0) {
        const total = s * c * t;
        const currentCpuVal = form.getFieldValue('cpu');
        if (currentCpuVal !== total) {
          form.setFieldsValue({ cpu: total });
        }
      }
    }
  }, [cpuSockets, cpuCores, cpuThreads, form, cpu, isHotPlugEnabledOnVm]);

  // [业务规则] 如果已开启热扩容，强制 CPU 拓扑 (Cores=1, Threads=1)
  // 这是一个 Harvester 平台的硬性限制：热扩容只支持增加插槽 (Sockets)。
  // 如果VM已开启热扩容，强制把 Cores 和 Threads 锁定为 1。
  React.useEffect(() => {
    if (isHotPlugEnabledOnVm) {
      const s = Number(cpuSockets) || 0;
      const c = Number(cpuCores) || 0;
      const t = Number(cpuThreads) || 0;
      
      // 如果发现 Cores 或 Threads 不是 1，立即强制重置为 1
      if (c !== 1 || t !== 1) {
         form.setFieldsValue({
           cpuCores: 1,
           cpuThreads: 1,
           // 确保cpu字段与sockets同步（因为cores=1, threads=1，所以cpu = sockets）
           cpu: s > 0 ? s : cpu
         });
      }
      // 确保在热扩容模式下，cpu字段始终等于sockets
      if (s > 0 && cpu !== s) {
        form.setFieldsValue({ cpu: s });
      }
    }
  }, [isHotPlugEnabledOnVm, cpuSockets, cpuCores, cpuThreads, form, cpu]);

  // [初始化] 设置默认 CPU 拓扑结构
  // 当组件第一次加载时，表单里可能只有总核数 (currentCpu)，没有详细的拓扑数据。
  // 这个 Effect 负责把总核数"翻译"成默认的拓扑结构，以便 UI 能正确显示。
  React.useEffect(() => {
    const s = form.getFieldValue('cpuSockets');
    const c = form.getFieldValue('cpuCores');
    const t = form.getFieldValue('cpuThreads');
    const cpuVal = form.getFieldValue('cpu');
    
    // 情况 1: 如果是全新打开，没有拓扑数据，我们默认采用 "全插槽模式" (Sockets = Total, Cores = 1)
    // 这样做最安全，兼容性最好。
    if (s === undefined && currentCpu) {
       form.setFieldsValue({
         cpu: currentCpu,
         cpuSockets: currentCpu,
         cpuCores: 1,
         cpuThreads: 1
       });
       // 同时备份一份作为"原始拓扑"，万一用户一上来就想玩热扩容开关，我们有据可查。
       setOriginalTopology({
         sockets: currentCpu,
         cores: 1,
         threads: 1
       });
    } else if (s !== undefined && !isHotPlugEnabledOnVm) {
       // 情况 2: 如果已经有拓扑数据了，且VM未开启热扩容。
       // 我们把这份现有的数据存进"备份"，作为用户自定义的基准。
       setOriginalTopology({
         sockets: s,
         cores: c || 1,
         threads: t || 1
       });
    }
    
    // [修复] 如果已开启热扩容，确保 cpu 字段有值
    // 如果 cpuSockets 有值但 cpu 没有值，或者 cpu 不等于 sockets，需要同步
    if (isHotPlugEnabledOnVm && s !== undefined && s > 0) {
      if (cpuVal === undefined || cpuVal === null || cpuVal === 0 || cpuVal !== s) {
        form.setFieldsValue({ cpu: s });
      }
    }
  }, [currentCpu, form, isHotPlugEnabledOnVm]);

  // [核心逻辑] 校验是否需要重启虚拟机
   // 这是一个多层级的判断逻辑，按照优先级依次检查：
   // 第一层：基础状态检查（是否开启热扩容功能）
   // 第二层：基建变更检查（是否修改了热扩容上限 maxSockets/maxMemory）
   // 第三层：规格范围检查（新的规格是否在原始上限范围内）
   const renderValidationMessage = (limit: number, newVal: number | undefined, isHotPlugEnabled: boolean, limitVal: number, originalLimit?: number, currentLimitFormVal?: number, field?: 'cpu' | 'memory') => {
     const isArm = architecture === 'arm64' || architecture === 'aarch64';
     if (field === 'cpu' && isHotPlugEnabled && isArm && newVal !== undefined && newVal !== limit) {
       return <div style={{marginTop: 8}}><Text type="warning">ARM 架构不支持 CPU 热插拔，需要重启生效</Text></div>;
     }
     
     // ---------------------------------------------------------
     // 第一层：基础状态检查
     // ---------------------------------------------------------
     // 如果VM未开启热扩容，那么任何修改都必须重启生效。
     if (!isHotPlugEnabled) {
        return <div style={{marginTop: 8}}><Text type="secondary">变更后需要重启生效</Text></div>;
     }

     // 如果新规格没有填写，或者和当前上限一致（边界情况），则不显示提示
     if (newVal === undefined || newVal === limit) {
        return null; 
     }
 
     // ---------------------------------------------------------
     // 规格范围检查
     // ---------------------------------------------------------
     // 如果VM已开启热扩容，判断新的规格值是否在"原始上限"范围内？
     
     const actualLimit = limitVal; // 这里的 limitVal 传入的是原始上限
 
     // 情况 A: 在范围内 -> 支持热扩容，无需重启！
     if (newVal <= actualLimit) {
        return <div style={{marginTop: 8}}><Text type="secondary">当前修改支持热扩容（无需重启）</Text></div>;
     }
 
     // 情况 B: 超出范围 -> 虽然开启了热扩容，但步子迈大了，得重启扩容
     return <div style={{marginTop: 8}}><Text type="warning">超出热扩容范围，需要重启生效</Text></div>;
   };

  /**
   * [辅助函数] 渲染全局提示 Alert
   * (该函数目前在 render 中未直接调用，可能是为了将来在顶部统一显示状态而保留)
   */
  const renderGlobalAlert = () => {
    // 无变更，不显示
    if (cpu === currentCpu && memory === currentMemory) {
       return null;
    }
    
    // [简化] 热扩容开关已拆分为独立功能，这里只显示规格变更的提示
    if (isHotPlugEnabledOnVm) {
      // 已开启热扩容：检查是否在范围内
      const limitCpu = maxSockets || currentCpu * 4;
      const limitMem = maxMemory || currentMemory * 4;
      
      const isOverLimit = (cpu !== undefined && cpu > limitCpu) || (memory !== undefined && memory > limitMem);
      const isScalingDown = (cpu !== undefined && cpu < currentCpu) || (memory !== undefined && memory < currentMemory);

      if (isScalingDown) {
         return <Alert type="error" message="热扩容模式下不支持缩容" style={{ marginTop: 4 }} />;
      }

      if (isOverLimit) {
         return <Alert type="info" message="超过热扩容范围，需要重启生效" style={{ marginTop: 4 }} />;
      } else {
         return <Alert type="info" message="当前修改支持热扩容（无需重启）" style={{ marginTop: 4 }} />;
      }
    } else {
      // 未开启热扩容：所有修改都需要重启
      return <Alert type="info" message="当前修改需要重启生效" style={{ marginTop: 4 }} />;
    }
  };

  // Check if Hot Plug is in progress
  // We don't have direct access to 'record' or 'conditions' here.
  // But we can check if 'isHotPlugEnabledOnVm' returns false when we expect it to be true (i.e. config is set).
  // A cleaner way is to pass 'isHotPlugInProgress' as a prop, but let's see if we can derive it.
  
  // Actually, 'isHotPlugEnabledOnVm' is a function passed from parent.
  // If we modify 'isHotPlugEnabledOnVm' in parent to return false when in progress, 
  // then 'isHotPlugActive' will be false here.
  // This means the UI will think Hot Plug is NOT active, and thus show the "Restart Required" warning if we change specs.
  // This is technically correct: if a hot plug is in progress, we can't do another hot plug, so any change would require a restart (or waiting).
  // However, the user might want to know WHY they can't hot plug.
  
  // Let's refine the UX. 
  // If Hot Plug is configured (maxSockets > sockets), but isHotPlugEnabledOnVm() returns false,
  // it means either RestartRequired or HotPlugInProgress.
  
  return (
    <>
      <div style={{ opacity: disabled ? 0.6 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
              {/* 
                ========================================
                1. CPU 配置区域 
                ========================================
                这里根据是否开启热扩容，展示两种完全不同的界面：
                - 模式 A (开启热扩容): 简化版。用户只输入总核数，系统自动处理为 Sockets。
                  同时提供折叠的“高级”区域，让用户查看当前的上限。
                - 模式 B (未开启): 完整版。用户可以自由配置 Sockets * Cores 的组合。
              */}
              <Row gutter={12} style={{ marginBottom: 0 }}>
                <Col span={6}>
                   <div style={{ lineHeight: '32px' }}>vCPU分配</div>
                </Col>
                <Col span={18}>
                   {isHotPlugEnabledOnVm ? (
                     /* 模式 A: 已开启热扩容 (简化视图 + 高级折叠) */
                     <Form.Item style={{ marginBottom: 0 }}>
                       <div style={{ display: 'flex', alignItems: 'center' }}>
                         <div style={{ display: 'flex', alignItems: 'center' }}>
                           {/* 主要输入框: 热扩容模式下，允许在范围内增加CPU（热扩容） */}
                           <Form.Item name="cpu" noStyle initialValue={cpuSockets || currentCpu}>
                             <InputNumber 
                               style={{ width: 100 }} 
                               suffix="核" 
                               min={currentCpu} // 热扩容模式下，不允许减少，只能增加
                               max={maxSockets || currentCpu * 4} // 最大不超过热扩容上限
                               onChange={(val) => {
                                 const v = Number(val) || 0;
                                 if (v > 0) {
                                    // [关键逻辑] 热扩容模式下，修改总核数 = 修改 Sockets 数
                                    // 因为 Cores 和 Threads 被锁定为 1，所以 总数 = Sockets * 1 * 1
                                    form.setFieldsValue({
                                      cpu: v,
                                      cpuSockets: v,
                                      cpuCores: 1,
                                      cpuThreads: 1
                                    });
                                 }
                               }}
                             />
                           </Form.Item>
                         </div>
                 {/* 高级选项切换按钮 */}
                 <a onClick={() => setShowAdvanced(!showAdvanced)} style={{ fontSize: 14, marginLeft: 10 }}>
                   拓扑 {showAdvanced ? <UpOutlined /> : <DownOutlined />}
                 </a>
               </div>

               {/* 高级拓扑配置区域 (折叠) */}
               <div style={{ background: '#EDF0F7', padding: '12px', marginTop: 12, border: '1px solid #e5e5e5', borderRadius: 8, display: showAdvanced ? 'block' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                     <Form.Item noStyle name="cpuSockets">
                       <InputNumber min={1} max={64} style={{ width: 150 }} suffix="插槽" />
                     </Form.Item>
                     <span style={{ margin: '0 12px', color: '#666' }}>x</span>
                     <Form.Item noStyle name="cpuCores">
                       <InputNumber min={1} max={64} style={{ width: 150 }} suffix="核/插槽" disabled={true} />
                     </Form.Item>

                     <span style={{ margin: '0 12px', color: '#666' }}>x</span>
                     <Form.Item noStyle name="cpuThreads">
                       <InputNumber min={1} max={64} style={{ width: 150 }} suffix="线程" disabled={true} />
                     </Form.Item>
                  </div>
                  <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
                    当前热扩容上限为 {maxSockets} 核。超过热扩容范围需重启后才能生效
                  </div>
                  
                  {/* 隐藏的 Thread 字段，保持逻辑完整性 */}
                  <Form.Item noStyle name="cpuThreads" hidden>
                    <InputNumber />
                  </Form.Item>
               </div>
             </Form.Item>
           ) : (
              /* 模式 B: 未开启热扩容 (完整拓扑视图) */
              <Form.Item style={{ marginBottom: 0 }}>
                <Space>
                   <Form.Item noStyle name="cpuSockets">
                     <InputNumber suffix="插槽" min={1} max={64} style={{ width: 100 }} placeholder="Socket" />
                   </Form.Item>
                   <Text>，每插槽</Text>
                   <Form.Item noStyle name="cpuCores">
                     <InputNumber suffix="核" min={1} max={64} style={{ width: 100 }} placeholder="Core" />
                   </Form.Item>
                   <span style={{color: '#666' }}>，总计</span>
                   {/* 实时计算总核数显示 */}
                   <Form.Item noStyle shouldUpdate={(prev, curr) => prev.cpuSockets !== curr.cpuSockets || prev.cpuCores !== curr.cpuCores}>
                     {() => {
                        const s = form.getFieldValue('cpuSockets') || 0;
                        const c = form.getFieldValue('cpuCores') || 0;
                        return <span style={{ fontWeight: 500 }}>{s * c} 核</span>;
                     }}
                   </Form.Item>
                </Space>
                
                {/* 隐藏字段 */}
                <Form.Item noStyle name="cpuThreads" hidden>
                   <InputNumber />
                </Form.Item>
                <Form.Item noStyle name="cpu" hidden>
                   <InputNumber />
                </Form.Item>
              </Form.Item>
            )}
           {/* CPU 校验提示信息 */}
           {/* 
             isHotPlugEnabledOnVm: 虚拟机当前是否已开启热扩容
             maxSockets: 虚拟机当前的热扩容上限
             currentCpu: 当前 CPU 核数
           */}
           {renderValidationMessage(currentCpu, cpu, isHotPlugEnabledOnVm, isHotPlugEnabledOnVm && maxSockets ? maxSockets : currentCpu, maxSockets, undefined, 'cpu')}
           <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      {/* 
        ========================================
        2. 内存配置区域 
        ========================================
      */}
      <Row gutter={12} style={{ marginBottom: 0 }}>
        <Col span={6}>
           <div style={{ lineHeight: '32px' }}>内存分配</div>
        </Col>
        <Col span={18}>
          <Form.Item style={{ marginBottom: 0 }}>
             <Space>
               {/* 内存预设单选框 */}
               <Radio.Group 
                 value={memPreset} 
                 buttonStyle="solid"
                 onChange={(e) => { 
                   const v = String(e.target.value); 
                   setMemPreset(v); 
                   if (v !== 'custom') { 
                     const gi = Number(v); 
                     // [热扩容检查] 如果已开启热扩容，只允许增加内存
                     if (isHotPlugEnabledOnVm && gi < currentMemory) {
                       message.warning('热扩容模式下不允许减少内存');
                       return;
                     }
                     setMemGi(gi); 
                     form.setFieldsValue({ memory: gi }); 
                   } 
                 }}
               >
                 <Radio.Button value="4">4 GiB</Radio.Button>
                 <Radio.Button value="8">8 GiB</Radio.Button>
                 <Radio.Button value="16">16 GiB</Radio.Button>
                 <Radio.Button value="custom">自定义</Radio.Button>
               </Radio.Group>
               {/* 自定义内存输入框 */}
               <InputNumber 
                 min={isHotPlugEnabledOnVm ? currentMemory : 1} // 热扩容模式下，不允许减少
                 max={isHotPlugEnabledOnVm ? (maxMemory || currentMemory * 4) : 1024} // 热扩容模式下，最大不超过热扩容上限
                 value={memGi} 
                 suffix="GiB" 
                 style={{ width: 100 }}
                 onChange={(val) => { 
                   const gi = Number(val || 1); 
                   setMemGi(gi); 
                   form.setFieldsValue({ memory: gi }); 
                   setMemPreset('custom'); 
                 }} 
               />
             </Space>
          </Form.Item>
          
          {/* 隐藏的 memory 表单字段，用于实际提交 */}
          <Form.Item 
            name="memory" 
            hidden
            rules={[
              { required: true, message: '请选择或输入内存大小' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (value > 0) return Promise.resolve();
                  return Promise.reject(new Error('内存大小必须大于 0'));
                },
              }),
            ]}
          >
            <InputNumber />
          </Form.Item>
          {/* 内存校验提示信息 */}
          {renderValidationMessage(currentMemory, memory, isHotPlugEnabledOnVm, isHotPlugEnabledOnVm && maxMemory ? maxMemory : currentMemory, maxMemory, undefined, 'memory')}
          <div style={{ marginBottom: 24 }} />
        </Col>
      </Row>

      </div>
    </>
  );
};

export default ChangeSpec;
