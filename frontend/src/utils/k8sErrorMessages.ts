/**
 * 统一入口：后端 / K8s / 集群常见英文错误 → 中文提示。
 * 请在此新增规则；errorHandler、requestManager 仅调用 translateKnownApiErrorMessage，避免分散重复。
 */

/**
 * @param raw 原始错误串（可含多段拼接、JSON 片段）
 * @returns 能识别则返回中文；否则返回原文
 */
export function translateKnownApiErrorMessage(raw: string): string {
  const msg = String(raw ?? '').trim();
  if (!msg) return String(raw ?? '');

  const lower = msg.toLowerCase();

  // --- 集群准入校验 Webhook 超时（API Server 调用校验服务超时；匹配条件依赖上游返回的域名/服务名原文）---
  if (
    lower.includes('validator.harvesterhci.io') ||
    (lower.includes('harvester-webhook') && lower.includes('deadline exceeded')) ||
    (lower.includes('failed calling webhook') && lower.includes('context deadline exceeded')) ||
    (lower.includes('failed to call webhook') && lower.includes('deadline exceeded'))
  ) {
    return '集群准入校验 Webhook 响应超时（常见于 Webhook 服务繁忙或控制面网络延迟）。请稍后重试；若持续出现请在集群侧检查 Webhook 相关服务与节点负载。';
  }

  // --- KubeVirt：运行策略 Halted 时不允许重启 ---
  if (
    /runstategy\s+halted.*manual restart/i.test(msg) ||
    /runstrategy\s+halted.*manual restart/i.test(msg) ||
    (lower.includes('virtualmachine.kubevirt.io') && lower.includes('runstategy halted')) ||
    (lower.includes('virtualmachine.kubevirt.io') && lower.includes('runstrategy halted'))
  ) {
    let vm = '';
    const m1 = msg.match(/restart virtual machine\s+([^\s]+)\s+failed/i);
    if (m1?.[1]) vm = String(m1[1]);
    const m2 = msg.match(/virtualmachine\.kubevirt\.io\s+"([^"]+)"/i);
    if (!vm && m2?.[1]) vm = String(m2[1]);
    const head = vm ? `实例 ${vm} ` : '实例 ';
    return `${head}运行策略为 Halted（保持停止），不支持重启。请先启动实例或将运行策略调整为允许运行后再重试。`;
  }

  // --- 虚拟机备份进行中，禁止停止/重启 ---
  if (lower.includes('vmbackup in progress for vm')) {
    let vm = '';
    const m = msg.match(/vmbackup in progress for vm\s+([^\s,]+)/i);
    if (m?.[1]) vm = String(m[1]);
    const head = vm ? `实例 ${vm} ` : '实例 ';
    return `${head}当前正在执行备份任务，暂不允许停止或重启。请等待备份完成或删除进行中的备份后再重试。`;
  }

  // --- Harvester：保存为模板 / 模板资源准入，templateId 为空 ---
  if (
    lower.includes('templateid is empty') ||
    (lower.includes('spec.templateid') && lower.includes('empty')) ||
    (lower.includes('mutator.harvesterhci.io') && lower.includes('templateid'))
  ) {
    return 'Harvester 准入校验未通过：模板标识（templateId）为空，无法写入 spec.templateId。常见于从虚拟机生成模板时集群未正确注入该字段，或与当前 Harvester 版本/实例状态不兼容。请稍后重试或升级/核对 Harvester；若仍失败请在集群侧查看 mutator.harvesterhci.io 相关日志。';
  }

  return msg;
}
