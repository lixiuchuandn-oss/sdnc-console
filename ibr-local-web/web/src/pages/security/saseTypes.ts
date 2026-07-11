/**
 * 网际路由域（IRD）下「单条安全服务」以 Tower CSM 投影 JSON 为准。
 * @see source: "csm_security_domain"
 */
export type SecurityServiceRaw = {
	vm_group_id?: string;
	vm_type?: string;
	vm_group_name?: string;
	vm_id_list?: string;
	vendor_name?: string;
	defend_type?: number;
	id?: string;
	name?: string;
	elements?: string[];
	count?: number;
	Count?: number;
	[key: string]: unknown;
};

export type CsmSecurityDomainRef = {
	id?: string;
	name?: string;
	networkCidrs?: string[];
};

export type SecurityService = {
	id?: string | number;
	name?: string;
	type?: string | null;
	vendor?: string;
	defenseType?: string;
	neCount?: number;
	source?: string;
	status?: string;
	vmIds?: string[];
	webId?: string;
	webIds?: string[];
	description?: string;
	raw?: SecurityServiceRaw;
	vm_type?: string;
	vmType?: string;
	vm_group_id?: string;
	vendor_name?: string;
	defend_type?: number;
	vm_id_list?: string;
	elements?: string[];
	count?: number;
	Count?: number;
};

export type GatewayInfo = {
	/** 网际路由域 ID */
	id?: string;
	name?: string;
	cloudId?: string;
	cloudName?: string;
	vrUuid?: string;
	/** 关联 CSM 安全域 ID（安全能力查询入口） */
	linkedCsmSecurityDomainId?: string;
	linkedCsmSecurityDomain?: CsmSecurityDomainRef;
	/** CSM 资源池 clouds.id */
	csmCloudId?: string;
	csmProtectionObjects?: unknown[];
	serviceChains?: unknown[];
	ssoEndpoint?: string;
	csmProjectionReady?: boolean;
	csmProjectionError?: string | null;
	stale?: boolean;
	needsLogin?: boolean;
	unavailable?: boolean;
	gatewayQuerySkipped?: boolean;
	skipHint?: string;
	/** 来自 CSM 投影，source 为 csm_security_domain */
	securityServices?: SecurityService[];
};
