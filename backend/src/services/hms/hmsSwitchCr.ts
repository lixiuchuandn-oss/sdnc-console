import { getJsonOnce, requestJson, resolveHarvesterCloudKubeToken } from '../clouds/harvester/utils';

export const HMS_SWITCH_API_GROUP = 'hms.rivercloud.com';
export const HMS_SWITCH_API_VERSION = 'v1';
export const HMS_SWITCH_KIND = 'Switch';
export const HMS_SWITCH_PLURAL = 'switches';

export type HmsSwitchCrSpecInput = {
  hosts?: string[];
  primaryHost?: string;
  user?: string;
  port?: number;
  password?: string;
  vendor?: string;
  deviceProfile?: string;
  infoCommands?: string[];
  interfaceCommands?: string[];
  performanceCommands?: string[];
  vlanCommands?: string[];
  corsAllowedOrigins?: string[];
  dialTimeout?: number;
  execTimeout?: number;
};

export type HmsSwitchCrBody = {
  name: string;
  spec: HmsSwitchCrSpecInput;
};

function harvesterApiRoots(endpoint: string): string[] {
  const base = String(endpoint || '').trim().replace(/\/+$/, '');
  if (!base) return [];

  let origin = base;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}`;
  } catch {
    origin = base.replace(/\/v[0-9].*$/, '');
  }

  const roots = new Set<string>();
  roots.add(origin);
  if (!base.includes('/k8s/clusters/')) {
    const stripped = base.replace(/\/v[0-9]+(\/harvester)?$/, '');
    roots.add(`${stripped}/k8s/clusters/local`);
  }
  return Array.from(roots);
}

export function hmsSwitchCrCollectionPath(): string {
  return `/apis/${HMS_SWITCH_API_GROUP}/${HMS_SWITCH_API_VERSION}/${HMS_SWITCH_PLURAL}`;
}

export function hmsSwitchCrItemPath(name: string): string {
  return `${hmsSwitchCrCollectionPath()}/${encodeURIComponent(String(name || '').trim())}`;
}

function buildCandidateUrls(endpoint: string, pathSuffix: string): string[] {
  const seg = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`;
  return harvesterApiRoots(endpoint).map((root) => `${root.replace(/\/+$/, '')}${seg}`);
}

function normalizeStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
}

function normalizeCommandList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x ?? '').trim());
}

export function buildHmsSwitchCrManifest(name: string, specInput: HmsSwitchCrSpecInput) {
  const nameTrim = String(name || '').trim();
  const primaryHost = String(specInput.primaryHost || '').trim();
  const hostsRaw = normalizeStringList(specInput.hosts);
  const hosts = hostsRaw.length > 0 ? hostsRaw : primaryHost ? [primaryHost] : [];
  const portNum = Number(specInput.port);
  const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 22;
  const dialTimeoutNum = Number(specInput.dialTimeout);
  const execTimeoutNum = Number(specInput.execTimeout);
  const dialTimeout =
    Number.isFinite(dialTimeoutNum) && dialTimeoutNum > 0 ? dialTimeoutNum : 15;
  const execTimeout =
    Number.isFinite(execTimeoutNum) && execTimeoutNum > 0 ? execTimeoutNum : 15;

  const spec: Record<string, unknown> = {
    hosts,
    primaryHost: primaryHost || hosts[0] || '',
    user: String(specInput.user || 'root').trim() || 'root',
    port,
    vendor: String(specInput.vendor || '').trim(),
    deviceProfile: String(specInput.deviceProfile || '').trim(),
    dialTimeout,
    execTimeout,
    infoCommands: normalizeCommandList(specInput.infoCommands),
    interfaceCommands: normalizeCommandList(specInput.interfaceCommands),
    performanceCommands: normalizeCommandList(specInput.performanceCommands),
    vlanCommands: normalizeCommandList(specInput.vlanCommands),
    corsAllowedOrigins: normalizeStringList(specInput.corsAllowedOrigins),
  };

  if (specInput.password != null && String(specInput.password).length > 0) {
    spec.password = String(specInput.password);
  }

  if (!spec.corsAllowedOrigins || (spec.corsAllowedOrigins as string[]).length === 0) {
    spec.corsAllowedOrigins = ['*'];
  }

  return {
    apiVersion: `${HMS_SWITCH_API_GROUP}/${HMS_SWITCH_API_VERSION}`,
    kind: HMS_SWITCH_KIND,
    metadata: { name: nameTrim },
    spec,
  };
}

export function redactHmsSwitchCr(item: any): any {
  if (!item || typeof item !== 'object') return item;
  const clone = JSON.parse(JSON.stringify(item));
  if (clone.spec && typeof clone.spec === 'object' && 'password' in clone.spec) {
    clone.spec.password = clone.spec.password ? '******' : '';
    clone.spec.passwordConfigured = !!item.spec?.password;
  }
  return clone;
}

async function requestFirstOk<T>(
  urls: string[],
  token: string,
  insecure: boolean,
  fn: (url: string) => Promise<T>,
): Promise<T> {
  let lastErr: any = null;
  for (const url of urls) {
    try {
      return await fn(url);
    } catch (e: any) {
      lastErr = e;
      if (e?.status === 404) continue;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('HMS Switch CR API 不可用');
}

export async function listHmsSwitchCrs(cloud: {
  endpoint?: string;
  secretKey?: string | null;
  config?: any;
}): Promise<any[]> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = buildCandidateUrls(String(cloud.endpoint || ''), hmsSwitchCrCollectionPath());

  const data = await requestFirstOk(urls, token, insecure, (url) =>
    getJsonOnce(url, token, insecure, true),
  );

  const items = Array.isArray(data?.items) ? data.items : [];
  return items.map(redactHmsSwitchCr);
}

export async function getHmsSwitchCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = buildCandidateUrls(String(cloud.endpoint || ''), hmsSwitchCrItemPath(name));

  const data = await requestFirstOk(urls, token, insecure, (url) =>
    getJsonOnce(url, token, insecure, true),
  );
  return redactHmsSwitchCr(data);
}

export async function createHmsSwitchCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  body: HmsSwitchCrBody,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const manifest = buildHmsSwitchCrManifest(body.name, body.spec);
  if (!manifest.metadata.name) {
    throw Object.assign(new Error('缺少 Switch 名称'), { status: 400 });
  }
  if (!manifest.spec.primaryHost) {
    throw Object.assign(new Error('缺少 primaryHost / 管理地址'), { status: 400 });
  }
  if (!manifest.spec.password) {
    throw Object.assign(new Error('创建 Switch 须填写 SSH 密码'), { status: 400 });
  }

  const urls = buildCandidateUrls(String(cloud.endpoint || ''), hmsSwitchCrCollectionPath());
  const data = await requestFirstOk(urls, token, insecure, (url) =>
    requestJson('POST', url, token, insecure, manifest),
  );
  return redactHmsSwitchCr(data);
}

export async function updateHmsSwitchCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
  body: { spec: HmsSwitchCrSpecInput },
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const nameTrim = String(name || '').trim();
  const urls = buildCandidateUrls(String(cloud.endpoint || ''), hmsSwitchCrItemPath(nameTrim));

  const existing = await requestFirstOk(urls, token, insecure, (url) =>
    getJsonOnce(url, token, insecure, true),
  );

  const mergedSpec: HmsSwitchCrSpecInput = {
    ...(existing?.spec || {}),
    ...body.spec,
  };
  if (!body.spec.password) {
    mergedSpec.password = existing?.spec?.password;
  }

  const manifest = {
    ...existing,
    apiVersion: `${HMS_SWITCH_API_GROUP}/${HMS_SWITCH_API_VERSION}`,
    kind: HMS_SWITCH_KIND,
    metadata: {
      ...(existing?.metadata || {}),
      name: nameTrim,
    },
    spec: buildHmsSwitchCrManifest(nameTrim, mergedSpec).spec,
  };

  const data = await requestFirstOk(urls, token, insecure, (url) =>
    requestJson('PUT', url, token, insecure, manifest),
  );
  return redactHmsSwitchCr(data);
}

export async function deleteHmsSwitchCr(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<void> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = buildCandidateUrls(String(cloud.endpoint || ''), hmsSwitchCrItemPath(name));

  await requestFirstOk(urls, token, insecure, (url) =>
    requestJson('DELETE', url, token, insecure).then(() => undefined),
  );
}
