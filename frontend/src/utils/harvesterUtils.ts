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
 *    - generateHarvesterEntityId：生成统一规范的“集群实体 ID”，形如 id-{实体缩写}-{11位随机字符串}
 *      主要用于我们自行创建的 K8s/CRD 实体（如 Harvester VM 的 vmid），
 *      其他云厂商（阿里云、华为云等）的 VM ID 则直接使用云平台返回的 InstanceId。
 */

/**
 * 判断命名空间是否为 Harvester 系统命名空间
 *
 * 用途：
 * - Harvester 命名空间列表过滤：隐藏或标记系统命名空间
 * - Volumes / Resources 等页面中，用于区分业务命名空间和系统命名空间
 *
 * 规则：
 * - 精确匹配：cloud-public / default / ingress-nginx
 * - 前缀匹配：cattle / fleet / longhorn / kube / harvester / cluster-fleet / cluster / local / user
 */
export const isSystemNamespace = (name: string): boolean => {
  const n = String(name || '').toLowerCase();
  
  // Exact matches
  if (['cloud-public','default', 'ingress-nginx'].includes(n)) return true;

  // Prefix matches
  const prefixes = [
    'cattle',
    'fleet',
    'longhorn',
    'kube',
    'harvester',
    'cluster-fleet',
    'cluster',
    'local',
    'user'
  ];
  
  return prefixes.some(p => n.startsWith(p));
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
 * - error              -> 错误
 * - errorUnschedulable -> 调度失败
 * - waitingForVolumeBinding -> 等待卷绑定
 * - provisioning       -> 配置中
 * - unknown            -> 未知
 */
export const cnVmStatus = (v?: string): string => {
  const k = String(v || '').toLowerCase();
  const m: Record<string, string> = {
    running: '运行中',
    starting: '启动中',
    stopping: '停止中',
    terminating: '删除中',
    stopped: '已停止',
    terminated: '已删除',
    error: '错误',
    errorunschedulable: '调度失败',
    waitingforvolumebinding: '等待卷绑定',
    provisioning: '配置中',
    unknown: '未知'
  };
  return m[k] || (v || '-');
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
