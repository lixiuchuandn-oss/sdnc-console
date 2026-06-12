import { message } from 'antd';
import { apiPost } from '../../../../../../services/api';
import type { SecurityDomainOption } from '../types';
import { getServiceInstances } from './field-utils';

export async function executeCenSso(
  r: any,
  instanceOverride: any,
  allDomains: SecurityDomainOption[],
  csmElementGroupCache: Record<string, Record<string, any>>,
): Promise<void> {
  const fromList = getServiceInstances(r, allDomains, csmElementGroupCache);
  const instances = instanceOverride !== undefined && instanceOverride !== null ? [instanceOverride] : fromList;
  if (instances.length === 0) {
    message.warning('该服务无实例，无法访问');
    return;
  }

  const first = instances[0];
  const instanceId = typeof first === 'object' ? (first.id || first.uuid || first.vm_id || first.vrouter_id) : first;
  if (!instanceId) {
    message.warning('实例ID未找到');
    return;
  }

  const dom = allDomains.find((d) => String(d.id) === String(r.domainId));
  const cloudId = dom?.cloudId;
  if (!cloudId) {
    message.error('未找到关联的云资源ID');
    return;
  }

  try {
    message.loading({ content: '正在发起SSO访问...', key: 'sso' });
    const res: any = await apiPost(`/api/clouds/${cloudId}/csm/security/domain/attach/callOnSSO`, {
      id: instanceId,
      currentLoginWebPort: '8020',
    });
    message.success({ content: 'SSO请求成功，正在跳转...', key: 'sso' });

    const url = res?.data?.url || res?.url;
    if (url) {
      window.open(url, '_blank');
    } else {
      message.warning('未返回跳转URL');
    }
  } catch (e: any) {
    message.error({ content: `SSO访问失败: ${e.message}`, key: 'sso' });
  }
}
