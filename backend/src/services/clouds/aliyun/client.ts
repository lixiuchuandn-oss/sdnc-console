import RPCClient from '@alicloud/pop-core';

export interface AliyunRpcOptions {
  accessKeyId: string;
  accessKeySecret: string;
  regionId: string;
  action: string;
  version?: string; // default ECS 2014-05-26
  extraParams?: Record<string, string | number | boolean>;
}

export async function callAliyunEcs(options: AliyunRpcOptions): Promise<any> {
  const {
    accessKeyId,
    accessKeySecret,
    regionId,
    action,
    version = '2014-05-26',
    extraParams = {}
  } = options;

  const client = new RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint: 'https://ecs.aliyuncs.com',
    apiVersion: version
  });

  const params = { RegionId: regionId, ...extraParams } as Record<string, any>;
  try {
    const result = await client.request(action, params, { method: 'GET' });
    return result;
  } catch (err: any) {
    const code = err?.code || err?.name;
    const message = err?.message || 'Aliyun SDK 调用失败';
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function callAliyunSlb(options: AliyunRpcOptions): Promise<any> {
  const {
    accessKeyId,
    accessKeySecret,
    regionId,
    action,
    version = '2014-05-15',
    extraParams = {}
  } = options;

  const client = new RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint: 'https://slb.aliyuncs.com',
    apiVersion: version
  });

  const params = { RegionId: regionId, ...extraParams } as Record<string, any>;
  try {
    const result = await client.request(action, params, { method: 'GET' });
    return result;
  } catch (err: any) {
    const code = err?.code || err?.name;
    const message = err?.message || 'Aliyun SLB 调用失败';
    throw new Error(code ? `${code}: ${message}` : message);
  }
}

export async function callAliyunVpc(options: AliyunRpcOptions): Promise<any> {
  const {
    accessKeyId,
    accessKeySecret,
    regionId,
    action,
    version = '2016-04-28',
    extraParams = {}
  } = options;

  const client = new RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint: 'https://vpc.aliyuncs.com',
    apiVersion: version
  });

  const params = { RegionId: regionId, ...extraParams } as Record<string, any>;
  try {
    const result = await client.request(action, params, { method: 'GET' });
    return result;
  } catch (err: any) {
    const code = err?.code || err?.name;
    const message = err?.message || 'Aliyun VPC 调用失败';
    throw new Error(code ? `${code}: ${message}` : message);
  }
}
export async function testAliyunConnection(opts: AliyunRpcOptions): Promise<{ ok: boolean; message?: string }>{
  try {
    const data = await callAliyunEcs({ ...opts, action: 'DescribeVpcs', extraParams: { PageSize: 1 } });
    const ok = !!(data && (data.TotalCount !== undefined || data.Vpcs || data.VpcSets));
    return { ok, message: ok ? '连接成功' : '连接失败，返回数据不完整' };
  } catch (err: any) {
    return { ok: false, message: err?.message || '连接失败' };
  }
}

export async function callAliyunCms(options: AliyunRpcOptions & { namespace?: string }): Promise<any> {
  const {
    accessKeyId,
    accessKeySecret,
    regionId,
    action,
    version = '2019-01-01',
    extraParams = {}
  } = options;

  const client = new RPCClient({
    accessKeyId,
    accessKeySecret,
    endpoint: 'https://metrics.aliyuncs.com',
    apiVersion: version
  });

  const params = { RegionId: regionId, ...extraParams } as Record<string, any>;
  try {
    const result = await client.request(action, params, { method: 'GET' });
    return result;
  } catch (err: any) {
    const code = err?.code || err?.name;
    const message = err?.message || 'Aliyun CMS 调用失败';
    throw new Error(code ? `${code}: ${message}` : message);
  }
}