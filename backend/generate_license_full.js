const jwt = require('jsonwebtoken');

const secret = '9g4tZ4mQiekqlyDUe4qOD4EkrN5EAYAmkBGWEXw6YaI';

const payload = {
  iss: 'ComputeTower System',
  sub: 'Full Authorization',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (365 * 10 * 24 * 60 * 60), // 10 years
  type: 'enterprise',
  features: [
    // 基础平台服务
    'platform.base', 
    'sys.dashboard', 
    'sys.tenant-mgmt', 
    'sys.rbac-advanced',
    
    // 云管平台 (CNMC)
    'platform.multi-cloud', 
    'network.vpc', 
    'network.kube-ovn', 
    'network.ovn.vpc', 
    
    // SDN 控制中心
    'sdn.cascade', 
    'sdn.interconnect', 
    'sdn.traffic', 
    
    // AISOC 安全运营中心
    'platform.aisoc',
    
    // 其他可能需要的默认项
    'platform.default'
  ],
  limits: {
    maxNodes: 99999,
    maxVms: 999999,
    maxCloudAccounts: 99999
  },
  instanceId: '9ac35fcf-73f5-4bc2-9f95-0b0886b021c3'
};

const token = jwt.sign(payload, secret);
console.log('--- BEGIN LICENSE KEY ---');
console.log(token);
console.log('--- END LICENSE KEY ---');