/**
 * 接收器配置工具：從 AlertmanagerConfig 列表扁平化為接收器列表，並推斷類型
 * 與 monitoring.coreos.com AlertmanagerConfig spec.receivers 結構對齊
 * 遷移自 Compute.Tower-Monitoring frontend/src/utils/receivers.ts
 */

export type ReceiverUIType = 'dingtalk' | 'email' | 'inbox';

/** Kubernetes annotation key 只能包含一個 '/'（格式 prefix/name），以下均為單斜線格式。 */

/** 接收器類型：key = receiver-type/<receiverName>，值 dingtalk | email | inbox */
const RECEIVER_TYPE_ANNOTATION_PREFIX = 'receiver-type';

function getReceiverTypeAnnotationKey(receiverName: string): string {
  return `${RECEIVER_TYPE_ANNOTATION_PREFIX}/${receiverName}`;
}

/** 钉钉签名密钥：key = receiver-dingtalk-secret/<receiverName>-<index>，避免多斜線導致 K8s 校驗失敗 */
export const RECEIVER_ANNOTATION_DINGTALK_SECRET_PREFIX = 'receiver-dingtalk-secret';
const RECEIVER_ANNOTATION_DINGTALK_SECRET_PREFIX_SLASH = `${RECEIVER_ANNOTATION_DINGTALK_SECRET_PREFIX}/`;

function getDingtalkSecretAnnotationKey(receiverName: string, index: number): string {
  return `${RECEIVER_ANNOTATION_DINGTALK_SECRET_PREFIX}/${receiverName}-${index}`;
}

/** 扁平化後的單條接收器（用於列表與下拉選項） */
export interface FlattenedReceiver {
  namespace: string;
  configName: string;
  receiverName: string;
  receiverType: ReceiverUIType;
  /** 完整 receiver 物件，用於創建告警配置時帶入 spec */
  receiverSpec: ReceiverSpec;
  /** 钉钉签名密钥（僅在從帶 annotations 的 config 扁平化時可能帶出） */
  dingtalkSigningSecret?: string;
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

/** 內建類型選項：邮箱第一，钉钉第二；站内信已取消 */
export const RECEIVER_TYPE_OPTIONS: { value: ReceiverUIType; label: string; description: string }[] = [
  { value: 'email', label: '邮箱', description: '通过 SMTP 发送邮件通知' },
  { value: 'dingtalk', label: '钉钉', description: '通过钉钉机器人 Webhook 发送告警' },
];

/** 站内信使用佔位 URL，便於後端識別為內建類型 */
export const INBOX_WEBHOOK_PLACEHOLDER = 'https://internal/inbox';

function inferReceiverType(receiver: any): ReceiverUIType {
  if (receiver.emailConfigs && Array.isArray(receiver.emailConfigs) && receiver.emailConfigs.length > 0) {
    return 'email';
  }
  if (receiver.webhookConfigs && Array.isArray(receiver.webhookConfigs) && receiver.webhookConfigs.length > 0) {
    const url = receiver.webhookConfigs[0]?.url ?? '';
    if (url === INBOX_WEBHOOK_PLACEHOLDER || /inbox|站内信/i.test(url)) {
      return 'inbox';
    }
    return 'dingtalk';
  }
  return 'dingtalk';
}

/**
 * 從 AlertmanagerConfig 列表扁平化出所有接收器
 * 若 config 帶 metadata.annotations，會解析钉钉簽名密鑰（receiver/<name>/dingtalkSigningSecret）
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
    const configName = config.metadata?.name ?? '';
    const annotations = config.metadata?.annotations ?? {};
    const receivers = config.spec?.receivers;
    if (!Array.isArray(receivers)) continue;
    for (const r of receivers) {
      const name = r?.name;
      if (!name || typeof name !== 'string') continue;
      const typeKey = getReceiverTypeAnnotationKey(name);
      const annotatedType = annotations[typeKey];
      const receiverType: ReceiverUIType =
        annotatedType === 'dingtalk' || annotatedType === 'email' || annotatedType === 'inbox'
          ? annotatedType
          : inferReceiverType(r);
      const dingtalkSecrets = receiverType === 'dingtalk' ? getDingtalkSecretsFromAnnotations(annotations, name) : [];
      const dingtalkSigningSecret = dingtalkSecrets[0];
      out.push({
        namespace,
        configName,
        receiverName: name,
        receiverType,
        receiverSpec: { ...r },
        dingtalkSigningSecret,
      });
    }
  }
  return out;
}

/**
 * 組合成下拉選項用的唯一值（namespace/configName/receiverName）
 */
export function receiverOptionValue(item: FlattenedReceiver): string {
  return `${item.namespace}\t${item.configName}\t${item.receiverName}`;
}

export function parseReceiverOptionValue(value: string): { namespace: string; configName: string; receiverName: string } | null {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('\t');
  if (parts.length !== 3) return null;
  return { namespace: parts[0], configName: parts[1], receiverName: parts[2] };
}

/**
 * 根據表單值組裝 ReceiverSpec（支援多條钉钉/多條邮箱）
 * dingtalkList: [{ webhookUrl, dingtalkSigningSecret? }]
 * emailList: [{ emailTo, emailFrom?, smarthost?, requireTls?, authUsername?, authIdentity?, authSecretKey? }]
 * 出参对齐 Harvester：requireTLS、tlsConfig、authPassword 仅以 Secret 引用 { name, key } 形式提交。
 */
export function buildReceiverSpec(
  name: string,
  type: ReceiverUIType,
  formValues: Record<string, any>
): ReceiverSpec {
  const spec: ReceiverSpec = { name: name.trim() };
  if (type === 'dingtalk') {
    const list = Array.isArray(formValues.dingtalkList) ? formValues.dingtalkList : [];
    spec.webhookConfigs = list
      .map((item: any) => (item?.webhookUrl ?? '').toString().trim())
      .filter((url: string) => url)
      .map((url: string) => ({ url, sendResolved: true }));
    if (spec.webhookConfigs.length === 0) spec.webhookConfigs = [{ url: undefined, sendResolved: true }];
  } else if (type === 'email') {
    const list = Array.isArray(formValues.emailList) ? formValues.emailList : [];
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
        sendResolved: true,
      };
      if (authIdentity) config.authPassword = { name: authIdentity, key: authSecretKey };
      return config;
    }).filter((c: any) => c.to);
    if (spec.emailConfigs.length === 0) spec.emailConfigs = [{ sendResolved: true, tlsConfig: {} }];
  } else {
    const inboxUrl = (formValues.inboxWebhookUrl ?? '').toString().trim() || INBOX_WEBHOOK_PLACEHOLDER;
    spec.webhookConfigs = [{ url: inboxUrl, sendResolved: true }];
  }
  return spec;
}

/** 从 annotations 中读取该接收器所有钉钉签名密钥（按索引 0,1,2...），key 格式 receiver-dingtalk-secret/<name>-<index> */
export function getDingtalkSecretsFromAnnotations(annotations: Record<string, string> | undefined, receiverName: string): string[] {
  if (!annotations) return [];
  const out: string[] = [];
  let i = 0;
  let v = annotations[getDingtalkSecretAnnotationKey(receiverName, i)];
  while (v != null) {
    out.push(v);
    i += 1;
    v = annotations[getDingtalkSecretAnnotationKey(receiverName, i)];
  }
  return out;
}

/** 合并钉钉签名密钥到 annotations（按索引写入），key 格式 receiver-dingtalk-secret/<name>-<index> */
export function mergeDingtalkSecretsIntoAnnotations(
  annotations: Record<string, string>,
  receiverName: string,
  secrets: string[]
): void {
  for (let i = 0; i < secrets.length; i++) {
    if (secrets[i]?.trim()) annotations[getDingtalkSecretAnnotationKey(receiverName, i)] = secrets[i].trim();
  }
}

/** 从 annotations 中删除该接收器所有钉钉签名密钥（含多条） */
export function removeDingtalkSecretsFromAnnotations(annotations: Record<string, string>, receiverName: string): void {
  const namePrefix = `${receiverName}-`;
  Object.keys(annotations).forEach((k) => {
    if (k.startsWith(RECEIVER_ANNOTATION_DINGTALK_SECRET_PREFIX_SLASH) && k.slice(RECEIVER_ANNOTATION_DINGTALK_SECRET_PREFIX_SLASH.length).startsWith(namePrefix)) {
      delete annotations[k];
    }
  });
}

/** 寫入接收器類型到 annotations，供本平台及支援該約定的 UI（如 Harvester）顯示「钉钉」等 */
export function setReceiverTypeAnnotation(
  annotations: Record<string, string>,
  receiverName: string,
  type: ReceiverUIType
): void {
  annotations[getReceiverTypeAnnotationKey(receiverName)] = type;
}

/** 從 annotations 刪除該接收器的類型標記 */
export function removeReceiverTypeAnnotation(annotations: Record<string, string>, receiverName: string): void {
  delete annotations[getReceiverTypeAnnotationKey(receiverName)];
}
