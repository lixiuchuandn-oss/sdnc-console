/** 与后端一致的接收器名称：email-receiver | dingtalk-receiver | website-receiver */
export type ReceiverName = 'email-receiver' | 'dingtalk-receiver' | 'website-receiver';

/** UI 层与 ReceiverName 一致 */
export type ReceiverUIType = ReceiverName;

/** 通知方式下拉选项，value 为 receiverName */
export const RECEIVER_NAME_OPTIONS: { value: ReceiverName; label: string }[] = [
  { value: 'email-receiver', label: '邮件' },
  { value: 'dingtalk-receiver', label: '钉钉' },
  { value: 'website-receiver', label: '网站' },
];

export const RECEIVER_TYPE_OPTIONS = RECEIVER_NAME_OPTIONS;

export const INBOX_WEBHOOK_PLACEHOLDER = 'internal-inbox-webhook';

const RECEIVER_TYPE_ANNOTATION_PREFIX = 'receiver-type';
const DINGTALK_SECRETS_ANNOTATION_PREFIX = 'dingtalk-secrets';

function getReceiverTypeAnnotationKey(receiverName: string): string {
  return `${RECEIVER_TYPE_ANNOTATION_PREFIX}/${receiverName}`;
}

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
  name: string;
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
    url?: string;
    sendResolved?: boolean;
  }>;
}

/**
 * 從 AlertmanagerConfig 列表扁平化出所有接收器
 */
export function flattenReceiversFromConfigList(
  configList: Array<{
    metadata?: { name?: string; namespace?: string; annotations?: Record<string, string> };
    spec?: { receivers?: any[] };
  }>
): FlattenedReceiver[] {
  const out: FlattenedReceiver[] = [];
  for (const config of configList) {
    const namespace = config.metadata?.namespace ?? '';
    const receiverName = config.metadata?.name ?? '';
    const receivers = config.spec?.receivers;
    if (!Array.isArray(receivers)) continue;
    for (const r of receivers) {
      out.push({
        namespace,
        receiverName,
        specReceiverName: r.name,
        receiverSpec: r as ReceiverSpec,
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

/** 寫入接收器類型到 annotations */
export function setReceiverTypeAnnotation(
  annotations: Record<string, string>,
  receiverName: string,
  receiverNameValue: ReceiverName
): void {
  annotations[getReceiverTypeAnnotationKey(receiverName)] = receiverNameValue;
}

/** 從 annotations 刪除該接收器的類型標記 */
export function removeReceiverTypeAnnotation(annotations: Record<string, string>, receiverName: string): void {
  delete annotations[getReceiverTypeAnnotationKey(receiverName)];
}

/**
 * 根據表單值組裝 ReceiverSpec（仅支持邮箱；钉钉已去掉）
 * Form 入参：
 *   emailConfigs (或 emailList): [{ emailTo, emailFrom?, smarthost?, requireTls?, authUsername?, authIdentity?, authSecretKey? }]
 * 出参 spec.emailConfigs 对齐 Harvester/CRD，单条示例：
 *   { authPassword: { name: 'admin-email-secret', key: 'password' }, authUsername, from, requireTLS, sendResolved, smarthost, to }
 * authPassword 仅以 Secret 引用 { name, key } 提交，不传明文。
 */
export function buildReceiverSpec(
  name: string,
  receiverName: ReceiverName,
  formValues: Record<string, any>
): ReceiverSpec {
  const spec: ReceiverSpec = { name: name.trim() };
  if (receiverName === 'email-receiver') {
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
    if (spec.emailConfigs.length === 0) spec.emailConfigs = [{ sendResolved: true, tlsConfig: {} }];
  } else if (receiverName === 'dingtalk-receiver') {
    const list = Array.isArray(formValues.dingtalkList) ? formValues.dingtalkList : [];
    spec.webhookConfigs = list
      .map((item: any) => (item?.webhookUrl ?? '').toString().trim())
      .filter(Boolean)
      .map((url: string) => ({ url, sendResolved: true }));
    if (!spec.webhookConfigs.length) spec.webhookConfigs = [{ url: undefined, sendResolved: true }];
  }
  return spec;
}

export function getDingtalkSecretsFromAnnotations(
  annotations: Record<string, string>,
  receiverName: string
): string[] {
  const key = `${DINGTALK_SECRETS_ANNOTATION_PREFIX}/${receiverName}`;
  const val = annotations[key];
  if (!val) return [];
  try {
    return val.split(',');
  } catch {
    return [];
  }
}

export function mergeDingtalkSecretsIntoAnnotations(
  annotations: Record<string, string>,
  receiverName: string,
  dingtalkList: Array<{ dingtalkSigningSecret?: string }>
): void {
  const secrets = dingtalkList.map(item => item.dingtalkSigningSecret || '').join(',');
  const key = `${DINGTALK_SECRETS_ANNOTATION_PREFIX}/${receiverName}`;
  annotations[key] = secrets;
}

export function removeDingtalkSecretsFromAnnotations(
  annotations: Record<string, string>,
  receiverName: string
): void {
  const key = `${DINGTALK_SECRETS_ANNOTATION_PREFIX}/${receiverName}`;
  delete annotations[key];
}
