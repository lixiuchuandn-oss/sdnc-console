const path = require('path');

jest.mock('@huaweicloud/huaweicloud-sdk-vpc', () => {
  class CreateVpcOption {
    constructor() { this.cidr = undefined; this.name = undefined; this.description = undefined; this.tags = undefined; }
    withCidr(v) { this.cidr = v; return this; }
    withName(v) { this.name = v; return this; }
    withDescription(v) { this.description = v; return this; }
    withTags(v) { this.tags = v; return this; }
  }
  class CreateVpcRequestBody { constructor(){ this.vpc = undefined; } withVpc(v){ this.vpc = v; return this; } }
  class CreateVpcRequest { constructor(){ this.body = undefined; } withBody(b){ this.body = b; return this; } }

  class UpdateVpcOption {
    constructor(){ this.name = undefined; this.description = undefined; this.cidr = undefined; this.tags = undefined; }
    withName(v){ this.name = v; return this; }
    withDescription(v){ this.description = v; return this; }
    withCidr(v){ this.cidr = v; return this; }
    withTags(v){ this.tags = v; return this; }
  }
  class UpdateVpcRequestBody { constructor(){ this.vpc = undefined; } withVpc(v){ this.vpc = v; return this; } }
  class UpdateVpcRequest { constructor(vpcId){ this.vpcId = vpcId; this.body = undefined; } withBody(b){ this.body = b; return this; } }

  class Builder { withCredential(){ return this; } withEndpoint(){ return this; } build(){ return new VpcClient(); } }
  class VpcClient { static newBuilder(){ return new Builder(); } async createVpc(request){ return { request }; } async updateVpc(request){ return { request }; } }
  return { VpcClient, CreateVpcRequest, CreateVpcRequestBody, CreateVpcOption, UpdateVpcRequest, UpdateVpcRequestBody, UpdateVpcOption };
});

jest.mock('@huaweicloud/huaweicloud-sdk-core/auth/BasicCredentials', () => {
  class BasicCredentials { withAk(){ return this; } withSk(){ return this; } withProjectId(){ return this; } }
  return { BasicCredentials };
});

const { huaweiCreateVpc, huaweiUpdateVpc } = require(path.join(__dirname, '..', 'dist', 'services', 'clouds', 'huaweicloud', 'client.js'));

describe('Huawei VPC client payloads (JS)', () => {
  const opts = { ak: 'ak', sk: 'sk', region: 'cn-north-4', projectId: 'pid' };

  test('createVpc trims name and ignores empty description', async () => {
    const resp = await huaweiCreateVpc(opts, { cidr: '10.0.0.0/16', name: '  vpc-a  ', description: '' });
    const body = resp?.request?.body;
    expect(body?.vpc?.cidr).toBe('10.0.0.0/16');
    expect(body?.vpc?.name).toBe('vpc-a');
    expect(body?.vpc?.description).toBeUndefined();
  });

  test('createVpc does not set name when empty string', async () => {
    const resp = await huaweiCreateVpc(opts, { cidr: '10.1.0.0/16', name: '   ' });
    const body = resp?.request?.body;
    expect(body?.vpc?.cidr).toBe('10.1.0.0/16');
    expect(body?.vpc?.name).toBeUndefined();
  });

  test('updateVpc trims fields and does not include tags', async () => {
    const resp = await huaweiUpdateVpc(opts, 'vpc-123', { name: '  new  ', description: '  d  ', cidr: ' 10.2.0.0/16 ' });
    const body = resp?.request?.body;
    expect(body?.vpc?.name).toBe('new');
    expect(body?.vpc?.description).toBe('d');
    expect(body?.vpc?.cidr).toBe('10.2.0.0/16');
    expect(body?.vpc?.tags).toBeUndefined();
  });
});