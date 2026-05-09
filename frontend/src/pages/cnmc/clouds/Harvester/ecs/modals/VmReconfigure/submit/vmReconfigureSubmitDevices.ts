/**
 * 变配提交：GPU / 节点调度与亲和 / USB / VM 策略（`updateHarvesterVmSpec`）。
 */
import { message, Modal } from 'antd';
import { updateHarvesterVmSpec } from '../../../../../../../../services/harvesterApi';
import type { VmReconfigureSubmitCtx } from './vmReconfigureSubmitContext';
import { VmReconfigureSubmitSkipFinalize } from './vmReconfigureSubmitTypes';

export async function submitVmReconfigureChangeGpu(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, record, latestVm, gpuResources, openRestartConfirm } = ctx;
        const mode = values.gpuMode || 'none';
        const names = Array.isArray(values.gpuResourceNames) ? values.gpuResourceNames : [];
        const deviceNames = Array.isArray(values.gpuDeviceNames) ? values.gpuDeviceNames : [];
        const gpuNodeName = values.gpuNodeName !== undefined ? values.gpuNodeName : undefined;
        
        // [节点选择器校验] 如果是直通GPU（非vGPU），需要校验节点选择器
        if (mode !== 'none' && mode !== 'vgpu' && names.length > 0) {
          const activeVm = latestVm || record;
          const currentNodeSelector = activeVm?.spec?.template?.spec?.nodeSelector || {};
          const currentNodeName = currentNodeSelector['kubernetes.io/hostname'];
          
          // 获取要挂载的GPU设备所在的节点
          const gpuList = Array.isArray(gpuResources) ? gpuResources : [];
          const targetGpus = names.map((rn: string) => gpuList.find((g: any) => String(g?.resourceName || '') === String(rn))).filter(Boolean);
          const targetNodes = targetGpus.map((g: any) => String(g?.node || g?.nodeName || '').trim()).filter(Boolean);
          const uniqueTargetNodes = Array.from(new Set(targetNodes));
          
          if (uniqueTargetNodes.length > 0) {
            const targetNode = uniqueTargetNodes[0]; // 取第一个节点（如果多个节点不一致，后面会拒绝）
            
            // 检查当前VM是否有其他直通设备（USB或GPU）
            const domain = activeVm?.spec?.template?.spec?.domain;
            const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
            const currentGpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
            const isUsbHostDevice = (d: any) => {
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('usb') || dn.includes('usb');
            };
            const isGpuLikeHostDevice = (d: any) => {
              if (isUsbHostDevice(d)) return false;
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('gpu') || dn.startsWith('nvidia.com/');
            };
            const hasOtherPassthroughDevices = hostDevices.some((d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d)) || currentGpus.length > 0;
            
            // 1. 判断是否有节点选择器
            if (!currentNodeName) {
              // 2. 如果没有，自动设置节点选择器
              await updateHarvesterVmSpec(cloudId, namespace, vmName, {
                gpuMode: mode,
                gpuResourceNames: names,
                gpuDeviceNames: deviceNames,
                gpuNodeName: targetNode,
              });
              message.success(`GPU配置已更新，已自动设置节点选择器为 ${targetNode}`);
              openRestartConfirm(namespace, vmName, false);
              return undefined;
            } else {
              // 3. 如果有节点选择器
              if (!hasOtherPassthroughDevices) {
                // 3.1 没有其他直通设备，提示用户是否变更节点
                if (currentNodeName !== targetNode) {
                  Modal.confirm({
                    title: '节点选择器不一致',
                    content: `当前VM的节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`,
                    okText: '是，变更节点',
                    cancelText: '取消',
                    onOk: async () => {
                      await updateHarvesterVmSpec(cloudId, namespace, vmName, {
                        gpuMode: mode,
                        gpuResourceNames: names,
                        gpuDeviceNames: deviceNames,
                        gpuNodeName: targetNode,
                      });
                      message.success('GPU配置已更新，节点选择器已变更');
                      openRestartConfirm(namespace, vmName, false);
                    },
                  });
                  throw new VmReconfigureSubmitSkipFinalize(); // 不继续执行，等待用户确认
                }
              } else {
                // 3.2 有其他直通设备
                if (currentNodeName === targetNode) {
                  // 3.2.1 节点选择器与自己一致，跳过（直接提交）
                } else {
                  // 3.2.2 节点选择器与自己不一致，拒绝变配
                  message.error(`无法挂载GPU：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但GPU设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的GPU设备。`);
                  throw new VmReconfigureSubmitSkipFinalize(); // 拒绝提交
                }
              }
            }
            
            // 检查多个GPU是否在同一节点
            if (uniqueTargetNodes.length > 1) {
              message.error(`无法挂载GPU：选择的GPU设备位于不同节点（${uniqueTargetNodes.join(', ')}），请选择位于同一节点的GPU设备。`);
              throw new VmReconfigureSubmitSkipFinalize(); // 拒绝提交
            }
          }
        }
        
        await updateHarvesterVmSpec(cloudId, namespace, vmName, {
          gpuMode: mode,
          gpuResourceNames: mode === 'none' ? [] : names,
          gpuDeviceNames: mode === 'none' ? [] : deviceNames,
          gpuNodeName: mode === 'none' ? null : gpuNodeName,
        });
        message.success('GPU配置已更新');
        openRestartConfirm(namespace, vmName, false);
}


export async function submitVmReconfigureChangeNodeScheduling(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
        const mode = values.nodeSchedulingMode;
        const fixedNode = values.fixedNode;
        const nodeSelectorPairs = values.nodeSelectorPairs || [];
        
        // 验证
        if (mode === 'fixed' && !fixedNode) {
          message.error('请选择要固定的节点');
          throw new VmReconfigureSubmitSkipFinalize();
        }
        if (mode === 'label') {
          const validPairs = nodeSelectorPairs.filter((p: any) => p?.key && p?.value);
          if (validPairs.length === 0) {
            message.error('请至少添加一个标签选择器');
            throw new VmReconfigureSubmitSkipFinalize();
          }
        }
        
        // 构建提交参数
        let updateParams: any = {};
        
        if (mode === 'auto') {
          // 自动调度：清空所有 nodeSelector
          updateParams.nodeSelector = null;
        } else if (mode === 'fixed') {
          // 指定主机：使用 nodeSelector
          const nodeName = String(fixedNode || '').trim();
          if (nodeName) {
            updateParams.nodeSelector = {
              'kubernetes.io/hostname': nodeName
            };
          } else {
            updateParams.nodeSelector = null;
          }
        } else if (mode === 'label') {
          // 标签选择：构建 nodeSelector 对象
          const nodeSelector: Record<string, string> = {};
          nodeSelectorPairs.forEach((p: any) => {
            const key = String(p?.key || '').trim();
            const value = String(p?.value || '').trim();
            if (key && value) {
              nodeSelector[key] = value;
            }
          });
          updateParams.nodeSelector = Object.keys(nodeSelector).length > 0 ? nodeSelector : null;
        }

        await updateHarvesterVmSpec(cloudId, namespace, vmName, updateParams);
        message.success('节点调度配置已更新');
        openRestartConfirm(namespace, vmName, false);
}


export async function submitVmReconfigureChangeNodeAffinity(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
        const mode = values.nodeAffinityMode;
        const terms = values.nodeAffinityTerms || [];
        
        // 构建 nodeAffinity
        let nodeAffinity: any = null; // 使用 null 表示清空
        if (mode === 'required' && terms.length > 0) {
          const nodeSelectorTerms = terms.map((term: any) => {
            const expressions = (term.expressions || []).filter((expr: any) => expr?.key && expr?.operator);
            if (expressions.length === 0) return null;
            
            return {
              matchExpressions: expressions.map((expr: any) => {
                const matchExpr: any = {
                  key: String(expr.key || '').trim(),
                  operator: String(expr.operator || 'In'),
                };
                
                // 某些操作符不需要 values（如 Exists, DoesNotExist）
                if (!['Exists', 'DoesNotExist'].includes(matchExpr.operator)) {
                  const values = Array.isArray(expr.values) ? expr.values : [];
                  const filteredValues = values.filter((v: any) => v && String(v).trim()).map((v: any) => String(v).trim());
                  if (filteredValues.length > 0) {
                    matchExpr.values = filteredValues;
                  } else {
                    // 如果操作符需要值但没有提供，跳过这个表达式
                    return null;
                  }
                }
                
                return matchExpr;
              }).filter((expr: any) => expr !== null && expr.key),
            };
          }).filter((term: any) => term !== null && term.matchExpressions && term.matchExpressions.length > 0);
          
          if (nodeSelectorTerms.length > 0) {
            nodeAffinity = {
              nodeAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: {
                  nodeSelectorTerms,
                },
              },
            };
          }
        }
        
        await updateHarvesterVmSpec(cloudId, namespace, vmName, { affinity: nodeAffinity });
        message.success('节点亲和性配置已更新');
        openRestartConfirm(namespace, vmName, false);
}


export async function submitVmReconfigureChangeUsb(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, record, latestVm, usbResources, openRestartConfirm } = ctx;
        const names = Array.isArray(values.usbResourceNames) ? values.usbResourceNames : [];
        
        // [节点选择器校验] USB是直通设备，需要校验节点选择器
        if (names.length > 0) {
          const activeVm = latestVm || record;
          const currentNodeSelector = activeVm?.spec?.template?.spec?.nodeSelector || {};
          const currentNodeName = currentNodeSelector['kubernetes.io/hostname'];
          
          // 获取要挂载的USB设备所在的节点
          const usbList = Array.isArray(usbResources) ? usbResources : [];
          const targetUsbs = names.map((rn: string) => usbList.find((u: any) => String(u?.resourceName || '') === String(rn))).filter(Boolean);
          const targetNodes = targetUsbs.map((u: any) => String(u?.nodeName || u?.node || '').trim()).filter(Boolean);
          const uniqueTargetNodes = Array.from(new Set(targetNodes));
          
          if (uniqueTargetNodes.length > 0) {
            const targetNode = uniqueTargetNodes[0]; // 取第一个节点（如果多个节点不一致，后面会拒绝）
            
            // 检查当前VM是否有其他直通设备（USB或GPU）
            const domain = activeVm?.spec?.template?.spec?.domain;
            const hostDevices = Array.isArray(domain?.devices?.hostDevices) ? domain.devices.hostDevices : [];
            const currentGpus = Array.isArray(domain?.devices?.gpus) ? domain.devices.gpus : [];
            const isUsbHostDevice = (d: any) => {
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('usb') || dn.includes('usb');
            };
            const isGpuLikeHostDevice = (d: any) => {
              if (isUsbHostDevice(d)) return false;
              const dn = String(d?.deviceName || '').toLowerCase();
              const n = String(d?.name || '').toLowerCase();
              return n.startsWith('gpu') || dn.startsWith('nvidia.com/');
            };
            const hasOtherPassthroughDevices = hostDevices.some((d: any) => isGpuLikeHostDevice(d) || isUsbHostDevice(d)) || currentGpus.length > 0;
            
            // 1. 判断是否有节点选择器
            if (!currentNodeName) {
              // 2. 如果没有，自动设置节点选择器
              await updateHarvesterVmSpec(cloudId, namespace, vmName, { 
                usbResourceNames: names,
                nodeSelector: { 'kubernetes.io/hostname': targetNode }
              });
              message.success(`USB配置已更新，已自动设置节点选择器为 ${targetNode}`);
              openRestartConfirm(namespace, vmName, false);
              return undefined;
            } else {
              // 3. 如果有节点选择器
              if (!hasOtherPassthroughDevices) {
                // 3.1 没有其他直通设备，提示用户是否变更节点
                if (currentNodeName !== targetNode) {
                  Modal.confirm({
                    title: '节点选择器不一致',
                    content: `当前VM的节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。是否将节点选择器变更为 ${targetNode}？`,
                    okText: '是，变更节点',
                    cancelText: '取消',
                    onOk: async () => {
                      await updateHarvesterVmSpec(cloudId, namespace, vmName, { 
                        usbResourceNames: names,
                        nodeSelector: { 'kubernetes.io/hostname': targetNode }
                      });
                      message.success('USB配置已更新，节点选择器已变更');
                      openRestartConfirm(namespace, vmName, false);
                    },
                  });
                  throw new VmReconfigureSubmitSkipFinalize(); // 不继续执行，等待用户确认
                }
              } else {
                // 3.2 有其他直通设备
                if (currentNodeName === targetNode) {
                  // 3.2.1 节点选择器与自己一致，跳过（直接提交）
                } else {
                  // 3.2.2 节点选择器与自己不一致，拒绝变配
                  message.error(`无法挂载USB：当前VM已挂载其他直通设备，节点选择器为 ${currentNodeName}，但USB设备位于节点 ${targetNode}。请先移除其他直通设备或选择位于 ${currentNodeName} 节点的USB设备。`);
                  throw new VmReconfigureSubmitSkipFinalize(); // 拒绝提交
                }
              }
            }
            
            // 检查多个USB是否在同一节点
            if (uniqueTargetNodes.length > 1) {
              message.error(`无法挂载USB：选择的USB设备位于不同节点（${uniqueTargetNodes.join(', ')}），请选择位于同一节点的USB设备。`);
              throw new VmReconfigureSubmitSkipFinalize(); // 拒绝提交
            }
          }
        }
        
        await updateHarvesterVmSpec(cloudId, namespace, vmName, { usbResourceNames: names });
        message.success('USB配置已更新');
        openRestartConfirm(namespace, vmName, false);
}


export async function submitVmReconfigureVmPolicy(
  ctx: VmReconfigureSubmitCtx,
  values: any,
  vmName: string,
  namespace: string,
): Promise<void> {
  const { cloudId, openRestartConfirm } = ctx;
        const rs = values.runStrategy || 'Manual';
        const es = values.evictionStrategy ? String(values.evictionStrategy) : null;
        await updateHarvesterVmSpec(cloudId, namespace, vmName, { runStrategy: rs, evictionStrategy: es });
        message.success('策略配置已更新');
        openRestartConfirm(namespace, vmName, false);
}
