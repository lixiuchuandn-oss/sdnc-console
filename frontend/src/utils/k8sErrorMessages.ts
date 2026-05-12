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

  // --- Harvester：未配置备份目标（需在集群设置中配置 Backup Target）---
  if (lower.includes('backup target is not set')) {
    return '未配置备份服务器，请先配置备份服务器后再做备份。';
  }

  // --- 集群准入校验 Webhook 超时（须排在具体 admission 文案之后，避免误把「拒绝原因」整段当成超时）---
  if (
    lower.includes('validator.harvesterhci.io') &&
    (lower.includes('deadline exceeded') ||
      lower.includes('context deadline exceeded') ||
      lower.includes('failed calling webhook') ||
      lower.includes('failed to call webhook'))
  ) {
    return '集群准入校验 Webhook 响应超时（常见于 Webhook 服务繁忙或控制面网络延迟）。请稍后重试；若持续出现请在集群侧检查 Webhook 相关服务与节点负载。';
  }

  // --- 集群准入校验 Webhook 超时（其它 harvester webhook 路径）---
  if (
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

  // --- Kube-OVN：子网网关不在 CIDR 内（租户/管理端创建子网常见）---
  if (
    lower.includes('pod-ip-validating.kube-ovn.io') ||
    lower.includes('gateway') && (lower.includes('not in cidr') || lower.includes('not in the cidr'))
  ) {
    return '子网网关地址不在所选 CIDR 网段内，或不符合集群对该子网的校验规则。请核对网关与 CIDR（例如网关须落在网段内且未被排除 IP 占用），修改后重试。';
  }

  // --- Kubernetes PVC：禁止将请求容量改为小于已分配容量（缩小云盘）---
  if (
    lower.includes('less than status.capacity') ||
    (lower.includes('persistentvolumeclaim') &&
      (lower.includes('spec.resources.requests.storage') || lower.includes('requests.storage')) &&
      (lower.includes('can not be less') || lower.includes('cannot be less')))
  ) {
    return '虚拟云盘无法缩小磁盘容量';
  }

  // --- Kubernetes PVC：未 Bound（常为创建中/未就绪）时无法按 Bound 规则调整 spec（immutable + bound claims）---
  if (
    lower.includes('persistentvolumeclaim') &&
    lower.includes('spec is immutable after creation') &&
    lower.includes('bound claims')
  ) {
    return '虚拟云盘正在创建中，无法修改';
  }

  // --- Harvester：整机备份从备份新建 VM 且「保留 MAC」时，源虚拟机仍在场则准入拒绝（与源机 MAC 冲突）---
  if (
    lower.includes("can't restore the new vm with the same macaddress") ||
    lower.includes('same macaddress because the source vm is still existent') ||
    (lower.includes('spec.keepmacaddress') && lower.includes('source vm')) ||
    (lower.includes('keepmacaddress') && lower.includes('macaddress') && lower.includes('still existent'))
  ) {
    return 'mac地址和已有虚拟机重复';
  }

  // --- Harvester / Multus：NAD 不存在；完整 JSON 或 admission webhook 文案也匹配 ---
  if (
    lower.includes('admission webhook') &&
    lower.includes('denied the request') &&
    (lower.includes('network-attachment-definitions') ||
      lower.includes('networkattachmentdefinition') ||
      lower.includes('network-attachment')) &&
    lower.includes('not found')
  ) {
    return '子网网络尚未就绪：集群中找不到所选子网对应的网络附加资源（NAD）。常见于刚创建 VPC/子网或扁平子网尚未同步完成，请稍候再创建虚拟机，或在子网/网络已就绪后重新选择网卡。';
  }
  if (
    (lower.includes('network-attachment-definitions') ||
      lower.includes('networkattachmentdefinitions.k8s.cni.cncf.io')) &&
    lower.includes('not found')
  ) {
    return '子网网络尚未就绪：集群中找不到所选子网对应的网络附加资源（NAD）。常见于刚创建 VPC/子网或扁平子网尚未同步完成，请稍候再创建虚拟机，或在子网/网络已就绪后重新选择网卡。';
  }

  // --- KubeVirt：启动顺序冲突（已为其他设备设置了启动顺序）---
  if (
    lower.includes('bootorder') &&
    lower.includes('already set') &&
    lower.includes('different device')
  ) {
    return '启动顺序配置冲突：已为其他设备设置了启动顺序。请取消当前设备的「优先启动」设置，或先清除其他设备的启动顺序后再重试。';
  }

  return msg;
}
