/**
 * 自测 GET /api/clouds/:id/monitoring/ceph-dashboard/summary 核心逻辑：
 * 直连 DB 取第一条 Harvester/Cloudmap 云，调用 harvesterMonitoringCephDashboardSummaryHandler（与 HTTP 路由一致）。
 *
 * 用法（在 backend 目录）：
 *   npx ts-node --transpile-only src/scripts/cephDashboardSummarySelfTest.ts
 * 指定云 ID：
 *   npx ts-node --transpile-only src/scripts/cephDashboardSummarySelfTest.ts <cloudUuid>
 *
 * 仅替换代理根地址（仍用库中 Token/config），便于与 probe 同一 API 主机复测：
 *   set CEPH_SELFTEST_ORIGIN=https://10.2.200.101 && npm run ceph:dashboard-self-test
 *
 * 依赖：可连上该云的 endpoint；Token/忽略 TLS 以库中云配置为准。
 */
import 'reflect-metadata';
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { harvesterMonitoringCephDashboardSummaryHandler } from '../routes/clouds/harvester/handlers/monitoring-ceph-dashboard.handlers';

function normalizeProvider(cloud: Cloud): string | null {
  const provider = String((cloud as any)?.config?.provider || '').toLowerCase().trim();
  if (['harvester', 'cloudmap', 'cloudmap.private', 'cloudmap.edge', 'cloudmap.csm'].includes(provider)) {
    return provider;
  }
  return null;
}

function createMockRes(): Response & { __payload?: unknown; __status?: number } {
  const r: any = {
    headersSent: false,
    __payload: undefined as unknown,
    __status: 200,
    status(code: number) {
      this.__status = code;
      return this;
    },
    json(body: unknown) {
      this.__payload = body;
      return this;
    },
  };
  return r as Response & { __payload?: unknown; __status?: number };
}

async function main() {
  const argCloudId = process.argv[2]?.trim();

  await AppDataSource.initialize();
  try {
    const repo = AppDataSource.getRepository(Cloud);
    let cloud: Cloud | null = null;
    if (argCloudId) {
      cloud = await repo.findOne({ where: { id: argCloudId } });
      if (!cloud) {
        console.error(`未找到云 id=${argCloudId}`);
        process.exitCode = 2;
        return;
      }
      if (!normalizeProvider(cloud)) {
        console.error(`云 ${cloud.name} 的 provider 非 Harvester/Cloudmap，无法测 ceph-dashboard`);
        process.exitCode = 2;
        return;
      }
    } else {
      const all = await repo.find();
      cloud = all.find((c) => normalizeProvider(c) != null) ?? null;
      if (!cloud) {
        console.error('数据库中无 Harvester/Cloudmap 资源池，请先在界面录入云或传入 cloud UUID 参数');
        process.exitCode = 2;
        return;
      }
    }

    const provider = (cloud as any)?.config?.provider;
    console.log(`云: ${cloud.name} (${cloud.id}) provider=${provider}`);
    console.log(`endpoint: ${cloud.endpoint}`);

    const originOverride = process.env.CEPH_SELFTEST_ORIGIN?.trim();
    let cloudForReq: Cloud = cloud;
    if (originOverride) {
      cloudForReq = Object.assign(Object.create(Object.getPrototypeOf(cloud)), cloud, {
        endpoint: originOverride,
      });
      console.log(`CEPH_SELFTEST_ORIGIN 覆盖 endpoint: ${originOverride}`);
    }

    const req = {
      params: { id: cloud.id },
      query: {} as Record<string, string | undefined>,
      cloud: cloudForReq,
    } as unknown as Request;

    const res = createMockRes();
    await harvesterMonitoringCephDashboardSummaryHandler(req, res as Response);

    const payload = (res as any).__payload;
    const st = (res as any).__status ?? 200;
    console.log(`handler HTTP 状态: ${st}`);
    console.log(JSON.stringify(payload, null, 2));

    const tower = payload?._tower;
    const data = payload?.data;
    if (tower?.cephDashboardError && !data) {
      console.error('自测失败: Ceph Dashboard 未返回 data，见上文 _tower');
      process.exitCode = 1;
      return;
    }
    if (data && typeof data === 'object' && data !== null && 'health_status' in (data as object)) {
      console.log('自测通过: summary 含 health_status');
      process.exitCode = 0;
      return;
    }
    if (data != null) {
      console.log('自测通过: 已返回非空 data（字段可能与集群版本有关）');
      process.exitCode = 0;
      return;
    }
    console.error('自测失败: data 为空且无明确错误');
    process.exitCode = 1;
  } finally {
    await AppDataSource.destroy().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
