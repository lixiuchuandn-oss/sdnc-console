import { BasicCredentials } from '@huaweicloud/huaweicloud-sdk-core/auth/BasicCredentials';
import {
  VpcClient,
  ListVpcsRequest,
  ListSubnetsRequest,
  ListRouteTablesRequest,
  CreateRouteTableRequest,
  CreateRoutetableReqBody,
  CreateRouteTableReq,
  UpdateRouteTableRequest,
  UpdateRoutetableReqBody,
  UpdateRouteTableReq,
  AssociateRouteTableRequest,
  DisassociateRouteTableRequest,
  RoutetableAssociateReqbody,
  AsscoiateReq,
  AssociateRouteTableAndSubnetReq,
  DeleteRouteTableRequest,
} from '@huaweicloud/huaweicloud-sdk-vpc';
import {
  EcsClient,
  ListServersDetailsRequest,
  ShowServerRemoteConsoleRequest,
  ShowServerRemoteConsoleRequestBody,
  GetServerRemoteConsoleOption,
} from '@huaweicloud/huaweicloud-sdk-ecs';
import {
  EvsClient,
  ListSnapshotsRequest,
  ListVolumesRequest,
} from '@huaweicloud/huaweicloud-sdk-evs';
import { ElbClient } from '@huaweicloud/huaweicloud-sdk-elb';
import { HcClient } from '@huaweicloud/huaweicloud-sdk-core/HcClient';
import { DefaultHttpClient } from '@huaweicloud/huaweicloud-sdk-core/http/DefaultHttpClient';
import { NatClient, ListNatGatewaysRequest } from '@huaweicloud/huaweicloud-sdk-nat';

export interface HuaweiClientOptions {
  ak: string;
  sk: string;
  region: string; // e.g. cn-north-4
  projectId: string; // required for regional services
}

function buildVpcEndpoint(region: string): string {
  return `https://vpc.${region}.myhuaweicloud.com`;
}

function buildEcsEndpoint(region: string): string {
  return `https://ecs.${region}.myhuaweicloud.com`;
}

function buildEvsEndpoint(region: string): string {
  return `https://evs.${region}.myhuaweicloud.com`;
}

function buildElbEndpoint(region: string): string {
  return `https://elb.${region}.myhuaweicloud.com`;
}

function buildNatEndpoint(region: string): string {
  return `https://nat.${region}.myhuaweicloud.com`;
}

function buildCesEndpoint(region: string): string {
  return `https://ces.${region}.myhuaweicloud.com`;
}

function buildCtsEndpoint(region: string): string {
  return `https://cts.${region}.myhuaweicloud.com`;
}

function buildBasicCredentials(opts: HuaweiClientOptions): BasicCredentials {
  return new BasicCredentials().withAk(opts.ak).withSk(opts.sk).withProjectId(opts.projectId);
}

/** 华为云 API 网关 IAM 类错误（如 APIGW.0301）的友好中文说明 */
export function formatHuaweiCloudErrorMessage(err: any, defaultFallback = 'HuaweiCloud 请求失败'): string {
  const message = err?.message || err?.errorMsg || defaultFallback;
  const code = err?.errorCode || err?.code;
  const full = code ? `${code}: ${message}` : String(message);
  if (/APIGW\.0301/i.test(full) || /APIGW\.0301/i.test(String(message))) {
    return (
      '华为云 IAM 鉴权失败（APIGW.0301）：获取 Token 被拒绝。请核对访问密钥（AK/SK）是否与账号一致且已启用，' +
      '项目 ID（projectId）是否与所选区域一致；临时密钥请确认未过期。'
    );
  }
  return full;
}

const __cesCache = new Map<string, { data: any; ts: number }>();
function __getCache(k: string, ttl: number): any | null {
  const v = __cesCache.get(k);
  if (!v) return null;
  if (Date.now() - v.ts > ttl) return null;
  return v.data;
}
function __setCache(k: string, data: any): void {
  __cesCache.set(k, { data, ts: Date.now() });
}

export async function huaweiListVpcs(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new ListVpcsRequest();
  try {
    const result = await client.listVpcs(request);
    return result;
  } catch (err: any) {
    throw new Error(formatHuaweiCloudErrorMessage(err, 'HuaweiCloud VPC 查询失败'));
  }
}

export async function huaweiShowVpc(opts: HuaweiClientOptions, vpcId: string): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const ShowVpcRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/ShowVpcRequest').ShowVpcRequest;
  const request = new ShowVpcRequest(vpcId);
  try {
    const result = await client.showVpc(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud VPC 查询失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiCreateVpc(
  opts: HuaweiClientOptions,
  payload: {
    cidr: string;
    name?: string;
    description?: string;
    enterprise_project_id?: string;
    tags?: string[];
    block_service_endpoint_states?: string;
    enable_network_address_usage_metrics?: boolean;
  },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const CreateVpcRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateVpcRequest').CreateVpcRequest;
  const CreateVpcRequestBody =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateVpcRequestBody').CreateVpcRequestBody;
  const CreateVpcOption =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateVpcOption').CreateVpcOption;
  const nm = payload.name != null ? String(payload.name).trim() : undefined;
  const desc = payload.description != null ? String(payload.description).trim() : undefined;
  const opt = new CreateVpcOption()
    .withCidr(payload.cidr)
    .withName((nm && nm.length ? nm : undefined) as any)
    .withDescription((desc && desc.length ? desc : undefined) as any)
    .withTags((Array.isArray(payload.tags) ? payload.tags : undefined) as any);
  const body = new CreateVpcRequestBody().withVpc(opt);
  const request = new CreateVpcRequest().withBody(body);
  try {
    const result = await client.createVpc(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud VPC 创建失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiUpdateVpc(
  opts: HuaweiClientOptions,
  vpcId: string,
  payload: {
    name?: string;
    description?: string;
    cidr?: string;
    enterprise_project_id?: string;
    tags?: string[];
    block_service_endpoint_states?: string;
    enable_network_address_usage_metrics?: boolean;
  },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const UpdateVpcRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/UpdateVpcRequest').UpdateVpcRequest;
  const UpdateVpcRequestBody =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/UpdateVpcRequestBody').UpdateVpcRequestBody;
  const UpdateVpcOption =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/UpdateVpcOption').UpdateVpcOption;
  const upNm = payload.name != null ? String(payload.name).trim() : undefined;
  const upDesc = payload.description != null ? String(payload.description).trim() : undefined;
  const upCidr = payload.cidr != null ? String(payload.cidr).trim() : undefined;
  const opt = new UpdateVpcOption()
    .withName((upNm && upNm.length ? upNm : undefined) as any)
    .withDescription((upDesc && upDesc.length ? upDesc : undefined) as any)
    .withCidr((upCidr && upCidr.length ? upCidr : undefined) as any);
  const body = new UpdateVpcRequestBody().withVpc(opt);
  const request = new UpdateVpcRequest(vpcId).withBody(body);
  try {
    const result = await client.updateVpc(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud VPC 更新失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiDeleteVpc(opts: HuaweiClientOptions, vpcId: string): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const DeleteVpcRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/DeleteVpcRequest').DeleteVpcRequest;
  const request = new DeleteVpcRequest(vpcId);
  try {
    const result = await client.deleteVpc(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud VPC 删除失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListSubnets(opts: HuaweiClientOptions, vpcId?: string): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new ListSubnetsRequest();
  if (vpcId) {
    request.withVpcId(vpcId);
  }
  try {
    const result = await client.listSubnets(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 子网 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

// Note: ports listing is implemented below using HcClient with /v2.0/ports

export async function huaweiCreateSubnet(
  opts: HuaweiClientOptions,
  payload: {
    vpc_id: string;
    cidr: string;
    name?: string;
    description?: string;
    gateway_ip?: string;
    dhcp_enable?: boolean;
    primary_dns?: string;
    secondary_dns?: string;
    dnsList?: string[];
    availability_zone?: string;
  },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const CreateSubnetRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateSubnetRequest').CreateSubnetRequest;
  const CreateSubnetRequestBody =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateSubnetRequestBody').CreateSubnetRequestBody;
  const CreateSubnetOption =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateSubnetOption').CreateSubnetOption;
  const opt = new CreateSubnetOption()
    .withVpcId(String(payload.vpc_id))
    .withCidr(String(payload.cidr))
    .withName((payload.name != null ? String(payload.name).trim() : undefined) as any)
    .withDescription(
      (payload.description != null ? String(payload.description).trim() : undefined) as any,
    )
    .withGatewayIp(
      (payload.gateway_ip != null ? String(payload.gateway_ip).trim() : undefined) as any,
    )
    .withDhcpEnable((payload.dhcp_enable != null ? !!payload.dhcp_enable : undefined) as any)
    .withPrimaryDns(
      (payload.primary_dns != null ? String(payload.primary_dns).trim() : undefined) as any,
    )
    .withSecondaryDns(
      (payload.secondary_dns != null ? String(payload.secondary_dns).trim() : undefined) as any,
    )
    .withDnsList((Array.isArray(payload.dnsList) ? payload.dnsList : undefined) as any)
    .withAvailabilityZone(
      (payload.availability_zone != null
        ? String(payload.availability_zone).trim()
        : undefined) as any,
    );
  const body = new CreateSubnetRequestBody().withSubnet(opt);
  const request = new CreateSubnetRequest().withBody(body);
  try {
    const result = await client.createSubnet(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 子网 创建失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiUpdateSubnet(
  opts: HuaweiClientOptions,
  subnetId: string,
  payload: {
    name?: string;
    description?: string;
    dhcp_enable?: boolean;
    primary_dns?: string;
    secondary_dns?: string;
    dnsList?: string[];
  },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const UpdateSubnetRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/UpdateSubnetRequest').UpdateSubnetRequest;
  const UpdateSubnetRequestBody =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/UpdateSubnetRequestBody').UpdateSubnetRequestBody;
  const UpdateSubnetOption =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/UpdateSubnetOption').UpdateSubnetOption;
  const opt = new UpdateSubnetOption()
    .withName((payload.name != null ? String(payload.name).trim() : undefined) as any)
    .withDescription(
      (payload.description != null ? String(payload.description).trim() : undefined) as any,
    )
    .withDhcpEnable((payload.dhcp_enable != null ? !!payload.dhcp_enable : undefined) as any)
    .withPrimaryDns(
      (payload.primary_dns != null ? String(payload.primary_dns).trim() : undefined) as any,
    )
    .withSecondaryDns(
      (payload.secondary_dns != null ? String(payload.secondary_dns).trim() : undefined) as any,
    )
    .withDnsList((Array.isArray(payload.dnsList) ? payload.dnsList : undefined) as any);
  const body = new UpdateSubnetRequestBody().withSubnet(opt);
  const request = new UpdateSubnetRequest(subnetId).withBody(body);
  try {
    const result = await client.updateSubnet(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 子网 更新失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiDeleteSubnet(
  opts: HuaweiClientOptions,
  subnetId: string,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const DeleteSubnetRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/DeleteSubnetRequest').DeleteSubnetRequest;
  const request = new DeleteSubnetRequest(subnetId);
  try {
    const result = await client.deleteSubnet(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 子网 删除失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListRouteTables(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new ListRouteTablesRequest();
  try {
    const result = await client.listRouteTables(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 路由表 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListSecurityGroups(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const ListSecurityGroupsRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/ListSecurityGroupsRequest').ListSecurityGroupsRequest;
  const request = new ListSecurityGroupsRequest();
  try {
    const result = await (client as any).listSecurityGroups(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 安全组 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiShowSecurityGroup(
  opts: HuaweiClientOptions,
  securityGroupId: string,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const ShowSecurityGroupRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/ShowSecurityGroupRequest').ShowSecurityGroupRequest;
  const request = new ShowSecurityGroupRequest(securityGroupId);
  try {
    const result = await (client as any).showSecurityGroup(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 安全组 详情查询失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiCreateSecurityGroup(
  opts: HuaweiClientOptions,
  payload: { name?: string; description?: string; enterprise_project_id?: string },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const CreateSecurityGroupRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateSecurityGroupRequest').CreateSecurityGroupRequest;
  const CreateSecurityGroupRequestBody =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateSecurityGroupRequestBody').CreateSecurityGroupRequestBody;
  const CreateSecurityGroupOption =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/CreateSecurityGroupOption').CreateSecurityGroupOption;
  const nm = payload.name != null ? String(payload.name).trim() : undefined;
  const opt = new CreateSecurityGroupOption()
    .withName((nm && nm.length ? nm : undefined) as any)
    .withEnterpriseProjectId(
      (payload.enterprise_project_id != null
        ? String(payload.enterprise_project_id).trim()
        : undefined) as any,
    );
  const body = new CreateSecurityGroupRequestBody().withSecurityGroup(opt);
  const request = new CreateSecurityGroupRequest().withBody(body);
  try {
    const result = await (client as any).createSecurityGroup(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 安全组 创建失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiDeleteSecurityGroup(
  opts: HuaweiClientOptions,
  securityGroupId: string,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const DeleteSecurityGroupRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/DeleteSecurityGroupRequest').DeleteSecurityGroupRequest;
  const request = new DeleteSecurityGroupRequest(securityGroupId);
  try {
    const result = await (client as any).deleteSecurityGroup(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 安全组 删除失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiCreateSecurityGroupRule(
  opts: HuaweiClientOptions,
  payload: {
    security_group_id: string;
    direction: string;
    protocol?: string;
    ethertype?: string;
    port_range_min?: number;
    port_range_max?: number;
    remote_ip_prefix?: string;
    remote_group_id?: string;
    description?: string;
  },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const NeutronCreateSecurityGroupRuleRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/NeutronCreateSecurityGroupRuleRequest').NeutronCreateSecurityGroupRuleRequest;
  const NeutronCreateSecurityGroupRuleRequestBody =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/NeutronCreateSecurityGroupRuleRequestBody').NeutronCreateSecurityGroupRuleRequestBody;
  const NeutronCreateSecurityGroupRuleOption =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/NeutronCreateSecurityGroupRuleOption').NeutronCreateSecurityGroupRuleOption;
  const opt = new NeutronCreateSecurityGroupRuleOption()
    .withSecurityGroupId(payload.security_group_id)
    .withDirection(String(payload.direction || '').toLowerCase())
    .withProtocol((payload.protocol ? String(payload.protocol).toLowerCase() : undefined) as any)
    .withEthertype((payload.ethertype ? String(payload.ethertype).toLowerCase() : undefined) as any)
    .withPortRangeMin(payload.port_range_min as any)
    .withPortRangeMax(payload.port_range_max as any)
    .withRemoteIpPrefix(payload.remote_ip_prefix as any)
    .withRemoteGroupId(payload.remote_group_id as any)
    .withDescription(payload.description as any);
  const body = new NeutronCreateSecurityGroupRuleRequestBody().withSecurityGroupRule(opt);
  const request = new NeutronCreateSecurityGroupRuleRequest().withBody(body);
  try {
    const result = await (client as any).neutronCreateSecurityGroupRule(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 安全组规则 创建失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiDeleteSecurityGroupRule(
  opts: HuaweiClientOptions,
  ruleId: string,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const NeutronDeleteSecurityGroupRuleRequest =
    require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/NeutronDeleteSecurityGroupRuleRequest').NeutronDeleteSecurityGroupRuleRequest;
  const request = new NeutronDeleteSecurityGroupRuleRequest(ruleId);
  try {
    const result = await (client as any).neutronDeleteSecurityGroupRule(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 安全组规则 删除失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListPublicips(opts: HuaweiClientOptions): Promise<any> {
  const endpoints = [
    `https://eip.${opts.region}.myhuaweicloud.com`,
    `https://vpc.${opts.region}.myhuaweicloud.com`,
  ];
  const credentials = buildBasicCredentials(opts);
  for (const ep of endpoints) {
    try {
      const http = new DefaultHttpClient(undefined, [ep]);
      const hc = new HcClient(http);
      hc.withEndpoints([ep]).withCredential(credentials);
      const result = await hc.sendRequest<any>({
        method: 'GET',
        url: '/v1/{project_id}/publicips',
        contentType: 'application/json',
        queryParams: {},
        pathParams: { project_id: opts.projectId },
        headers: {},
      });
      if (result) return result;
    } catch (err: any) {
      const msg = err?.message || '';
      if (!msg.includes('ENOTFOUND')) {
        const message = err?.message || err?.errorMsg || 'HuaweiCloud 弹性公网IP 查询失败';
        const code = err?.errorCode || err?.code;
        throw new Error(code ? `${code}: ${message}` : message);
      }
    }
  }
  throw new Error('HuaweiCloud 弹性公网IP 查询失败');
}

export async function huaweiBatchQueryCesMetricData(
  opts: HuaweiClientOptions,
  payload: {
    metrics: Array<{
      namespace: string;
      metric_name: string;
      dimensions: Array<{ name: string; value: string }>;
    }>;
    period?: number;
    filter?: string;
    from?: number;
    to?: number;
  },
): Promise<any> {
  const endpoint = buildCesEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  const asMillis = (t?: number): number | undefined => {
    if (t == null) return undefined;
    const n = Number(t);
    if (!isFinite(n)) return undefined;
    return n < 1e11 ? Math.floor(n * 1000) : Math.floor(n);
  };
  const body: any = {
    metrics: Array.isArray(payload?.metrics) ? payload.metrics : [],
  };
  if (payload?.period != null) body.period = payload.period;
  if (payload?.filter != null) body.filter = payload.filter;
  if (payload?.from != null) body.from = asMillis(payload.from);
  if (payload?.to != null) body.to = asMillis(payload.to);
  const cacheKey = `batch:${opts.projectId}:${opts.region}:${JSON.stringify(body)}`;
  const cached = __getCache(cacheKey, 20000);
  if (cached) return cached;
  try {
    const result = await hc.sendRequest<any>({
      method: 'POST',
      url: `/V1.0/{project_id}/batch-query-metric-data`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: { project_id: opts.projectId },
      headers: {},
      data: body,
    });
    __setCache(cacheKey, result);
    return result;
  } catch (err: any) {
    try {
      const resp = err?.response;
      const data = resp?.data;
      const code =
        err?.errorCode ||
        err?.code ||
        resp?.status ||
        (typeof data === 'object' ? data?.code || data?.error_code : undefined);
      const message =
        err?.message ||
        err?.errorMsg ||
        (typeof data === 'object' ? data?.details || data?.error_msg : undefined) ||
        'HuaweiCloud CES 指标查询失败';
      if (data) {
        console.error(
          'CES batch-query error response',
          typeof data === 'string' ? data : JSON.stringify(data),
        );
      }
      const e2: any = new Error(code ? `${code}: ${message}` : message);
      e2.code = code;
      e2.status = resp?.status;
      e2.response = resp;
      throw e2;
    } catch {
      const message = err?.message || err?.errorMsg || 'HuaweiCloud CES 指标查询失败';
      const code = err?.errorCode || err?.code || err?.response?.status;
      const e2: any = new Error(code ? `${code}: ${message}` : message);
      e2.code = code;
      e2.status = err?.response?.status;
      e2.response = err?.response;
      throw e2;
    }
  }
}

export async function huaweiQueryCesMetricDataSingle(
  opts: HuaweiClientOptions,
  args: {
    namespace: string;
    metric_name: string;
    instance_id: string;
    period?: number;
    filter?: string;
    from?: number;
    to?: number;
  },
): Promise<any> {
  const endpoint = buildCesEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  const asMillis = (t?: number): number | undefined => {
    if (t == null) return undefined;
    const n = Number(t);
    if (!isFinite(n)) return undefined;
    return n < 1e11 ? Math.floor(n * 1000) : Math.floor(n);
  };
  const cacheKey = `single:${opts.projectId}:${opts.region}:${args.namespace}:${args.metric_name}:${args.instance_id}:${args.period}:${args.filter}:${args.from}:${args.to}`;
  const cached = __getCache(cacheKey, 20000);
  if (cached) return cached;
  try {
    const result = await hc.sendRequest<any>({
      method: 'GET',
      url: `/V1.0/{project_id}/metric-data`,
      contentType: 'application/json',
      queryParams: {
        namespace: args.namespace,
        metric_name: args.metric_name,
        'dim.0': `instance_id,${args.instance_id}`,
        from: asMillis(args.from),
        to: asMillis(args.to),
        period: args.period,
        filter: args.filter,
      },
      pathParams: { project_id: opts.projectId },
      headers: {},
    });
    __setCache(cacheKey, result);
    return result;
  } catch (err: any) {
    try {
      const resp = err?.response;
      const data = resp?.data;
      if (data) {
        console.error(
          'CES single metric error response',
          typeof data === 'string' ? data : JSON.stringify(data),
        );
      }
    } catch {}
    const message = err?.message || err?.errorMsg || 'HuaweiCloud CES 单指标查询失败';
    const code = err?.errorCode || err?.code || err?.response?.status;
    const e2: any = new Error(code ? `${code}: ${message}` : message);
    e2.code = code;
    e2.status = err?.response?.status;
    e2.response = err?.response;
    throw e2;
  }
}

export async function huaweiListCesMetrics(
  opts: HuaweiClientOptions,
  args: {
    namespace?: string;
    metric_name?: string;
    instance_id?: string;
    limit?: number;
    order?: 'asc' | 'desc';
  },
): Promise<any> {
  const endpoint = buildCesEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  const qp: any = {};
  if (args?.namespace) qp.namespace = args.namespace;
  if (args?.metric_name) qp.metric_name = args.metric_name;
  if (args?.instance_id) qp['dim.0'] = `instance_id,${args.instance_id}`;
  if (args?.limit != null) qp.limit = args.limit;
  if (args?.order) qp.order = args.order;
  const cacheKey = `list:${opts.projectId}:${opts.region}:${qp.namespace || '-'}:${qp.metric_name || '-'}:${qp['dim.0'] || '-'}:${qp.limit || '-'}:${qp.order || '-'}`;
  const cached = __getCache(cacheKey, 20000);
  if (cached) return cached;
  try {
    const result = await hc.sendRequest<any>({
      method: 'GET',
      url: `/V1.0/{project_id}/metrics`,
      contentType: 'application/json',
      queryParams: qp,
      pathParams: { project_id: opts.projectId },
      headers: {},
    });
    __setCache(cacheKey, result);
    return result;
  } catch (err: any) {
    try {
      const resp = err?.response;
      const data = resp?.data;
      if (data) {
        console.error(
          'CES list metrics error response',
          typeof data === 'string' ? data : JSON.stringify(data),
        );
      }
    } catch {}
    const message = err?.message || err?.errorMsg || 'HuaweiCloud CES 指标列表查询失败';
    const code = err?.errorCode || err?.code || err?.response?.status;
    const e2: any = new Error(code ? `${code}: ${message}` : message);
    e2.code = code;
    e2.status = err?.response?.status;
    e2.response = err?.response;
    throw e2;
  }
}

export async function huaweiListCtsTraces(
  opts: HuaweiClientOptions,
  args: {
    resource_type?: string;
    resource_name?: string;
    resource_id?: string;
    trace_name?: string;
    trace_id?: string;
    trace_type?: string;
    trace_source?: string;
    service_type?: string;
    limit?: number;
    order?: 'asc' | 'desc';
    start_time?: number;
    end_time?: number;
  },
): Promise<any> {
  const endpoint = buildCtsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  const qp: any = {};
  if (args?.resource_type) qp.resource_type = args.resource_type;
  if (args?.resource_name) qp.resource_name = args.resource_name;
  if (args?.resource_id) qp.resource_id = args.resource_id;
  if (args?.trace_name) qp.trace_name = args.trace_name;
  if (args?.trace_id) qp.trace_id = args.trace_id;
  if (args?.trace_type) qp.trace_type = args.trace_type;
  if (args?.trace_source) qp.trace_source = args.trace_source;
  qp.service_type = args?.service_type || 'ECS';
  if (args?.limit != null) qp.limit = args.limit;
  if (args?.order) qp.order = args.order;
  if (args?.start_time != null) qp.start_time = args.start_time;
  if (args?.end_time != null) qp.end_time = args.end_time;
  const cacheKey = `cts:${opts.projectId}:${opts.region}:${qp.service_type}:${qp.resource_id || '-'}:${qp.limit || '-'}:${qp.order || '-'}:${qp.start_time || '-'}:${qp.end_time || '-'}`;
  const cached = __getCache(cacheKey, 20000);
  if (cached) return cached;
  try {
    const result = await hc.sendRequest<any>({
      method: 'GET',
      url: `/v3/{project_id}/tracker/traces`,
      contentType: 'application/json',
      queryParams: qp,
      pathParams: { project_id: opts.projectId },
      headers: {},
    });
    __setCache(cacheKey, result);
    return result;
  } catch (err: any) {
    try {
      const resp = err?.response;
      const data = resp?.data;
      const txt = typeof data === 'string' ? data : JSON.stringify(data || {});
      if ((txt && /APIGW\.0101/i.test(txt)) || /APIGW\.0101/i.test(String(err?.message || ''))) {
        const alt = await hc.sendRequest<any>({
          method: 'GET',
          url: `/v3/{project_id}/traces`,
          contentType: 'application/json',
          queryParams: qp,
          pathParams: { project_id: opts.projectId },
          headers: {},
        });
        __setCache(cacheKey, alt);
        return alt;
      }
    } catch {}
    try {
      const resp = err?.response;
      const data = resp?.data;
      if (data) {
        console.error(
          'CTS list traces error response',
          typeof data === 'string' ? data : JSON.stringify(data),
        );
      }
    } catch {}
    const message = err?.message || err?.errorMsg || 'HuaweiCloud CTS 审计日志查询失败';
    const code = err?.errorCode || err?.code || err?.response?.status;
    const msg =
      (typeof err?.response?.data === 'string' && err?.response?.data ? err?.response?.data : '') ||
      (code ? `${code}: ${message}` : message);
    const e2: any = new Error(msg);
    e2.code = code;
    e2.status = err?.response?.status;
    e2.response = err?.response;
    throw e2;
  }
}

export async function huaweiListPorts(opts: HuaweiClientOptions, deviceId: string): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  try {
    const result = await hc.sendRequest<any>({
      method: 'GET',
      url: '/v2.0/ports',
      contentType: 'application/json',
      queryParams: { device_id: deviceId },
      pathParams: {},
      headers: {},
    });
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 端口 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiShowPort(opts: HuaweiClientOptions, portId: string): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  try {
    const result = await hc.sendRequest<any>({
      method: 'GET',
      url: `/v2.0/ports/${encodeURIComponent(portId)}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
    });
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 端口 详情查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiUpdatePort(
  opts: HuaweiClientOptions,
  portId: string,
  payload: any,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  try {
    const result = await hc.sendRequest<any>({
      method: 'PUT',
      url: `/v2.0/ports/${encodeURIComponent(portId)}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: { port: payload },
    });
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 端口 更新失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiUpdateFloatingip(
  opts: HuaweiClientOptions,
  floatingipId: string,
  portId: string | null,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  try {
    const result = await hc.sendRequest<any>({
      method: 'PUT',
      url: `/v2.0/floatingips/${encodeURIComponent(floatingipId)}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: { floatingip: { port_id: portId } },
    });
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 弹性公网IP 绑定更新失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiShowRouteTable(
  opts: HuaweiClientOptions,
  routeTableId: string,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request =
    new (require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/ShowRouteTableRequest').ShowRouteTableRequest)(
      routeTableId,
    );
  try {
    const result = await client.showRouteTable(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 路由表 查询失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiCreateRouteTable(
  opts: HuaweiClientOptions,
  payload: {
    vpcId: string;
    name?: string;
    description?: string;
    routes?: Array<{ type: string; destination: string; nexthop: string; description?: string }>;
  },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const body = new CreateRoutetableReqBody().withRoutetable(
    new CreateRouteTableReq(payload.vpcId)
      .withName(payload.name as any)
      .withDescription(payload.description as any)
      .withRoutes(
        (payload.routes || []).map(
          (r) =>
            ({
              type: r.type,
              destination: r.destination,
              nexthop: r.nexthop,
              description: r.description,
            }) as any,
        ),
      ),
  );
  const request = new CreateRouteTableRequest().withBody(body);
  try {
    const result = await client.createRouteTable(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 路由表 创建失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiUpdateRouteTable(
  opts: HuaweiClientOptions,
  routeTableId: string,
  payload: {
    name?: string;
    description?: string;
    routes?: Array<{ type: string; destination: string; nexthop: string; description?: string }>;
    add?: Array<{ type: string; destination: string; nexthop: string; description?: string }>;
    del?: Array<{ type: string; destination: string; nexthop: string; description?: string }>;
    mod?: Array<{ type: string; destination: string; nexthop: string; description?: string }>;
  },
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const body = new UpdateRoutetableReqBody().withRoutetable(
    new UpdateRouteTableReq()
      .withName((payload.name != null ? String(payload.name).trim() : undefined) as any)
      .withDescription(
        (payload.description != null ? String(payload.description).trim() : undefined) as any,
      )
      .withRoutes(
        (() => {
          const RouteTableRouteAction =
            require('@huaweicloud/huaweicloud-sdk-vpc/v2/model/RouteTableRouteAction').RouteTableRouteAction;
          const mapAddMod = (r: any) =>
            ({
              type: String(r.type || '')
                .trim()
                .toLowerCase(),
              destination: String(r.destination).trim(),
              nexthop: String(r.nexthop || '').trim(),
              description: r.description != null ? String(r.description).trim() : undefined,
            }) as any;
          const mapDel = (r: any) =>
            ({
              type: String(r.type || '')
                .trim()
                .toLowerCase(),
              destination: String(r.destination).trim(),
              nexthop: String(r.nexthop || '').trim(),
            }) as any;
          const action = new RouteTableRouteAction();
          const addList =
            payload.add && Array.isArray(payload.add) ? payload.add : payload.routes || [];
          const delList = payload.del && Array.isArray(payload.del) ? payload.del : [];
          const modList = payload.mod && Array.isArray(payload.mod) ? payload.mod : [];
          if (addList.length) action.withAdd(addList.map(mapAddMod));
          if (delList.length) action.withDel(delList.map(mapDel));
          if (modList.length) action.withMod(modList.map(mapAddMod));
          return action;
        })(),
      ),
  );
  const request = new UpdateRouteTableRequest(routeTableId).withBody(body);
  try {
    const result = await client.updateRouteTable(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 路由表 更新失败';
    const code = err?.errorCode || err?.code;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.httpStatusCode || err?.statusCode || err?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiAssociateRouteTable(
  opts: HuaweiClientOptions,
  routeTableId: string,
  subnetIds: string[],
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const assoc = new AssociateRouteTableAndSubnetReq().withAssociate(subnetIds);
  const body = new RoutetableAssociateReqbody().withRoutetable(new AsscoiateReq(assoc));
  const request = new AssociateRouteTableRequest(routeTableId).withBody(body);
  try {
    const result = await client.associateRouteTable(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 路由表挂载子网 失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiDisassociateRouteTable(
  opts: HuaweiClientOptions,
  routeTableId: string,
  subnetIds: string[],
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const disassoc = new AssociateRouteTableAndSubnetReq().withDisassociate(subnetIds);
  const body = new RoutetableAssociateReqbody().withRoutetable(new AsscoiateReq(disassoc));
  const request = new DisassociateRouteTableRequest(routeTableId).withBody(body);
  try {
    const result = await client.disassociateRouteTable(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 路由表解绑子网 失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiDeleteRouteTable(
  opts: HuaweiClientOptions,
  routeTableId: string,
): Promise<any> {
  const endpoint = buildVpcEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = VpcClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new DeleteRouteTableRequest(routeTableId);
  try {
    const result = await client.deleteRouteTable(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 路由表 删除失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListServers(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildEcsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = EcsClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new ListServersDetailsRequest();
  try {
    const result = await client.listServersDetails(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud ECS 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListSnapshots(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildEvsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = EvsClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new ListSnapshotsRequest();
  try {
    const result = await client.listSnapshots(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud EVS 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListVolumes(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildEvsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = EvsClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new ListVolumesRequest();
  try {
    const result = await client.listVolumes(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud EVS 云盘 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListLoadBalancers(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildElbEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = ElbClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const ListLoadbalancersRequest =
    require('@huaweicloud/huaweicloud-sdk-elb/v2/model/ListLoadbalancersRequest').ListLoadbalancersRequest;
  const request = new ListLoadbalancersRequest();
  try {
    const result = await client.listLoadbalancers(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud ELB 负载均衡 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiListNatGateways(opts: HuaweiClientOptions): Promise<any> {
  const endpoint = buildNatEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = NatClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const request = new ListNatGatewaysRequest();
  try {
    const result = await client.listNatGateways(request);
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud NAT 网关 查询失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiGetServerRemoteConsoleUrl(
  opts: HuaweiClientOptions,
  serverId: string,
): Promise<string | null> {
  const endpoint = buildEcsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const client = EcsClient.newBuilder().withCredential(credentials).withEndpoint(endpoint).build();
  const body = new ShowServerRemoteConsoleRequestBody().withRemoteConsole(
    new GetServerRemoteConsoleOption().withProtocol('vnc').withType('novnc'),
  );
  const request = new ShowServerRemoteConsoleRequest(serverId).withBody(body);
  try {
    const result: any = await client.showServerRemoteConsole(request);
    const rc = (result && (result.remoteConsole || (result as any)['remote_console'])) || {};
    const url: string | undefined = rc?.url || (rc as any)['url'];
    return url || null;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud 获取远程控制台URL失败';
    const code = err?.errorCode || err?.code;
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function huaweiStartServer(opts: HuaweiClientOptions, serverId: string): Promise<any> {
  const endpoint = buildEcsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  try {
    const result = await hc.sendRequest<any>({
      method: 'POST',
      url: '/v1/{project_id}/cloudservers/action',
      contentType: 'application/json',
      queryParams: {},
      pathParams: { project_id: opts.projectId },
      headers: {},
      data: { 'os-start': { servers: [{ id: serverId }] } },
    });
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud ECS 启动失败';
    const code = err?.errorCode || err?.code || err?.response?.status;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.response?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiStopServer(
  opts: HuaweiClientOptions,
  serverId: string,
  force: boolean = false,
): Promise<any> {
  const endpoint = buildEcsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  try {
    const result = await hc.sendRequest<any>({
      method: 'POST',
      url: '/v1/{project_id}/cloudservers/action',
      contentType: 'application/json',
      queryParams: {},
      pathParams: { project_id: opts.projectId },
      headers: {},
      data: { 'os-stop': { type: force ? 'HARD' : 'SOFT', servers: [{ id: serverId }] } },
    });
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud ECS 停止失败';
    const code = err?.errorCode || err?.code || err?.response?.status;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.response?.status;
    e.response = err?.response;
    throw e;
  }
}

export async function huaweiRebootServer(
  opts: HuaweiClientOptions,
  serverId: string,
  force: boolean = false,
): Promise<any> {
  const endpoint = buildEcsEndpoint(opts.region);
  const credentials = buildBasicCredentials(opts);
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(credentials);
  try {
    const result = await hc.sendRequest<any>({
      method: 'POST',
      url: '/v1/{project_id}/cloudservers/action',
      contentType: 'application/json',
      queryParams: {},
      pathParams: { project_id: opts.projectId },
      headers: {},
      data: { reboot: { type: force ? 'HARD' : 'SOFT', servers: [{ id: serverId }] } },
    });
    return result;
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || 'HuaweiCloud ECS 重启失败';
    const code = err?.errorCode || err?.code || err?.response?.status;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.response?.status;
    e.response = err?.response;
    throw e;
  }
}

function buildImsEndpoint(region: string): string {
  return `https://ims.${region}.myhuaweicloud.com`;
}

/** 通用 HcClient 原始 REST 调用（用于无现成 SDK 模型的写操作） */
async function huaweiHcSend(
  opts: HuaweiClientOptions,
  endpoint: string,
  req: { method: string; url: string; pathParams?: any; queryParams?: any; data?: any },
  fallbackMsg: string,
): Promise<any> {
  const http = new DefaultHttpClient(undefined, [endpoint]);
  const hc = new HcClient(http);
  hc.withEndpoints([endpoint]).withCredential(buildBasicCredentials(opts));
  try {
    return await hc.sendRequest<any>({
      method: req.method,
      url: req.url,
      contentType: 'application/json',
      queryParams: req.queryParams || {},
      pathParams: req.pathParams || {},
      headers: {},
      data: req.data,
    });
  } catch (err: any) {
    const message = err?.message || err?.errorMsg || fallbackMsg;
    const code = err?.errorCode || err?.code || err?.response?.status;
    const e: any = new Error(code ? `${code}: ${message}` : message);
    e.code = code;
    e.status = err?.response?.status;
    e.response = err?.response;
    throw e;
  }
}

// ===== ECS 创建依赖 =====
export async function huaweiListFlavors(opts: HuaweiClientOptions, availabilityZone?: string): Promise<any> {
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'GET',
    url: '/v1/{project_id}/cloudservers/flavors',
    pathParams: { project_id: opts.projectId },
    queryParams: availabilityZone ? { availability_zone: availabilityZone } : {},
  }, 'HuaweiCloud 查询规格失败');
}

export async function huaweiListAvailabilityZones(opts: HuaweiClientOptions): Promise<any> {
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'GET',
    url: '/v1/{project_id}/os-availability-zone',
    pathParams: { project_id: opts.projectId },
  }, 'HuaweiCloud 查询可用区失败');
}

export async function huaweiListKeypairs(opts: HuaweiClientOptions): Promise<any> {
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'GET',
    url: '/v1/{project_id}/os-keypairs',
    pathParams: { project_id: opts.projectId },
  }, 'HuaweiCloud 查询密钥对失败');
}

export async function huaweiCreateKeypair(opts: HuaweiClientOptions, name: string, publicKey?: string): Promise<any> {
  const keypair: any = { name };
  if (publicKey) keypair.public_key = publicKey;
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'POST',
    url: '/v1/{project_id}/os-keypairs',
    pathParams: { project_id: opts.projectId },
    data: { keypair },
  }, 'HuaweiCloud 创建密钥对失败');
}

export async function huaweiDeleteKeypair(opts: HuaweiClientOptions, name: string): Promise<any> {
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'DELETE',
    url: '/v1/{project_id}/os-keypairs/{keypair_name}',
    pathParams: { project_id: opts.projectId, keypair_name: name },
  }, 'HuaweiCloud 删除密钥对失败');
}

export async function huaweiListImages(opts: HuaweiClientOptions, params?: { imagetype?: string; osType?: string; limit?: number }): Promise<any> {
  const queryParams: any = { status: 'active', limit: String(params?.limit || 200) };
  if (params?.imagetype) queryParams.__imagetype = params.imagetype;
  if (params?.osType) queryParams.__os_type = params.osType;
  return huaweiHcSend(opts, buildImsEndpoint(opts.region), {
    method: 'GET',
    url: '/v2/cloudimages',
    queryParams,
  }, 'HuaweiCloud 查询镜像失败');
}

// ===== ECS 创建/删除 =====
export async function huaweiCreateServers(opts: HuaweiClientOptions, server: any): Promise<any> {
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'POST',
    url: '/v1/{project_id}/cloudservers',
    pathParams: { project_id: opts.projectId },
    data: { server },
  }, 'HuaweiCloud 创建实例失败');
}

export async function huaweiDeleteServers(opts: HuaweiClientOptions, serverIds: string[], deleteVolume = false): Promise<any> {
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'POST',
    url: '/v1/{project_id}/cloudservers/delete',
    pathParams: { project_id: opts.projectId },
    data: { servers: serverIds.map((id) => ({ id })), delete_publicip: false, delete_volume: !!deleteVolume },
  }, 'HuaweiCloud 删除实例失败');
}

// ===== CES 告警规则 =====
export async function huaweiListAlarms(opts: HuaweiClientOptions): Promise<any> {
  return huaweiHcSend(opts, buildCesEndpoint(opts.region), {
    method: 'GET',
    url: '/V1.0/{project_id}/alarms',
    pathParams: { project_id: opts.projectId },
    queryParams: { limit: '100' },
  }, 'HuaweiCloud 查询告警规则失败');
}

export async function huaweiCreateAlarm(opts: HuaweiClientOptions, alarm: any): Promise<any> {
  return huaweiHcSend(opts, buildCesEndpoint(opts.region), {
    method: 'POST',
    url: '/V1.0/{project_id}/alarms',
    pathParams: { project_id: opts.projectId },
    data: alarm,
  }, 'HuaweiCloud 创建告警规则失败');
}

export async function huaweiDeleteAlarm(opts: HuaweiClientOptions, alarmId: string): Promise<any> {
  return huaweiHcSend(opts, buildCesEndpoint(opts.region), {
    method: 'DELETE',
    url: '/V1.0/{project_id}/alarms/{alarm_id}',
    pathParams: { project_id: opts.projectId, alarm_id: alarmId },
  }, 'HuaweiCloud 删除告警规则失败');
}

export async function huaweiSetAlarmAction(opts: HuaweiClientOptions, alarmId: string, enabled: boolean): Promise<any> {
  return huaweiHcSend(opts, buildCesEndpoint(opts.region), {
    method: 'PUT',
    url: '/V1.0/{project_id}/alarms/{alarm_id}/action',
    pathParams: { project_id: opts.projectId, alarm_id: alarmId },
    data: { alarm_enabled: enabled },
  }, 'HuaweiCloud 启停告警规则失败');
}

// ===== RDS 云数据库 =====
function buildRdsEndpoint(region: string): string {
  return `https://rds.${region}.myhuaweicloud.com`;
}

export async function huaweiListDbInstances(opts: HuaweiClientOptions): Promise<any> {
  return huaweiHcSend(opts, buildRdsEndpoint(opts.region), {
    method: 'GET',
    url: '/v3/{project_id}/instances',
    pathParams: { project_id: opts.projectId },
  }, 'HuaweiCloud 查询云数据库失败');
}

export async function huaweiListDatastores(opts: HuaweiClientOptions, engine: string): Promise<any> {
  return huaweiHcSend(opts, buildRdsEndpoint(opts.region), {
    method: 'GET',
    url: '/v3/{project_id}/datastores/{database_name}',
    pathParams: { project_id: opts.projectId, database_name: engine },
  }, 'HuaweiCloud 查询数据库版本失败');
}

export async function huaweiListRdsFlavors(opts: HuaweiClientOptions, engine: string, version?: string): Promise<any> {
  return huaweiHcSend(opts, buildRdsEndpoint(opts.region), {
    method: 'GET',
    url: '/v3/{project_id}/flavors/{database_name}',
    pathParams: { project_id: opts.projectId, database_name: engine },
    queryParams: version ? { version_name: version } : {},
  }, 'HuaweiCloud 查询数据库规格失败');
}

export async function huaweiCreateDbInstance(opts: HuaweiClientOptions, instance: any): Promise<any> {
  return huaweiHcSend(opts, buildRdsEndpoint(opts.region), {
    method: 'POST',
    url: '/v3/{project_id}/instances',
    pathParams: { project_id: opts.projectId },
    data: instance,
  }, 'HuaweiCloud 创建云数据库失败');
}

export async function huaweiDeleteDbInstance(opts: HuaweiClientOptions, instanceId: string): Promise<any> {
  return huaweiHcSend(opts, buildRdsEndpoint(opts.region), {
    method: 'DELETE',
    url: '/v3/{project_id}/instances/{instance_id}',
    pathParams: { project_id: opts.projectId, instance_id: instanceId },
  }, 'HuaweiCloud 删除云数据库失败');
}

export async function huaweiRestartDbInstance(opts: HuaweiClientOptions, instanceId: string): Promise<any> {
  return huaweiHcSend(opts, buildRdsEndpoint(opts.region), {
    method: 'POST',
    url: '/v3/{project_id}/instances/{instance_id}/action',
    pathParams: { project_id: opts.projectId, instance_id: instanceId },
    data: { restart: {} },
  }, 'HuaweiCloud 重启云数据库失败');
}

// ===== NAT SNAT/DNAT 规则 =====
function buildNatEndpointStr(region: string): string {
  return `https://nat.${region}.myhuaweicloud.com`;
}

export async function huaweiListSnatRules(opts: HuaweiClientOptions, natGatewayId?: string): Promise<any> {
  return huaweiHcSend(opts, buildNatEndpointStr(opts.region), {
    method: 'GET',
    url: '/v2/{project_id}/snat_rules',
    pathParams: { project_id: opts.projectId },
    queryParams: natGatewayId ? { nat_gateway_id: natGatewayId } : {},
  }, 'HuaweiCloud 查询SNAT规则失败');
}

export async function huaweiCreateSnatRule(opts: HuaweiClientOptions, rule: any): Promise<any> {
  return huaweiHcSend(opts, buildNatEndpointStr(opts.region), {
    method: 'POST',
    url: '/v2/{project_id}/snat_rules',
    pathParams: { project_id: opts.projectId },
    data: { snat_rule: rule },
  }, 'HuaweiCloud 创建SNAT规则失败');
}

export async function huaweiDeleteSnatRule(opts: HuaweiClientOptions, natGatewayId: string, snatRuleId: string): Promise<any> {
  return huaweiHcSend(opts, buildNatEndpointStr(opts.region), {
    method: 'DELETE',
    url: '/v2/{project_id}/nat_gateways/{nat_gateway_id}/snat_rules/{snat_rule_id}',
    pathParams: { project_id: opts.projectId, nat_gateway_id: natGatewayId, snat_rule_id: snatRuleId },
  }, 'HuaweiCloud 删除SNAT规则失败');
}

export async function huaweiListDnatRules(opts: HuaweiClientOptions, natGatewayId?: string): Promise<any> {
  return huaweiHcSend(opts, buildNatEndpointStr(opts.region), {
    method: 'GET',
    url: '/v2/{project_id}/dnat_rules',
    pathParams: { project_id: opts.projectId },
    queryParams: natGatewayId ? { nat_gateway_id: natGatewayId } : {},
  }, 'HuaweiCloud 查询DNAT规则失败');
}

export async function huaweiCreateDnatRule(opts: HuaweiClientOptions, rule: any): Promise<any> {
  return huaweiHcSend(opts, buildNatEndpointStr(opts.region), {
    method: 'POST',
    url: '/v2/{project_id}/dnat_rules',
    pathParams: { project_id: opts.projectId },
    data: { dnat_rule: rule },
  }, 'HuaweiCloud 创建DNAT规则失败');
}

export async function huaweiDeleteDnatRule(opts: HuaweiClientOptions, natGatewayId: string, dnatRuleId: string): Promise<any> {
  return huaweiHcSend(opts, buildNatEndpointStr(opts.region), {
    method: 'DELETE',
    url: '/v2/{project_id}/nat_gateways/{nat_gateway_id}/dnat_rules/{dnat_rule_id}',
    pathParams: { project_id: opts.projectId, nat_gateway_id: natGatewayId, dnat_rule_id: dnatRuleId },
  }, 'HuaweiCloud 删除DNAT规则失败');
}

// ===== EIP 申请/释放 =====
async function huaweiEipSend(
  opts: HuaweiClientOptions,
  req: { method: string; url: string; pathParams?: any; data?: any },
  fallbackMsg: string,
): Promise<any> {
  const endpoints = [`https://eip.${opts.region}.myhuaweicloud.com`, `https://vpc.${opts.region}.myhuaweicloud.com`];
  const credentials = buildBasicCredentials(opts);
  let lastErr: any = null;
  for (const ep of endpoints) {
    try {
      const http = new DefaultHttpClient(undefined, [ep]);
      const hc = new HcClient(http);
      hc.withEndpoints([ep]).withCredential(credentials);
      return await hc.sendRequest<any>({
        method: req.method,
        url: req.url,
        contentType: 'application/json',
        queryParams: {},
        pathParams: req.pathParams || {},
        headers: {},
        data: req.data,
      });
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message || '';
      if (!msg.includes('ENOTFOUND')) {
        const code = err?.errorCode || err?.code;
        throw new Error(code ? `${code}: ${msg || fallbackMsg}` : (msg || fallbackMsg));
      }
    }
  }
  const code = lastErr?.errorCode || lastErr?.code;
  throw new Error(code ? `${code}: ${lastErr?.message || fallbackMsg}` : (lastErr?.message || fallbackMsg));
}

export async function huaweiCreatePublicip(
  opts: HuaweiClientOptions,
  payload: { ipType?: string; bandwidthName?: string; bandwidthSize?: number; shareType?: string; chargeMode?: string },
): Promise<any> {
  const data: any = {
    publicip: { type: payload.ipType || '5_bgp' },
    bandwidth: {
      name: payload.bandwidthName || `bw-${Date.now()}`,
      size: Number(payload.bandwidthSize || 5),
      share_type: payload.shareType || 'PER',
    },
  };
  if (payload.chargeMode) data.bandwidth.charge_mode = payload.chargeMode;
  return huaweiEipSend(opts, { method: 'POST', url: '/v1/{project_id}/publicips', pathParams: { project_id: opts.projectId }, data }, 'HuaweiCloud 申请EIP失败');
}

export async function huaweiDeletePublicip(opts: HuaweiClientOptions, publicipId: string): Promise<any> {
  return huaweiEipSend(opts, { method: 'DELETE', url: '/v1/{project_id}/publicips/{publicip_id}', pathParams: { project_id: opts.projectId, publicip_id: publicipId } }, 'HuaweiCloud 释放EIP失败');
}

// ===== EVS 云盘写操作 =====
export async function huaweiCreateVolume(opts: HuaweiClientOptions, volume: any): Promise<any> {
  return huaweiHcSend(opts, buildEvsEndpoint(opts.region), {
    method: 'POST',
    url: '/v2/{project_id}/cloudvolumes',
    pathParams: { project_id: opts.projectId },
    data: { volume },
  }, 'HuaweiCloud 创建云盘失败');
}

export async function huaweiDeleteVolume(opts: HuaweiClientOptions, volumeId: string): Promise<any> {
  return huaweiHcSend(opts, buildEvsEndpoint(opts.region), {
    method: 'DELETE',
    url: '/v2/{project_id}/cloudvolumes/{volume_id}',
    pathParams: { project_id: opts.projectId, volume_id: volumeId },
  }, 'HuaweiCloud 删除云盘失败');
}

export async function huaweiResizeVolume(opts: HuaweiClientOptions, volumeId: string, newSize: number): Promise<any> {
  return huaweiHcSend(opts, buildEvsEndpoint(opts.region), {
    method: 'POST',
    url: '/v2.1/{project_id}/cloudvolumes/{volume_id}/action',
    pathParams: { project_id: opts.projectId, volume_id: volumeId },
    data: { 'os-extend': { new_size: Number(newSize) } },
  }, 'HuaweiCloud 扩容云盘失败');
}

export async function huaweiAttachVolume(opts: HuaweiClientOptions, serverId: string, volumeId: string, device?: string): Promise<any> {
  const volumeAttachment: any = { volumeId };
  if (device) volumeAttachment.device = device;
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'POST',
    url: '/v1/{project_id}/cloudservers/{server_id}/attachvolume',
    pathParams: { project_id: opts.projectId, server_id: serverId },
    data: { volumeAttachment },
  }, 'HuaweiCloud 挂载云盘失败');
}

export async function huaweiDetachVolume(opts: HuaweiClientOptions, serverId: string, volumeId: string): Promise<any> {
  return huaweiHcSend(opts, buildEcsEndpoint(opts.region), {
    method: 'DELETE',
    url: '/v1/{project_id}/cloudservers/{server_id}/detachvolume/{volume_id}',
    pathParams: { project_id: opts.projectId, server_id: serverId, volume_id: volumeId },
  }, 'HuaweiCloud 卸载云盘失败');
}

// ===== EVS 快照写操作 =====
export async function huaweiCreateSnapshot(opts: HuaweiClientOptions, volumeId: string, name?: string, description?: string): Promise<any> {
  const snapshot: any = { volume_id: volumeId, force: true };
  if (name) snapshot.name = name;
  if (description) snapshot.description = description;
  return huaweiHcSend(opts, buildEvsEndpoint(opts.region), {
    method: 'POST',
    url: '/v2/{project_id}/snapshots',
    pathParams: { project_id: opts.projectId },
    data: { snapshot },
  }, 'HuaweiCloud 创建快照失败');
}

export async function huaweiDeleteSnapshot(opts: HuaweiClientOptions, snapshotId: string): Promise<any> {
  return huaweiHcSend(opts, buildEvsEndpoint(opts.region), {
    method: 'DELETE',
    url: '/v2/{project_id}/snapshots/{snapshot_id}',
    pathParams: { project_id: opts.projectId, snapshot_id: snapshotId },
  }, 'HuaweiCloud 删除快照失败');
}

export async function testHuaweiConnection(
  opts: HuaweiClientOptions,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const data = await huaweiListVpcs(opts);
    const ok = !!(data && (Array.isArray((data as any).vpcs) || (data as any).vpcs !== undefined));
    return { ok, message: ok ? '连接成功' : '连接失败，返回数据不完整' };
  } catch (err: any) {
    return { ok: false, message: formatHuaweiCloudErrorMessage(err, '连接失败') };
  }
}
