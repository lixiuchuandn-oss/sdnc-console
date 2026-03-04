import yaml from 'js-yaml';
import { fetchConfigMap } from '../../../../../services/monitoringApi';
import {
  DINGTALK_CONFIGMAP_NAME,
  DINGTALK_CONFIGMAP_NAMESPACE,
  DINGTALK_RECEIVER,
  EMAIL_RECEIVER,
  WEBSITE_RECEIVER,
} from '../context/MonitoringContext';

/** 与后端一致的接收器名称：email-receiver | dingtalk-receiver | website-receiver */
export type ReceiverName = typeof EMAIL_RECEIVER | typeof DINGTALK_RECEIVER | typeof WEBSITE_RECEIVER;

/** 钉钉 Webhook ConfigMap 中 config.yaml 的 targets 结构（机器人账号名 -> { url, message? }） */
export interface DingtalkWebhookConfig {
  [targetName: string]: {
    url: string;
    message?: string;
  };
}

/** UI 层与 ReceiverName 一致 */
export type ReceiverUIType = ReceiverName;

/** 通知方式下拉选项，value 为 receiverName */
export const RECEIVER_NAME_OPTIONS: { value: ReceiverName; label: string }[] = [
  { value: EMAIL_RECEIVER, label: '邮件' },
  { value: DINGTALK_RECEIVER, label: '钉钉' },
  { value: WEBSITE_RECEIVER, label: '站内信' },
];

/** 扁平化後的單條接收器（用於列表與下拉選項） */
export interface FlattenedReceiver {
  namespace: string;
  /** AlertmanagerConfig.metadata.name，对应 email-receiver | dingtalk-receiver */
  receiverName: string;
  /** spec.receivers[].name，具体接收器条目名 */
  specReceiverName: string;
  receiverSpec: ReceiverSpec;
}

/** AlertmanagerConfig spec.receivers[] 單項結構（與 Harvester/CRD 一致） */
export interface ReceiverSpec {
  name: string; // 通知对象名称
  emailConfigs?: Array<{
    to?: string;
    from?: string;
    smarthost?: string;
    authUsername?: string;
    /** 仅支持通过 Secret 引用：{ name: Secret名称, key: Secret内键名 }，不传明文密码 */
    authPassword?: { name: string; key: string };
    requireTLS?: boolean;
    tlsConfig?: Record<string, unknown>;
    sendResolved?: boolean;
  }>;
  webhookConfigs?: Array<{
    url?: string
    robotAccount?: string;
    robotAccessToken?: string;
    robotUrl?: string;
    sendResolved?: boolean;
  }>;
}

const DINGTALK_WEBHOOK_ERROR_NO_CONFIG = '请先添加dingtalk webhook配置文件';
const DINGTALK_WEBHOOK_ERROR_BAD_FORMAT = 'dingtalk webhook配置文件格式不对';

export type ParseDingtalkWebhookConfigResult =
  | { ok: true; config: DingtalkWebhookConfig }
  | { ok: false; error: string };

const getDingtalkWebhookUrl = (name: string): string =>
  'http://' + DINGTALK_CONFIGMAP_NAME + ':8060/dingtalk/' + name + '/send';

/**
 * 从钉钉 Webhook ConfigMap 的 API 响应中解析 config.yaml，返回 targets 为 DingtalkWebhookConfig。
 * 入参为 GET /monitoring/configmaps/:namespace/:name 的响应体。
 * 解析异常时返回 { ok: false, error: 'dingtalk webhook配置文件格式不对' }。
 */
export function parseDingtalkWebhookConfigFromConfigMap(configMapResponse: unknown): ParseDingtalkWebhookConfigResult {
  const out: DingtalkWebhookConfig = {};
  const raw = configMapResponse as any;
  const resource = raw?.data != null && typeof raw.data === 'object' ? raw.data : raw;
  const data =
    resource?.data != null && typeof resource.data === 'object'
      ? resource.data
      : typeof resource === 'object' && resource !== null
        ? resource
        : {};
  const configYaml = (data['config.yaml'] ?? data['config.yml'] ?? '').toString();
  if (!configYaml || typeof configYaml !== 'string') {
    return { ok: false, error: DINGTALK_WEBHOOK_ERROR_BAD_FORMAT };
  }
  try {
    const parsed = yaml.load(configYaml) as { targets?: Record<string, { url?: string; message?: string }> } | undefined;
    const targets = parsed?.targets;
    if (targets && typeof targets === 'object' && !Array.isArray(targets)) {
      for (const [name, t] of Object.entries(targets)) {
        if (!t || typeof t !== 'object') continue;
        const url = typeof (t as any).url === 'string' ? (t as any).url : '';
        const message = typeof (t as any).message === 'string' ? (t as any).message : undefined;
        out[name] = { url, ...(message !== undefined ? { message } : {}) };
      }
    }
    return { ok: true, config: out };
  } catch {
    return { ok: false, error: DINGTALK_WEBHOOK_ERROR_BAD_FORMAT };
  }
}

/**
 * 请求 alertmanager-webhook-dingtalk ConfigMap 并解析为 DingtalkWebhookConfig。
 * ConfigMap 不存在时返回 { ok: false, error: '请先添加dingtalk webhook配置文件' }；
 * 解析异常时返回 { ok: false, error: 'dingtalk webhook配置文件格式不对' }。
 */
export async function fetchDingtalkWebhookConfig(
  cloudId: string,
  options?: { signal?: AbortSignal }
): Promise<ParseDingtalkWebhookConfigResult> {
  const { data, ok } = await fetchConfigMap(
    cloudId,
    DINGTALK_CONFIGMAP_NAMESPACE,
    DINGTALK_CONFIGMAP_NAME,
    options
  );
  if (!ok || data == null) {
    return { ok: false, error: DINGTALK_WEBHOOK_ERROR_NO_CONFIG };
  }
  return parseDingtalkWebhookConfigFromConfigMap(data);
}

/**
 * 从钉钉 Webhook ConfigMap 的 API 响应中解析 targets -> { [name]: { url } }（仅 url，兼容旧用法）
 * 解析失败时返回空对象。
 */
export function parseDingtalkTargetsFromConfigMap(configMapResponse: unknown): Record<string, { url: string }> {
  const result = parseDingtalkWebhookConfigFromConfigMap(configMapResponse);
  if (!result.ok) return {};
  const out: Record<string, { url: string }> = {};
  for (const [name, t] of Object.entries(result.config)) {
    out[name] = { url: t.url };
  }
  return out;
}

/**
 * 从 Dingtalk ConfigMap 中存的完整 url（如 https://oapi.dingtalk.com/robot/send?access_token=xxx）
 * 用 "?" 拆成 robotUrl（list[0]）与 query，并从 query 中解析出 access_token 作为 robotAccessToken。
 */
/** 内部代理 URL 不应作为「钉钉机器人地址」展示 */
function isInternalProxyUrl(url: string): boolean {
  const u = (url || '').trim();
  return u.includes('alertmanager-webhook-dingtalk') || /\/dingtalk\/[^/]+\/send/.test(u);
}

function parseDingtalkUrlToRobotUrlAndToken(url: string): { robotUrl: string; robotAccessToken: string } {
  const list = (url || '').toString().trim().split('?');
  let robotUrl = (list[0] || '').trim();
  if (isInternalProxyUrl(robotUrl)) robotUrl = '';
  const query = (list[1] || '').trim();
  const match = query.match(/access_token=([^&]*)/);
  const robotAccessToken = match ? (match[1] || '').trim() : '';
  return { robotUrl, robotAccessToken };
}

/**
 * 对 dingtalk-receiver 的单项做特殊处理：robotAccount = ${namespace}_${specReceiverName}；
 * robotUrl、robotAccessToken 优先使用数据库中的值；若数据库无则从 DingtalkWebhookConfig 解析补全。
 */
export function normalizeDingtalkReceiverSpec(
  raw: ReceiverSpec,
  namespace: string,
  specReceiverName: string,
  dingtalkWebhookConfig?: DingtalkWebhookConfig,
): ReceiverSpec {
  const webhookArr = raw.webhookConfigs;
  const existing = Array.isArray(webhookArr) ? webhookArr[0] : undefined;
  const robotAccount = [namespace, specReceiverName].filter(Boolean).join('_');
  let robotUrl = (existing as any)?.robotUrl ?? '';
  let robotAccessToken = (existing as any)?.robotAccessToken ?? '';
  if ((!robotUrl || !robotAccessToken) && dingtalkWebhookConfig?.[robotAccount]?.url) {
    const parsed = parseDingtalkUrlToRobotUrlAndToken(dingtalkWebhookConfig[robotAccount].url);
    if (!robotUrl) robotUrl = parsed.robotUrl;
    if (!robotAccessToken) robotAccessToken = parsed.robotAccessToken;
  }
  const urlFromDb = (existing as any)?.url ?? '';
  return {
    ...raw,
    webhookConfigs: [
      {
        url: urlFromDb || getDingtalkWebhookUrl(robotAccount),
        robotAccount,
        robotUrl,
        robotAccessToken,
        sendResolved: (existing as any)?.sendResolved !== false,
      },
    ],
  };
}

/**
 * 从 AlertmanagerConfig 列表扁平化出所有接收器。
 * 传入 dingtalkWebhookConfig 时，钉钉接收器会从 config 中按 specReceiverName 取 url 解析出 robotUrl、robotAccessToken。
 */
export function flattenReceiversFromConfigList(
  configList: Array<{
    metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
    spec?: { receivers?: any[] };
  }>,
  dingtalkWebhookConfig?: DingtalkWebhookConfig,
): FlattenedReceiver[] {
  const out: FlattenedReceiver[] = [];
  for (const config of configList) {
    const namespace = config.metadata?.namespace ?? '';
    const receiverName = config.metadata?.name ?? '';
    const receivers = config.spec?.receivers;
    if (!Array.isArray(receivers)) continue;
    for (const r of receivers) {
      const specReceiverName = (r?.name ?? '').toString().trim();
      const receiverSpec =
        receiverName === DINGTALK_RECEIVER
          ? normalizeDingtalkReceiverSpec(r as ReceiverSpec, namespace, specReceiverName, dingtalkWebhookConfig)
          : (r as ReceiverSpec);
      out.push({
        namespace,
        receiverName,
        specReceiverName,
        receiverSpec,
      });
    }
  }
  return out;
}

/**
 * 組合成下拉選項用的唯一值（namespace/receiverName/specReceiverName）
 */
export function receiverOptionValue(item: FlattenedReceiver): string {
  return `${item.namespace}\t${item.receiverName}\t${item.specReceiverName}`;
}

export function parseReceiverOptionValue(value: string): { namespace: string; receiverName: string; specReceiverName: string } | null {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('\t');
  if (parts.length !== 3) return null;
  return { namespace: parts[0], receiverName: parts[1], specReceiverName: parts[2] };
}

export function buildReceiverSpec(
  name: string,
  receiverName: ReceiverName,
  formValues: Record<string, any>
): ReceiverSpec {
  const spec: ReceiverSpec = { name: name.trim() };
  if (receiverName === EMAIL_RECEIVER) {  // 邮件通知对象
    const list = Array.isArray(formValues.emailConfigs) ? formValues.emailConfigs : Array.isArray(formValues.emailList) ? formValues.emailList : [];
    spec.emailConfigs = list.map((item: any) => {
      const requireTLS = item?.requireTls !== false;
      const toRaw = (item?.emailTo ?? '').toString().trim();
      const to = toRaw
        ? toRaw
            .split(/[,，\s]+/)
            .map((s: string) => s.trim())
            .filter(Boolean)
            .join(', ')
        : undefined;
      const authIdentity = (item?.authIdentity ?? '').toString().trim();
      const authSecretKey = (item?.authSecretKey ?? '').toString().trim();
      const config: {
        to?: string;
        from?: string;
        smarthost?: string;
        authUsername?: string;
        authPassword?: { name: string; key: string };
        requireTLS: boolean;
        tlsConfig: Record<string, unknown>;
        sendResolved: boolean;
      } = {
        to,
        from: (item?.emailFrom ?? '').toString().trim() || undefined,
        smarthost: (item?.smarthost ?? '').toString().trim() || undefined,
        authUsername: (item?.authUsername ?? '').toString().trim() || undefined,
        requireTLS,
        tlsConfig: {},
        sendResolved: item?.sendResolved !== false,
      };
      if (authIdentity) config.authPassword = { name: authIdentity, key: authSecretKey };
      return config;
    }).filter((c: any) => c.to);
    if (spec.emailConfigs.length === 0) spec.emailConfigs = [{ sendResolved: false, tlsConfig: {} }];
  } else if (receiverName === WEBSITE_RECEIVER) {
    // 站内信：仅 name，其他配置项为空
    return { name: name.trim() || WEBSITE_RECEIVER };
  } else if (receiverName === DINGTALK_RECEIVER) {  // 钉钉通知对象
    const list = Array.isArray(formValues.webhookConfigs) ? formValues.webhookConfigs : [];
    const namespace = (formValues.namespace ?? '').toString().trim();
    const specReceiverName = name.trim();
    const robotAccountValue = namespace && specReceiverName ? `${namespace}_${specReceiverName}` : specReceiverName || undefined;
    spec.webhookConfigs = list
      .map((item: any) => ({
        url: getDingtalkWebhookUrl(robotAccountValue ?? ''),
        robotUrl: (item?.robotUrl ?? '').toString().trim() || undefined,
        robotAccount: robotAccountValue,
        robotAccessToken: (item?.robotAccessToken ?? '').toString().trim() || undefined,
        sendResolved: item?.sendResolved !== false,
      }))
    if (!spec.webhookConfigs.length) spec.webhookConfigs = [ // 默认值
      { url: undefined, robotUrl: undefined, robotAccount: undefined, robotAccessToken: undefined, sendResolved: false }
    ];
  }
  return spec;
}
