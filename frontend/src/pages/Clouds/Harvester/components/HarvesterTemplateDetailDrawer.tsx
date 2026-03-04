import React, { useEffect, useState, useMemo } from 'react';
import { Drawer, Tabs, Button, Tag, Descriptions, Card, List, Space, Skeleton } from 'antd';
import { 
  FileTextOutlined, 
  CloseOutlined, 
  ReloadOutlined,
  HddOutlined,
  GlobalOutlined,
  KeyOutlined,
  LaptopOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import LinedTextArea from '../../../../components/LinedTextArea';
import { fetchHarvesterResourceByLink } from '../../../../services/harvesterApi';

interface HarvesterTemplateDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  template: any;
  cloudId: string;
}

// 缓存 Image Alias，避免重复请求
const imageAliasCache = new Map<string, string>();

const HarvesterTemplateDetailDrawer: React.FC<HarvesterTemplateDetailDrawerProps> = ({
  open,
  onClose,
  template,
  cloudId,
}) => {
  const [versionData, setVersionData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  // 新增：用于存储解析出的镜像名称映射 { imageId: alias }
  const [imageAliases, setImageAliases] = useState<Record<string, string>>({});

  // 获取模板的默认版本 ID (可能是 "namespace/name" 格式，也可能是纯 "name" 格式)
  const defaultVersionId = useMemo(() => {
    return template?.spec?.defaultVersionId;
  }, [template]);

  // 获取模板的命名空间
  const namespace = useMemo(() => {
    return template?.metadata?.namespace;
  }, [template]);

  // 加载版本详情
  useEffect(() => {
    if (open && cloudId && namespace && defaultVersionId) {
      fetchVersionDetail();
    } else if (open && !defaultVersionId) {
        // 如果没有默认版本，可能是一个空模板或者数据不完整
        setVersionData(null);
    }
  }, [open, cloudId, namespace, defaultVersionId]);

  const fetchVersionDetail = async () => {
    setLoading(true);
    try {
      // 构造 Version 的 API 路径
      // spec.defaultVersionId 可能是 "namespace/name" 格式 (例如 "default/id-vmtplv-xxx")
      // 但我们的 API 路径需要 namespace 和 name 分开
      let targetNs = namespace;
      let targetName = defaultVersionId;

      if (defaultVersionId && defaultVersionId.includes('/')) {
          const parts = defaultVersionId.split('/');
          if (parts.length === 2) {
              targetNs = parts[0];
              targetName = parts[1];
          }
      }

      // Harvester Template Version 的标准路径: /apis/harvesterhci.io/v1beta1/namespaces/{ns}/virtualmachinetemplateversions/{id}
      const path = `/apis/harvesterhci.io/v1beta1/namespaces/${targetNs}/virtualmachinetemplateversions/${targetName}`;
      const res = await fetchHarvesterResourceByLink(cloudId, path);
      setVersionData(res);
    } catch (e: any) {
      console.warn('Failed to fetch template version:', e);
      // message.error(`加载模板版本详情失败: ${e.message}`); // 静默失败，回退到 Metadata 解析
    } finally {
      setLoading(false);
    }
  };

  // 解析 CPU
  const cpuInfo = useMemo(() => {
    if (!versionData) return null;
    const cpu = versionData?.spec?.vm?.spec?.template?.spec?.domain?.cpu;
    if (cpu) {
      return {
        cores: cpu.cores || '-',
        sockets: cpu.sockets || '-',
        threads: cpu.threads || '-',
        total: (Number(cpu.cores || 1) * Number(cpu.sockets || 1) * Number(cpu.threads || 1))
      };
    }
    return null;
  }, [versionData]);

  // 解析 Memory
  const memoryInfo = useMemo(() => {
    if (!versionData) return null;
    const mem = versionData?.spec?.vm?.spec?.template?.spec?.domain?.memory?.guest;
    return mem || '-';
  }, [versionData]);

  // 批量加载 Image Alias
  useEffect(() => {
    if (!versionData || !cloudId) return;

    const imageIds = new Set<string>();
    
    // 1. 从 spec.vm.spec.volumeClaimTemplates 中查找 (最标准的位置)
    const vcts = versionData?.spec?.vm?.spec?.volumeClaimTemplates || [];
    if (Array.isArray(vcts)) {
        vcts.forEach((vct: any) => {
            const imgId = vct.metadata?.annotations?.['harvesterhci.io/imageId'];
            if (imgId) imageIds.add(imgId);
        });
    }

    // 2. 从 spec.vm.metadata.annotations['harvesterhci.io/volumeClaimTemplates'] 中查找 (备用)
    try {
        const vctStr = versionData?.spec?.vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (vctStr) {
            const vct = JSON.parse(vctStr);
            if (Array.isArray(vct)) {
                vct.forEach((v: any) => {
                    const imgId = v.metadata?.annotations?.['harvesterhci.io/imageId'];
                    if (imgId) imageIds.add(imgId);
                });
            }
        }
    } catch (e) {
        // ignore
    }

    // 3. 从 ContainerDisk 中查找 (虽然通常直接显示，但也可以解析 Alias)
    const volumes = versionData?.spec?.vm?.spec?.template?.spec?.volumes || [];
    volumes.forEach((vol: any) => {
        // ContainerDisk 已经是完整的 Image Reference，无需 API 查找
    });

    const fetchAliases = async () => {
        const newAliases: Record<string, string> = {};
        const pendingIds: string[] = [];

        imageIds.forEach(id => {
            if (imageAliasCache.has(id)) {
                newAliases[id] = imageAliasCache.get(id)!;
            } else {
                pendingIds.push(id);
            }
        });

        if (pendingIds.length > 0) {
            await Promise.all(pendingIds.map(async (id) => {
                try {
                    // id format: namespace/name
                    const [ns, name] = id.includes('/') ? id.split('/') : ['default', id];
                    const path = `/apis/harvesterhci.io/v1beta1/namespaces/${ns}/virtualmachineimages/${name}`;
                    const res = await fetchHarvesterResourceByLink(cloudId, path);
                    const alias = res.spec?.displayName || res.metadata?.name || id;
                    imageAliasCache.set(id, alias);
                    newAliases[id] = alias;
                } catch (e) {
                    console.warn(`Failed to fetch image alias for ${id}`, e);
                    imageAliasCache.set(id, id); // Fallback to ID on error
                    newAliases[id] = id;
                }
            }));
        }

        setImageAliases(prev => ({ ...prev, ...newAliases }));
    };

    fetchAliases();
  }, [versionData, cloudId]);

  // 解析 Disks (优先从 versionData 解析，若无则从 template annotations 解析)
  const disks = useMemo(() => {
    // 1. 尝试从 Version Data 解析
    if (versionData) {
      const volumes = versionData?.spec?.vm?.spec?.template?.spec?.volumes || [];
      const domainDisks = versionData?.spec?.vm?.spec?.template?.spec?.domain?.devices?.disks || [];
      const vcts = versionData?.spec?.vm?.spec?.volumeClaimTemplates || [];

      // 预先解析 annotations 中的 volumeClaimTemplates
      let annotationVcts: any[] = [];
      try {
        const vctStr = versionData?.spec?.vm?.metadata?.annotations?.['harvesterhci.io/volumeClaimTemplates'];
        if (vctStr) {
            annotationVcts = JSON.parse(vctStr);
        }
      } catch (e) {
        // ignore
      }

      return volumes.map((vol: any) => {
        // 注意：domainDisks 可能是 undefined，需要安全访问
        const diskConfig = Array.isArray(domainDisks) 
            ? domainDisks.find((d: any) => d.name === vol.name)
            : undefined;
        
        let type = 'Disk';
        let source = '-';
        let imageId = null;

        if (vol.persistentVolumeClaim) {
          type = 'Volume';
          source = vol.persistentVolumeClaim.claimName;
          
          // 尝试查找对应的 VolumeClaimTemplate 以获取 Image ID
          // 优先查找 spec.volumeClaimTemplates
          let vct = vcts.find((v: any) => v.metadata?.name === vol.persistentVolumeClaim.claimName);
          
          // 如果找不到，尝试查找 annotations 中的 volumeClaimTemplates
          if (!vct && Array.isArray(annotationVcts)) {
             vct = annotationVcts.find((v: any) => v.metadata?.name === vol.persistentVolumeClaim.claimName);
          }

          if (vct?.metadata?.annotations?.['harvesterhci.io/imageId']) {
              imageId = vct.metadata.annotations['harvesterhci.io/imageId'];
          }
        } else if (vol.containerDisk) {
          type = 'Container';
          source = vol.containerDisk.image;
        } else if (vol.cloudInitNoCloud || vol.cloudInitConfigDrive) {
          type = 'CloudInit';
          source = 'User Data / Network Data';
        }

        if (imageId) {
            const alias = imageAliases[imageId] || imageId;
            // 如果 source 是 claimName，我们显示 "Image: alias (claimName)"
            source = `Image: ${alias}`; 
        }

        return {
          name: vol.name,
          type,
          source,
          bus: diskConfig?.disk?.bus || diskConfig?.cdrom?.bus || '-',
          bootOrder: diskConfig?.bootOrder,
          isCdrom: !!diskConfig?.cdrom
        };
      }).sort((a: any, b: any) => (a.bootOrder || 999) - (b.bootOrder || 999));
    }
    
    // ...
  }, [versionData, template, imageAliases]); // <--- 关键修复：添加 imageAliases 到依赖数组

  // 计算操作系统镜像名称
  const osImage = useMemo(() => {
    if (!disks || !Array.isArray(disks) || disks.length === 0) return null;

    // 优先找 bootOrder=1 的启动盘，其次第一个有 Image 的盘
    const bootDisk = disks.find((d: any) => d.bootOrder === 1)
      || disks.find((d: any) => typeof d.source === 'string' && d.source.startsWith('Image:'))
      || disks[0];

    if (!bootDisk || typeof bootDisk.source !== 'string') return null;

    // disks 里 source 形如 "Image: xxx"，这里把前缀去掉
    if (bootDisk.source.startsWith('Image:')) {
      return bootDisk.source.replace(/^Image:\s*/, '');
    }

    return bootDisk.source;
  }, [disks]);

  // 解析 Networks (优先 from versionData 解析)
  const networks = useMemo(() => {
    // 1. 尝试从 Version Data 解析
    if (versionData) {
      const nets = versionData?.spec?.vm?.spec?.template?.spec?.networks || [];
      const interfaces = versionData?.spec?.vm?.spec?.template?.spec?.domain?.devices?.interfaces || [];

      // 注意：interfaces 可能是 undefined，需要安全访问
      if (!Array.isArray(interfaces)) return [];

      return interfaces.map((iface: any) => {
        const net = Array.isArray(nets) ? nets.find((n: any) => n.name === iface.name) : undefined;
        return {
          name: iface.name,
          model: iface.model || 'virtio',
          networkName: net?.multus?.networkName || 'Management Network',
          mac: iface.macAddress || '-'
        };
      });
    }
    // ...
  }, [versionData, template]);

  // CloudInit
  const cloudInit = useMemo(() => {
      // 检查 volumes 里的 cloudInit
      const volumes = versionData?.spec?.vm?.spec?.template?.spec?.volumes || [];
      const ciVol = volumes.find((v: any) => v.cloudInitNoCloud || v.cloudInitConfigDrive);
      if (ciVol) {
          const src = ciVol.cloudInitNoCloud || ciVol.cloudInitConfigDrive;
          return {
              userData: src.userData,
              networkData: src.networkData
          };
      }
      return null;
  }, [versionData]);

  // 解析 SSH Keys
  const sshKeys = useMemo(() => {
    if (!versionData) return [];
    // SSH Key 通常在 spec.keyPairIds (Harvester v1.0+)
    const keyPairIds = versionData?.spec?.keyPairIds || [];
    return keyPairIds;
  }, [versionData]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={800}
      placement="right"
      closable={false}
      styles={{ body: { padding: 0, background: '#f5f7fa', display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <div style={{ background: '#fff', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
                fontSize: 24, 
                color: '#1890ff',
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#e6f7ff',
                borderRadius: '50%'
            }}>
                <FileTextOutlined />
            </div>
            <div>
                <div style={{ fontSize: 18, fontWeight: 500 }}>
                    {template?.spec?.displayName || template?.metadata?.name}
                </div>
                <div style={{ fontSize: 12, color: '#999'}}>
                    {template?.spec?.description || '无描述'}
                </div>
            </div>
         </div>
         <div style={{ display: 'flex', gap: 8 }}>
            <Button 
                icon={<ReloadOutlined />} 
                onClick={fetchVersionDetail} 
                loading={loading}
                type="text"
            />
            <Button 
                icon={<CloseOutlined />} 
                onClick={onClose} 
                type="text"
            />
         </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
                    {/* Basic Info */}
                    <Card size="small" title="基础信息" bordered={false}>
                        <Descriptions column={2}>
                            <Descriptions.Item label="名称">{template?.metadata?.name}</Descriptions.Item>
                            <Descriptions.Item label="命名空间">{template?.metadata?.namespace}</Descriptions.Item>
                            <Descriptions.Item label="默认版本 ID">
                                <Tag>{defaultVersionId || '未设置'}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item label="创建时间">
                                {template?.metadata?.creationTimestamp ? dayjs(template.metadata.creationTimestamp).format('YYYY-MM-DD HH:mm:ss') : '-'}
                            </Descriptions.Item>
                        </Descriptions>
                    </Card>

                    {loading ? <Skeleton active /> : (versionData || (disks && disks.length > 0) || (networks && networks.length > 0)) ? (
                        <>
                            {/* Spec */}
                            <Card size="small" title="规格配置 (Spec)" bordered={false} extra={versionData ? <Tag color="blue">Version: {versionData.metadata.resourceVersion}</Tag> : <Tag>From Template Metadata</Tag>}>
                                <Descriptions column={2}>
                                    <Descriptions.Item label={<Space><LaptopOutlined /> CPU</Space>}>
                                        {cpuInfo ? `${cpuInfo.cores} Cores x ${cpuInfo.sockets} Sockets x ${cpuInfo.threads} Threads (${cpuInfo.total} vCPU)` : '-'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label={<Space><HddOutlined /> 内存</Space>}>
                                        {memoryInfo || '-'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label={<Space><LaptopOutlined /> 操作系统镜像</Space>}>
                                        {osImage || '-'}
                                    </Descriptions.Item>
                                </Descriptions>
                            </Card>

                            {/* Disks */}
                            <Card size="small" title="存储卷 (Volumes)" bordered={false}>
                                <List
                                    dataSource={disks}
                                    renderItem={(item: any) => (
                                        <List.Item>
                                            <List.Item.Meta
                                                avatar={<HddOutlined style={{ fontSize: 18, color: '#1890ff' }} />}
                                                title={
                                                    <Space>
                                                        <span>{item.name}</span>
                                                        {item.isCdrom && <Tag color="orange">CD-ROM</Tag>}
                                                        {item.bootOrder && <Tag color="green">Boot: {item.bootOrder}</Tag>}
                                                    </Space>
                                                }
                                                description={
                                                    <Space split="|">
                                                        <span>Type: {item.type}</span>
                                                        <span>Source: {item.source}</span>
                                                        <span>Bus: {item.bus}</span>
                                                    </Space>
                                                }
                                            />
                                        </List.Item>
                                    )}
                                />
                            </Card>

                            {/* Networks */}
                            <Card size="small" title="网络接口 (Interfaces)" bordered={false}>
                                <List
                                    dataSource={networks}
                                    renderItem={(item: any) => (
                                        <List.Item>
                                            <List.Item.Meta
                                                avatar={<GlobalOutlined style={{ fontSize: 18, color: '#52c41a' }} />}
                                                title={item.name}
                                                description={
                                                    <Space split="|">
                                                        <span>Network: {item.networkName}</span>
                                                        <span>Model: {item.model}</span>
                                                        <span>MAC: {item.mac}</span>
                                                    </Space>
                                                }
                                            />
                                        </List.Item>
                                    )}
                                />
                            </Card>

                            {/* SSH Keys */}
                            {sshKeys.length > 0 && (
                                <Card size="small" title="SSH 密钥" bordered={false}>
                                    <Space wrap>
                                        {sshKeys.map((keyId: string) => (
                                            <Tag icon={<KeyOutlined />} key={keyId}>{keyId}</Tag>
                                        ))}
                                    </Space>
                                </Card>
                            )}
                            
                            {/* CloudInit Preview (if any) */}
                            {cloudInit && (cloudInit.userData || cloudInit.networkData) && (
                                <Card size="small" title="Cloud Config" bordered={false}>
                                    <Tabs 
                                        type="card" 
                                        size="small"
                                        items={[
                                            ...(cloudInit.userData ? [{
                                                key: 'userdata',
                                                label: 'User Data',
                                                children: <LinedTextArea value={cloudInit.userData} readOnly />
                                            }] : []),
                                            ...(cloudInit.networkData ? [{
                                                key: 'networkdata',
                                                label: 'Network Data',
                                                children: <LinedTextArea value={cloudInit.networkData} readOnly />
                                            }] : [])
                                        ]}
                                    />
                                </Card>
                            )}
                        </>
                    ) : (
                        !loading && <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>暂无版本详情数据</div>
                    )}
                </Space>
      </div>
    </Drawer>
  );
};

export default HarvesterTemplateDetailDrawer;
