import { useEffect } from 'react';
import type { FormInstance } from 'antd/es/form';

/**
 * 选中「性能设置」菜单项后：在聚合 VM 更新时补全 dedicatedCPUPlacement 等字段（与 Menu 切换时的粗回填互补）。
 */
export function useVmReconfigureCpuAdvancedMenuSync(params: {
  open: boolean;
  selectedKey: string;
  activeRecord: any;
  form: FormInstance;
}) {
  const { open, selectedKey, activeRecord, form } = params;

  useEffect(() => {
    if (!open) return;
    if (selectedKey !== 'cpu_advanced') return;

    const domain = activeRecord?.spec?.template?.spec?.domain;
    const cpuSpec = domain?.cpu;
    const resources = domain?.resources;
    if (!cpuSpec || !resources) return;

    const parseCpu = (v: any) => {
      if (!v) return null;
      const s = String(v);
      if (s.endsWith('m')) return parseInt(s, 10) / 1000;
      return parseFloat(s);
    };

    const limit = parseCpu(resources?.limits?.cpu);

    form.setFieldsValue({
      dedicatedCPUPlacement: !!cpuSpec?.dedicatedCpuPlacement,
      isolateEmulatorThread: !!cpuSpec?.isolateEmulatorThread,
      cpuRequest: parseCpu(resources?.requests?.cpu),
      cpuLimit: limit,
    });
  }, [open, selectedKey, activeRecord, form]);
}
