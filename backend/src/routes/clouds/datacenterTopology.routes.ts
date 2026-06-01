/**
 * Cloudmap 机房拓扑：机柜与柜内设备占位（Tower SQLite 持久化）。
 * 物理节点 / 交换机事实数据仍由既有 Harvester/ASW-CTL 接口提供，本模块仅存布局与自定义项。
 */
import { randomUUID } from 'crypto';
import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { Cloud } from '../../entities/Cloud';
import { AuthRequest } from '../../middleware/auth';
import { createApiPermissionMiddleware } from '../../permissions';

async function loadCloudOr404(id: string, res: Response): Promise<Cloud | null> {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) {
    res.status(404).json({ message: '云资源不存在' });
    return null;
  }
  return cloud;
}

type RackDeviceRow = {
  id: string;
  rackId: string;
  sourceKind: string;
  refKey: string | null;
  customLabel: string | null;
  slotOrder: number;
  createdAt: string;
  updatedAt: string;
};

type RackRow = {
  id: string;
  cloudId: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  devices: RackDeviceRow[];
};

async function listRacksWithDevices(cloudId: string): Promise<RackRow[]> {
  const racks: any[] = await AppDataSource.query(
    `SELECT * FROM cloud_datacenter_racks WHERE cloudId = ? ORDER BY sortOrder ASC, createdAt ASC`,
    [cloudId],
  );
  if (!Array.isArray(racks) || racks.length === 0) return [];
  const ids = racks.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const devs: any[] = await AppDataSource.query(
    `SELECT * FROM cloud_datacenter_rack_devices WHERE rackId IN (${placeholders}) ORDER BY slotOrder ASC, createdAt ASC`,
    ids,
  );
  const byRack = new Map<string, RackDeviceRow[]>();
  for (const d of Array.isArray(devs) ? devs : []) {
    const list = byRack.get(d.rackId) || [];
    list.push({
      id: d.id,
      rackId: d.rackId,
      sourceKind: d.sourceKind,
      refKey: d.refKey ?? null,
      customLabel: d.customLabel ?? null,
      slotOrder: Number(d.slotOrder) || 0,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });
    byRack.set(d.rackId, list);
  }
  return racks.map((r) => ({
    id: r.id,
    cloudId: r.cloudId,
    name: r.name,
    sortOrder: Number(r.sortOrder) || 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    devices: byRack.get(r.id) || [],
  }));
}

/** 挂载到主 clouds Router；必须在 `GET /:id` 之前注册。 */
export function attachDatacenterTopologyRoutes(router: Router) {
  const mw = createApiPermissionMiddleware();

  router.get('/:id/datacenter-topology/racks', mw, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      if (!(await loadCloudOr404(id, res))) return;
      const racks = await listRacksWithDevices(id);
      res.json({ message: 'ok', data: { racks } });
    } catch (e: any) {
      res.status(500).json({ message: '查询机柜失败', error: e?.message || String(e) });
    }
  });

  router.post('/:id/datacenter-topology/racks', mw, async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      if (!(await loadCloudOr404(id, res))) return;
      const name = String((req.body as any)?.name || '').trim();
      if (!name) return res.status(400).json({ message: '机柜名称不能为空' });
      const maxRow: any[] = await AppDataSource.query(
        `SELECT COALESCE(MAX(sortOrder), -1) as m FROM cloud_datacenter_racks WHERE cloudId = ?`,
        [id],
      );
      const defaultNext = Number(maxRow?.[0]?.m) + 1;
      const bodySort = (req.body as any)?.sortOrder;
      let sortOrder: number;
      if (bodySort !== undefined && bodySort !== null && String(bodySort).trim() !== '') {
        const n = Number(bodySort);
        sortOrder = Number.isFinite(n) ? Math.trunc(n) : defaultNext;
      } else {
        sortOrder = defaultNext;
      }
      const rid = randomUUID();
      await AppDataSource.query(
        `INSERT INTO cloud_datacenter_racks (id, cloudId, name, sortOrder) VALUES (?, ?, ?, ?)`,
        [rid, id, name, sortOrder],
      );
      const racks = await listRacksWithDevices(id);
      const created = racks.find((r) => r.id === rid);
      res.status(201).json({ message: '已创建', data: { rack: created } });
    } catch (e: any) {
      res.status(500).json({ message: '创建机柜失败', error: e?.message || String(e) });
    }
  });

  router.patch(
    '/:id/datacenter-topology/racks/:rackId',
    mw,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id, rackId } = req.params;
        if (!(await loadCloudOr404(id, res))) return;
        const rows: any[] = await AppDataSource.query(
          `SELECT id FROM cloud_datacenter_racks WHERE id = ? AND cloudId = ?`,
          [rackId, id],
        );
        if (!rows?.length) return res.status(404).json({ message: '机柜不存在' });
        const name = (req.body as any)?.name;
        const sortOrder = (req.body as any)?.sortOrder;
        if (name !== undefined) {
          const n = String(name || '').trim();
          if (!n) return res.status(400).json({ message: '机柜名称不能为空' });
          await AppDataSource.query(
            `UPDATE cloud_datacenter_racks SET name = ?, updatedAt = datetime('now') WHERE id = ?`,
            [n, rackId],
          );
        }
        if (sortOrder !== undefined) {
          await AppDataSource.query(
            `UPDATE cloud_datacenter_racks SET sortOrder = ?, updatedAt = datetime('now') WHERE id = ?`,
            [Number(sortOrder) || 0, rackId],
          );
        }
        const racks = await listRacksWithDevices(id);
        const rack = racks.find((r) => r.id === rackId);
        res.json({ message: '已更新', data: { rack } });
      } catch (e: any) {
        res.status(500).json({ message: '更新机柜失败', error: e?.message || String(e) });
      }
    },
  );

  router.delete(
    '/:id/datacenter-topology/racks/:rackId',
    mw,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id, rackId } = req.params;
        if (!(await loadCloudOr404(id, res))) return;
        const rows: any[] = await AppDataSource.query(
          `SELECT id FROM cloud_datacenter_racks WHERE id = ? AND cloudId = ?`,
          [rackId, id],
        );
        if (!rows?.length) return res.status(404).json({ message: '机柜不存在' });
        await AppDataSource.query(`DELETE FROM cloud_datacenter_rack_devices WHERE rackId = ?`, [
          rackId,
        ]);
        await AppDataSource.query(`DELETE FROM cloud_datacenter_racks WHERE id = ?`, [rackId]);
        res.json({ message: '已删除' });
      } catch (e: any) {
        res.status(500).json({ message: '删除机柜失败', error: e?.message || String(e) });
      }
    },
  );

  router.post(
    '/:id/datacenter-topology/racks/:rackId/devices',
    mw,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id, rackId } = req.params;
        if (!(await loadCloudOr404(id, res))) return;
        const rows: any[] = await AppDataSource.query(
          `SELECT id FROM cloud_datacenter_racks WHERE id = ? AND cloudId = ?`,
          [rackId, id],
        );
        if (!rows?.length) return res.status(404).json({ message: '机柜不存在' });
        const sourceKind = String((req.body as any)?.sourceKind || '').trim();
        if (!['node', 'switch', 'custom'].includes(sourceKind)) {
          return res.status(400).json({ message: 'sourceKind 须为 node | switch | custom' });
        }
        const refKey =
          (req.body as any)?.refKey !== undefined && (req.body as any)?.refKey !== null
            ? String((req.body as any).refKey).trim() || null
            : null;
        const customLabel =
          (req.body as any)?.customLabel !== undefined && (req.body as any)?.customLabel !== null
            ? String((req.body as any).customLabel).trim() || null
            : null;
        // 占位插板可不加名称，customLabel 为 null，前端用「自定义」等默认展示
        const slotOrder = Number((req.body as any)?.slotOrder);
        const sid = randomUUID();
        await AppDataSource.query(
          `INSERT INTO cloud_datacenter_rack_devices (id, rackId, sourceKind, refKey, customLabel, slotOrder) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            sid,
            rackId,
            sourceKind,
            refKey,
            customLabel,
            Number.isFinite(slotOrder) ? slotOrder : 0,
          ],
        );
        const racks = await listRacksWithDevices(id);
        const rack = racks.find((r) => r.id === rackId);
        const device = rack?.devices.find((d) => d.id === sid);
        res.status(201).json({ message: '已添加', data: { device } });
      } catch (e: any) {
        res.status(500).json({ message: '添加设备失败', error: e?.message || String(e) });
      }
    },
  );

  router.patch(
    '/:id/datacenter-topology/racks/:rackId/devices/:deviceId',
    mw,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id, rackId, deviceId } = req.params;
        if (!(await loadCloudOr404(id, res))) return;
        const dr: any[] = await AppDataSource.query(
          `SELECT d.id FROM cloud_datacenter_rack_devices d
           JOIN cloud_datacenter_racks r ON r.id = d.rackId
           WHERE d.id = ? AND d.rackId = ? AND r.cloudId = ?`,
          [deviceId, rackId, id],
        );
        if (!dr?.length) return res.status(404).json({ message: '设备不存在' });
        const slotOrder = (req.body as any)?.slotOrder;
        const customLabel = (req.body as any)?.customLabel;
        const refKey = (req.body as any)?.refKey;
        if (slotOrder !== undefined) {
          await AppDataSource.query(
            `UPDATE cloud_datacenter_rack_devices SET slotOrder = ?, updatedAt = datetime('now') WHERE id = ?`,
            [Number(slotOrder) || 0, deviceId],
          );
        }
        if (customLabel !== undefined) {
          await AppDataSource.query(
            `UPDATE cloud_datacenter_rack_devices SET customLabel = ?, updatedAt = datetime('now') WHERE id = ?`,
            [customLabel === null ? null : String(customLabel).trim() || null, deviceId],
          );
        }
        if (refKey !== undefined) {
          await AppDataSource.query(
            `UPDATE cloud_datacenter_rack_devices SET refKey = ?, updatedAt = datetime('now') WHERE id = ?`,
            [refKey === null ? null : String(refKey).trim() || null, deviceId],
          );
        }
        const racks = await listRacksWithDevices(id);
        const rack = racks.find((r) => r.id === rackId);
        const device = rack?.devices.find((d) => d.id === deviceId);
        res.json({ message: '已更新', data: { device } });
      } catch (e: any) {
        res.status(500).json({ message: '更新设备失败', error: e?.message || String(e) });
      }
    },
  );

  router.delete(
    '/:id/datacenter-topology/racks/:rackId/devices/:deviceId',
    mw,
    async (req: AuthRequest, res: Response) => {
      try {
        const { id, rackId, deviceId } = req.params;
        if (!(await loadCloudOr404(id, res))) return;
        const dr: any[] = await AppDataSource.query(
          `SELECT d.id FROM cloud_datacenter_rack_devices d
           JOIN cloud_datacenter_racks r ON r.id = d.rackId
           WHERE d.id = ? AND d.rackId = ? AND r.cloudId = ?`,
          [deviceId, rackId, id],
        );
        if (!dr?.length) return res.status(404).json({ message: '设备不存在' });
        await AppDataSource.query(`DELETE FROM cloud_datacenter_rack_devices WHERE id = ?`, [
          deviceId,
        ]);
        res.json({ message: '已删除' });
      } catch (e: any) {
        res.status(500).json({ message: '删除设备失败', error: e?.message || String(e) });
      }
    },
  );
}
