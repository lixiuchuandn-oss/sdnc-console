import React from 'react';
import { Alert, Button, Card, Col, Collapse, Form, Input, Row, Select, Space, Tag } from 'antd';
import { CopyOutlined, DeleteOutlined, FolderOutlined, PlusOutlined } from '@ant-design/icons';

import { CPU_UNITS, MEMORY_UNITS, IMAGE_PULL_POLICY_OPTIONS } from '../constants';
import { compareCpuResources, compareMemoryResources } from '../resourceUtils';
import { EnvEditor, PortsEditor, ProbeEditor, ResourceInput } from '../editors';
import type { WorkloadContainerFormValue, WorkloadFormProps } from '../types';

export interface WorkloadFormStepContainersProps {
  containers: WorkloadContainerFormValue[];
  activeContainerIndex: number;
  onSelectContainer: (index: number) => void;
  onDuplicateContainer: (index: number) => void;
  onRemoveContainer: (index: number) => void;
  onAddContainer: () => void;
  onBrowseRegistry: () => void;
  cloudId: string;
  defaultNamespace?: string;
  namespacesOptions: string[];
  configMaps?: WorkloadFormProps['configMaps'];
  secrets?: WorkloadFormProps['secrets'];
  onRefreshConfigMaps?: () => void;
  onRefreshSecrets?: () => void;
  onOpenQuickCreateConfigMap: () => void;
  onOpenQuickCreateSecret: () => void;
}

const WorkloadFormStepContainers: React.FC<WorkloadFormStepContainersProps> = ({
  containers,
  activeContainerIndex,
  onSelectContainer,
  onDuplicateContainer,
  onRemoveContainer,
  onAddContainer,
  onBrowseRegistry,
  cloudId,
  defaultNamespace,
  namespacesOptions,
  configMaps,
  secrets,
  onRefreshConfigMaps,
  onRefreshSecrets,
  onOpenQuickCreateConfigMap,
  onOpenQuickCreateSecret,
}) => {
  const form = Form.useFormInstance();

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="容器配置"
        description={
          <div>
            <div>
              每个容器独立配置镜像、端口、环境变量、资源限制、启动命令和健康检查。点击容器卡片可展开详细配置。
            </div>
            <div style={{ marginTop: 8, color: '#faad14' }}>
              <strong>注意：</strong>Kubernetes 限制镜像拉取凭证只能在 Pod
              级别配置。如果您在多个容器中配置了不同的凭证，系统会自动合并去重后应用到 Pod。
            </div>
          </div>
        }
      />
      {containers.map((container, index) => {
        const isActive = index === activeContainerIndex;
        const portsCount = container.ports?.length || 0;
        const envCount = container.env?.length || 0;
        const resourcesCount =
          container.resources?.requests?.cpu ||
          container.resources?.requests?.memory ||
          container.resources?.limits?.cpu ||
          container.resources?.limits?.memory
            ? 1
            : 0;
        const commandCount = container.command?.length || container.args?.length ? 1 : 0;
        const probeCount =
          (container.livenessProbe?.enabled ? 1 : 0) + (container.readinessProbe?.enabled ? 1 : 0);

        return (
          <Card
            key={`container-${index}`}
            size="small"
            style={{
              marginBottom: 16,
              border: isActive ? '2px solid #1677ff' : '1px solid #f0f0f0',
            }}
            title={
              <Space>
                <Tag color={isActive ? 'blue' : 'default'}>{`容器 ${index + 1}`}</Tag>
                <span style={{ fontWeight: 500 }}>
                  {container.containerName || `container-${index + 1}`}
                </span>
                {isActive && <Tag color="processing">编辑中</Tag>}
              </Space>
            }
            extra={
              <Space>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => onDuplicateContainer(index)}
                >
                  复制
                </Button>
                {containers.length > 1 && (
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => onRemoveContainer(index)}
                  >
                    删除
                  </Button>
                )}
              </Space>
            }
          >
            {isActive ? (
              <>
                <Form.Item
                  name="image"
                  label="镜像地址"
                  rules={[{ required: true, message: '请输入镜像地址' }]}
                  extra={
                    <span style={{ color: '#999' }}>
                      例如: nginx:latest 或 harbor.example.com/library/nginx:v1.0
                    </span>
                  }
                >
                  <Input
                    placeholder="镜像地址"
                    addonAfter={
                      <Button
                        type="text"
                        size="small"
                        icon={<FolderOutlined />}
                        onClick={onBrowseRegistry}
                      >
                        浏览仓库
                      </Button>
                    }
                  />
                </Form.Item>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item
                      name="containerName"
                      label="容器名称"
                      extra="默认与工作负载名称相同，仅支持小写字母、数字和连字符"
                      rules={[
                        {
                          pattern: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
                          message:
                            '容器名称只能包含小写字母、数字和连字符，且开头结尾必须是字母或数字',
                        },
                      ]}
                    >
                      <Input placeholder="容器名称 (可选)" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      name="imagePullPolicy"
                      label="镜像拉取策略"
                      initialValue="IfNotPresent"
                    >
                      <Select options={IMAGE_PULL_POLICY_OPTIONS} />
                    </Form.Item>
                  </Col>
                </Row>
                <Collapse
                  ghost
                  defaultActiveKey={[]}
                  items={[
                    {
                      key: 'ports',
                      label: `端口配置 (${portsCount})`,
                      children: <PortsEditor />,
                    },
                    {
                      key: 'env',
                      label: `环境变量 (${envCount})`,
                      children: (
                        <EnvEditor
                          cloudId={cloudId}
                          namespacesOptions={namespacesOptions}
                          selectedNamespace={
                            form.getFieldValue('namespace') || defaultNamespace || 'default'
                          }
                          configMaps={configMaps ?? []}
                          secrets={secrets ?? []}
                          onRefreshConfigMaps={() => onRefreshConfigMaps?.()}
                          onRefreshSecrets={() => onRefreshSecrets?.()}
                          onOpenQuickCreateConfigMap={onOpenQuickCreateConfigMap}
                          onOpenQuickCreateSecret={onOpenQuickCreateSecret}
                        />
                      ),
                    },
                    {
                      key: 'resources',
                      label: `资源限制 (${resourcesCount})`,
                      children: (
                        <>
                          <Row gutter={16}>
                            <Col span={12}>
                              <Form.Item
                                name={['resources', 'requests', 'cpu']}
                                label="CPU 请求"
                                dependencies={[['resources', 'limits', 'cpu']]}
                                rules={[
                                  {
                                    validator: (_, value) => {
                                      if (!value) return Promise.resolve();
                                      const limit = form.getFieldValue([
                                        'resources',
                                        'limits',
                                        'cpu',
                                      ]);
                                      if (limit && compareCpuResources(value, limit) > 0) {
                                        return Promise.reject(new Error('请求值不能超过限制值'));
                                      }
                                      return Promise.resolve();
                                    },
                                  },
                                ]}
                              >
                                <ResourceInput
                                  placeholder="如: 100"
                                  units={CPU_UNITS}
                                  defaultUnit="m"
                                  unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5"
                                />
                              </Form.Item>
                            </Col>
                            <Col span={12}>
                              <Form.Item
                                name={['resources', 'limits', 'cpu']}
                                label="CPU 限制"
                                dependencies={[['resources', 'requests', 'cpu']]}
                                rules={[
                                  {
                                    validator: (_, value) => {
                                      if (!value) return Promise.resolve();
                                      const request = form.getFieldValue([
                                        'resources',
                                        'requests',
                                        'cpu',
                                      ]);
                                      if (request && compareCpuResources(request, value) > 0) {
                                        return Promise.reject(new Error('限制值不能小于请求值'));
                                      }
                                      return Promise.resolve();
                                    },
                                  },
                                ]}
                              >
                                <ResourceInput
                                  placeholder="如: 500"
                                  units={CPU_UNITS}
                                  defaultUnit="m"
                                  unitTooltip="m: 毫核(1000m=1核)；核: 支持小数如0.5"
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                          <Row gutter={16}>
                            <Col span={12}>
                              <Form.Item
                                name={['resources', 'requests', 'memory']}
                                label="内存请求"
                                dependencies={[['resources', 'limits', 'memory']]}
                                rules={[
                                  {
                                    validator: (_, value) => {
                                      if (!value) return Promise.resolve();
                                      const limit = form.getFieldValue([
                                        'resources',
                                        'limits',
                                        'memory',
                                      ]);
                                      if (limit && compareMemoryResources(value, limit) > 0) {
                                        return Promise.reject(new Error('请求值不能超过限制值'));
                                      }
                                      return Promise.resolve();
                                    },
                                  },
                                ]}
                              >
                                <ResourceInput
                                  placeholder="如: 128"
                                  units={MEMORY_UNITS}
                                  defaultUnit="Mi"
                                  unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可"
                                />
                              </Form.Item>
                            </Col>
                            <Col span={12}>
                              <Form.Item
                                name={['resources', 'limits', 'memory']}
                                label="内存限制"
                                dependencies={[['resources', 'requests', 'memory']]}
                                rules={[
                                  {
                                    validator: (_, value) => {
                                      if (!value) return Promise.resolve();
                                      const request = form.getFieldValue([
                                        'resources',
                                        'requests',
                                        'memory',
                                      ]);
                                      if (request && compareMemoryResources(request, value) > 0) {
                                        return Promise.reject(new Error('限制值不能小于请求值'));
                                      }
                                      return Promise.resolve();
                                    },
                                  },
                                ]}
                              >
                                <ResourceInput
                                  placeholder="如: 512"
                                  units={MEMORY_UNITS}
                                  defaultUnit="Mi"
                                  unitTooltip="MiB/GiB: 二进制单位(1GiB=1024MiB)，任意数值均可"
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                        </>
                      ),
                    },
                    {
                      key: 'command',
                      label: `启动命令 (${commandCount})`,
                      children: (
                        <Row gutter={16}>
                          <Col span={12}>
                            <Form.Item
                              name="command"
                              label="启动命令"
                              extra="覆盖容器默认入口点，多个命令用逗号分隔"
                              rules={[
                                {
                                  validator: (_, value) => {
                                    if (!value || !Array.isArray(value)) return Promise.resolve();
                                    const chineseRegex = /[\u4e00-\u9fa5]/;
                                    for (let i = 0; i < value.length; i++) {
                                      if (chineseRegex.test(value[i])) {
                                        return Promise.reject(new Error('不能包含中文字符'));
                                      }
                                    }
                                    return Promise.resolve();
                                  },
                                },
                              ]}
                            >
                              <Select
                                mode="tags"
                                placeholder="如: /bin/sh"
                                style={{ width: '100%' }}
                                tokenSeparators={[',']}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item
                              name="args"
                              label="启动参数"
                              extra="传递给入口点的参数，多个参数用逗号分隔"
                              rules={[
                                {
                                  validator: (_, value) => {
                                    if (!value || !Array.isArray(value)) return Promise.resolve();
                                    const chineseRegex = /[\u4e00-\u9fa5]/;
                                    for (let i = 0; i < value.length; i++) {
                                      if (chineseRegex.test(value[i])) {
                                        return Promise.reject(new Error('不能包含中文字符'));
                                      }
                                    }
                                    return Promise.resolve();
                                  },
                                },
                              ]}
                            >
                              <Select
                                mode="tags"
                                placeholder="如: -c, script.sh"
                                style={{ width: '100%' }}
                                tokenSeparators={[',']}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      ),
                    },
                    {
                      key: 'probes',
                      label: `健康检查 (${probeCount})`,
                      children: (
                        <>
                          <ProbeEditor name="livenessProbe" label="存活探针 (Liveness Probe)" />
                          <ProbeEditor name="readinessProbe" label="就绪探针 (Readiness Probe)" />
                        </>
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              <div
                onClick={() => onSelectContainer(index)}
                style={{ cursor: 'pointer', padding: '8px 0' }}
              >
                <div style={{ color: '#666', fontSize: 13 }}>{container.image || '未配置镜像'}</div>
                <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                  端口 {portsCount} / 环境变量 {envCount} / 挂载{' '}
                  {container.volumeMounts?.length || 0}
                </div>
              </div>
            )}
          </Card>
        );
      })}
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={onAddContainer}
        style={{ marginBottom: 16 }}
      >
        添加容器
      </Button>
    </div>
  );
};

export default WorkloadFormStepContainers;
