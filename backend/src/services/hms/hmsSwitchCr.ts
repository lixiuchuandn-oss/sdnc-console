import {
  getJsonOnce,
  requestJson,
  resolveHarvesterCloudKubeToken,
} from '../clouds/harvester/utils';

export const HMS_SWITCH_API_GROUP = 'hms.rivercloud.com';
export const HMS_SWITCH_API_VERSION = 'v1';
export const HMS_SWITCH_KIND = 'Switch';
export const HMS_SWITCH_PLURAL = 'switches';

export const HMS_SWITCH_DEVICE_PROFILE_GENERIC = 'generic';

function normalizeHmsDeviceProfileForCr(value?: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return HMS_SWITCH_DEVICE_PROFILE_GENERIC;
  const lower = raw.toLowerCase();
  if (lower === 'default' || lower === 'generit' || lower === 'generic') {
    return HMS_SWITCH_DEVICE_PROFILE_GENERIC;
  }
  return raw;
}

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
  /** 会话内关闭 CLI 分页；留空则 HSM 使用 deviceProfile 默认 */
  screenLengthCmd?: string;
};

export type HmsSwitchCrBody = {
  name: string;
  spec: HmsSwitchCrSpecInput;
};

function harvesterApiRoots(endpoint: string): string[] {
  const base = String(endpoint || '')
    .trim()
    .replace(/\/+$/, '');
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
  return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
}

/** 合并误拆的管道 CLI（与前端 hmsSwitchCrForm.normalizeCliCommandLines 一致） */
function normalizeCliCommandLines(text: string): string[] {
  const raw = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of raw) {
    const prev = out.length > 0 ? out[out.length - 1]! : '';
    const continuesPipe =
      out.length > 0 &&
      (/^\|/.test(line) || /^include\b/i.test(line) || /\|\s*$/.test(prev));
    if (continuesPipe) {
      const joined = `${prev} ${line}`.replace(/\|\s+/g, '| ').replace(/\s+/g, ' ').trim();
      out[out.length - 1] = joined;
      continue;
    }
    out.push(line);
  }
  return out;
}

function normalizeCommandList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const merged = normalizeCliCommandLines(raw.map((x) => String(x ?? '').trim()).join('\n'));
  return merged.length > 0 ? merged : raw.map((x) => String(x ?? '').trim()).filter(Boolean);
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
  const dialTimeout = Number.isFinite(dialTimeoutNum) && dialTimeoutNum > 0 ? dialTimeoutNum : 15;
  const execTimeout = Number.isFinite(execTimeoutNum) && execTimeoutNum > 0 ? execTimeoutNum : 15;

  const spec: Record<string, unknown> = {
    hosts,
    primaryHost: primaryHost || hosts[0] || '',
    user: String(specInput.user || 'root').trim() || 'root',
    port,
    vendor: String(specInput.vendor || '').trim(),
    deviceProfile: normalizeHmsDeviceProfileForCr(specInput.deviceProfile),
    dialTimeout,
    execTimeout,
    infoCommands: normalizeCommandList(specInput.infoCommands),
    interfaceCommands: normalizeCommandList(specInput.interfaceCommands),
    performanceCommands: normalizeCommandList(specInput.performanceCommands),
    vlanCommands: normalizeCommandList(specInput.vlanCommands),
    corsAllowedOrigins: normalizeStringList(specInput.corsAllowedOrigins),
  };

  const screenLengthCmd = String(specInput.screenLengthCmd ?? '').trim();
  if (screenLengthCmd) {
    spec.screenLengthCmd = screenLengthCmd;
  }

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
  const item = await getHmsSwitchCrRaw(cloud, name);
  return redactHmsSwitchCr(item);
}

/** 读取 Switch CR 原文（含 password），仅用于服务端发起 SSH */
export async function getHmsSwitchCrRaw(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<any> {
  const token = resolveHarvesterCloudKubeToken(cloud);
  const insecure = !!cloud.config?.ignoreTls;
  const urls = buildCandidateUrls(String(cloud.endpoint || ''), hmsSwitchCrItemPath(name));

  return requestFirstOk(urls, token, insecure, (url) =>
    getJsonOnce(url, token, insecure, true),
  );
}

export type HmsSwitchSshConnectParams = {
  configName: string;
  host: string;
  port: number;
  username: string;
  password: string;
};

export async function buildHmsSwitchSshConnectParams(
  cloud: { endpoint?: string; secretKey?: string | null; config?: any },
  name: string,
): Promise<HmsSwitchSshConnectParams> {
  const nameTrim = String(name || '').trim();
  if (!nameTrim) {
    throw Object.assign(new Error('缺少 Switch 名称'), { status: 400 });
  }
  const item = await getHmsSwitchCrRaw(cloud, nameTrim);
  const spec = item?.spec && typeof item.spec === 'object' ? item.spec : {};
  const hosts = Array.isArray(spec.hosts) ? spec.hosts.map(String).filter(Boolean) : [];
  const primaryHost = String(spec.primaryHost || hosts[0] || '').trim();
  if (!primaryHost) {
    throw Object.assign(new Error('Switch 未配置管理地址'), { status: 400 });
  }
  const password = spec.password != null ? String(spec.password) : '';
  if (!password) {
    throw Object.assign(
      new Error('Switch CR 未配置 SSH 密码，请先在「编辑交换机」中填写密码'),
      { status: 400 },
    );
  }
  const portNum = Number(spec.port);
  const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 22;
  const username = String(spec.user || 'root').trim() || 'root';

  return {
    configName: nameTrim,
    host: primaryHost,
    port,
    username,
    password,
  };
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
  if (Object.prototype.hasOwnProperty.call(body.spec, 'screenLengthCmd')) {
    const cmd = String(body.spec.screenLengthCmd ?? '').trim();
    if (cmd) mergedSpec.screenLengthCmd = cmd;
    else delete mergedSpec.screenLengthCmd;
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
