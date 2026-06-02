// 从不同云厂商/平台的原始资源对象中抽取统一的 id / name 标识。
export const extractIdentity = (provider: string, type: 'vm' | 'vpc', r: any) => {
  let id = '';
  let name = '';

  if (type === 'vm') {
    if (provider === 'aliyun') {
      id = r?.InstanceId;
      name = r?.InstanceName || r?.HostName;
    } else if (provider === 'huaweicloud') {
      id = r?.id;
      name = r?.name;
    } else if (
      provider === 'harvester' ||
      provider === 'cloudmap.private' ||
      provider === 'cloudmap.edge'
    ) {
      id = r?.InstanceId || '';
      if (id.includes('/')) name = id.split('/').pop() || '';
      else name = r?.Extra?.Name;
    } else if (provider === 'cloudmap.csm' || provider === 'cloudmap') {
      id = r?.InstanceId || r?.id || r?.Id || r?.uuid || '';
      name = r?.InstanceName || r?.HostName || r?.name || r?.Name;
    }
  } else if (type === 'vpc') {
    if (provider === 'aliyun') {
      id = r?.VpcId;
      name = r?.VpcName;
    } else if (provider === 'huaweicloud') {
      id = r?.id || r?.VpcId;
      name = r?.name || r?.VpcName;
    }
  }

  if (!id) id = r?.id || r?.Id || '';
  if (!name) name = r?.name || r?.Name || '';
  if (id && !name) name = id;

  return { id, name };
};
