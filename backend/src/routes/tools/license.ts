import { Router } from 'express';
import { licenseService, getInstallId } from '../../services/LicenseService';
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

// 获取当前平台唯一安装 ID（用于离线授权绑定）
router.get('/node-id', (req, res) => {
  try {
    const nodeId = getInstallId();
    res.json({ nodeId });
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to get node id' });
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

export default router;
