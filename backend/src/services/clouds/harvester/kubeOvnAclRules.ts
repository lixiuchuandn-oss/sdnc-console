/**
 * Kube-OVN Subnet.spec.acls 与安全组规则共用的校验与语义约束
 */

export const KUBE_OVN_ACL_ACTIONS = new Set(['drop', 'allow', 'pass']);
export const KUBE_OVN_ACL_DIRECTIONS = new Set(['from-lport', 'to-lport']);

export type KubeOvnAclRuleRow = {
  action: string;
  direction: string;
  match: string;
  priority: number;
};

/**
 * 校验并规范化 ACL 条目数组（与 Subnet.spec.acls 单条结构一致）
 */
export function parseKubeOvnAclRulesInput(
  raw: unknown,
  arrayLabel = 'acls',
): { ok: true; value: KubeOvnAclRuleRow[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: `${arrayLabel} 须为数组` };
  const out: KubeOvnAclRuleRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== 'object')
      return { ok: false, message: `${arrayLabel}[${i}] 须为对象` };
    const o = row as Record<string, unknown>;
    const action = String(o.action ?? '').trim();
    const direction = String(o.direction ?? '').trim();
    const match = String(o.match ?? '').trim();
    const priority = Number(o.priority);
    if (!action || !direction || !match)
      return { ok: false, message: `${arrayLabel}[${i}] 须包含非空的 action、direction、match` };
    if (!Number.isFinite(priority))
      return { ok: false, message: `${arrayLabel}[${i}] priority 须为有效数字` };
    if (!KUBE_OVN_ACL_ACTIONS.has(action))
      return { ok: false, message: `${arrayLabel}[${i}] action 仅允许 drop、allow、pass` };
    if (!KUBE_OVN_ACL_DIRECTIONS.has(direction))
      return { ok: false, message: `${arrayLabel}[${i}] direction 仅允许 from-lport、to-lport` };
    out.push({ action, direction, match, priority });
  }
  return { ok: true, value: out };
}

/**
 * 安全组模板：入向不手写目的地址、出向不手写源地址（下发时由成员 IP 补全）
 */
export function securityGroupAclSemanticsError(direction: string, match: string): string | null {
  if (direction === 'from-lport' && /\bip4\.dst\b/.test(match)) {
    return '入方向（from-lport）的 match 不应包含 ip4.dst，目的地址由成员虚拟机网卡 IP 自动补全';
  }
  if (direction === 'to-lport' && /\bip4\.src\b/.test(match)) {
    return '出方向（to-lport）的 match 不应包含 ip4.src，源地址由成员虚拟机网卡 IP 自动补全';
  }
  return null;
}
