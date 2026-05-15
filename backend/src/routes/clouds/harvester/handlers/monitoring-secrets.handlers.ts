/**
 * Harvester Monitoring Secrets & ConfigMaps Handlers
 * Secrets 和 ConfigMaps 管理（告警接收器密钥、钉钉 ConfigMap）
 */

import { Request, Response } from 'express';
import { requestJson } from '../../../../services/clouds/harvester/utils';
import { ensureProvider, normalizeOrigin } from './monitoring-helpers';
import {
  PAGESIZE,
  SECRETS_BASE,
  CONFIGMAPS_BASE,
  MONITORING_RECEIVER_SECRET_LABEL,
  ALERTMANAGER_TARGET_ANNOTATION,
  DINGTALK_CONFIGMAP_NS,
  DINGTALK_CONFIGMAP_NAME,
  isUnreachableError,
  requireTenantAccessForMonitoring,
} from './monitoring-helpers';
import { getJsonOnce } from '../../../../services/clouds/harvester/utils';

export async function harvesterMonitoringSecretsListHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const namespace = String(req.query?.namespace ?? 'cattle-monitoring-system').trim();
    const datasource = String(req.query?.datasource ?? 'prometheus').trim().toLowerCase();
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权访问该命名空间下的密钥对象',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const excludeQs =
      'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state';
    const filterQs = `&filter=metadata.namespace=${encodeURIComponent(namespace)}`;
    const labelQs = `&labelSelector=${encodeURIComponent(MONITORING_RECEIVER_SECRET_LABEL + '=true')}`;
    const apiPath = `${SECRETS_BASE}?${PAGESIZE}&${excludeQs}${filterQs}${labelQs}`;
    const raw = await getJsonOnce(`${origin}/${apiPath}`, cloud.secretKey || '', insecure, true);
    const list: any[] = Array.isArray(raw?.data) ? raw.data : [];
    const secretList = list.map((item: any) => ({
      name: (item?.metadata?.name ?? item?.name ?? '').toString().trim(),
      data: item?.data && typeof item.data === 'object' ? item.data : {},
      type: (item?.type ?? 'Opaque').toString(),
    }));
    res.json(secretList);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json([]);
    if (res.headersSent) return;
    const status = (e as any).status || 500;
    res.status(status).json({ message: e?.message || '请求密钥secrets列表失败' });
  }
}

export async function harvesterMonitoringSecretsDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    if (!namespace || !name) {
      return res.status(400).json({ message: '命名空间与密钥名称不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权访问该命名空间下的密钥对象',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${SECRETS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const excludeQs =
      'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.relationships&exclude=metadata.fields&exclude=metadata.state&exclude=metadata.annotations';
    const url = `${origin}/${path}?${excludeQs}`;
    const raw = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    const item =
      (raw as any)?.data != null &&
      typeof (raw as any).data === 'object' &&
      (raw as any).data?.metadata != null
        ? (raw as any).data
        : raw;
    if (!item?.metadata) {
      return res.status(404).json({ message: '密钥不存在' });
    }
    if (item?.metadata?.labels?.[MONITORING_RECEIVER_SECRET_LABEL] !== 'true') {
      return res.status(400).json({ message: '该密钥不是告警接收器密钥（缺少 monitoring-receiver-secret 标签）' });
    }
    res.json({
      name: (item?.metadata?.name ?? item?.name ?? '').toString().trim(),
      namespace: (item?.metadata?.namespace ?? '').toString().trim(),
      data: item?.data && typeof item.data === 'object' ? item.data : {},
      type: (item?.type ?? 'Opaque').toString(),
    });
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({});
    if (res.headersSent) return;
    const status = (e as any).status ?? (e as any)?.statusCode ?? 500;
    res.status(status).json({ message: e?.message || '请求密钥失败' });
  }
}

export async function harvesterMonitoringSecretsCreateHandler(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const body = req.body;
    const namespace = (body?.metadata?.namespace ?? '').toString().trim();
    const name = (body?.metadata?.name ?? '').toString().trim();
    if (!namespace || !name) {
      return res.status(400).json({ message: 'metadata.namespace 与 metadata.name 不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权访问该命名空间下的密钥对象',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const payload = {
      apiVersion: 'v1',
      kind: 'Secret',
      type: body?.type ?? 'Opaque',
      metadata: {
        name,
        namespace,
        labels: { ...(body?.metadata?.labels || {}), [MONITORING_RECEIVER_SECRET_LABEL]: 'true' },
      },
      data: body?.data && typeof body.data === 'object' ? body.data : {},
    };
    const url = `${origin}/${SECRETS_BASE}`;
    await requestJson('POST', url, cloud.secretKey || '', insecure, payload);
    res.status(201).json({ message: '创建成功' });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status ?? (e as any)?.statusCode ?? 500;
    const errMsg = (e as any).message || (typeof (e as any).body === 'string' ? (e as any).body : '') || '创建密钥失败';
    res.status(status).json({ message: errMsg });
  }
}

export async function harvesterMonitoringSecretsUpdateHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    const body = req.body;
    if (!namespace || !name) {
      return res.status(400).json({ message: 'namespace 与 name 不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权访问该命名空间下的密钥对象',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const getPath = `${SECRETS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const existingRaw = await getJsonOnce(`${origin}/${getPath}`, cloud.secretKey || '', insecure, true);
    const existing =
      (existingRaw as any)?.data != null &&
      typeof (existingRaw as any).data === 'object' &&
      (existingRaw as any).data?.metadata != null
        ? (existingRaw as any).data
        : existingRaw;
    if (!existing?.metadata) {
      return res.status(404).json({ message: '密钥不存在' });
    }
    if (existing?.metadata?.labels?.[MONITORING_RECEIVER_SECRET_LABEL] !== 'true') {
      return res.status(400).json({ message: '该密钥不是告警接收器密钥，无法通过此接口修改' });
    }
    const payload = {
      apiVersion: 'v1',
      kind: 'Secret',
      type: body?.type ?? existing?.type ?? 'Opaque',
      metadata: {
        ...existing.metadata,
        name,
        namespace,
        resourceVersion: existing.metadata?.resourceVersion,
        labels: { ...(existing.metadata?.labels || {}), [MONITORING_RECEIVER_SECRET_LABEL]: 'true' },
      },
      data: body?.data && typeof body.data === 'object' ? body.data : existing?.data || {},
    };
    const putUrl = `${origin}/${getPath}`;
    await requestJson('PUT', putUrl, cloud.secretKey || '', insecure, payload);
    res.json({ message: '更新成功' });
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status ?? (e as any)?.statusCode ?? 500;
    const errMsg = (e as any).message || (typeof (e as any).body === 'string' ? (e as any).body : '') || '更新密钥失败';
    res.status(status).json({ message: errMsg });
  }
}

export async function harvesterMonitoringSecretsDeleteHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    if (!namespace || !name) {
      return res.status(400).json({ message: 'namespace 与 name 不能为空' });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权访问该命名空间下的密钥对象',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const getPath = `${SECRETS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const existingRaw = await getJsonOnce(`${origin}/${getPath}`, cloud.secretKey || '', insecure, true);
    const existing =
      (existingRaw as any)?.data != null &&
      typeof (existingRaw as any).data === 'object' &&
      (existingRaw as any).data?.metadata != null
        ? (existingRaw as any).data
        : existingRaw;
    if (existing?.metadata && existing?.metadata?.labels?.[MONITORING_RECEIVER_SECRET_LABEL] !== 'true') {
      return res.status(400).json({ message: '该密钥不是告警接收器密钥，无法通过此接口删除' });
    }
    const targetBinding = (existing?.metadata?.annotations?.[ALERTMANAGER_TARGET_ANNOTATION] ?? '').toString().trim();
    if (targetBinding) {
      return res.status(400).json({
        message: `该告警密钥已被通知对象引用（${targetBinding}），请先解除关联后再删除`,
      });
    }
    await requestJson('DELETE', `${origin}/${getPath}`, cloud.secretKey || '', insecure);
    res.status(204).send();
  } catch (e: any) {
    if (res.headersSent) return;
    const status = (e as any).status ?? (e as any)?.statusCode ?? 500;
    const errMsg = (e as any).message || (typeof (e as any).body === 'string' ? (e as any).body : '') || '删除密钥失败';
    res.status(status).json({ message: errMsg });
  }
}

export async function harvesterMonitoringConfigMapsDetailHandler(req: Request, res: Response) {
  try {
    const { id, namespace, name } = req.params;
    if (!namespace || !name) {
      return res.status(400).json({ message: '命名空间与配置名称不能为空' });
    }
    if (namespace !== DINGTALK_CONFIGMAP_NS || name !== DINGTALK_CONFIGMAP_NAME) {
      return res.status(400).json({
        message: `仅允许访问 ConfigMap ${DINGTALK_CONFIGMAP_NS}/${DINGTALK_CONFIGMAP_NAME}`,
      });
    }
    const tenant = await requireTenantAccessForMonitoring(req as any, res, id, {
      namespaces: [namespace],
      forbiddenMessage: '无权访问该命名空间下的 ConfigMap',
    });
    if (!tenant) return;

    const cloud = (req as any).cloud;
    if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;

    const insecure = !!(cloud.config as any)?.ignoreTls;
    const origin = normalizeOrigin(cloud.endpoint || '');
    const path = `${CONFIGMAPS_BASE}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
    const excludeQs = 'exclude=metadata.managedFields&exclude=metadata.ownerReferences&exclude=metadata.annotations';
    const url = `${origin}/${path}?${excludeQs}`;
    const data = await getJsonOnce(url, cloud.secretKey || '', insecure, true);
    res.json(data);
  } catch (e: any) {
    if (isUnreachableError(e)) return res.status(200).json({});
    if (res.headersSent) return;
    const status = (e as any).status || (e as any)?.statusCode || 500;
    res.status(status).json({ message: e?.message || '请求 ConfigMap 失败' });
  }
}
