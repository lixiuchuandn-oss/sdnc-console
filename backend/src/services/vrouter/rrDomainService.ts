import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { RrDomain } from '../../entities/vRouter/RrDomain';
import { RrDomainNode } from '../../entities/vRouter/RrDomainNode';
import { SRv6Tunnel } from '../../entities/vRouter/SRv6Tunnel';
import type {
  RrDomainNodeInput,
  RrDomainNodeView,
  RrDomainSource,
  RrDomainStatus,
  RrDomainUpsertInput,
  RrDomainView,
} from '../../entities/vRouter/rrDomain.types';

export class RrDomainError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RrDomainError';
    this.statusCode = statusCode;
  }
}

const slugPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function domainRepo() {
  return AppDataSource.getRepository(RrDomain);
}

function nodeRepo() {
  return AppDataSource.getRepository(RrDomainNode);
}

function tunnelRepo() {
  return AppDataSource.getRepository(SRv6Tunnel);
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function validateNodes(nodes: RrDomainNodeInput[]) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new RrDomainError('至少需要一个 RR 节点');
  }
  const rrNames = new Set<string>();
  const addresses = new Set<string>();
  nodes.forEach((n, idx) => {
    const rrName = normalizeText(n.rrName);
    const addr = normalizeText(n.neighborAddress);
    if (!rrName) throw new RrDomainError(`节点 ${idx + 1}：RR名称不能为空`);
    if (!addr) throw new RrDomainError(`节点 ${idx + 1}：邻居地址不能为空`);
    if (rrNames.has(rrName)) throw new RrDomainError(`RR 名称重复：${rrName}`);
    if (addresses.has(addr.toLowerCase())) throw new RrDomainError(`邻居地址重复：${addr}`);
    rrNames.add(rrName);
    addresses.add(addr.toLowerCase());
  });
}

function toNodeView(node: RrDomainNode): RrDomainNodeView {
  return {
    id: node.id,
    rrName: node.rrName,
    neighborAddress: node.neighborAddress,
    remoteAs: node.remoteAs ?? null,
    localAs: node.localAs ?? null,
    clusterId: node.clusterId ?? null,
    routerIdHint: node.routerIdHint ?? null,
    priority: node.priority,
    remark: node.remark ?? null,
    sortOrder: node.sortOrder,
  };
}

function toDomainView(domain: RrDomain): RrDomainView {
  const nodes = [...(domain.nodes || [])].sort(
    (a, b) => a.priority - b.priority || a.sortOrder - b.sortOrder,
  );
  return {
    id: domain.id,
    name: domain.name,
    displayName: domain.displayName,
    description: domain.description ?? null,
    remoteAs: domain.remoteAs,
    localAs: domain.localAs ?? null,
    source: domain.source,
    status: domain.status,
    nodes: nodes.map(toNodeView),
    createdAt: domain.createdAt.toISOString(),
    updatedAt: domain.updatedAt.toISOString(),
  };
}

async function loadDomainWithNodes(id: string): Promise<RrDomain> {
  const domain = await domainRepo().findOne({
    where: { id },
    relations: ['nodes'],
  });
  if (!domain) throw new RrDomainError('RR 反射域不存在', 404);
  return domain;
}

async function assertNotReferenced(domainId: string) {
  const ref = await tunnelRepo().findOne({
    where: [{ peARrDomainId: domainId }, { peBRrDomainId: domainId }],
  });
  if (ref) {
    throw new RrDomainError(`RR 反射域已被 SRv6 隧道引用：${ref.name}`, 409);
  }
}

function buildNodeEntities(domainId: string, nodes: RrDomainNodeInput[]): RrDomainNode[] {
  return nodes.map((n, idx) =>
    nodeRepo().create({
      domainId,
      rrName: normalizeText(n.rrName),
      neighborAddress: normalizeText(n.neighborAddress),
      remoteAs: n.remoteAs ?? null,
      localAs: n.localAs ?? null,
      clusterId: n.clusterId ?? null,
      routerIdHint: n.routerIdHint ?? null,
      priority: n.priority ?? 1,
      remark: n.remark ?? null,
      sortOrder: n.sortOrder ?? idx,
    }),
  );
}

async function replaceNodes(domainId: string, nodes: RrDomainNodeInput[]) {
  await nodeRepo().delete({ domainId });
  const entities = buildNodeEntities(domainId, nodes);
  await nodeRepo().save(entities);
}

export const rrDomainService = {
  async list(opts?: { status?: RrDomainStatus }): Promise<RrDomainView[]> {
    const where = opts?.status ? { status: opts.status } : {};
    const rows = await domainRepo().find({
      where,
      relations: ['nodes'],
      order: { updatedAt: 'DESC' },
    });
    return rows.map(toDomainView);
  },

  async getById(id: string): Promise<RrDomainView> {
    const domain = await loadDomainWithNodes(id);
    return toDomainView(domain);
  },

  async getByName(name: string): Promise<RrDomainView | null> {
    const slug = normalizeText(name);
    if (!slug) return null;
    const domain = await domainRepo().findOne({ where: { name: slug }, relations: ['nodes'] });
    return domain ? toDomainView(domain) : null;
  },

  async create(input: {
    name: string;
    displayName: string;
    description?: string | null;
    remoteAs: number;
    localAs?: number | null;
    source?: RrDomainSource;
    status?: RrDomainStatus;
    nodes: RrDomainNodeInput[];
  }): Promise<RrDomainView> {
    const name = normalizeText(input.name);
    const displayName = normalizeText(input.displayName);
    if (!name || !slugPattern.test(name)) throw new RrDomainError('域标识格式无效');
    if (!displayName) throw new RrDomainError('域名称不能为空');
    if (!Number.isInteger(input.remoteAs) || input.remoteAs <= 0) {
      throw new RrDomainError('域级对端 ASN 无效');
    }
    validateNodes(input.nodes);

    const dup = await domainRepo().findOne({ where: { name } });
    if (dup) throw new RrDomainError(`域标识已存在：${name}`, 409);

    const entity = domainRepo().create({
      name,
      displayName,
      description: input.description ?? null,
      remoteAs: input.remoteAs,
      localAs: input.localAs ?? null,
      source: input.source ?? 'manual',
      status: input.status ?? 'active',
    });
    const saved = await domainRepo().save(entity);
    await replaceNodes(saved.id, input.nodes);
    return this.getById(saved.id);
  },

  async update(
    id: string,
    patch: {
      displayName?: string;
      description?: string | null;
      remoteAs?: number;
      localAs?: number | null;
      status?: RrDomainStatus;
      nodes?: RrDomainNodeInput[];
    },
  ): Promise<RrDomainView> {
    const domain = await loadDomainWithNodes(id);
    if (patch.displayName !== undefined) {
      const displayName = normalizeText(patch.displayName);
      if (!displayName) throw new RrDomainError('域名称不能为空');
      domain.displayName = displayName;
    }
    if (patch.description !== undefined) domain.description = patch.description ?? null;
    if (patch.remoteAs !== undefined) {
      if (!Number.isInteger(patch.remoteAs) || patch.remoteAs <= 0) {
        throw new RrDomainError('域级对端 ASN 无效');
      }
      domain.remoteAs = patch.remoteAs;
    }
    if (patch.localAs !== undefined) domain.localAs = patch.localAs ?? null;
    if (patch.status !== undefined) domain.status = patch.status;
    await domainRepo().save(domain);

    if (patch.nodes !== undefined) {
      validateNodes(patch.nodes);
      await replaceNodes(domain.id, patch.nodes);
    }
    return this.getById(domain.id);
  },

  async remove(id: string): Promise<void> {
    await loadDomainWithNodes(id);
    await assertNotReferenced(id);
    await domainRepo().delete({ id });
  },

  async upsertByName(input: RrDomainUpsertInput): Promise<RrDomainView> {
    const existing = await domainRepo().findOne({ where: { name: input.name } });
    if (existing) {
      return this.update(existing.id, {
        displayName: input.displayName,
        description: input.description ?? null,
        remoteAs: input.remoteAs,
        localAs: input.localAs ?? null,
        status: input.status ?? 'active',
        nodes: input.nodes,
      });
    }
    return this.create(input);
  },

  async importUpsert(inputs: RrDomainUpsertInput[]): Promise<RrDomainView[]> {
    const results: RrDomainView[] = [];
    for (const input of inputs) {
      results.push(await this.upsertByName(input));
    }
    return results;
  },

  async resolveActiveDomainsByIds(ids: string[]): Promise<Map<string, RrDomainView>> {
    const uniq = [...new Set(ids.map((id) => normalizeText(id)).filter(Boolean))];
    if (uniq.length === 0) return new Map();
    const rows = await domainRepo().find({
      where: { id: In(uniq), status: 'active' },
      relations: ['nodes'],
    });
    const map = new Map<string, RrDomainView>();
    rows.forEach((r) => map.set(r.id, toDomainView(r)));
    return map;
  },
};

export type { RrDomainView, RrDomainNodeView };
