import { listCsmVms } from './src/services/clouds/csm/client';

async function main() {
  console.log('=== 测试 CSM VM 查询集成 ===');
  
  // Create a mock cloud object
   const cloud = {
     endpoint: 'https://10.21.100.35:8011',
     accessKey: 'Cloudmap#123',
     secretKey: 'Cloudmap#123',
     ignoreTls: true
   };

   try {
     console.log('调用 listCsmVms...');
     const vms = await listCsmVms(cloud);
    console.log(`查询成功，共找到 ${vms.length} 台虚拟机`);
    if (vms.length > 0) {
      console.log('第一台虚拟机示例:', vms[0]);
    }
  } catch (error: any) {
    console.error('查询失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', JSON.stringify(error.response.data));
    }
  }
}

main();
