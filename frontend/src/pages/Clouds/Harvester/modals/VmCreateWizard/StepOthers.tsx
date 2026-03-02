/*
 * =========================================================================
 * [组件名称] StepOthers (Harvester 虚拟机创建向导 - 高级配置步骤)
 * [文件路径] frontend/src/pages/Clouds/Harvester/modals/VmCreateWizard/StepOthers.tsx
 * [功能描述] 负责配置虚拟机的运行策略、启动固件、Cloud-Init 以及 USB 设备挂载。
 *            此步骤通常处理非计算/存储/网络类的其他配置项。
 * =========================================================================
 * [核心逻辑]
 * 1. [运行策略] 配置 VM 的生命周期管理 (Always, RerunOnFailure 等)。
 * 2. [固件安全] 支持 EFI/SecureBoot 和 TPM 2.0，满足 Windows 11 合规性要求。
 * 3. [初始化] 通过 Cloud-Init (userData) 注入 SSH 密钥和启动脚本。
 * 4. [硬件透传] 允许挂载宿主机的 USB 设备 (需 KubeVirt 允许列表支持)。
 * -------------------------------------------------------------------------
 * [数据交互] (Form Fields -> VM Spec)
 * - runStrategy      -> spec.runStrategy (默认: RerunOnFailure)
 * - evictionStrategy -> spec.evictionStrategy (默认: LiveMigrateIfPossible)
 * - bootUseEfi       -> spec.template.domain.firmware.bootloader.efi (布尔值)
 * - sshNames         -> spec.sshKeys (SSH Key 注入列表)
 * - userData         -> spec.cloudInit.userData (Base64 编码前的原始文本)
 * - usbDevices       -> spec.template.domain.devices.hostDevices (透传设备列表)
 * =========================================================================
 */
import React from 'react';
import { Form, Select, Checkbox, Input, Space, Row, Col, Typography, Button, List } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

/**
 * [接口定义] StepOthersProps
 * 定义了组件所需的 Props，主要包括表单实例和外部资源数据。
 */
interface StepOthersProps {
  /**
   * [表单实例] Ant Design Form 实例
   * 用于收集和校验虚拟机的高级配置数据。
   */
  form: any;
  /**
   * [资源列表] 可用的 USB 设备资源
   * 从后端获取的允许透传的宿主机 USB 设备列表 (PermittedHostDevices)。
   */
  usbResources: any[];
  /**
   * [回调函数] 刷新 USB 资源
   * 当用户点击刷新按钮或下拉框展开时触发，重新获取最新的 USB 设备列表。
   */
  reloadUsbResources: () => void;
  /**
   * [资源列表] 可用的 SSH 密钥选项
   * 用户预先定义的 SSH 公钥列表，用于注入到虚拟机中。
   */
  sshKeyOptions: any[];
  /**
   * [回调函数] 刷新 SSH 密钥
   * 当用户展开下拉框时触发，确保密钥列表是最新的。
   */
  reloadSshKeys: () => void;
}

const StepOthers: React.FC<StepOthersProps> = ({
  form,
  usbResources,
  reloadUsbResources,
  sshKeyOptions,
  reloadSshKeys,
}) => {
  return (
    <>
      <Typography.Paragraph type="secondary">配置新建云主机的启动、Cloud-Init和USB设备参数</Typography.Paragraph>
      
      {/* ============================== 启动与可用性 ============================== */}
      <div className="wizard-group-title">启动与可用性</div>
      <Row gutter={16}>
        <Col span={12}>
          {/* [业务规则] 运行策略决定了 VM 在宿主机重启或故障时的行为 */}
          <Form.Item label="运行策略" name="runStrategy">
            <Select options={[
              { label: '始终运行（Always）', value: 'Always' },
              { label: '故障重试（RerunOnFailure）', value: 'RerunOnFailure' },
              { label: '手动（Manual）', value: 'Manual' },
              { label: '停止（Halted）', value: 'Halted' },
            ]} />
          </Form.Item>
        </Col>
        <Col span={12}>
          {/* [业务规则] 驱逐策略控制节点维护时的迁移行为 */}
          <Form.Item label="驱逐策略" name="evictionStrategy" tooltip="节点维护时的迁移策略">
            <Select options={[
              { label: '尽可能热迁移（LiveMigrateIfPossible）', value: 'LiveMigrateIfPossible' },
              { label: '强制热迁移（LiveMigrate）', value: 'LiveMigrate' },
              { label: '不迁移（None）', value: 'None' },
            ]} />
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
          {/* 
           * [条件渲染] EFI 高级选项
           * 仅当启用 EFI (bootUseEfi=true) 时，才允许配置 SecureBoot 和持久化。
           * 这是 Windows 11 等现代操作系统的强制要求。
           */}
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
      <Form.Item label="SSH 公钥标识" name="sshNames">
        <Select 
          mode="tags" 
          placeholder="输入或选择SSH key名称" 
          options={sshKeyOptions || []} 
          onOpenChange={(open) => { if (open) reloadSshKeys(); }}
        />
      </Form.Item>
      <Form.Item label="Cloud-Init" name="userData">
        <Input.TextArea rows={6} placeholder="#cloud-config" />
      </Form.Item>
      
      {/* ============================== USB 设备 ============================== */}
      <div className="wizard-group-title">USB设备</div>
      <Form.List name="usbDevices">
        {(fields, { add, remove }) => (
          <div>
            {/* [状态反馈] 如果后端未配置 permittedHostDevices，提示用户 */}
            {(usbResources || []).length === 0 ? (
              <div style={{ marginBottom: 10 }}>
                <Typography.Text type="secondary">未检测到允许的 USB 资源，请检查 KubeVirt 的 permittedHostDevices.usb 设置</Typography.Text>
              </div>
            ) : null}
            {fields.map(({ key, name }, idx) => (
              <Row key={key} gutter={12} style={{ marginBottom: 8 }}>
                <Col span={16}>
                  <Form.Item name={[name]} rules={[{ required: true, message: '请选择 USB 设备' }]}>
                    <Select
                      placeholder="选择 USB 设备"
                      options={(usbResources || []).map((x: any) => { 
                        // [数据转换] 格式化显示 Vendor:Product 
                        const v = String(x?.vendorId || x?.vendor || ''); 
                        const p = String(x?.productId || x?.product || ''); 
                        const code = (v && p) ? `${v}:${p}` : ''; 
                        const rn = x?.resourceName || '-'; 
                        return { label: code ? `${rn} (${code})` : rn, value: rn }; 
                      })}
                      onOpenChange={(open) => { if (open) reloadUsbResources(); }}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Button type="text" icon={<CloseOutlined />} onClick={() => remove(name)} />
                </Col>
              </Row>
            ))}
            <Space>
              <Button type="dashed" onClick={() => add('')}>新增USB设备</Button>
              <Button type="dashed" onClick={() => reloadUsbResources()}>刷新资源</Button>
            </Space>
          </div>
        )}
      </Form.List>
    </>
  );
};

export default StepOthers;
