/**
 * Rook Ceph CR：Tower → Steve 读写（CephCluster、CephBlockPool、CephFilesystem、CephObjectStore、CephBlockPoolRadosNamespace）。
 */

import { Request, Response } from 'express';
import { ensureProvider } from './monitoring-helpers';
import {
  CEPH_ROOK_STEVE,
  rookCreate,
  rookDelete,
  rookGetOne,
  rookPatchMerge,
  rookReplace,
} from '../../../../services/clouds/harvester/cephRookSteveCrud';

function sendSteveErr(res: Response, e: any) {
  if (res.headersSent) return;
  const st = typeof e?.status === 'number' ? e.status : 500;
  const b = e?.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    return res.status(st).json(b);
  }
  return res.status(st).json({ message: e?.message || '请求失败' });
}

function respondDelete(res: Response, data: unknown) {
  if (data !== null && typeof data === 'object') {
    res.json(data);
    return;
  }
  res.status(204).end();
}

function requireNsName(req: Request, res: Response): boolean {
  const ns = String(req.params.namespace || '').trim();
  const nm = String(req.params.name || '').trim();
  if (!ns || !nm) {
    res.status(400).json({ message: '缺少 namespace 或 name' });
    return false;
  }
  return true;
}

// ---- CephCluster ----

export async function harvesterCephRookClusterGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookGetOne(cloud, CEPH_ROOK_STEVE.clusters, req.params.namespace, req.params.name);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookClusterReplaceHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookReplace(cloud, CEPH_ROOK_STEVE.clusters, req.params.namespace, req.params.name, req.body);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookClusterPatchHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookPatchMerge(cloud, CEPH_ROOK_STEVE.clusters, req.params.namespace, req.params.name, req.body);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

// ---- CephBlockPool ----

export async function harvesterCephRookBlockPoolGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookGetOne(cloud, CEPH_ROOK_STEVE.blockPools, req.params.namespace, req.params.name);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookBlockPoolCreateHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const data = await rookCreate(cloud, CEPH_ROOK_STEVE.blockPools, req.body);
    res.status(201).json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookBlockPoolReplaceHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookReplace(cloud, CEPH_ROOK_STEVE.blockPools, req.params.namespace, req.params.name, req.body);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookBlockPoolPatchHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookPatchMerge(
      cloud,
      CEPH_ROOK_STEVE.blockPools,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookBlockPoolDeleteHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookDelete(cloud, CEPH_ROOK_STEVE.blockPools, req.params.namespace, req.params.name);
    respondDelete(res, data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

// ---- CephFilesystem ----

export async function harvesterCephRookFilesystemGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookGetOne(cloud, CEPH_ROOK_STEVE.filesystems, req.params.namespace, req.params.name);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookFilesystemCreateHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const data = await rookCreate(cloud, CEPH_ROOK_STEVE.filesystems, req.body);
    res.status(201).json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookFilesystemReplaceHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookReplace(cloud, CEPH_ROOK_STEVE.filesystems, req.params.namespace, req.params.name, req.body);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookFilesystemPatchHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookPatchMerge(
      cloud,
      CEPH_ROOK_STEVE.filesystems,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookFilesystemDeleteHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookDelete(cloud, CEPH_ROOK_STEVE.filesystems, req.params.namespace, req.params.name);
    respondDelete(res, data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

// ---- CephObjectStore ----

export async function harvesterCephRookObjectStoreGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookGetOne(cloud, CEPH_ROOK_STEVE.objectStores, req.params.namespace, req.params.name);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStoreCreateHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const data = await rookCreate(cloud, CEPH_ROOK_STEVE.objectStores, req.body);
    res.status(201).json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStoreReplaceHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookReplace(
      cloud,
      CEPH_ROOK_STEVE.objectStores,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStorePatchHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookPatchMerge(
      cloud,
      CEPH_ROOK_STEVE.objectStores,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStoreDeleteHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookDelete(cloud, CEPH_ROOK_STEVE.objectStores, req.params.namespace, req.params.name);
    respondDelete(res, data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

// ---- CephObjectStoreUser（RGW 用户 / S3 密钥由 Operator 写入 Secret）----

export async function harvesterCephRookObjectStoreUserGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookGetOne(
      cloud,
      CEPH_ROOK_STEVE.objectStoreUsers,
      req.params.namespace,
      req.params.name,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStoreUserCreateHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const data = await rookCreate(cloud, CEPH_ROOK_STEVE.objectStoreUsers, req.body);
    res.status(201).json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStoreUserReplaceHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookReplace(
      cloud,
      CEPH_ROOK_STEVE.objectStoreUsers,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStoreUserPatchHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookPatchMerge(
      cloud,
      CEPH_ROOK_STEVE.objectStoreUsers,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookObjectStoreUserDeleteHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookDelete(
      cloud,
      CEPH_ROOK_STEVE.objectStoreUsers,
      req.params.namespace,
      req.params.name,
    );
    respondDelete(res, data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

// ---- CephBlockPoolRadosNamespace ----

export async function harvesterCephRookRadosNamespaceGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookGetOne(cloud, CEPH_ROOK_STEVE.radosNamespaces, req.params.namespace, req.params.name);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookRadosNamespaceCreateHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  try {
    const data = await rookCreate(cloud, CEPH_ROOK_STEVE.radosNamespaces, req.body);
    res.status(201).json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookRadosNamespaceReplaceHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookReplace(
      cloud,
      CEPH_ROOK_STEVE.radosNamespaces,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookRadosNamespacePatchHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookPatchMerge(
      cloud,
      CEPH_ROOK_STEVE.radosNamespaces,
      req.params.namespace,
      req.params.name,
      req.body,
    );
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

export async function harvesterCephRookRadosNamespaceDeleteHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookDelete(cloud, CEPH_ROOK_STEVE.radosNamespaces, req.params.namespace, req.params.name);
    respondDelete(res, data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}

// ---- CephRBDMirror（只读 GET：列表仍来自 bundle）----

export async function harvesterCephRookRbdMirrorGetHandler(req: Request, res: Response) {
  const cloud = (req as any).cloud;
  if (!ensureProvider(cloud, 'harvester', res, '仅支持 Harvester/Cloudmap 资源池')) return;
  if (!requireNsName(req, res)) return;
  try {
    const data = await rookGetOne(cloud, CEPH_ROOK_STEVE.rbdMirrors, req.params.namespace, req.params.name);
    res.json(data);
  } catch (e: any) {
    sendSteveErr(res, e);
  }
}
