import { listCsmVms, getCsmPoolInfo, csmRequest } from './src/services/clouds/csm/client';

async function main() {
  console.log('=== 测试 CSM VM 查询集成 ===');
  
  // Create a mock cloud object
   const cloud = {
     endpoint: 'https://10.21.100.35:8011',
     ak: '80b43f03e2304919999330999081014e',
     sk: 'd337d105e4c64391a675076292379d7d',
     accessKey: '80b43f03e2304919999330999081014e',
     secretKey: 'd337d105e4c64391a675076292379d7d',
     ignoreTls: true
   };

   try {
     console.log('调用 VR1/pagelist...');
     const vrResp = await csmRequest(cloud, '/V2/ctcontrol/VR1/pagelist', { page_num: 1, page_size: 10 });
     console.log('VR1 Response:', JSON.stringify(vrResp));

     console.log('调用 getCsmPoolInfo...');
     const pool = await getCsmPoolInfo(cloud);
     console.log('Pool Info:', JSON.stringify(pool));

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
