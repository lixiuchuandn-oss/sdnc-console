/**
 * @file harvesterUtils.ts
 * @description Harvester 相关的前端通用工具函数集合
 *
 * 功能分组：
 * 1. 命名空间 / 存储类过滤：
 *    - isSystemNamespace：判断命名空间是否为系统命名空间，用于前端列表过滤或标记
 *    - isSystemStorageClass：判断存储类是否为系统 / 内部使用的存储类
 *
 * 2. 状态文案转换：
 *    - cnVmStatus：将 Harvester / KubeVirt VM 的状态字符串转换为中文可读文案
 *
 * 3. 集群实体 ID 生成（仅 Harvester 使用）：
 *    - generateHarvesterEntityId：生成统一规范的"集群实体 ID"，形如 id-{实体缩写}-{11位随机字符串}
 *      主要用于我们自行创建的 K8s/CRD 实体（如 Harvester VM 的 vmid），
 *      其他云厂商（阿里云、华为云等）的 VM ID 则直接使用云平台返回的 InstanceId。
 *
 * 4. 克隆进度计算：
 *    - calculateVmCloneProgress：计算虚拟机克隆的进度百分比和状态
 */

import { fetchHarvesterVolume } from '../services/harvesterApi';

/**
 * 判断命名空间是否为 Harvester 系统命名空间
 *
 * 用途：
 * - Harvester 命名空间列表过滤：隐藏或标记系统命名空间
 * - Volumes / Resources 等页面中，用于区分业务命名空间和系统命名空间
 */

  
  // system namespace
export const isSystemNamespace = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  const prefixes = [
    'cattle',
    'fleet',
    'longhorn',
    'kube',
    'harvester',
    'cluster-fleet',
    'cluster',
    'local',
    'ingress'
  ];
  
  return prefixes.some(p => n.startsWith(p));
};

/**
 * 判断是否为公共命名空间 (Public Namespace)
 * 公共命名空间对租户可见（只读），对管理员可见（读写）
 */
export const isPublicNamespace = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  return ['cloud-public', 'default', 'harvester-public'].includes(n);
};

/**
 * 判断存储类是否为 Harvester 系统 / 内部存储类
 *
 * 用途：
 * - 在存储类下拉框中隐藏系统存储类，降低误操作风险
 * - 在只面向业务的视图中过滤出“用户可选”的存储类
 *
 * 规则：
 * - 精确匹配：vmstate-persistence / longhorn-static / harvester-longhorn
 * - 前缀匹配：image- / longhorn-image-（镜像相关存储类）
 */
export const isSystemStorageClass = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
// 过滤特定的存储类
  if (['vmstate-persistence', 'longhorn-static', 'harvester-longhorn'].includes(n)) return true;
  
  // 过滤掉镜像相关的存储类（使用前缀匹配，避免误过滤用户自定义的存储类）
  if (n.startsWith('image-')) return true;
  if (n.startsWith('longhorn-image-')) return true;

  // 过滤 Harvester/Longhorn 内部生成的随机 StorageClass（常见为 longhorn-<uuid>）
  // 例如：longhorn-0f3a2c1d-8b7e-4d3a-9b1c-0a1b2c3d4e5f
  // 这类一般不希望在“业务选择存储类”的下拉里暴露。
  if (/^longhorn-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(n)) return true;

  // 过滤镜像导入/临时任务生成的 StorageClass（常见为 longhorn-<something>-<timestamp>）
  // 例如：longhorn-centos111-1770203161435554900
  // 例如：longhorn-222.iso-final-v9-1770202327299882000
  if (n.startsWith('longhorn-') && /-[0-9]{13,}$/.test(n)) return true;
  
  return false;
};

/**
 * 将 VM 状态字符串转换为中文说明
 *
 * 用途：
 * - VM 列表 / 详情页面中，将后端状态码转换为终端用户可读的中文状态
 * - 同时保留未知状态的回退策略：未匹配到时返回原始状态字符串
 *
 * 支持的状态映射：
 * - running            -> 运行中
 * - starting           -> 启动中
 * - stopping           -> 停止中
 * - terminating        -> 删除中
 * - stopped            -> 已停止
 * - terminated         -> 已删除
 * - pausing            -> 暂停中
 * - paused             -> 已暂停
 * - error              -> 错误
 * - errorUnschedulable -> 调度失败
 * - waitingForVolumeBinding -> 等待卷绑定
 * - provisioning       -> 配置中
 * - unknown            -> 未知
 */
export const VM_STATUS_MAP: Record<string, string> = {
  running: '运行中',
  starting: '启动中',
  stopping: '停止中',
  terminating: '删除中',
  stopped: '已停止',
  terminated: '已删除',
  pausing: '暂停中',
  paused: '已暂停',
  crashloopbackoff: '崩溃重启中',
  error: '错误',
  errorunschedulable: '调度失败',
  waitingforvolumebinding: '等待卷绑定',
  provisioning: '配置中',
  migrating: '迁移中',
  unknown: '未知'
};

/**
 * 将 VM 状态字符串转换为中文说明
 *
 * 用途：
 * - VM 列表 / 详情页面中，将后端状态码转换为终端用户可读的中文状态
 * - 同时保留未知状态的回退策略：未匹配到时返回原始状态字符串
 *
 * 支持的状态映射：
 * - running            -> 运行中
 * - starting           -> 启动中
 * - stopping           -> 停止中
 * - terminating        -> 删除中
 * - stopped            -> 已停止
 * - terminated         -> 已删除
 * - pausing            -> 暂停中
 * - paused             -> 已暂停
 * - error              -> 错误
 * - errorUnschedulable -> 调度失败
 * - waitingForVolumeBinding -> 等待卷绑定
 * - provisioning       -> 配置中
 * - unknown            -> 未知
 */
export const cnVmStatus = (v?: string): string => {
  const k = String(v || '').toLowerCase();
  return VM_STATUS_MAP[k] || (v || '-');
};

/**
 * 生成 Harvester 相关实体的统一 ID（集群实体 ID）
 *
 * 规范：
 * - 统一格式：id-{实体缩写}-{11位随机字符串}
 *   - 实体缩写通常为 vm/vpc/vr 等英文缩写，全部转小写
 *   - 示例：id-vm-3k9z0x8af21
 *
 * 使用范围（前端）：
 * - 仅用于 Harvester 这类我们直接创建 K8s/CRD 资源的场景
 * - 例如 Harvester VM 的 vmid（metadata.name / vmName / hostname）
 * - 其他云厂商（阿里云、华为云等）的 VM ID 由云平台自动生成，不应调用本方法
 *
 * 实现说明：
 * - 随机串使用 Math.random().toString(36) 生成 [0-9a-z] 字符，
 *   通过循环拼接保证长度至少 11 位，然后截取前 11 位
 * - 最终结果满足 Kubernetes/Harvester 名称要求：小写字母、数字、中划线
 *
 * 注意：该方法仅在前端生成 ID，用于“尽量降低冲突概率”，不做强唯一性保证，
 * 如需绝对唯一需结合后端校验或冲突重试。
 *
 * @param entity 实体缩写（如 'vm'、'vpc'、'vr'），会被转为小写
 */
export const generateHarvesterEntityId = (entity: string): string => {
  const e = String(entity || '').toLowerCase();
  let rand = '';
  while (rand.length < 11) {
    rand += Math.random().toString(36).substring(2);
  }
  rand = rand.substring(0, 11);
  return `id-${e}-${rand}`;
};

/**
 * 同步估算虚拟机克隆的初始进度（不查询 PVC 状态）
 * 
 * 用于在异步计算精确进度之前显示一个合理的初始值
 * 逻辑与 calculateVmCloneProgress 保持一致，但不查询 PVC 状态
 * 
 * @param vm 虚拟机对象
 * @returns 进度信息 { progress: 0-100, phase: 'pending'|'ready'|'failed', text: string }
 */
export const estimateVmCloneProgress = (
  vm: any
): { progress: number; phase: 'pending' | 'ready' | 'failed'; text: string } => {
  try {
    const ready = vm?.status?.ready || false;
    const volumes = vm?.spec?.template?.spec?.volumes || [];
    const pvcVolumes = volumes.filter((v: any) => v.persistentVolumeClaim);
    
    // 没有 PVC，直接检查 VM 状态
    if (pvcVolumes.length === 0) {
      if (ready) {
        return { progress: 100, phase: 'ready', text: '完成' };
      }
      return { progress: 50, phase: 'pending', text: '进行中' };
    }

    // 有 PVC 的情况：
    // - 如果 VM Ready，可能是 85%（所有 PVC Bound 但刚 Ready）或 100%（完全完成）
    //   为了保守起见，如果 Ready 但不确定 PVC 状态，显示 85%
    // - 如果 VM 未 Ready，显示基础进度 30%
    if (ready) {
      // 保守估计：即使 Ready，也可能只是 PVC Bound 完成，显示 85%
      // 实际精确进度会通过异步计算更新
      return { progress: 85, phase: 'pending', text: '进行中' };
    }
    
    // VM 未 Ready，显示基础进度
    return { progress: 30, phase: 'pending', text: '进行中' };
  } catch (e) {
    return { progress: 0, phase: 'pending', text: '进行中' };
  }
};

/**
 * 计算虚拟机克隆的进度
 * 
 * 进度计算逻辑：
 * 1. 如果没有 PVC，直接检查 VM Ready 状态（50% 或 100%）
 * 2. 如果有 PVC：
 *    - 基础进度 30%（VM 创建）
 *    - PVC Bound 进度：30% + (boundCount / totalPVC) * 55%（最多到 85%）
 *    - VM Ready：85% + 15% = 100%
 * 
 * @param vm 虚拟机对象
 * @param cloudId 云平台 ID
 * @returns 进度信息 { progress: 0-100, phase: 'pending'|'ready'|'failed', text: string }
 */
export const calculateVmCloneProgress = async (
  vm: any,
  cloudId: string
): Promise<{ progress: number; phase: 'pending' | 'ready' | 'failed'; text: string }> => {
  try {
    const ready = vm?.status?.ready || false;
    const volumes = vm?.spec?.template?.spec?.volumes || [];
    const pvcVolumes = volumes.filter((v: any) => v.persistentVolumeClaim);
    
    // 没有 PVC，直接检查 VM 状态
    if (pvcVolumes.length === 0) {
      if (ready) {
        return { progress: 100, phase: 'ready', text: '完成' };
      }
      return { progress: 50, phase: 'pending', text: '进行中' };
    }

    // 检查所有 PVC 是否 Bound
    let boundCount = 0;
    let allBound = true;
    const namespace = vm?.metadata?.namespace || '';
    
    for (const vol of pvcVolumes) {
      try {
        const pvcName = vol.persistentVolumeClaim.claimName;
        const pvc = await fetchHarvesterVolume(cloudId, namespace, pvcName);
        const phase = pvc?.status?.phase || '';
        if (phase === 'Bound') {
          boundCount++;
        } else {
          allBound = false;
        }
      } catch (e) {
        allBound = false;
      }
    }

    // 所有 PVC Bound 且 VM Ready = 完成
    if (allBound && ready) {
      return { progress: 100, phase: 'ready', text: '完成' };
    }
    
    // 所有 PVC Bound 但 VM 未 Ready = 85%
    if (allBound) {
      return { progress: 85, phase: 'pending', text: '进行中' };
    }
    
    // 部分 PVC Bound = 30% + (boundCount / total) * 55%
    const progress = 30 + Math.floor((boundCount / pvcVolumes.length) * 55);
    return { progress, phase: 'pending', text: '进行中' };
  } catch (e) {
    return { progress: 0, phase: 'pending', text: '进行中' };
  }
};
