import net from 'net';
import {
  RR_DOMAIN_IMPORT_COLUMNS,
  type RrDomainImportPreview,
  type RrDomainImportPreviewDomain,
  type RrDomainNodeInput,
  type RrDomainUpsertInput,
} from '../../entities/vRouter/rrDomain.types';

const normalizeText = (value: unknown) => String(value ?? '').trim();

const parseOptionalInt = (value: unknown): number | null | undefined => {
  const t = normalizeText(value);
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

const isValidIp = (value: string): boolean => {
  const v = normalizeText(value);
  if (!v) return false;
  return net.isIP(v) === 4 || net.isIP(v) === 6;
};

/** 简易 CSV 行解析（支持引号内逗号） */
export const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => normalizeText(c)));
};

const rowToRecord = (headers: string[], cells: string[]): Record<string, string> => {
  const rec: Record<string, string> = {};
  headers.forEach((h, idx) => {
    rec[h] = cells[idx] ?? '';
  });
  return rec;
};

const slugPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export const parseRrDomainImportCsv = (csvText: string): RrDomainImportPreview => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows = parseCsvRows(csvText.replace(/^\uFEFF/, ''));
  if (rows.length === 0) {
    return { domains: [], errors: ['文件为空'], warnings };
  }

  const headers = rows[0].map((h) => normalizeText(h));
  for (const col of RR_DOMAIN_IMPORT_COLUMNS) {
    if (!headers.includes(col)) {
      errors.push(`缺少列：${col}`);
    }
  }
  if (errors.length > 0) {
    return { domains: [], errors, warnings };
  }

  const domainMap = new Map<string, RrDomainImportPreviewDomain>();
  const domainFieldSnapshots = new Map<string, string>();
  const rrNameSeen = new Set<string>();
  const neighborSeen = new Set<string>();

  for (let i = 1; i < rows.length; i += 1) {
    const rec = rowToRecord(headers, rows[i]);
    const lineNo = i + 1;
    const name = normalizeText(rec['域标识']);
    const displayName = normalizeText(rec['域名称']);
    const neighborAddress = normalizeText(rec['邻居地址']);
    const rrName = normalizeText(rec['RR名称']);

    if (!name) {
      errors.push(`第 ${lineNo} 行：域标识不能为空`);
      continue;
    }
    if (!slugPattern.test(name)) {
      errors.push(`第 ${lineNo} 行：域标识格式无效（${name}）`);
      continue;
    }
    if (!displayName) {
      errors.push(`第 ${lineNo} 行：域名称不能为空`);
      continue;
    }
    if (!rrName) {
      errors.push(`第 ${lineNo} 行：RR名称不能为空`);
      continue;
    }
    if (!neighborAddress || !isValidIp(neighborAddress)) {
      errors.push(`第 ${lineNo} 行：邻居地址无效（${neighborAddress || '空'}）`);
      continue;
    }

    const remoteAs = parseOptionalInt(rec['域级对端ASN']);
    if (remoteAs === null) {
      errors.push(`第 ${lineNo} 行：域级对端ASN 无效`);
      continue;
    }
    if (remoteAs === undefined) {
      errors.push(`第 ${lineNo} 行：域级对端ASN 不能为空`);
      continue;
    }

    const localAs = parseOptionalInt(rec['域级本端ASN']);
    if (localAs === null) {
      errors.push(`第 ${lineNo} 行：域级本端ASN 无效`);
      continue;
    }

    const nodeRemoteAs = parseOptionalInt(rec['对端ASN']);
    if (nodeRemoteAs === null) {
      errors.push(`第 ${lineNo} 行：对端ASN 无效`);
      continue;
    }
    const nodeLocalAs = parseOptionalInt(rec['本端ASN']);
    if (nodeLocalAs === null) {
      errors.push(`第 ${lineNo} 行：本端ASN 无效`);
      continue;
    }

    const priorityRaw = parseOptionalInt(rec['优先级']);
    const priority = priorityRaw === undefined || priorityRaw === null ? 1 : priorityRaw;

    const rrKey = `${name}::${rrName}`;
    if (rrNameSeen.has(rrKey)) {
      errors.push(`第 ${lineNo} 行：域 ${name} 下 RR 名称重复（${rrName}）`);
      continue;
    }
    rrNameSeen.add(rrKey);

    const nbrKey = `${name}::${neighborAddress.toLowerCase()}`;
    if (neighborSeen.has(nbrKey)) {
      errors.push(`第 ${lineNo} 行：域 ${name} 下邻居地址重复（${neighborAddress}）`);
      continue;
    }
    neighborSeen.add(nbrKey);

    const domainFieldsKey = JSON.stringify({
      displayName,
      description: normalizeText(rec['域备注']) || null,
      remoteAs,
      localAs: localAs ?? null,
    });
    const prevSnap = domainFieldSnapshots.get(name);
    if (prevSnap && prevSnap !== domainFieldsKey) {
      warnings.push(`域 ${name} 多行域级字段不一致，导入将以首行为准`);
    } else if (!prevSnap) {
      domainFieldSnapshots.set(name, domainFieldsKey);
    }

    let domain = domainMap.get(name);
    if (!domain) {
      domain = {
        name,
        displayName,
        description: normalizeText(rec['域备注']) || null,
        remoteAs,
        localAs: localAs ?? null,
        nodes: [],
        domainFieldWarnings: [],
      };
      domainMap.set(name, domain);
    }

    const node: RrDomainNodeInput = {
      rrName,
      neighborAddress,
      remoteAs: nodeRemoteAs ?? null,
      localAs: nodeLocalAs ?? null,
      clusterId: normalizeText(rec['ClusterID']) || null,
      routerIdHint: normalizeText(rec['RouterID']) || null,
      priority,
      remark: normalizeText(rec['备注']) || null,
      sortOrder: domain.nodes.length,
    };
    domain.nodes.push(node);
  }

  if (domainMap.size === 0 && errors.length === 0) {
    errors.push('未解析到有效数据行');
  }

  for (const d of domainMap.values()) {
    if (d.nodes.length === 0) {
      errors.push(`域 ${d.name} 无 RR 节点`);
    }
  }

  return {
    domains: Array.from(domainMap.values()),
    errors,
    warnings,
  };
};

export const previewToUpsertInputs = (
  preview: RrDomainImportPreview,
): RrDomainUpsertInput[] =>
  preview.domains.map((d) => ({
    name: d.name,
    displayName: d.displayName,
    description: d.description,
    remoteAs: d.remoteAs,
    localAs: d.localAs,
    source: 'excel_import' as const,
    status: 'active' as const,
    nodes: d.nodes,
  }));
