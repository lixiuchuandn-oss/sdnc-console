/** HMS Switch CR spec（集群 · 物理交换机） */
export type HmsSwitchCrSpec = {
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
  passwordConfigured?: boolean;
};

export type HmsSwitchCr = {
  apiVersion?: string;
  kind?: string;
  metadata?: { name?: string; uid?: string; resourceVersion?: string };
  spec?: HmsSwitchCrSpec;
};
