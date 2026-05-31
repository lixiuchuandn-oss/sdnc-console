/**
 * Harbor 镜像上传路由
 *
 * 处理镜像文件上传并推送到 Harbor 仓库。
 *
 * @see ImageUploadService
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { imageUploadService } from '../../services/harbor/ImageUploadService';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

// 配置 multer 用于文件上传
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB
  },
  fileFilter: (req, file, cb) => {
    console.log('文件过滤器: originalname=', file.originalname, 'mimetype=', file.mimetype);
    // 支持 .tar 格式的镜像文件
    if (
      file.originalname.endsWith('.tar') ||
      file.mimetype === 'application/x-tar' ||
      file.mimetype === 'application/octet-stream'
    ) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .tar 格式的镜像文件'));
    }
  },
});

console.log('uploadRoutes 已加载');

/**
 * POST /api/harbor/registries/:id/images/upload
 * 上传镜像到 Harbor
 *
 * Request Body (multipart/form-data):
 * - file: 镜像 tar 文件
 * - project: Harbor 项目名称
 * - repository: 仓库名称
 * - tag: 镜像标签
 */
router.post(
  '/:id/images/upload',
  authMiddleware,
  upload.single('file'),
  async (req: Request, res: Response) => {
    console.log(
      '收到上传请求: path=',
      req.path,
      'params=',
      req.params,
      'body keys=',
      Object.keys(req.body),
    );

    try {
      const { id } = req.params;
      const { project, repository, tag } = req.body;
      const file = req.file;

      // 参数验证
      if (!file) {
        console.error('未找到上传文件');
        return res.status(400).json({
          success: false,
          message: '未找到上传文件',
        });
      }

      console.log(`上传文件信息: size=${file.size}, originalname=${file.originalname}`);

      if (!project || !repository || !tag) {
        console.error('缺少必要参数:', { project, repository, tag });
        return res.status(400).json({
          success: false,
          message: '缺少必要参数: project, repository, tag',
        });
      }

      // 参数清理
      const cleanProject = project.trim();
      const cleanRepository = repository.trim();
      const cleanTag = tag.trim();

      // 基本格式验证
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(cleanProject)) {
        return res.status(400).json({
          success: false,
          message: '项目名称格式不正确',
        });
      }

      if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(cleanRepository)) {
        return res.status(400).json({
          success: false,
          message: '仓库名称格式不正确',
        });
      }

      if (!/^[a-zA-Z0-9._-]+$/.test(cleanTag)) {
        return res.status(400).json({
          success: false,
          message: '标签格式不正确',
        });
      }

      console.log(
        `开始上传镜像: harbor=${id}, project=${cleanProject}, repository=${cleanRepository}, tag=${cleanTag}, size=${file.size}`,
      );

      // 执行上传
      const result = await imageUploadService.uploadImage({
        harborId: id,
        project: cleanProject,
        repository: cleanRepository,
        tag: cleanTag,
        file,
      });

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      console.error('镜像上传路由错误:', error);
      res.status(500).json({
        success: false,
        message: error.message || '镜像上传失败',
      });
    }
  },
);

/**
 * GET /api/harbor/registries/:id/images/upload/check
 * 检查上传环境是否就绪
 */
router.get('/:id/images/upload/check', authMiddleware, async (req: Request, res: Response) => {
  try {
    const skopeoStatus = await imageUploadService.checkSkopeoAvailable();

    res.json({
      skopeo: skopeoStatus,
      maxSize: '2GB',
      supportedFormats: ['.tar'],
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * POST /api/harbor/registries/:id/images/upload/cleanup
 * 清理临时文件（管理员功能）
 */
router.post('/:id/images/upload/cleanup', authMiddleware, async (req: Request, res: Response) => {
  try {
    const result = await imageUploadService.cleanupTmpFiles();
    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export { router as uploadRoutes };
