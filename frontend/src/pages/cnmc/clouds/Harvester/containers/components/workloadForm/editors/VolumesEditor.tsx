/**
 * 存储卷与卷挂载配置
 */
import React, { useMemo, useCallback } from 'react';
import {
  Form,
  Input,
  Select,
  Button,
  Space,
  Card,
  Tag,
  Divider,
  Row,
  Col,
  Switch,
  Alert,
  Tooltip,
  Dropdown,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  DownOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';

import type { VolumeConfig, VolumeMountConfig, VolumeType } from '../types';
import {
  VOLUME_TYPE_OPTIONS,
  HOST_PATH_TYPE_OPTIONS,
  EMPTY_DIR_MEDIUM_OPTIONS,
  EMPTY_DIR_SIZE_UNITS,
} from '../constants';
import { validateVolumeName, validateUnixPath } from '../validators';
import ResourceInput from './ResourceInput';

export interface VolumesEditorProps {
  cloudId: string;
  namespacesOptions: string[];
  selectedNamespace: string;
  configMaps: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
  secrets: Array<{ metadata: { name: string; namespace: string; annotations?: Record<string, string> }; data?: Record<string, string> }>;
  persistentVolumeClaims?: Array<{
    metadata: { name: string; namespace: string; annotations?: Record<string, string> };
    raw?: { metadata?: { annotations?: Record<string, string> } };
    annotations?: Record<string, string>;
    alias?: string;
    name?: string;
    pvcName?: string;
  }>;
  onRefreshConfigMaps: () => void;
  onRefreshSecrets: () => void;
  onOpenQuickCreateConfigMap: () => void;
  onOpenQuickCreateSecret: () => void;
  refreshKey?: number; // 父组件传入的刷新标记，变化时重新读取数据
  onVolumeChange?: () => void; // 卷变化时通知父组件
}

const VolumesEditor: React.FC<VolumesEditorProps> = ({
  cloudId: _cloudId,
  namespacesOptions: _namespacesOptions,
  selectedNamespace,
  configMaps,
  secrets,
  persistentVolumeClaims = [],
  onRefreshConfigMaps: _onRefreshConfigMaps,
  onRefreshSecrets: _onRefreshSecrets,
  onOpenQuickCreateConfigMap,
  onOpenQuickCreateSecret,
  refreshKey: _refreshKey = 0,
  onVolumeChange,
}) => {
  const form = Form.useFormInstance();
  
  // 按命名空间过滤资源
  const filteredConfigMaps = useMemo(() => {
    if (!selectedNamespace) return configMaps || [];
    return (configMaps || []).filter(cm => cm?.metadata?.namespace === selectedNamespace);
  }, [configMaps, selectedNamespace]);
  
  const filteredSecrets = useMemo(() => {
    if (!selectedNamespace) return secrets || [];
    return (secrets || []).filter(s => s?.metadata?.namespace === selectedNamespace);
  }, [secrets, selectedNamespace]);
  
  const filteredPVCs = useMemo(() => {
    if (!selectedNamespace) return persistentVolumeClaims || [];
    return (persistentVolumeClaims || []).filter((pvc: any) => {
      const pvcNs = pvc?.metadata?.namespace || pvc?.namespace;
      // 过滤掉 Block 类型的 PVC，只展示 Filesystem 类型
      const source = pvc?.rawData || pvc || {};
      const volumeMode = source?.spec?.volumeMode || pvc?.volumeMode || 'Block';
      return pvcNs === selectedNamespace && volumeMode !== 'Block';
    });
  }, [persistentVolumeClaims, selectedNamespace]);
  
  // 直接从表单读取最新值，不使用 useMemo 缓存，确保卷名称变化时立即更新
  const volumes = (() => {
    const v = form.getFieldValue('volumes');
    return Array.isArray(v) ? v.filter(Boolean) : [];
  })();
  
  const volumeMounts = (() => {
    const v = form.getFieldValue('volumeMounts');
    return Array.isArray(v) ? v.filter(Boolean) : [];
  })();

  // 添加卷 - 直接从 form 读取最新值，避免闭包问题
  const addVolume = useCallback((type: VolumeType) => {
    const currentVolumes = form.getFieldValue('volumes') || [];
    const newVolume: VolumeConfig = { name: '', type };
    form.setFieldsValue({ volumes: [newVolume, ...currentVolumes] });
    onVolumeChange?.();
  }, [form, onVolumeChange]);

  // 删除卷
  const removeVolume = useCallback((index: number) => {
    const currentVolumes = form.getFieldValue('volumes') || [];
    const volName = currentVolumes[index]?.name;
    const updated = currentVolumes.filter((_: VolumeConfig, i: number) => i !== index);
    form.setFieldsValue({ volumes: updated });
    
    // 同时删除对应的挂载
    if (volName) {
      const currentMounts = form.getFieldValue('volumeMounts') || [];
      const updatedMounts = currentMounts.filter((m: VolumeMountConfig) => m.name !== volName);
      form.setFieldsValue({ volumeMounts: updatedMounts });
    }
    onVolumeChange?.(); // 通知父组件刷新
  }, [form, onVolumeChange]);

  // 添加挂载
  const addVolumeMount = useCallback(() => {
    const currentMounts = form.getFieldValue('volumeMounts') || [];
    const newMount: VolumeMountConfig = { name: '', mountPath: '', readOnly: false };
    form.setFieldsValue({ volumeMounts: [newMount, ...currentMounts] });
    onVolumeChange?.();
  }, [form, onVolumeChange]);

  // 删除挂载
  const removeVolumeMount = useCallback((index: number) => {
    const currentMounts = form.getFieldValue('volumeMounts') || [];
    const updated = currentMounts.filter((_: VolumeMountConfig, i: number) => i !== index);
    form.setFieldsValue({ volumeMounts: updated });
    onVolumeChange?.(); // 通知父组件刷新
  }, [form, onVolumeChange]);

  // 获取可用的卷名称列表（用于挂载选择）
  const availableVolumeNames = volumes.filter((v: VolumeConfig) => v.name).map((v: VolumeConfig) => v.name);

  // 渲染单个卷配置
  const renderVolume = (volume: VolumeConfig, index: number) => {
    const basePath = ['volumes', index];
    
    return (
      <Card 
        key={index} 
        size="small" 
        style={{ marginBottom: 12 }}
        title={
          <Space>
            <Tag color={volume.type === 'configMap' ? 'blue' : volume.type === 'secret' ? 'orange' : 'green'}>
              {VOLUME_TYPE_OPTIONS.find(o => o.value === volume.type)?.label || volume.type}
            </Tag>
            <span style={{ fontSize: 12, color: '#999' }}>
              {VOLUME_TYPE_OPTIONS.find(o => o.value === volume.type)?.desc}
            </span>
          </Space>
        }
        extra={
          <Button
            type="text"
            danger
            size="small"
            icon={<MinusCircleOutlined />}
            onClick={() => removeVolume(index)}
          >
            删除
          </Button>
        }
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name={[...basePath, 'name']}
              label="卷名称"
              rules={[
                { required: true, message: '请输入卷名称' },
                { validator: validateVolumeName },
                {
                  validator: (_: any, value: string) => {
                    if (!value) return Promise.resolve();
                    const allVolumes: VolumeConfig[] = form.getFieldValue('volumes') || [];
                    const duplicates = allVolumes.filter(
                      (v: VolumeConfig, i: number) =>
                        i !== index && v?.name && v.name === value,
                    );
                    if (duplicates.length > 0) {
                      return Promise.reject(new Error(`卷名称 "${value}" 已存在，请使用不同的名称`));
                    }
                    return Promise.resolve();
                  },
                },
              ]}
            >
              <Input placeholder="如: config-volume" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name={[...basePath, 'type']}
              label="卷类型"
              rules={[{ required: true, message: '请选择卷类型' }]}
            >
              <Select
                options={VOLUME_TYPE_OPTIONS}
                onChange={(newType) => {
                  // 类型变更时重置该卷配置
                  const updated = [...volumes];
                  const currentName = updated[index]?.name;
                  updated[index] = { name: currentName || '', type: newType };
                  form.setFieldsValue({ volumes: updated });
                  onVolumeChange?.(); // 通知父组件刷新
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* ConfigMap 类型 */}
        {volume.type === 'configMap' && (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'configMapName']}
                  label="ConfigMap"
                  rules={[{ required: true, message: '请选择 ConfigMap' }]}
                >
                  <Select
                    placeholder="选择 ConfigMap"
                    showSearch
                    optionFilterProp="label"
                    options={filteredConfigMaps.map(cm => {
                      const alias = cm?.metadata?.annotations?.['tower.io/alias'];
                      const name = cm.metadata.name;
                      return {
                        label: alias ? `${alias} (${name})` : name,
                        value: name,
                      };
                    })}
                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        <Divider style={{ margin: '8px 0' }} />
                        <Button
                          type="link"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            onOpenQuickCreateConfigMap();
                          }}
                          style={{ width: '100%', textAlign: 'left' }}
                        >
                          快速创建 ConfigMap
                        </Button>
                      </>
                    )}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'configMapOptional']}
                  label={(
                    <Tooltip title="开启：ConfigMap 不存在时容器仍能启动；关闭：ConfigMap 必须存在，否则容器启动失败">
                      <span>允许不存在 <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} /></span>
                    </Tooltip>
                  )}
                  valuePropName="checked"
                >
                  <Switch size="small" />
                </Form.Item>
              </Col>
            </Row>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message="ConfigMap 的所有 key 将挂载为文件，文件名为 key 名称"
            />
          </>
        )}

        {/* Secret 类型 */}
        {volume.type === 'secret' && (
          <>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'secretName']}
                  label="Secret"
                  rules={[{ required: true, message: '请选择 Secret' }]}
                >
                                <Select
                                  placeholder="选择 Secret"
                                  showSearch
                                  optionFilterProp="label"
                                  options={filteredSecrets.map(s => {
                                    const alias = s?.metadata?.annotations?.['tower.io/alias'];
                                    const name = s.metadata.name;
                                    return {
                                      label: alias ? `${alias} (${name})` : name,
                                      value: name,
                                    };
                                  })}                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        <Divider style={{ margin: '8px 0' }} />
                        <Button
                          type="link"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            onOpenQuickCreateSecret();
                          }}
                          style={{ width: '100%', textAlign: 'left' }}
                        >
                          快速创建 Secret
                        </Button>
                      </>
                    )}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name={[...basePath, 'secretOptional']}
                  label={(
                    <Tooltip title="开启：Secret 不存在时容器仍能启动；关闭：Secret 必须存在，否则容器启动失败">
                      <span>允许不存在 <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} /></span>
                    </Tooltip>
                  )}
                  valuePropName="checked"
                >
                  <Switch size="small" />
                </Form.Item>
              </Col>
            </Row>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message="Secret 的所有 key 将挂载为文件，文件名为 key 名称"
            />
          </>
        )}

        {/* PVC 类型 */}
        {volume.type === 'persistentVolumeClaim' && (
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name={[...basePath, 'claimName']}
                label="PVC 名称"
                rules={[{ required: true, message: '请选择 PVC' }]}
              >
                <Select
                  placeholder="选择 PVC"
                  showSearch
                  optionFilterProp="label"
                  options={filteredPVCs.map((pvc: any) => {
                    // 从多个位置获取 annotations（优先 rawData）
                    const alias = pvc?.rawData?.metadata?.annotations?.['tower.io/alias']
                      || pvc?.raw?.metadata?.annotations?.['tower.io/alias']
                      || pvc?.metadata?.annotations?.['tower.io/alias']
                      || pvc?.annotations?.['tower.io/alias']
                      || pvc?.alias;
                    const name = pvc?.rawData?.metadata?.name || pvc?.raw?.metadata?.name || pvc?.metadata?.name || pvc?.name || pvc?.pvcName;
                    return {
                      label: alias ? `${alias} (${name})` : name,
                      value: name,
                    };
                  })}
                />
              </Form.Item>
            </Col>
          </Row>
        )}

        {/* EmptyDir 类型 */}
        {volume.type === 'emptyDir' && (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'emptyDirMedium']}
                label="存储介质"
                initialValue="default"
              >
                <Select options={EMPTY_DIR_MEDIUM_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'emptyDirSizeLimit']}
                label="大小限制"
              >
                <ResourceInput placeholder="如: 1" units={EMPTY_DIR_SIZE_UNITS} defaultUnit="Gi" unitTooltip="Mi=MiB(1024KiB)；Gi=GiB(1024MiB)；Ti=TiB(1024GiB)" />
              </Form.Item>
            </Col>
          </Row>
        )}

        {/* HostPath 类型 */}
        {volume.type === 'hostPath' && (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'hostPath']}
                label="节点路径"
                rules={[
                  { required: true, message: '请输入节点路径' },
                  { validator: validateUnixPath },
                ]}
              >
                <Input placeholder="如: /var/data" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name={[...basePath, 'hostPathType']}
                label="路径类型"
              >
                <Select options={HOST_PATH_TYPE_OPTIONS} allowClear placeholder="自动检测" />
              </Form.Item>
            </Col>
          </Row>
        )}
      </Card>
    );
  };

  // 渲染单个挂载配置
  const renderVolumeMount = (mount: VolumeMountConfig, index: number) => {
    const basePath = ['volumeMounts', index];
    const mountName = form.getFieldValue([...basePath, 'name']);
    const allVolumes: VolumeConfig[] = form.getFieldValue('volumes') || [];
    const matchedVolume = allVolumes.find((v) => v.name === mountName);
    const isReadOnlyImmutable = matchedVolume?.type === 'configMap' || matchedVolume?.type === 'secret';
    
    return (
      <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
        <Col span={6}>
          <Form.Item
            name={[...basePath, 'name']}
            label="卷名称"
            rules={[{ required: true, message: '请选择卷' }]}
          >
            <Select
              placeholder="选择卷"
              showSearch
              options={availableVolumeNames.map((name: string) => ({ label: name, value: name }))}
            />
          </Form.Item>
        </Col>
        <Col span={isReadOnlyImmutable ? 10 : 8}>
          <Form.Item
            name={[...basePath, 'mountPath']}
            label="挂载路径"
            rules={[
              { required: true, message: '请输入挂载路径' },
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  if (!value.startsWith('/')) {
                    return Promise.reject(new Error('路径必须以 / 开头'));
                  }
                  if (value === '/') {
                    return Promise.reject(new Error('不能挂载到根路径 /'));
                  }
                  if (value.includes('..')) {
                    return Promise.reject(new Error('路径不能包含 ..'));
                  }
                  if (/\/\//.test(value)) {
                    return Promise.reject(new Error('路径不能包含连续的 //'));
                  }
                  const allMounts: VolumeMountConfig[] = form.getFieldValue('volumeMounts') || [];
                  const duplicates = allMounts.filter(
                    (m: VolumeMountConfig, i: number) =>
                      i !== index && m?.mountPath && m.mountPath === value,
                  );
                  if (duplicates.length > 0) {
                    return Promise.reject(new Error(`挂载路径 "${value}" 已被使用，同一容器内不能重复挂载到相同路径`));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            validateTrigger={['onChange', 'onBlur']}
          >
            <Input placeholder="/etc/config" />
          </Form.Item>
        </Col>
        <Col span={isReadOnlyImmutable ? 6 : 4}>
          <Form.Item
            name={[...basePath, 'subPath']}
            label="子路径"
            rules={[
              {
                validator: (_, value) => {
                  if (!value) return Promise.resolve();
                  if (value.startsWith('/')) {
                    return Promise.reject(new Error('子路径不能以 / 开头，请使用相对路径'));
                  }
                  if (value.includes('..')) {
                    return Promise.reject(new Error('子路径不能包含 ..'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
            validateTrigger={['onChange', 'onBlur']}
          >
            <Input placeholder="相对路径" />
          </Form.Item>
        </Col>
        {!isReadOnlyImmutable && (
          <Col span={4}>
            <Form.Item
              name={[...basePath, 'readOnly']}
              label="只读"
              valuePropName="checked"
            >
              <Switch size="small" />
            </Form.Item>
          </Col>
        )}
        <Col span={2}>
          <Button
            type="text"
            danger
            icon={<MinusCircleOutlined />}
            onClick={() => removeVolumeMount(index)}
          />
        </Col>
      </Row>
    );
  };

  // 存储卷类型下拉菜单
  const volumeTypeMenuItems = VOLUME_TYPE_OPTIONS.map(opt => ({
    key: opt.value,
    label: (
      <span>
        <Tag color={opt.value === 'configMap' ? 'blue' : opt.value === 'secret' ? 'orange' : 'green'} style={{ marginRight: 4 }}>
          {opt.label}
        </Tag>
        <span style={{ color: '#999', fontSize: 12 }}>{opt.desc}</span>
      </span>
    ),
    onClick: () => addVolume(opt.value as VolumeType),
  }));

  return (
    <div>
      {/* 存储卷定义 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>存储卷定义</span>
          <Dropdown menu={{ items: volumeTypeMenuItems }} trigger={['click']}>
            <Button type="dashed" size="small" icon={<PlusOutlined />}>
              添加存储卷 <DownOutlined />
            </Button>
          </Dropdown>
        </div>
        
        {volumes.length === 0 && (
          <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
            暂无存储卷，点击上方按钮添加
          </div>
        )}
        
        {volumes.map((vol: VolumeConfig, index: number) => renderVolume(vol, index))}
      </div>

      {/* 卷挂载配置 */}
      <div>
        <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>卷挂载配置</span>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={addVolumeMount}
            disabled={availableVolumeNames.length === 0}
          >
            添加挂载
          </Button>
        </div>
        
        {volumeMounts.length > 0 && (
          <Row gutter={8} style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
            <Col span={6}>卷名称</Col>
            <Col span={8}>挂载路径</Col>
            <Col span={4}>子路径</Col>
            <Col span={4}>只读</Col>
            <Col span={2}>操作</Col>
          </Row>
        )}
        
        {volumeMounts.length === 0 && availableVolumeNames.length > 0 && (
          <div style={{ color: '#999', fontSize: 12, padding: '8px 0' }}>
            已定义 {availableVolumeNames.length} 个卷，点击添加挂载
          </div>
        )}
        
        {volumeMounts.map((mount: VolumeMountConfig, index: number) => renderVolumeMount(mount, index))}
      </div>
    </div>
  );
};

export default VolumesEditor;
