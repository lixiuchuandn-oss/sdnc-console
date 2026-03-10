import React from 'react';
import { Form, InputNumber, Space, Typography, Select, Checkbox, Input, message } from 'antd';
import { fetchHarvesterNodes } from '../../../../../services/harvesterApi';

type Props = {
  form: any;
  cloudId?: string;
  /** 当前 VM 的 CPU / 资源原始对象，用于初始化和调试展示 */
  vmCpuState?: {
    cpu?: any;
    resources?: any;
  };
  /** 调试展示用：当前 VM 的 CPU / 资源信息字符串 */
  vmCpuDebugText?: string;
};

const CpuAdvanced: React.FC<Props> = ({ form, cloudId, vmCpuState, vmCpuDebugText }) => {
  // 使用本地受控状态 + 监听 vmCpuState，保证“CPU 绑定”回显一定跟 VM 保持一致
  const [dedicatedChecked, setDedicatedChecked] = React.useState<boolean>(!!vmCpuState?.cpu?.dedicatedCpuPlacement);
  const [isolateChecked, setIsolateChecked] = React.useState<boolean>(!!vmCpuState?.cpu?.isolateEmulatorThread);

  React.useEffect(() => {
    const quantityToGi = (q: any): number | undefined => {
      if (q === undefined || q === null || q === '') return undefined;
      if (typeof q === 'number') {
        const v = Math.ceil(q / (1024 ** 3));
        return Number.isFinite(v) && v > 0 ? v : undefined;
      }
      const s = String(q).trim();
      if (!s) return undefined;
      const units: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5 };
      for (const [u, m] of Object.entries(units)) {
        if (s.endsWith(u)) {
          const n = parseFloat(s.slice(0, -u.length));
          if (!Number.isFinite(n) || n <= 0) return undefined;
          return Math.ceil((n * m) / (1024 ** 3));
        }
      }
      const n = parseFloat(s);
      if (!Number.isFinite(n) || n <= 0) return undefined;
      if (n <= 4096) return Math.ceil(n);
      return Math.ceil(n / (1024 ** 3));
    };

    const nextDedicated = !!vmCpuState?.cpu?.dedicatedCpuPlacement;
    const nextIsolate = !!vmCpuState?.cpu?.isolateEmulatorThread;
    const nextMemReq = quantityToGi(vmCpuState?.resources?.requests?.memory);
    const nextMemLim = quantityToGi(vmCpuState?.resources?.limits?.memory);
    setDedicatedChecked(nextDedicated);
    setIsolateChecked(nextIsolate);
    // 同步到表单字段，避免提交时拿不到最新值
    form?.setFieldsValue?.({
      dedicatedCPUPlacement: nextDedicated,
      isolateEmulatorThread: nextIsolate,
      memoryRequestGi: nextMemReq,
      memoryLimitGi: nextMemLim
    });
  }, [vmCpuState, form]);
  return (
    <div>
      <Form.Item label="CPU 模式" name="cpuModel" initialValue="host-passthrough">
        <Select options={[{ label: 'Host-Passthrough', value: 'host-passthrough' }, { label: 'Host-Model', value: 'host-model' }, { label: '自定义', value: 'custom' }]} style={{ width: 220 }} />
      </Form.Item>
      <Form.Item noStyle shouldUpdate={(prev, curr) => prev.cpuModel !== curr.cpuModel}>
        {({ getFieldValue }) => (getFieldValue('cpuModel') === 'custom' ? (
          <Form.Item label="自定义模型" name="cpuModelCustom" extra={<Typography.Text type="secondary">指定 CPU 型号名称，例如 Skylake-Client-IBRS</Typography.Text>}>
            <Input placeholder="如：Skylake-Client-IBRS" />
          </Form.Item>
        ) : null)}
      </Form.Item>
      <Form.Item label="CPU 绑定" name="dedicatedCPUPlacement" valuePropName="checked">
        <Space>
          <Checkbox
            checked={dedicatedChecked}
            onChange={async (e) => {
              const v = e.target.checked;
              if (!v) {
                setDedicatedChecked(false);
                form?.setFieldsValue?.({ dedicatedCPUPlacement: false });
                return;
              }

              const checkCpuManager = (node: any) => {
                const anns = node?.metadata?.annotations || node?.annotations || {};
                const raw = anns['harvesterhci.io/cpu-manager-update-status'];
                if (!raw) return false;
                try {
                  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
                  const p = String(obj?.policy || '').toLowerCase();
                  const s = String(obj?.status || '').toLowerCase();
                  return p === 'static' && s === 'success';
                } catch {
                  return false;
                }
              };

              try {
                if (!cloudId) throw new Error('missing cloudId');
                const res: any = await fetchHarvesterNodes(cloudId);
                const items: any[] = res?.data?.items || res?.items || [];
                const ok = (items || []).some((node: any) => checkCpuManager(node));
                if (!ok) {
                  message.error('当前物理节点未开启CPU管理');
                  setDedicatedChecked(false);
                  form?.setFieldsValue?.({ dedicatedCPUPlacement: false });
                  return;
                }
                message.warning('CPU 绑定为资源独占模式，无法使用CPU QoS');
                form?.setFieldsValue?.({
                  cpuRequest: undefined,
                  cpuLimit: undefined,
                });
                setDedicatedChecked(true);
                form?.setFieldsValue?.({ dedicatedCPUPlacement: true });
              } catch {
                message.error('CPU管理状态校验失败');
                setDedicatedChecked(false);
                form?.setFieldsValue?.({ dedicatedCPUPlacement: false });
              }
            }}
          >
            启用
          </Checkbox>
          <Typography.Text type="secondary">保证用固定的物理 CPU 核心，减少切换损耗</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="CPU 隔离" name="isolateEmulatorThread" valuePropName="checked">
        <Space>
          <Checkbox
            checked={isolateChecked}
            onChange={(e) => {
              const v = e.target.checked;
              setIsolateChecked(v);
              form?.setFieldsValue?.({ isolateEmulatorThread: v });
            }}
          >
            启用
          </Checkbox>
          <Typography.Text type="secondary">启用后 QEMU 模拟器线程与来宾 vCPU 隔离，降低干扰</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="CPU QoS">
        <Space>
          <Typography.Text>平时至少需要</Typography.Text>
          <Form.Item noStyle name="cpuRequest">
            <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>核，最多使用</Typography.Text>
          <Form.Item noStyle name="cpuLimit">
            <InputNumber min={0} max={512} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>核</Typography.Text>
        </Space>
      </Form.Item>
      <Form.Item label="内存 QoS">
        <Space>
          <Typography.Text>平时至少需要</Typography.Text>
          <Form.Item noStyle name="memoryRequestGi">
            <InputNumber min={0} max={2048} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>GiB，最多使用</Typography.Text>
          <Form.Item noStyle name="memoryLimitGi">
            <InputNumber min={0} max={4096} precision={0} style={{ width: 100 }} />
          </Form.Item>
          <Typography.Text>GiB</Typography.Text>
        </Space>
      </Form.Item>
    </div>
  );
};

export default CpuAdvanced;
