/** Cloudmap / Harvester 高风险操作 — 默认风险提示文案 */

export const HIGH_RISK_ACK_DEFAULT =
  '我已了解上述影响，确认本次操作由本人发起，而非误触。';

export const DELETE_RISK_ITEMS = [
  '删除后通常不可恢复，或需通过备份/回收站等特殊路径才能恢复。',
  '请确认目标对象名称、命名空间及关联业务无误后再继续。',
] as const;

export const DELETE_NAMESPACE_RISK_ITEMS = [
  '删除后不可恢复；命名空间内资源将被级联清理。',
  '请确认集群内已无虚拟机、卷及其他重要资源。',
] as const;

export const DELETE_NETWORK_RISK_ITEMS = [
  '可能导致虚拟机或容器断网、负载均衡流量中断。',
  '若仍有资源引用，集群可能拒绝删除或留下不一致状态。',
] as const;

export const DELETE_STORAGE_RISK_ITEMS = [
  '可能导致数据不可恢复或影响依赖该存储的业务。',
  '请确认无虚拟机、Pod 或备份任务仍引用该资源。',
] as const;

export const FORCE_DELETE_VM_RISK_ITEMS = [
  '虚拟机将被永久删除，无法从回收站恢复。',
  '勾选同步删除卷时，关联 PVC 数据将一并清除且不可找回。',
] as const;

export const VM_RECYCLE_RISK_ITEMS = [
  '虚拟机将移入回收站；运行中的实例会被强制终止。',
  '默认不删除关联数据卷；彻底删除请在回收站中操作。',
] as const;

export const NODE_MAINTENANCE_RISK_ITEMS = [
  '节点将被 cordon，工作负载将按策略热迁移或关机。',
  '强制模式将关机节点上全部虚拟机，并覆盖 maintain-mode-strategy。',
] as const;

export const CHANGE_OS_RISK_ITEMS = [
  '将删除当前系统盘并重建实例，系统盘数据将会丢失。',
  '虚拟机须重启后新系统盘才会生效；请在业务低峰期执行。',
] as const;

export const DRS_RULE_RISK_ITEMS = [
  '规则生效后，指标超阈值可能触发集群自动热迁移。',
  '删除规则后集群将不再按该策略自动调度迁移。',
] as const;

export const CEPH_STORAGE_RISK_ITEMS = [
  '可能影响集群存储可用性与业务 I/O。',
  '配置错误可能导致长时间不可用或数据迁移/重建。',
] as const;

export const CONTAINER_DELETE_RISK_ITEMS = [
  '可能导致业务中断；Deployment 等控制器可能自动重建 Pod。',
  '删除 Service / Ingress / Gateway 将切断对应流量入口。',
] as const;
