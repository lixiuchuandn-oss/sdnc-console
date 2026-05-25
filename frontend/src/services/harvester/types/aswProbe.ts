/** ASW-CTL / HSM 单维度探测块（info / interfaces / performance / vlans） */
export type AswCtlProbeLinesSection = {
  host?: string;
  device_profile?: string;
  ok?: boolean;
  lines?: AswCtlProbeLine[];
};

export type AswCtlProbeLine = {
  stdout?: string;
  stderr?: string;
  error?: string;
  command?: string;
};

/** 单台交换机实例探测 record（Tower 入库或 live sync 摘要中的 items 元素） */
export type AswCtlSwitchProbeRecord = {
  baseUrl?: string;
  info?: AswCtlProbeLinesSection;
  interfaces?: AswCtlProbeLinesSection;
  performance?: AswCtlProbeLinesSection;
  vlans?: AswCtlProbeLinesSection;
  switchHost?: string;
  host?: string;
  healthError?: string;
  healthHttpStatus?: number;
  healthNotApplicable?: boolean;
  healthNaMessage?: string;
  health?: unknown;
  healthPath?: string;
  infoError?: string;
  infoHttpStatus?: number;
  interfacesError?: string;
  interfacesHttpStatus?: number;
  performanceError?: string;
  performanceHttpStatus?: number;
  vlansError?: string;
  vlansHttpStatus?: number;
  infoNa?: boolean;
  interfacesNa?: boolean;
  performanceNa?: boolean;
  vlansNa?: boolean;
  apiKeySent?: boolean;
  productModel?: string;
  name?: string;
  performanceNotApplicable?: boolean;
  performanceNaMessage?: string;
  vlansNotApplicable?: boolean;
  vlansNaMessage?: string;
  deviceProfilesError?: string;
  deviceProfilesHttpStatus?: number;
  deviceProfiles?: unknown;
};

export type AswCtlProbeAggregate = AswCtlSwitchProbeRecord;

export type AswCtlSwitchesSummaryResponse = {
  aggregate?: AswCtlProbeAggregate;
  items?: AswCtlSwitchProbeRecord[];
  apiKeyProvided?: boolean;
  cacheSyncedAt?: string | null;
  source?: string;
  configured?: boolean;
  message?: string;
};
