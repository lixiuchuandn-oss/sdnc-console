/**
 * useVmHotplug.ts
 * 
 * 热插拔操作 Hook
 * 
 * 功能：
 * 1. 管理热插拔相关的状态和资源
 * 2. 提供热插拔API调用方法
 * 3. 检查VM是否支持热插拔
 */
import { useState, useEffect, useMemo } from 'react';
import { Form, message } from 'antd';
import {
  fetchHarvesterNads,
  fetchKubeOvnVpcs,
  fetchKubeOvnSubnets,
  harvesterVmAction,
  fetchHarvesterVolumes,
  fetchHarvesterStorageClasses,
  fetchHarvesterImages,
} from '../../../../../services/harvesterApi';

type Props = {
  open: boolean;
  cloudId: string;
  record: any | null;
  onClose: () => void;
  onOk: () => void;
  initialConfigType?: string;
};

export const useVmHotplug = (props: Props) => {
  const { open, cloudId, record, onClose, onOk, initialConfigType = 'hotplug_nic' } = props;

  const [form] = Form.useForm();
  const [selectedKey, setSelectedKey] = useState<string>(initialConfigType);
  
  // 资源列表
  const [nads, setNads] = useState<any[]>([]);
  const [vpcs, setVpcs] = useState<any[]>([]);
  const [subnets, setSubnets] = useState<any[]>([]);
  const [volumes, setVolumes] = useState<any[]>([]);
  const [storageClasses, setStorageClasses] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [hotUnpluggableNics, setHotUnpluggableNics] = useState<string[]>([]);
  
  // 加载状态
  const [loading, setLoading] = useState(false);

  const namespace = record?.metadata?.namespace;
  const vmName = record?.metadata?.name;

  // 加载NAD列表
  const reloadNads = async () => {
    try {
      const res = await fetchHarvesterNads(cloudId);
      const list = res?.data || res || [];
      setNads(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.error('Failed to load NADs:', e);
      message.error('加载网络列表失败');
    }
  };

  // 加载VPC列表
  const reloadVpcs = async () => {
    try {
      const res = await fetchKubeOvnVpcs(cloudId);
      const list = res?.data || res || [];
      setVpcs(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.error('Failed to load VPCs:', e);
    }
  };

  // 加载Subnet列表
  const reloadSubnets = async () => {
    try {
      const res = await fetchKubeOvnSubnets(cloudId);
      const list = res?.data || res || [];
      setSubnets(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.error('Failed to load Subnets:', e);
    }
  };

  // 加载可热插拔的网卡列表
  const reloadHotUnpluggableNics = async () => {
    if (!namespace || !vmName) return;
    
    try {
      const res = await harvesterVmAction(cloudId, namespace, vmName, 'findHotunpluggableNics', {});
      const interfaces = res?.interfaces || [];
      setHotUnpluggableNics(Array.isArray(interfaces) ? interfaces : []);
    } catch (e: any) {
      console.error('Failed to load hot-unpluggable NICs:', e);
      setHotUnpluggableNics([]);
    }
  };

  // 加载卷列表
  const reloadVolumes = async () => {
    if (!namespace) return;
    
    try {
      // fetchHarvesterVolumes 的第二个参数是 force，第三个参数是 skipSync
      const res = await fetchHarvesterVolumes(cloudId, false, false);
      const list = res?.data || res || [];
      // 过滤出当前命名空间的卷
      const filtered = Array.isArray(list) 
        ? list.filter((vol: any) => {
            const volNs = vol?.metadata?.namespace || vol?.namespace || '';
            return volNs === namespace;
          })
        : [];
      setVolumes(filtered);
    } catch (e: any) {
      console.error('Failed to load volumes:', e);
      message.error('加载数据盘列表失败');
    }
  };

  // 加载存储类列表
  const reloadStorageClasses = async () => {
    try {
      const res = await fetchHarvesterStorageClasses(cloudId);
      const list = res?.data || res || [];
      setStorageClasses(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.error('Failed to load storage classes:', e);
      message.error('加载存储类列表失败');
    }
  };

  // 加载VM镜像列表
  const reloadImages = async () => {
    try {
      const res = await fetchHarvesterImages(cloudId, false, false);
      const list = res?.data || res || [];
      setImages(Array.isArray(list) ? list : []);
    } catch (e: any) {
      console.error('Failed to load images:', e);
      message.error('加载VM镜像列表失败');
    }
  };

  // 检查VM是否支持热插拔
  const isHotplugSupported = useMemo(() => {
    if (!record) return false;
    
    const conditions = record?.status?.conditions || [];
    const isLiveMigratable = conditions.some(
      (c: any) => c.type === 'LiveMigratable' && c.status === 'True'
    );
    
    const isRunning = record?.status?.printableStatus === 'Running';
    
    const interfaces = record?.spec?.template?.spec?.domain?.devices?.interfaces || [];
    const allHaveMac = interfaces.every((i: any) => i.macAddress);
    
    return isLiveMigratable && isRunning && allHaveMac;
  }, [record]);

  const isMigratable = useMemo(() => {
    if (!record) return false;
    const conditions = record?.status?.conditions || [];
    return conditions.some(
      (c: any) => c.type === 'LiveMigratable' && c.status === 'True'
    );
  }, [record]);

  // 初始化加载资源
  useEffect(() => {
    if (open && cloudId) {
      reloadNads();
      reloadVpcs();
      reloadSubnets();
      reloadStorageClasses();
      reloadImages();
      if (namespace) {
        reloadVolumes();
      }
      if (namespace && vmName) {
        reloadHotUnpluggableNics();
      }
    }
  }, [open, cloudId, namespace, vmName]);

  // 提交处理（通用）
  const handleSubmit = async () => {
    // 由各个子组件自行处理提交逻辑
  };

  return {
    form,
    selectedKey,
    setSelectedKey,
    nads,
    vpcs,
    subnets,
    volumes,
    storageClasses,
    images,
    reloadNads,
    reloadVpcs,
    reloadSubnets,
    reloadVolumes,
    reloadStorageClasses,
    reloadImages,
    hotUnpluggableNics,
    reloadHotUnpluggableNics,
    handleSubmit,
    isHotplugSupported,
    isMigratable,
    namespace,
    vmName,
  };
};
