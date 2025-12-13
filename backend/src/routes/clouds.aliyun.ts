import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Cloud } from '../entities/Cloud';
import { callAliyunEcs, callAliyunVpc, callAliyunCms, callAliyunSlb } from '../services/aliyun';

const fetchCloudOr404 = async (id: string, res: Response) => {
  const repo = AppDataSource.getRepository(Cloud);
  const cloud = await repo.findOne({ where: { id } });
  if (!cloud) { res.status(404).json({ message: '云资源不存在' }); return null; }
  return cloud;
};

const isAliyun = (cloud: any) => {
  const p = String(cloud?.config?.provider || '').toLowerCase();
  return p.includes('aliyun');
};

export const registerAliyunRoutes = (router: Router, checkAdminPermission: any) => {
  router.get('/:id/resources/ecs', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const data = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeInstances', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
      const capabilities = { isHarvester: false, supportsInstanceType: true, supportsZone: true, supportsVpc: true, supportsNetworkFusion: false, supportsMultus: false };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ message: '查询ECS失败', error: error.message });
    }
  });

  router.get('/:id/resources/vpcs', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '缺少阿里云访问密钥' });
      const data = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcs' } as any);
      res.json({ message: '查询成功', data });
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ message: '查询VPC失败', error: error.message });
    }
  });

  router.post('/:id/resources/vpcs', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id } = req.params;
      const { VpcName, CidrBlock, Description, EnableIpv6, Ipv6CidrBlock } = req.body || {};
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!CidrBlock) return res.status(400).json({ message: '缺少必填参数：CidrBlock' });
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const extraParams: Record<string, any> = { CidrBlock };
      if (VpcName) extraParams.VpcName = VpcName;
      if (Description) extraParams.Description = Description;
      if (EnableIpv6 !== undefined) extraParams.EnableIpv6 = !!EnableIpv6;
      if (Ipv6CidrBlock) extraParams.Ipv6CidrBlock = Ipv6CidrBlock;
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'CreateVpc', extraParams });
      res.json({ message: '创建成功', data: result });
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ message: '创建VPC失败', error: error.message });
    }
  });

  router.delete('/:id/resources/vpcs/:vpcId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, vpcId } = req.params;
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!vpcId) return res.status(400).json({ message: '缺少 VPC 标识 vpcId' });
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DeleteVpc', extraParams: { VpcId: vpcId } } as any);
      res.json({ message: '删除成功', data: result });
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ message: '删除VPC失败', error: error.message });
    }
  });

  router.patch('/:id/resources/vpcs/:vpcId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, vpcId } = req.params;
      const { VpcName, Description } = req.body || {};
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!vpcId) return res.status(400).json({ message: '缺少 VPC 标识 vpcId' });
      if (VpcName === undefined && Description === undefined) return res.status(400).json({ message: '至少提供一个可修改字段：VpcName 或 Description' });
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'ModifyVpcAttribute', extraParams: { VpcId: vpcId, ...(VpcName ? { VpcName } : {}), ...(Description ? { Description } : {}) } } as any);
      res.json({ message: '更新成功', data: result });
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ message: '更新VPC失败', error: error.message });
    }
  });

  router.get('/:id/resources/vswitches', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id } = req.params; const { vpcId } = (req.query || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '缺少阿里云访问密钥' });
      const pageSize = 50; let page = 1; let all: any[] = [];
      while (true) {
        const resp = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVSwitches', extraParams: { PageNumber: page, PageSize: pageSize, ...(vpcId ? { VpcId: vpcId } : {}) } } as any);
        const chunk = resp?.VSwitches?.VSwitch || [];
        all = all.concat(Array.isArray(chunk) ? chunk : []);
        if (!Array.isArray(chunk) || chunk.length < pageSize) break;
        page += 1; if (page > 50) break;
      }
      const p = String(cloud.config?.provider || '').toLowerCase();
      const capabilities = { isHarvester: p === 'harvester', supportsVpc: true, supportsNetworkFusion: false, supportsMultus: false };
      res.json({ message: '查询成功', data: { VSwitches: { VSwitch: all } }, capabilities });
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ message: '查询子网失败', error: error.message });
    }
  });

  router.post('/:id/resources/vswitches', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id } = req.params; const { VpcId, ZoneId, CidrBlock, VSwitchName, Description } = req.body || {}; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!VpcId || !ZoneId || !CidrBlock) return res.status(400).json({ message: '缺少必填参数：VpcId、ZoneId、CidrBlock' });
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const extraParams: Record<string, any> = { VpcId, ZoneId, CidrBlock };
      if (VSwitchName) extraParams.VSwitchName = VSwitchName;
      if (Description) extraParams.Description = Description;
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'CreateVSwitch', extraParams });
      res.json({ message: '创建成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '创建VSwitch失败', error: error.message }); }
  });

  router.delete('/:id/resources/vswitches/:vswitchId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, vswitchId } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!vswitchId) return res.status(400).json({ message: '缺少 VSwitch 标识 vswitchId' });
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DeleteVSwitch', extraParams: { VSwitchId: vswitchId } } as any);
      res.json({ message: '删除成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '删除VSwitch失败', error: error.message }); }
  });

  router.get('/:id/resources/subnets', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id } = req.params; const { vpcId } = (req.query || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '缺少阿里云访问密钥' });
      const pageSize = 50; let page = 1; let all: any[] = [];
      while (true) {
        const resp = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVSwitches', extraParams: { PageNumber: page, PageSize: pageSize, ...(vpcId ? { VpcId: vpcId } : {}) } } as any);
        const chunk = resp?.VSwitches?.VSwitch || [];
        all = all.concat(Array.isArray(chunk) ? chunk : []);
        if (!Array.isArray(chunk) || chunk.length < pageSize) break;
        page += 1; if (page > 50) break;
      }
      const capabilities = { isHarvester: false, supportsSubnets: true, supportsNetworkFusion: false, supportsMultus: false };
      res.json({ message: '查询成功', data: { VSwitches: { VSwitch: all } }, capabilities });
    } catch (error: any) {
      if (res.headersSent) return;
      return res.status(500).json({ message: '查询子网失败', error: error.message });
    }
  });

  // Security Groups
  router.get('/:id/resources/security-groups', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
      const data = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeSecurityGroups', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
      const capabilities = { isHarvester: false, supportsEip: true };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询SecurityGroups失败', error: error.message }); }
  });
  router.post('/:id/resources/security-groups', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const { vpcId, name, description } = (req.body || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      if (!vpcId || !name) return res.status(400).json({ message: '缺少必要参数 vpcId 或 name' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'CreateSecurityGroup', extraParams: { VpcId: vpcId, SecurityGroupName: name, ...(description ? { Description: description } : {}) } } as any);
      res.json({ message: '创建成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '创建安全组失败', error: error.message }); }
  });
  router.patch('/:id/resources/security-groups/:sgId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id, sgId } = req.params; const { name, description } = (req.body || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'ModifySecurityGroupAttribute', extraParams: { SecurityGroupId: sgId, ...(name ? { SecurityGroupName: name } : {}), ...(description ? { Description: description } : {}) } } as any);
      res.json({ message: '更新成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '更新安全组失败', error: error.message }); }
  });
  router.delete('/:id/resources/security-groups/:sgId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id, sgId } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DeleteSecurityGroup', extraParams: { SecurityGroupId: sgId } } as any);
      res.json({ message: '删除成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '删除安全组失败', error: error.message }); }
  });

  // ENIs
  router.get('/:id/resources/enis', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const { vSwitchId, instanceId } = (req.query || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
      const pageSize = 50; let page = 1; let all: any[] = [];
      while (true) {
        const resp = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeNetworkInterfaces', extraParams: { PageNumber: page, PageSize: pageSize, ...(vSwitchId ? { VSwitchId: vSwitchId } : {}), ...(instanceId ? { InstanceId: instanceId } : {}) } } as any);
        const chunk = resp?.NetworkInterfaces?.NetworkInterface || [];
        all = all.concat(Array.isArray(chunk) ? chunk : []);
        if (!Array.isArray(chunk) || chunk.length < pageSize) break;
        page += 1; if (page > 50) break;
      }
      const capabilities = { isHarvester: false, supportsEni: true };
      res.json({ message: '查询成功', data: { NetworkInterfaces: { NetworkInterface: all } }, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询ENI失败', error: error.message }); }
  });
  router.post('/:id/resources/enis', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const { vSwitchId, securityGroupId, name, description, ipv4Address } = (req.body || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      if (!vSwitchId || !securityGroupId) return res.status(400).json({ message: '缺少必要参数：vSwitchId 或 securityGroupId' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'CreateNetworkInterface', extraParams: { VSwitchId: vSwitchId, SecurityGroupId: securityGroupId, ...(name ? { NetworkInterfaceName: name } : {}), ...(description ? { Description: description } : {}), ...(ipv4Address ? { PrimaryIpAddress: ipv4Address } : {}) } } as any);
      res.json({ message: '创建成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '创建ENI失败', error: error.message }); }
  });
  router.patch('/:id/resources/enis/:eniId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id, eniId } = req.params; const { name, description } = (req.body || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'ModifyNetworkInterfaceAttribute', extraParams: { NetworkInterfaceId: eniId, ...(name ? { NetworkInterfaceName: name } : {}), ...(description ? { Description: description } : {}) } } as any);
      res.json({ message: '更新成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '更新ENI失败', error: error.message }); }
  });
  router.delete('/:id/resources/enis/:eniId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id, eniId } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DeleteNetworkInterface', extraParams: { NetworkInterfaceId: eniId } } as any);
      res.json({ message: '删除成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '删除ENI失败', error: error.message }); }
  });

  // Network ACLs
  router.get('/:id/resources/network-acls', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const { vpcId } = (req.query || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
      const data = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeNetworkAcls', extraParams: { ...(vpcId ? { VpcId: vpcId } : {}) } } as any);
      const capabilities = { isHarvester: false, supportsRouteTables: true };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询网络ACL失败', error: error.message }); }
  });
  router.post('/:id/resources/network-acls', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const { vpcId, name, description } = (req.body || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      if (!vpcId || !name) return res.status(400).json({ message: '缺少必要参数：vpcId 或 name' });
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'CreateNetworkAcl', extraParams: { VpcId: vpcId, NetworkAclName: name, ...(description ? { Description: description } : {}) } } as any);
      res.json({ message: '创建成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '创建网络ACL失败', error: error.message }); }
  });
  router.patch('/:id/resources/network-acls/:aclId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id, aclId } = req.params; const { name, description } = (req.body || {}) as any; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'UpdateNetworkAclAttributes', extraParams: { NetworkAclId: aclId, ...(name ? { NetworkAclName: name } : {}), ...(description ? { Description: description } : {}) } } as any);
      res.json({ message: '更新成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '更新网络ACL失败', error: error.message }); }
  });
  router.delete('/:id/resources/network-acls/:aclId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id, aclId } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DeleteNetworkAcl', extraParams: { NetworkAclId: aclId } } as any);
      res.json({ message: '删除成功', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '删除网络ACL失败', error: error.message }); }
  });

  // EIPs
  router.get('/:id/resources/eips', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
      const data = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeEipAddresses', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
      const capabilities = { isHarvester: false, supportsEip: true };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询EIP失败', error: error.message }); }
  });

  // Load Balancers
  router.get('/:id/resources/loadbalancers', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
      const data = await callAliyunSlb({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeLoadBalancers', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
      const capabilities = { isHarvester: false, supportsSnapshots: true };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询负载均衡失败', error: error.message }); }
  });

  // NAT Gateways
  router.get('/:id/resources/nat-gateways', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
      const data = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeNatGateways', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
      const capabilities = { isHarvester: false, supportsRouteTables: true };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询NAT网关失败', error: error.message }); }
  });

  // Route Tables
  router.get('/:id/resources/route-tables', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const { vpcId } = req.query as { vpcId?: string }; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '缺少阿里云访问密钥' });
      const fetchRtByVpc = async (VpcId: string) => { const resp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeRouteTableList', extraParams: { VpcId, RouterType: 'VRouter', PageNumber: 1, PageSize: 50 } } as any); const arr: any[] = resp?.RouterTableList?.RouterTableListType || []; return Array.isArray(arr) ? arr : []; };
      let data: any;
      if (vpcId) { data = await fetchRtByVpc(vpcId); }
      else {
        const vpcResp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeVpcs', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
        const vpcs: any[] = vpcResp?.Vpcs?.Vpc || []; const ids: string[] = (Array.isArray(vpcs) ? vpcs : []).map(v => v?.VpcId).filter(Boolean);
        const all: any[] = []; for (const vid of ids) { const items = await fetchRtByVpc(vid); all.push(...items); } data = all;
      }
      const capabilities = { isHarvester: false, supportsDisk: true };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询路由表失败', error: error.message }); }
  });
  router.get('/:id/resources/route-entries', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const { routeTableId } = req.query as { routeTableId?: string }; if (!routeTableId) return res.status(400).json({ message: '缺少 routeTableId 参数' });
      const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '缺少阿里云访问密钥' });
      const resp: any = await callAliyunVpc({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeRouteEntryList', extraParams: { RouteTableId: routeTableId, PageNumber: 1, PageSize: 50 } } as any);
      const list = resp?.RouteEntries?.RouteEntry || resp?.RouteEntryList?.RouteEntry || resp?.RouteEntry || [];
      res.json({ message: '查询成功', data: Array.isArray(list) ? list : [] });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询路由条目失败', error: error.message }); }
  });

  // Disks
  router.get('/:id/resources/disks', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '本期仅支持阿里云资源查询' });
      const data = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeDisks', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
      const capabilities = { isHarvester: false, supportsSnapshots: true };
      res.json({ message: '查询成功', data, capabilities });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询云盘失败', error: error.message }); }
  });

  // Snapshots
  router.get('/:id/resources/snapshots', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try { const { id } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return; if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey) return res.status(400).json({ message: '缺少阿里云访问密钥' });
      const data = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeSnapshots', extraParams: { PageNumber: 1, PageSize: 50 } } as any);
      res.json({ message: '查询成功', data });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询快照失败', error: error.message }); }
  });

  router.post('/:id/resources/ecs/:instanceId/start', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, instanceId } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'StartInstance', extraParams: { InstanceId: instanceId } } as any);
      res.json({ message: '启动指令已下发', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '启动实例失败', error: error.message }); }
  });

  router.post('/:id/resources/ecs/:instanceId/stop', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, instanceId } = req.params; const { force } = req.body as { force?: boolean }; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'StopInstance', extraParams: { InstanceId: instanceId, ForceStop: !!force } } as any);
      res.json({ message: '停止指令已下发', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '停止实例失败', error: error.message }); }
  });

  router.post('/:id/resources/ecs/:instanceId/reboot', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, instanceId } = req.params; const { force } = req.body as { force?: boolean }; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'RebootInstance', extraParams: { InstanceId: instanceId, ForceStop: !!force } } as any);
      res.json({ message: '重启指令已下发', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '重启实例失败', error: error.message }); }
  });

  router.delete('/:id/resources/ecs/:instanceId', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, instanceId } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DeleteInstance', extraParams: { InstanceId: instanceId } } as any);
      res.json({ message: '删除指令已下发', data: result });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '删除实例失败', error: error.message }); }
  });

  router.get('/:id/resources/ecs/:instanceId/vnc-url', checkAdminPermission, async (req: any, res: Response, next: any) => {
    try {
      const { id, instanceId } = req.params; const cloud = await fetchCloudOr404(id, res); if (!cloud) return;
      if (!isAliyun(cloud)) return next();
      if (!cloud.accessKey || !cloud.secretKey || !cloud.region) return res.status(400).json({ message: '缺少阿里云访问密钥或地域信息' });
      const result = await callAliyunEcs({ accessKeyId: cloud.accessKey, accessKeySecret: cloud.secretKey, regionId: cloud.region, action: 'DescribeInstanceVncUrl', extraParams: { InstanceId: instanceId } } as any);
      const url = (result && (result.VncUrl || (result as any).vncUrl)) || null;
      res.json({ message: '查询成功', data: { VncUrl: url } });
    } catch (error: any) { if (res.headersSent) return; return res.status(500).json({ message: '查询VNC地址失败', error: error.message }); }
  });
};