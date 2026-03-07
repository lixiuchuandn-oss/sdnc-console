import { Router } from 'express';
import { licenseService } from '../../services/LicenseService';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

// 获取当前 License 状态 (公开接口，以便登录前检查)
router.get('/', (req, res) => {
  try {
    const status = licenseService.getStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

// 激活/更新 License (需要管理员权限)
router.post('/activate', authMiddleware, (req, res) => {
  const { licenseKey } = req.body;

  if (!licenseKey) {
    return res.status(400).json({ message: 'License key is required' });
  }

  try {
    const status = licenseService.activate(licenseKey);
    res.json(status);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// [DEV ONLY] 生成测试 License
// 注意：生产环境应移除或严格限制此接口
router.post('/generate-test', (req, res) => {
  const { customerName = 'Test Customer', days = 30, type = 'enterprise' } = req.body;
  try {
    const token = licenseService.generateTestLicense(customerName, days, type);
    res.json({ licenseKey: token });
  } catch (error: any) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
