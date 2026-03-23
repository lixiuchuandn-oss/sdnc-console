/**
 * 部署 Docker Registry 到 Harvester
 */

const axios = require('axios');

const API_BASE = 'http://localhost:5001';
let AUTH_TOKEN = '';

// 登录获取 Token
async function login() {
  console.log('正在登录...');
  
  try {
    const response = await axios.post(`${API_BASE}/api/auth/login`, {
      username: 'admin',
      password: 'admin123'
    });
    
    AUTH_TOKEN = response.data.access_token || response.data.token;
    console.log('登录成功');
    return AUTH_TOKEN;
  } catch (e) {
    console.error('登录失败:', e.response?.data || e.message);
    throw e;
  }
}

// 获取 Harvester 云环境
async function getHarvesterCloud() {
  const response = await axios.get(`${API_BASE}/api/clouds`, {
    headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
  });
  const clouds = response.data?.data || response.data || [];
  return clouds.find(c => c.provider === 'harvester');
}

// 创建 PVC
async function createPVC(cloudId) {
  console.log('\n[1/3] 创建 PVC...');
  
  try {
    const response = await axios.post(
      `${API_BASE}/api/clouds/${cloudId}/resources/harvester/volumes`,
      {
        namespace: 'default',
        name: 'docker-registry-pvc',
        sizeGi: 10,
        accessModes: ['ReadWriteOnce'],
      },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    );
    
    console.log('PVC 创建成功:', response.data?.metadata?.name || '成功');
    return true;
  } catch (e) {
    if (e.response?.status === 409 || e.response?.data?.message?.includes('already exists')) {
      console.log('PVC 已存在，跳过创建');
      return true;
    }
    console.error('PVC 创建失败:', e.response?.data || e.message);
    return false;
  }
}

// 创建 Deployment
async function createDeployment(cloudId) {
  console.log('\n[2/3] 创建 Deployment...');
  
  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'docker-registry',
      namespace: 'default',
      labels: { app: 'docker-registry' }
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { app: 'docker-registry' }
      },
      template: {
        metadata: {
          labels: { app: 'docker-registry' }
        },
        spec: {
          containers: [{
            name: 'registry',
            image: 'registry:2',
            ports: [{ containerPort: 5000 }],
            volumeMounts: [{
              name: 'registry-storage',
              mountPath: '/var/lib/registry'
            }],
            env: [{
              name: 'REGISTRY_STORAGE_DELETE_ENABLED',
              value: 'true'
            }]
          }],
          volumes: [{
            name: 'registry-storage',
            persistentVolumeClaim: {
              claimName: 'docker-registry-pvc'
            }
          }]
        }
      }
    }
  };

  try {
    const response = await axios.post(
      `${API_BASE}/api/clouds/${cloudId}/resources/harvester/containers/create`,
      {
        apiPath: '/apis/apps/v1/deployments',
        namespace: 'default',
        body: deployment
      },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    );
    
    console.log('Deployment 创建成功:', response.data?.message);
    return true;
  } catch (e) {
    if (e.response?.status === 409 || e.response?.data?.message?.includes('already exists')) {
      console.log('Deployment 已存在，跳过创建');
      return true;
    }
    console.error('Deployment 创建失败:', e.response?.data || e.message);
    return false;
  }
}

// 创建 Service
async function createService(cloudId) {
  console.log('\n[3/3] 创建 Service...');
  
  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: 'docker-registry',
      namespace: 'default'
    },
    spec: {
      type: 'NodePort',
      selector: {
        app: 'docker-registry'
      },
      ports: [{
        port: 5000,
        targetPort: 5000,
        nodePort: 30500
      }]
    }
  };

  try {
    const response = await axios.post(
      `${API_BASE}/api/clouds/${cloudId}/resources/harvester/containers/create`,
      {
        apiPath: '/api/v1/services',
        namespace: 'default',
        body: service
      },
      { headers: { Authorization: `Bearer ${AUTH_TOKEN}` } }
    );
    
    console.log('Service 创建成功:', response.data?.message);
    return true;
  } catch (e) {
    if (e.response?.status === 409 || e.response?.data?.message?.includes('already exists')) {
      console.log('Service 已存在，跳过创建');
      return true;
    }
    console.error('Service 创建失败:', e.response?.data || e.message);
    return false;
  }
}

// 主函数
async function main() {
  console.log('========================================');
  console.log('部署 Docker Registry 到 Harvester');
  console.log('========================================');
  
  try {
    // 登录
    await login();
    
    // 获取 Harvester 云环境
    const cloud = await getHarvesterCloud();
    if (!cloud) {
      console.error('未找到 Harvester 资源池');
      process.exit(1);
    }
    console.log('Harvester 资源池:', cloud.name);
    console.log('云环境 ID:', cloud.id);
    
    // 创建资源
    const pvcOk = await createPVC(cloud.id);
    const deployOk = await createDeployment(cloud.id);
    const svcOk = await createService(cloud.id);
    
    console.log('\n========================================');
    console.log('部署结果:');
    console.log('  PVC:', pvcOk ? '成功' : '失败');
    console.log('  Deployment:', deployOk ? '成功' : '失败');
    console.log('  Service:', svcOk ? '成功' : '失败');
    console.log('========================================');
    
    if (pvcOk && deployOk && svcOk) {
      console.log('\nDocker Registry 部署完成!');
      console.log('访问地址: <Harvester节点IP>:30500');
      console.log('\n测试命令:');
      console.log('  curl http://<节点IP>:30500/v2/_catalog');
    }
    
  } catch (e) {
    console.error('部署失败:', e.message);
    process.exit(1);
  }
}

main();
