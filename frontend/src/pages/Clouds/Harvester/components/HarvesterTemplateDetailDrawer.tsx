import React, { useEffect, useState, useMemo } from 'react';
import { Drawer, Tabs, Button, Tag, Descriptions, Card, List, Space, Skeleton, Tooltip } from 'antd';
import { 
  CloseOutlined, 
  ReloadOutlined,
  KeyOutlined,
  InfoCircleOutlined
} from '@ant-design/icons';
import LinedTextArea from '../../../../components/LinedTextArea';
import { fetchHarvesterResourceByLink } from '../../../../services/harvesterApi';
import { ReactComponent as CpuIcon } from '../../../../assets/clouds/cpu.svg';
import { ReactComponent as MemIcon } from '../../../../assets/clouds/mem.svg';
import { ReactComponent as DiskIcon } from '../../../../assets/clouds/disk.svg';
import { ReactComponent as NicIcon } from '../../../../assets/clouds/nic.svg';
import { OsIcon } from '../../../../components/OsIcon';

interface HarvesterTemplateDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  template: any;
  cloudId: string;
}

// 缓存 Image Alias，避免重复请求
const imageAliasCache = new Map<string, string>();

const evictionStrategyMap: Record<string, string> = {
    'LiveMigrate': '热迁移',
    'LiveMigrateIfPossible': '尽可能热迁移',
    'None': '无',
};

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
    return [];
  }, [versionData, template, imageAliases]);

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
    return [];
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
       <style>{`
          .minimal-scroll::-webkit-scrollbar {
              width: 6px;
              height: 6px;
          }
          .minimal-scroll::-webkit-scrollbar-track {
              background: transparent;
          }
          .minimal-scroll::-webkit-scrollbar-thumb {
              background: #e0e0e0;
              border-radius: 3px;
          }
          .minimal-scroll::-webkit-scrollbar-thumb:hover {
              background: #ccc;
          }
          .minimal-scroll::-webkit-scrollbar-button {
              display: none;
          }
      `}</style>

      {/* Header */}
      <div style={{ background: '#f5f7fa', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f0f0' }}>
         <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
                width: 38,
                height: 38,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                <OsIcon osName={osImage || ''} style={{ fontSize: 32 }} />
            </div>
            <div>
                <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.2 }}>
                    {template?.spec?.displayName || template?.metadata?.name}
                </div>
                <div style={{ fontSize: 12, color: '#999'}}>
                    {template?.spec?.description || '无描述'}
                </div>
            </div>
            {defaultVersionId && (
                <Tag style={{ margin: 0 }} color="blue">v{defaultVersionId.split('/').pop()}</Tag>
            )}
         </div>
         <div style={{ display: 'flex', alignItems: 'center' }}>
            <Button 
                icon={<ReloadOutlined spin={loading} />} 
                onClick={fetchVersionDetail} 
                type="text"
                style={{ width: 32, height: 32, borderRadius: 4, color: '#666' }}
            />
            <Button 
                icon={<CloseOutlined />} 
                onClick={onClose} 
                type="text"
                style={{ width: 32, height: 32, borderRadius: 4, fontSize: 16, color: '#666' }}
            />
         </div>
      </div>

      {/* Content */}
      <div className="minimal-scroll" style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
          <Space direction="vertical" size={24} style={{ width: '100%' }}>
                    {/* Basic Info (Optional, kept hidden or integrated if needed, now integrated into header or separate small card if critical info missing) */}
                    
                    {loading ? <Skeleton active /> : (versionData || (disks && disks.length > 0) || (networks && networks.length > 0)) ? (
                        <>
                            {/* Version Info */}
                            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                                <Descriptions column={2} size="small" styles={{ label: { width: 120, color: '#999' } }}>
                                    <Descriptions.Item label="模板 ID">
                                        <div style={{ wordBreak: 'break-all' }}>{template?.spec?.defaultVersionId || '-'}</div>
                                    </Descriptions.Item>
                                    <Descriptions.Item label="版本">
                                        <Tag color="blue">{versionData?.status?.version ? `v${versionData.status.version}` : '-'}</Tag>
                                    </Descriptions.Item>
                                    <Descriptions.Item label="运行策略">
                                        {versionData?.spec?.vm?.spec?.runStrategy || '-'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="操作系统">
                                        {versionData?.spec?.vm?.metadata?.labels?.['harvesterhci.io/os'] || '-'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="状态">
                                        {versionData?.status?.conditions ? (
                                            <Space wrap size={4}>
                                                {versionData.status.conditions.map((c: any) => (
                                                    <Tooltip key={c.type} title={`最后更新: ${c.lastUpdateTime}`}>
                                                        <Tag color={c.status === 'True' ? 'success' : 'default'}>
                                                            {c.type}
                                                        </Tag>
                                                    </Tooltip>
                                                ))}
                                            </Space>
                                        ) : '-'}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="驱逐策略">
                                        {(() => {
                                            const strategy = versionData?.spec?.vm?.spec?.template?.spec?.evictionStrategy;
                                            return evictionStrategyMap[strategy] || strategy || '-';
                                        })()}
                                    </Descriptions.Item>
                                </Descriptions>
                            </Card>

                            {/* Spec */}
                            <Card variant="borderless" styles={{ body: { padding: 16 } }}>
                                <div style={{ display: 'flex', gap: 24 }}>
                                    {/* CPU */}
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <div style={{ 
                                            width: 48, height: 48, borderRadius: 8, background: '#f0f9ff',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: '#1890ff', fontSize: 24
                                        }}>
                                            <CpuIcon width={28} height={28} style={{ fill: '#1890ff' }} />
                                        </div>
                                        <div>
                                            <div style={{ color: '#999', fontSize: 12 }}>CPU</div>
                                            <div style={{ fontSize: 20, fontWeight: 500 }}>
                                                {cpuInfo ? cpuInfo.total : '-'} <span style={{ fontSize: 14, color: '#999', fontWeight: 400 }}>vCPU</span>
                                            </div>
                                            <div style={{ fontSize: 12, color: '#999' }}>
                                                {cpuInfo ? `${cpuInfo.sockets} Sockets x ${cpuInfo.cores} Cores x ${cpuInfo.threads} Threads` : '-'}
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div style={{ width: 1, background: '#f0f0f0' }} />

                                    {/* Memory */}
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>
                                        <div style={{ 
                                            width: 48, height: 48, borderRadius: 8, background: '#f0f9ff',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: '#1890ff', fontSize: 24
                                        }}>
                                            <MemIcon width={28} height={28} style={{ fill: '#1890ff' }} />
                                        </div>
                                        <div>
                                            <div style={{ color: '#999', fontSize: 12 }}>内存</div>
                                            <div style={{ fontSize: 20, fontWeight: 500 }}>
                                                {memoryInfo || '-'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Card>

                            {/* Disks */}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ color: '#666' }}>虚拟磁盘</span>
                                </div>
                                <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                                    <List
                                        dataSource={disks}
                                        renderItem={(item: any) => (
                                            <List.Item style={{ padding: '16px 24px' }}>
                                                <List.Item.Meta
                                                    avatar={
                                                        <div style={{ 
                                                            width: 48, height: 48, borderRadius: 8, background: '#ffffff',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            flexShrink: 0 
                                                        }}>
                                                            <DiskIcon width={38} height={38} style={{ fill: '#1890ff' }} />
                                                        </div>
                                                    }
                                                    title={
                                                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                                            <span>{item.name}</span>
                                                            {item.isCdrom && <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>CD-ROM</Tag>}
                                                            {item.bootOrder && <Tag color="green" style={{ fontSize: 10, margin: 0 }}>启动顺序: {item.bootOrder}</Tag>}
                                                        </div>
                                                    }
                                                    description={
                                                        <div style={{ fontSize: 12 }}>
                                                            <span>类型: {item.type}</span>
                                                            <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                                                            <span>来源: {item.source}</span>
                                                            <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                                                            <span>总线: {item.bus}</span>
                                                        </div>
                                                    }
                                                />
                                            </List.Item>
                                        )}
                                    />
                                </Card>
                            </div>

                            {/* Networks */}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ color: '#666' }}>虚拟网卡</span>
                                </div>
                                <Card variant="borderless" styles={{ body: { padding: 0 } }}>
                                    <List
                                        dataSource={networks}
                                        renderItem={(item: any) => (
                                            <List.Item style={{ padding: '16px 24px' }}>
                                                <List.Item.Meta
                                                    avatar={
                                                        <div style={{ 
                                                            width: 48, height: 48, borderRadius: 8, background: '#ffffff',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            flexShrink: 0 
                                                        }}>
                                                            <NicIcon width={38} height={38} style={{ fill: '#1890ff' }} />
                                                        </div>
                                                    }
                                                    title={item.name}
                                                    description={
                                                        <div style={{ fontSize: 12 }}>
                                                            <span>网络: {item.networkName}</span>
                                                            <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                                                            <span>型号: {item.model}</span>
                                                            <span style={{ margin: '0 8px', color: '#eee' }}>|</span>
                                                            <span>MAC: {item.mac}</span>
                                                        </div>
                                                    }
                                                />
                                            </List.Item>
                                        )}
                                    />
                                </Card>
                            </div>

                            {/* Others */}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ color: '#666' }}>其他选项</span>
                                </div>
                                <Card variant="borderless" styles={{ body: { padding: '16px 24px' } }}>
                                    <Descriptions column={1} size="small" styles={{ label: { width: 120, color: '#999' } }}>
                                        {/* SSH Keys */}
                                        <Descriptions.Item label="SSH Keys">
                                            {sshKeys.length > 0 ? (
                                                <Space wrap>
                                                    {sshKeys.map((keyId: string) => (
                                                        <Tag icon={<KeyOutlined />} key={keyId}>{keyId}</Tag>
                                                    ))}
                                                </Space>
                                            ) : '无'}
                                        </Descriptions.Item>
                                        
                                        {/* CloudInit Preview */}
                                        <Descriptions.Item label="Cloud-Init">
                                            {(cloudInit && (cloudInit.userData || cloudInit.networkData)) ? (
                                                <div className="minimal-scroll" style={{ maxHeight: 200, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4, width: '100%' }}>
                                                    {cloudInit.userData && (
                                                        <div style={{ marginBottom: 8 }}>
                                                            <div style={{ fontSize: 12, fontWeight: 500, color: '#666', marginBottom: 4 }}>User Data</div>
                                                            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                                {cloudInit.userData}
                                                            </pre>
                                                        </div>
                                                    )}
                                                    {cloudInit.networkData && (
                                                        <div>
                                                            <div style={{ fontSize: 12, fontWeight: 500, color: '#666', marginBottom: 4 }}>Network Data</div>
                                                            <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                                {cloudInit.networkData}
                                                            </pre>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : '未配置'}
                                        </Descriptions.Item>
                                        
                                        <Descriptions.Item label="高级配置">
                                            <Space direction="vertical" size={4}>
                                                <div>预留内存: {versionData?.spec?.vm?.metadata?.annotations?.['harvesterhci.io/reservedMemory'] || '-'}</div>
                                                <div>特性 (Features): {versionData?.spec?.vm?.spec?.template?.spec?.domain?.features ? (
                                                    <span style={{ fontSize: 12, color: '#666' }}>
                                                        {Object.keys(versionData.spec.vm.spec.template.spec.domain.features).join(', ')}
                                                    </span>
                                                ) : '-'}</div>
                                            </Space>
                                        </Descriptions.Item>

                                        <Descriptions.Item label="基础信息">
                                             <Space direction="vertical" size={0}>
                                                <div>Namespace: {template?.metadata?.namespace}</div>
                                                <div>Created: {template?.metadata?.creationTimestamp}</div>
                                             </Space>
                                        </Descriptions.Item>
                                    </Descriptions>
                                </Card>
                            </div>
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
