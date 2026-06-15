/** 创建向导 / 变配 · 高级调度折叠项标题（统一口径） */

export const VM_ADVANCED_SCHEDULING_COLLAPSE = {
  nodeLabels: '节点标签',
  podAffinity: '虚拟机亲和性',
  podAntiAffinity: '虚拟机反亲和性',
} as const;

/** 折叠项内简要说明（不放标题里，避免三项长短不一） */
export const VM_ADVANCED_SCHEDULING_HINT = {
  podAffinity: '尽量或必须与所选虚拟机部署在同一拓扑域（例如同一宿主机）。',
  podAntiAffinity: '尽量或必须与所选虚拟机分散在不同拓扑域（例如不同宿主机）。',
} as const;

export function vmFailureDomainRequiredMessage(): string {
  return '请选择故障域';
}

/** 指定主机时落点已定，清空高级调度相关表单字段 */
export function clearVmAdvancedSchedulingFormFields(form: {
  setFieldsValue: (values: Record<string, unknown>) => void;
}): void {
  form.setFieldsValue({
    failureDomainName: undefined,
  });
}

/** 运行位置为「指定主机」时不展示、不提交高级调度 */
export function isVmAdvancedSchedulingAllowed(hostMode: string | undefined): boolean {
  return hostMode !== 'node';
}
