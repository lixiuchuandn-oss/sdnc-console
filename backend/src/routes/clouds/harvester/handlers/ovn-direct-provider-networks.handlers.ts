import { Response } from 'express';
import { AppDataSource } from '../../../../config/database';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import { checkTenantAccess, fetchCloudOr404, ensureProvider } from '../harvester.direct.helpers';
import { licenseService } from '../../../../services/LicenseService';
import { KubeOvnProviderNetworkInventory } from '../../../../entities/kubeovn/KubeOvnProviderNetworkInventory';
import { syncKubeOvnProviderNetworks } from '../../../../services/clouds/harvester/inventory';

export async function harvesterProviderNetworkListHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res
        .status(403)
        .json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester', next)) return;

    const { force, skipSync } = req.query;
    const insecure = !!(cloud.config as any)?.ignoreTls;
    const repo = AppDataSource.getRepository(KubeOvnProviderNetworkInventory);
    const count = await repo.count({ where: { cloudId: id } });

    const shouldSync =
      count === 0 || (String(force) === 'true' && String(skipSync) !== 'true');
    if (shouldSync) {
      await syncKubeOvnProviderNetworks(cloud, insecure);
    } else if (String(skipSync) === 'true') {
      console.log('[ProviderNetwork-Refresh] 跳过全量同步（创建后刷新），直接查询数据库');
    }

    const items = await repo.find({ where: { cloudId: id } });
    const list = items.map((item) => item.rawData || {
      metadata: {
        name: item.name,
        uid: item.uid,
        labels: item.labels,
        annotations: item.annotations,
      },
      spec: {
        defaultInterface: item.defaultInterface,
        customInterfaces: item.customInterfaces,
        exchangeLinkName: item.exchangeLinkName,
        excludeNodes: item.excludeNodes,
      },
      status: {
        ready: item.ready,
        readyNodes: item.readyNodes,
        notReadyNodes: item.notReadyNodes,
        vlans: item.vlans,
      },
    });

    res.json({ message: '查询成功', data: { items: list } });
  } catch (error: any) {
    if (res.headersSent) return;
    res.status(500).json({ message: '查询 Provider Networks 失败', error: error.message });
  }
}

export async function harvesterProviderNetworkCreateHandler(
  req: any,
  res: Response,
  next: any,
) {
  try {
    if (!licenseService.hasFeature('network.ovn.vpc')) {
      return res
        .status(403)
        .json({ message: '未授权：虚拟专有云（OVN VPC）功能未启用' });
    }
    const { id } = req.params;
    const { allowed } = await checkTenantAccess(req, id);
    if (!allowed) return res.status(403).json({ message: 'Access denied' });

    const cloud = await fetchCloudOr404(id, res);
    if (!cloud) return;

    const base = (cloud.endpoint || '').replace(/\/+$/, '');
    let origin = base;
    try {
      const u = new URL(base);
      origin = `${u.protocol}//${u.host}`;
    } catch {
      origin = base.replace(/\/v[0-9].*$/, '');
    }

    const { name, spec, defaultInterface, customInterfaces, exchangeLinkName } = req.body;
    if (!name) {
      res.status(400).json({ message: '缺少必要参数: name' });
      return;
    }

    const finalSpec = spec || {
      defaultInterface: defaultInterface || '',
      customInterfaces: customInterfaces || [],
      exchangeLinkName: exchangeLinkName !== undefined ? exchangeLinkName : false,
    };
    if (!finalSpec.defaultInterface || finalSpec.defaultInterface.trim() === '') {
      res.status(400).json({ message: 'defaultInterface 不能为空' });
      return;
    }
    if (finalSpec.customInterfaces && !Array.isArray(finalSpec.customInterfaces)) {
      res.status(400).json({ message: 'customInterfaces 必须是数组格式' });
      return;
    }

    const payload = {
      apiVersion: 'kubeovn.io/v1',
      kind: 'ProviderNetwork',
      metadata: { name },
      spec: finalSpec,
    };

    const url = `${origin}/apis/kubeovn.io/v1/provider-networks`;
    const json = await requestJson(
      'POST',
      url,
      cloud.secretKey || '',
      !!(cloud.config as any)?.ignoreTls,
      payload,
    );

    if (json && json.metadata) {
      try {
        const repo = AppDataSource.getRepository(KubeOvnProviderNetworkInventory);
        const entity = repo.create({
          cloudId: cloud.id,
          uid: json.metadata?.uid || '',
          name: json.metadata?.name || '',
          defaultInterface: json.spec?.defaultInterface,
          customInterfaces: json.spec?.customInterfaces,
          exchangeLinkName: json.spec?.exchangeLinkName,
          excludeNodes: json.spec?.excludeNodes,
          ready: json.status?.ready,
          readyNodes: json.status?.readyNodes,
          notReadyNodes: json.status?.notReadyNodes,
          vlans: json.status?.vlans,
          labels: json.metadata?.labels,
          annotations: json.metadata?.annotations,
          rawData: json,
        });
        await repo.save(entity);
      } catch (e: any) {
        console.error('[ProviderNetwork-Create] 入库失败:', e?.message || e);
      }
    }

    res.json({ message: '创建成功', data: json });
  } catch (error: any) {
    if (res.headersSent) return;

    let errorMessage = error.message || '创建 Provider Network 失败';
    let errorDetails: any = null;
    if (error.status === 422 || error.statusCode === 422) {
      try {
        if (error.body) {
          errorDetails = typeof error.body === 'string' ? JSON.parse(error.body) : error.body;
          if (errorDetails.message) errorMessage = errorDetails.message;
          else if (errorDetails.details?.causes) {
            errorMessage = errorDetails.details.causes
              .map((c: any) => c.message || c.field)
              .join('; ');
          } else if (errorDetails.details?.field) {
            errorMessage = `${errorDetails.details.field}: ${errorDetails.details.message || errorMessage}`;
          }
        }
      } catch (parseError) {
        console.error('Failed to parse error response:', parseError);
      }
    }

    const statusCode = error.status || error.statusCode || 500;
    res.status(statusCode).json({
      message: '创建 Provider Network 失败',
      error: errorMessage,
      details: errorDetails,
    });
  }
}
