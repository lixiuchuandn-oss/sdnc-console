const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api';

async function main() {
  try {
    console.log('--- 1. 登录获取 Token ---');
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      username: 'admin',
      password: 'admin123'
    });
    const token = loginRes.data.token;
    console.log('Token 获取成功');

    const headers = { Authorization: `Bearer ${token}` };

    console.log('\n--- 2. 获取当前 License 状态 ---');
    try {
      const statusRes = await axios.get(`${BASE_URL}/system/license`, { headers });
      console.log('Status:', statusRes.data);
    } catch (e) {
      console.log('获取状态失败:', e.response?.data || e.message);
    }

    console.log('\n--- 3. 生成测试 License ---');
    // 注意：这个接口不需要 Auth，因为我们将其设计为开发用的
    const genRes = await axios.post(`${BASE_URL}/system/license/generate-test`, {
      customerName: 'Test Corp',
      days: 30,
      type: 'enterprise'
    }, { headers }); // 虽然不需要 Auth，但带上也无妨
    const licenseKey = genRes.data.licenseKey;
    console.log('Generated License Key:', licenseKey.substring(0, 20) + '...');

    console.log('\n--- 4. 激活 License ---');
    const activateRes = await axios.post(`${BASE_URL}/system/license/activate`, {
      licenseKey
    }, { headers });
    console.log('Activation Result:', activateRes.data);

    console.log('\n--- 5. 再次获取 License 状态 ---');
    const newStatusRes = await axios.get(`${BASE_URL}/system/license`, { headers });
    console.log('New Status:', newStatusRes.data);

  } catch (error) {
    console.error('Test Failed:', error.response?.data || error.message);
  }
}

main();
