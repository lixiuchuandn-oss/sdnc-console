/**
 * @file harvesterUtils.ts
 * @description Harvester 相关的前端通用工具函数集合
 *
 * 功能分组：
 * 1. 命名空间 / 存储类过滤：
 *    - isSystemNamespace：判断命名空间是否为系统命名空间，用于前端列表过滤或标记
 *    - isSystemStorageClass：判断存储类是否为系统 / 内部使用的存储类
 *    - isClusterDefaultStorageClass：判断是否为集群标记的 default StorageClass
 *    - pickDefaultStorageClassName：解析默认存储类名称（与创建向导一致）
 *
 * 2. 状态文案转换：
 *    - cnVmStatus：将 Harvester / KubeVirt VM 的状态字符串转换为中文可读文案
 *
 * 3. 集群实体 ID 生成（仅 Harvester 使用）：
 *    - generateHarvesterEntityId：生成统一规范的"集群实体 ID"，形如 id-{实体缩写}-{11位随机字符串}
 *      主要用于我们自行创建的 K8s/CRD 实体（如 Harvester VM 的 vmid），
 *      其他云厂商（阿里云、华为云等）的 VM ID 则直接使用云平台返回的 InstanceId。
 *
 * 4. 克隆任务结束状态判断：
 *    - getVmCloneTaskStatus：仅判断标准克隆任务是否已结束（完成/进行中），不做进度计算、不判失败
 */

/**
 * 判断命名空间是否为 Harvester 系统命名空间
 *
 * 用途：
 * - Harvester 命名空间列表过滤：隐藏或标记系统命名空间
 * - Volumes / Resources 等页面中，用于区分业务命名空间和系统命名空间
 */
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
 * 判断存储类是否被集群标记为 default StorageClass（metadata/annotations 上的 is-default-class）
 */
export const isClusterDefaultStorageClass = (sc: any): boolean => {
  const meta = sc?.metadata?.annotations || {};
  const top = sc?.annotations || {};
  const flag =
    meta['storageclass.kubernetes.io/is-default-class'] ??
    meta['storageclass.beta.kubernetes.io/is-default-class'] ??
    top['storageclass.kubernetes.io/is-default-class'] ??
    top['storageclass.beta.kubernetes.io/is-default-class'] ??
    sc?.isDefault;
  return String(flag || '').toLowerCase() === 'true';
};

/**
 * 解析集群「默认」存储类名称：优先 is-default-class，否则取列表第一项（与创建向导 useHarvesterData 一致）
 */
export const pickDefaultStorageClassName = (storageClasses?: any[]): string | undefined => {
  const list: any[] = Array.isArray(storageClasses) ? storageClasses : [];
  const pickName = (sc: any) => sc?.metadata?.name || sc?.name;
  const hit = list.find(isClusterDefaultStorageClass);
  return pickName(hit) || pickName(list[0]) || undefined;
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
 * 判断虚拟机标准克隆任务是否已结束（仅做结束状态判断，不做进度计算）
 *
 * 优先使用后端返回的 clonePvcsReady（克隆目标 VM 的磁盘 PVC 是否全部 Bound）：
 * - clonePvcsReady === true → 完成
 * - clonePvcsReady === false → 进行中
 *
 * 若无 clonePvcsReady（兼容旧数据），则依据 VM 是否已 Running 判断完成，其余均为进行中。
 * 不根据 VM 错误状态判「克隆失败」——VM 调度失败等不等于克隆失败，克隆只区分「卷就绪/未就绪」。
 *
 * @param vm 虚拟机对象（含 status，或后端附带的 clonePvcsReady）
 * @returns { phase: 'pending'|'ready', text: string } 仅返回完成或进行中，不返回失败
 */
export const getVmCloneTaskStatus = (
  vm: any
): { phase: 'pending' | 'ready'; text: string } => {
  try {
    // 优先使用后端基于 PVC 状态判断的结果（克隆目标 VM 的磁盘是否全部 Bound）
    if (vm?.clonePvcsReady === true) {
      return { phase: 'ready', text: '完成' };
    }
    if (vm?.clonePvcsReady === false) {
      return { phase: 'pending', text: '进行中' };
    }

    // 兼容：无 clonePvcsReady 时，仅用 VM 是否已运行判断完成，其余一律进行中（不判失败）
    const status = vm?.status;
    const ready = status?.ready === true;
    const conditions: any[] = Array.isArray(status?.conditions) ? status.conditions : [];
    const readyCond = conditions.find((c: any) => String(c?.type || '').toLowerCase() === 'ready');
    const readyByCond = readyCond && String(readyCond.status || '').toLowerCase() === 'true';
    const printable = String(status?.printableStatus || '').trim();
    if (ready || readyByCond || printable === 'Running') {
      return { phase: 'ready', text: '完成' };
    }

    return { phase: 'pending', text: '进行中' };
  } catch (e) {
    return { phase: 'pending', text: '进行中' };
  }
};

/**
 * 判断 VirtualMachineImage 是 ISO 光盘镜像还是磁盘镜像（qcow2/raw 等）。
 * 与 Harvester UI / 镜像列表（ImagesSection）使用同一套规则，避免各页面不一致。
 *
 * 优先级：metadata.labels[harvesterhci.io/image-type] → spec.diskFormat →
 * 卷导出语义 → 展示名/注解 image-name/URL 中的扩展名。
 */
export function resolveVmImageKind(img: any): 'iso' | 'disk' | 'unknown' {
  const labels = img?.metadata?.labels || {};
  const typeLabel = String(labels['harvesterhci.io/image-type'] || '').toLowerCase();
  if (typeLabel === 'iso') return 'iso';
  if (['raw_qcow2', 'qcow2', 'raw', 'disk', 'container'].includes(typeLabel)) return 'disk';

  const diskFormat = String(img?.spec?.diskFormat || img?.diskFormat || '').toLowerCase();
  if (diskFormat === 'iso') return 'iso';
  if (['qcow2', 'raw'].includes(diskFormat)) return 'disk';

  const sourceType = String(img?.spec?.sourceType || '').toLowerCase();
  if (sourceType === 'export-from-volume') return 'disk';
  if (img?.spec?.pvcName || img?.spec?.pvcNamespace) return 'disk';

  const ann = img?.metadata?.annotations || {};
  const disp = String(
    labels['harvesterhci.io/imageDisplayName'] ||
      img?.spec?.displayName ||
      ann['harvesterhci.io/image-name'] ||
      img?.metadata?.name ||
      img?.name ||
      '',
  ).toLowerCase();
  const url = String(img?.spec?.url || '').toLowerCase();

  if (sourceType === 'upload' || sourceType === 'download') {
    if (/\.iso$/i.test(disp) || /\.iso(\?|$|#)/i.test(url)) return 'iso';
    if (/\.(qcow2|img|raw)$/i.test(disp) || /\.(qcow2|img|raw)(\?|$|#)/i.test(url)) return 'disk';
    return 'unknown';
  }

  if (/\.iso$/i.test(disp)) return 'iso';
  if (/\.(qcow2|img|raw)$/i.test(disp)) return 'disk';
  return 'unknown';
}
