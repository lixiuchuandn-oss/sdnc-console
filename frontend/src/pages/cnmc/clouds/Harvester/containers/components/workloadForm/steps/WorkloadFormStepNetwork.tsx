import React from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
} from 'antd';

import { isIpInCidr } from '../networkIpUtils';
import { useWorkloadFormStaticIpCheck } from '../hooks/useWorkloadFormStaticIpCheck';
import type {
  WorkloadFormNadOption,
  WorkloadFormSubnetOption,
  WorkloadFormVpcOption,
} from '../hooks/useWorkloadFormNetworkOptions';

export interface WorkloadFormStepNetworkProps {
  cloudId: string;
  hideFlatSubnet?: boolean;
  loadingNetworkData: boolean;
  isFlatVpc: (vpc: string) => boolean;
  flatSubnetOptions: WorkloadFormSubnetOption[];
  vpcOptions: WorkloadFormVpcOption[];
  vpcSubnetOptions: WorkloadFormSubnetOption[];
  selectedVpc?: string;
  allNadOptions: WorkloadFormNadOption[];
  reloadNads: () => void | Promise<void>;
  kubeSubnets: unknown[];
}

const WorkloadFormStepNetwork: React.FC<WorkloadFormStepNetworkProps> = ({
  cloudId,
  hideFlatSubnet,
  loadingNetworkData,
  isFlatVpc,
  flatSubnetOptions,
  vpcOptions,
  vpcSubnetOptions,
  selectedVpc,
  allNadOptions,
  reloadNads,
  kubeSubnets,
}) => {
  const form = Form.useFormInstance();
  const networkType = Form.useWatch('networkType', form) || 'default';
  const enableStaticIPWatch = Form.useWatch('enableStaticIP', form);

  const { checkingStaticIP, staticIPCheckResult, setStaticIPCheckResult, handleCheckStaticIP } =
    useWorkloadFormStaticIpCheck({
      cloudId,
      form,
      flatSubnetOptions,
      kubeSubnets,
      selectedVpc,
    });

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="网络配置"
        description={
          <div>
            <div>
              配置 Pod 的网络连接方式。默认使用 Pod 网络，也可以选择扁平子网、VPC 子网或自定义 NAD。
            </div>
            <div style={{ marginTop: 8, color: '#faad14' }}>
              💡 提示：如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载。
            </div>
          </div>
        }
      />

      {loadingNetworkData ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="加载网络数据..." />
        </div>
      ) : (
        <>
          <Form.Item
            name="networkType"
            label="网络类型"
            initialValue="default"
            extra="选择 Pod 使用的网络类型"
          >
            <Radio.Group>
              <Radio value="default">默认网络（Pod网络）</Radio>
              {!hideFlatSubnet && <Radio value="flat_subnet">扁平子网</Radio>}
              <Radio value="vpc">VPC子网</Radio>
              <Radio value="custom_nad">自定义NAD</Radio>
            </Radio.Group>
          </Form.Item>

          {networkType === 'flat_subnet' && (
            <>
              {flatSubnetOptions.length === 0 && !loadingNetworkData && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="未找到扁平子网"
                  description={
                    <div>
                      <div>
                        请确保已在资源池中创建扁平子网（Kube-OVN 子网，VPC 为 ovn-internal，注解
                        tower.io/subnet-type=flat）
                      </div>
                      <div style={{ marginTop: 8 }}>
                        当前加载了 {kubeSubnets.length} 个子网，
                        {
                          (kubeSubnets as Array<{ vpc?: string; spec?: { vpc?: string } }>).filter(
                            (s) => isFlatVpc(s?.vpc || s?.spec?.vpc || ''),
                          ).length
                        }{' '}
                        个属于扁平 VPC
                      </div>
                      <div style={{ marginTop: 8, color: '#1677ff' }}>
                        💡 如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再重试。
                      </div>
                    </div>
                  }
                />
              )}
              {flatSubnetOptions.length > 0 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message="子网选择提示"
                  description="如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载，否则可能出现 NAD 未找到的错误。"
                />
              )}
              <Form.Item
                name="flatSubnet"
                label="选择子网"
                rules={[{ required: true, message: '请选择扁平子网' }]}
                extra="扁平子网提供 Underlay 网络连接，将自动生成 NAD 引用"
              >
                <Select
                  placeholder="选择扁平子网"
                  showSearch
                  optionFilterProp="label"
                  options={flatSubnetOptions}
                />
              </Form.Item>
            </>
          )}

          {networkType === 'vpc' && (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="子网选择提示"
                description="如果您刚创建了子网，请等待几秒钟让系统完成 NAD 创建后再创建工作负载，否则可能出现 NAD 未找到的错误。"
              />
              <Form.Item
                name="vpcName"
                label="选择VPC"
                rules={[{ required: true, message: '请选择VPC' }]}
              >
                <Select
                  placeholder="选择VPC"
                  showSearch
                  optionFilterProp="label"
                  options={vpcOptions}
                  onChange={() => {
                    form.setFieldsValue({ vpcSubnet: undefined });
                  }}
                />
              </Form.Item>
              <Form.Item
                name="vpcSubnet"
                label="选择子网"
                rules={[{ required: true, message: '请选择子网' }]}
              >
                <Select
                  placeholder={selectedVpc ? '选择子网' : '请先选择VPC'}
                  showSearch
                  optionFilterProp="label"
                  options={vpcSubnetOptions.map((opt) => {
                    const subnet = (kubeSubnets as Array<Record<string, unknown>>).find((s) => {
                      const name = (s.name as string) || (s?.metadata as { name?: string })?.name;
                      const vpc = (s.vpc as string) || (s?.spec as { vpc?: string })?.vpc;
                      return name === opt.value && vpc === selectedVpc;
                    });

                    let nadRef = opt.value;
                    if (subnet) {
                      let subnetNs =
                        (subnet?.namespace as string) ||
                        (subnet?.metadata as { namespace?: string })?.namespace;
                      if (!subnetNs) {
                        const provider =
                          (subnet?.provider as string) ||
                          (subnet?.spec as { provider?: string })?.provider;
                        if (provider) {
                          const parts = provider.split('.');
                          if (parts.length >= 2) subnetNs = parts[parts.length - 2];
                        }
                      }
                      subnetNs = subnetNs || 'default';
                      nadRef = `${subnetNs}/${opt.value}`;
                    }

                    return { ...opt, value: nadRef };
                  })}
                  disabled={!selectedVpc}
                />
              </Form.Item>
            </>
          )}

          {networkType === 'custom_nad' && (
            <Form.Item
              name="customNad"
              label="选择NAD"
              rules={[{ required: true, message: '请选择NAD' }]}
              extra="选择已创建的网络附件定义（NetworkAttachmentDefinition）"
            >
              <Select
                placeholder="选择NAD网络"
                options={allNadOptions}
                showSearch
                optionFilterProp="label"
                allowClear
                onDropdownVisibleChange={(open) => {
                  if (open) {
                    void reloadNads();
                  }
                }}
              />
            </Form.Item>
          )}

          <Divider />

          {networkType !== 'default' &&
            networkType !== 'custom_nad' &&
            (() => {
              let currentCidr: string | undefined;

              if (networkType === 'flat_subnet') {
                const flatSubnetValue = form.getFieldValue('flatSubnet');
                const flatSubnetOption = flatSubnetOptions.find(
                  (opt) => opt.value === flatSubnetValue,
                );
                const subnet = flatSubnetOption?.subnet as
                  | { cidr?: string; spec?: { cidrBlock?: string } }
                  | undefined;
                currentCidr = subnet?.cidr || subnet?.spec?.cidrBlock;
              } else if (networkType === 'vpc') {
                const vpcSubnetValue = form.getFieldValue('vpcSubnet');
                if (vpcSubnetValue) {
                  const parts = vpcSubnetValue.split('/');
                  const subnetName = parts.length === 2 ? parts[1] : parts[0];
                  const subnet = (kubeSubnets as Array<Record<string, unknown>>).find((s) => {
                    const name = (s.name as string) || (s?.metadata as { name?: string })?.name;
                    const vpc = (s.vpc as string) || (s?.spec as { vpc?: string })?.vpc;
                    return name === subnetName && vpc === selectedVpc;
                  });
                  currentCidr =
                    (subnet?.cidr as string) || (subnet?.spec as { cidrBlock?: string })?.cidrBlock;
                }
              }

              return (
                <Form.Item label="静态IP配置">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Form.Item name="enableStaticIP" valuePropName="checked" noStyle>
                      <Checkbox>启用静态IP</Checkbox>
                    </Form.Item>
                    {(enableStaticIPWatch ?? form.getFieldValue('enableStaticIP')) && (
                      <>
                        {currentCidr && (
                          <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                            子网 CIDR: <Tag color="blue">{currentCidr}</Tag>
                          </div>
                        )}
                        <Form.Item
                          name="staticIP"
                          label="静态IP地址"
                          rules={[
                            { required: true, message: '请输入静态IP地址' },
                            {
                              pattern:
                                /^((25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
                              message: '请输入有效的IPv4地址',
                            },
                            ...(currentCidr
                              ? [
                                  {
                                    validator: (_: unknown, value: string) => {
                                      if (!value || isIpInCidr(value, currentCidr!)) {
                                        return Promise.resolve();
                                      }
                                      return Promise.reject(
                                        new Error(`IP 地址不在子网 CIDR 范围 ${currentCidr} 内`),
                                      );
                                    },
                                  },
                                ]
                              : []),
                            {
                              validator: () => {
                                if (staticIPCheckResult && !staticIPCheckResult.available) {
                                  return Promise.reject(new Error(staticIPCheckResult.reason));
                                }
                                return Promise.resolve();
                              },
                            },
                          ]}
                          extra={
                            currentCidr
                              ? `子网 CIDR: ${currentCidr}`
                              : '请先选择子网以获取 CIDR 范围'
                          }
                        >
                          <Input
                            placeholder="例如: 192.168.1.100"
                            addonAfter={
                              <Button
                                type="link"
                                size="small"
                                loading={checkingStaticIP}
                                onClick={handleCheckStaticIP}
                                style={{ padding: '0 8px' }}
                              >
                                检测
                              </Button>
                            }
                            onChange={() => {
                              setStaticIPCheckResult(null);
                            }}
                          />
                        </Form.Item>
                        {staticIPCheckResult && (
                          <Alert
                            type={staticIPCheckResult.available ? 'success' : 'error'}
                            showIcon
                            style={{ marginBottom: 16 }}
                            message={staticIPCheckResult.available ? 'IP 可用' : 'IP 不可用'}
                            description={staticIPCheckResult.reason}
                          />
                        )}
                        {!staticIPCheckResult && (
                          <Alert
                            type="warning"
                            showIcon
                            style={{ marginBottom: 16 }}
                            message="建议点击「检测」按钮验证 IP 是否可用后再提交"
                          />
                        )}
                      </>
                    )}
                  </Space>
                </Form.Item>
              );
            })()}

          {networkType !== 'default' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message="注意"
              description={
                <div>
                  <div>
                    选择非默认网络类型时，请确保集群已正确配置对应的网络插件（如 Kube-OVN）。
                  </div>
                  {networkType === 'flat_subnet' && (
                    <div style={{ marginTop: 8 }}>
                      扁平子网需要 Pod 所在节点配置对应的物理网络接口。
                    </div>
                  )}
                  {networkType === 'vpc' && (
                    <div style={{ marginTop: 8 }}>
                      VPC 子网由 Kube-OVN 提供，支持网络隔离和高级网络功能。
                    </div>
                  )}
                  {networkType === 'custom_nad' && (
                    <div style={{ marginTop: 8 }}>
                      自定义 NAD 仅展示当前命名空间下混杂模式已开启的网络。Kube-OVN 类型的 NAD
                      将自动补充子网注解。非 Kube-OVN 类型（如 macvlan/bridge）的 NAD 需在 NAD
                      配置中设置 IPAM（如 DHCP 或静态 IP）才能为容器分配 IP 地址。
                    </div>
                  )}
                </div>
              }
            />
          )}
        </>
      )}
    </div>
  );
};

export default WorkloadFormStepNetwork;
