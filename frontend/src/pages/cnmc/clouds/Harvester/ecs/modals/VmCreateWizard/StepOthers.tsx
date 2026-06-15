/*
 * =========================================================================
 * [组件名称] StepOthers (Harvester 虚拟机创建向导 - 高级配置步骤)
 * [文件路径] frontend/src/pages/cnmc/clouds/Harvester/ecs/modals/VmCreateWizard/StepOthers.tsx
 * [功能描述] 负责配置虚拟机的运行策略、启动固件以及 USB 设备挂载。
 *            此步骤通常处理非计算/存储/网络类的其他配置项。
 * =========================================================================
 * [核心逻辑]
 * 1. [运行策略] 配置 VM 的生命周期管理 (Always, RerunOnFailure 等)。
 * 2. [固件安全] 支持 EFI/SecureBoot 和 TPM 2.0，满足 Windows 11 合规性要求。
 * 3. [硬件透传] 允许挂载宿主机的 USB 设备 (需 KubeVirt 允许列表支持)。
 * -------------------------------------------------------------------------
 * [数据交互] (Form Fields -> VM Spec)
 * - runStrategy      -> spec.runStrategy (默认: RerunOnFailure)
 * - evictionStrategy -> spec.evictionStrategy (默认: LiveMigrateIfPossible)
 * - bootUseEfi       -> spec.template.domain.firmware.bootloader.efi (布尔值)
 * - userData         -> spec.cloudInit.userData (Base64 编码前的原始文本，由「登录与凭据」步骤生成)
 * - usbDevices       -> spec.template.domain.devices.hostDevices (透传设备列表)
 * =========================================================================
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Form, Select, Checkbox, Space, Row, Col, Typography, Button } from 'antd';
import { MinusCircleOutlined } from '@ant-design/icons';

interface StepOthersProps {
  form: any;
  usbResources: any[];
  usbResourcesLoaded: boolean;
  usbResourcesLoading: boolean;
  reloadUsbResources: () => Promise<void> | void;
}

function buildUsbSelectOptions(usbResources: any[]) {
  return (usbResources || [])
    .filter((x: any) => {
      const enabled =
        x?.enabled !== undefined
          ? !!x.enabled
          : x?.raw?.status?.enabled !== undefined
            ? !!x.raw.status.enabled
            : x?.raw?.spec?.enabled !== undefined
              ? !!x.raw.spec.enabled
              : false;
      if (enabled !== true) return false;
      const resourceName = String(x?.resourceName || '').trim();
      if (resourceName && x?.claimed === true) return false;
      return true;
    })
    .map((x: any) => {
      const vid = String(
        x?.vendorId || x?.vendor || x?.raw?.status?.vendorID || x?.raw?.status?.vendorId || '',
      ).trim();
      const pid = String(
        x?.productId || x?.product || x?.raw?.status?.productID || x?.raw?.status?.productId || '',
      ).trim();
      const code = vid && pid ? `${vid}:${pid}` : '';
      const deviceName = String(
        x?.description ||
          x?.raw?.status?.description ||
          x?.raw?.spec?.description ||
          x?.name ||
          x?.raw?.metadata?.name ||
          '',
      ).trim();
      const rn = String(x?.resourceName || '').trim();
      const label = deviceName
        ? code
          ? `${deviceName} (${code})`
          : deviceName
        : code && rn
          ? `${rn} (${code})`
          : rn || '-';
      return { label, value: rn };
    });
}

const StepOthers: React.FC<StepOthersProps> = ({
  form,
  usbResources,
  usbResourcesLoaded,
  usbResourcesLoading,
  reloadUsbResources,
}) => {
  const [usbQueried, setUsbQueried] = useState(false);
  const usbSelectOptions = useMemo(() => buildUsbSelectOptions(usbResources), [usbResources]);

  const handleRefreshUsbResources = useCallback(async () => {
    setUsbQueried(true);
    await reloadUsbResources();
  }, [reloadUsbResources]);

  const handleAddUsbDevice = useCallback(
    async (add: (initValue?: string) => void) => {
      setUsbQueried(true);
      if (!usbResourcesLoaded) {
        await reloadUsbResources();
      }
      add('');
    },
    [reloadUsbResources, usbResourcesLoaded],
  );

  const showUsbEmptyHint =
    usbQueried && usbResourcesLoaded && !usbResourcesLoading && usbSelectOptions.length === 0;

  return (
    <>
      <Typography.Paragraph type="secondary">配置新建云主机的启动与 USB 设备参数</Typography.Paragraph>

      {/* ============================== 启动与可用性 ============================== */}
      <div className="wizard-group-title">启动与可用性</div>
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="运行策略" name="runStrategy">
            <Select
              options={[
                { label: '始终运行（Always）', value: 'Always' },
                { label: '故障重试（RerunOnFailure）', value: 'RerunOnFailure' },
                { label: '手动（Manual）', value: 'Manual' },
                { label: '停止（Halted）', value: 'Halted' },
              ]}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="驱逐策略" name="evictionStrategy" tooltip="节点维护时的迁移策略">
            <Select
              options={[
                { label: '尽可能热迁移（LiveMigrateIfPossible）', value: 'LiveMigrateIfPossible' },
                { label: '强制热迁移（LiveMigrate）', value: 'LiveMigrate' },
                { label: '不迁移（None）', value: 'None' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>

      {/* ============================== 固件与 TPM ============================== */}
      <div className="wizard-group-title">固件与TPM</div>
      <Form.Item label="固件">
        <Space direction="vertical">
          <Form.Item name="bootUseEfi" valuePropName="checked" noStyle>
            <Checkbox>使用 EFI 固件</Checkbox>
          </Form.Item>
          {(!!form.getFieldValue('bootUseEfi')) ? (
            <Space>
              <Form.Item name="efiPersistent" valuePropName="checked" noStyle>
                <Checkbox>持久化变量</Checkbox>
              </Form.Item>
              <Form.Item name="efiSecureBoot" valuePropName="checked" noStyle>
                <Checkbox>启用安全启动</Checkbox>
              </Form.Item>
            </Space>
          ) : null}
        </Space>
      </Form.Item>
      <Form.Item label="TPM">
        <Space>
          <Form.Item name="tpmEnabled" valuePropName="checked" noStyle>
            <Checkbox>启用</Checkbox>
          </Form.Item>
          <Form.Item name="tpmPersistent" valuePropName="checked" noStyle>
            <Checkbox>持久化状态</Checkbox>
          </Form.Item>
        </Space>
      </Form.Item>
      <Form.Item label="输入设备">
        <Space>
          <Form.Item name="useUsbTablet" valuePropName="checked" noStyle>
            <Checkbox>USB Tablet</Checkbox>
          </Form.Item>
        </Space>
      </Form.Item>

      {/* ============================== 管理配置 ============================== */}
      <div className="wizard-group-title">管理配置</div>
      <Form.Item label="Guest Agent">
        <Space>
          <Form.Item name="installGuestAgent" valuePropName="checked" noStyle>
            <Checkbox>安装 QEMU Guest Agent（无 Cloud-Init 时自动生成）</Checkbox>
          </Form.Item>
        </Space>
      </Form.Item>

      {/* ============================== USB 设备 ============================== */}
      <div className="wizard-group-title">USB设备</div>
      <Form.List name="usbDevices">
        {(fields, { add, remove }) => (
          <div>
            {showUsbEmptyHint ? (
              <div style={{ marginBottom: 10 }}>
                <Typography.Text type="secondary">
                  未检测到可用的 USB 资源，请检查 KubeVirt 的 permittedHostDevices.usb 设置，或点击「刷新资源」重试
                </Typography.Text>
              </div>
            ) : null}
            {fields.map(({ key, name }) => (
              <Row key={key} gutter={12} style={{ marginBottom: 8 }}>
                <Col span={22}>
                  <Form.Item name={[name]} rules={[{ required: true, message: '请选择 USB 设备' }]}>
                    <Select
                      placeholder="选择 USB 设备"
                      loading={usbResourcesLoading}
                      options={usbSelectOptions}
                      onOpenChange={(open) => {
                        if (open && usbResourcesLoaded) void handleRefreshUsbResources();
                      }}
                    />
                  </Form.Item>
                </Col>
                <Col span={2}>
                  <Button
                    color="danger"
                    variant="filled"
                    icon={<MinusCircleOutlined />}
                    onClick={() => remove(name)}
                  />
                </Col>
              </Row>
            ))}
            <Space>
              <Button
                type="dashed"
                loading={usbResourcesLoading}
                onClick={() => void handleAddUsbDevice(add)}
              >
                新增USB设备
              </Button>
              <Button
                type="dashed"
                loading={usbResourcesLoading}
                onClick={() => void handleRefreshUsbResources()}
              >
                刷新资源
              </Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepOthers;
