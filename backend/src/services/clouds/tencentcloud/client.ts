// 使用命名空间导入以兼容 CommonJS 默认导出，避免 undefined 问题
import * as tencentcloud from 'tencentcloud-sdk-nodejs';

export interface TencentOptions {
  secretId: string;
  secretKey: string;
  region: string; // e.g. ap-guangzhou
}

function createCvmClient(opts: TencentOptions) {
  const CvmClient = (tencentcloud as any)?.cvm?.v20170312?.Client;
  if (!CvmClient) {
    throw new Error('Tencent Cloud SDK 加载失败：cvm 客户端未找到');
  }
  return new CvmClient({
    credential: { secretId: opts.secretId, secretKey: opts.secretKey },
    region: opts.region,
    profile: { httpProfile: { endpoint: 'cvm.tencentcloudapi.com' } },
  });
}

function createVpcClient(opts: TencentOptions) {
  const VpcClient = (tencentcloud as any)?.vpc?.v20170312?.Client;
  if (!VpcClient) {
    throw new Error('Tencent Cloud SDK 加载失败：vpc 客户端未找到');
  }
  return new VpcClient({
    credential: { secretId: opts.secretId, secretKey: opts.secretKey },
    region: opts.region,
    profile: { httpProfile: { endpoint: 'vpc.tencentcloudapi.com' } },
  });
}

export async function tencentListInstances(opts: TencentOptions, params: Record<string, any> = {}) {
  const client = createCvmClient(opts);
  try {
    const limit = params && params.Limit !== undefined ? Number(params.Limit) : 50;
    const offset = params && params.Offset !== undefined ? Number(params.Offset) : 0;
    const data = await client.DescribeInstances({ ...params, Limit: limit, Offset: offset });
    return data;
  } catch (err: any) {
    const message = err?.message || 'Tencent CVM 调用失败';
    throw new Error(message);
  }
}

export async function tencentListVpcs(opts: TencentOptions, params: Record<string, any> = {}) {
  const client = createVpcClient(opts);
  try {
    const data = await client.DescribeVpcs({ Limit: '50', Offset: '0', ...params });
    return data;
  } catch (err: any) {
    const message = err?.message || 'Tencent VPC 调用失败';
    throw new Error(message);
  }
}

export async function tencentListSubnets(opts: TencentOptions, params: Record<string, any> = {}) {
  const client = createVpcClient(opts);
  try {
    const data = await client.DescribeSubnets({ Limit: '50', Offset: '0', ...params });
    return data;
  } catch (err: any) {
    const message = err?.message || 'Tencent Subnet 调用失败';
    throw new Error(message);
  }
}

export async function testTencentConnection(opts: TencentOptions): Promise<{ ok: boolean; message?: string }>{
  try {
    const data = await tencentListVpcs(opts, { Limit: '1', Offset: '0' });
    const ok = !!(data && (Array.isArray((data as any)?.VpcSet) || (data as any)?.TotalCount >= 0));
    return { ok, message: ok ? '连接成功' : '连接失败，返回数据不完整' };
  } catch (err: any) {
    return { ok: false, message: err?.message || '连接失败' };
  }
}