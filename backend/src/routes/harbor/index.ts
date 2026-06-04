/**
 * Harbor 路由入口
 *
 * 汇总所有 Harbor 相关路由。
 *
 * @see design/harbor-integration-design.md 第三章
 */
import { Router, Response } from 'express';
import multer from 'multer';
import { AppDataSource } from '../../config/database';
import { HarborRegistry } from '../../entities/harbor/HarborRegistry';
import {
  ImageUploadTask,
  UploadTaskStatus,
  RegistryType,
} from '../../entities/ImageUploadTask';
import { parseDockerImageFromBuffer } from '../../services/ImageTarParser';
import { pushImageToRegistry } from '../../services/DockerRegistryPusher';
import { registriesRoutes } from './registries.routes';
import { projectsRoutes } from './projects.routes';
import { uploadRoutes } from './upload.routes';
import { replicationRoutes } from './replication.routes';
import { scanRoutes } from './scan.routes';
import { syncRoutes } from './sync.routes';
import { authMiddleware, AuthRequest } from '../../middleware/auth';
import { checkPermission } from '../../permissions';
import { logger } from '../../utils/logger';

const harborLog = logger.child('HarborUpload');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 10 },
});

const uploadTaskRepo = AppDataSource.getRepository(ImageUploadTask);
const harborRegistryRepo = AppDataSource.getRepository(HarborRegistry);

function decryptHarborPassword(encrypted: string): string {
  return Buffer.from(encrypted, 'base64').toString().split('').reverse().join('');
}

async function processHarborUpload(
  taskId: string,
  harbor: HarborRegistry,
  project: string,
  repoName: string,
  tag: string,
  tarBuffer: Buffer,
) {
  const task = await uploadTaskRepo.findOne({ where: { id: taskId } });
  if (!task) return;

  try {
    task.status = UploadTaskStatus.PARSING;
    await uploadTaskRepo.save(task);

    const parsedImage = await parseDockerImageFromBuffer(tarBuffer);
    task.totalLayers = parsedImage.layers.length;
    await uploadTaskRepo.save(task);

    task.status = UploadTaskStatus.UPLOADING;
    await uploadTaskRepo.save(task);

    const repository = `${project}/${repoName}`;

    const isHttps = harbor.url.startsWith('https://');

    await pushImageToRegistry(
      parsedImage,
      {
        server: harbor.url.replace(/^https?:\/\//, ''),
        repository,
        tag,
        insecure: false,
        rejectUnauthorized: isHttps ? false : undefined,
        username: harbor.username,
        password: decryptHarborPassword(harbor.password),
      },
      async (progress) => {
        task.uploadedLayers = progress.current;
        task.currentLayer = progress.currentBlob;
        await uploadTaskRepo.save(task);
      },
    );

    task.status = UploadTaskStatus.COMPLETED;
    await uploadTaskRepo.save(task);
  } catch (err: any) {
    harborLog.error(`Harbor 上传任务 ${taskId} 失败:`, err);
    task.status = UploadTaskStatus.FAILED;
    task.error = err.message || '未知错误';
    await uploadTaskRepo.save(task);
  }
}

const router = Router();

router.post(
  '/registries/:id/projects/:project/upload',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const perms: string[] = Array.isArray((req.user as any)?.permissions)
        ? (req.user as any).permissions
        : [];
      if (!checkPermission(perms, 'harbor.image:push')) {
        return res.status(403).json({ message: '权限不足' });
      }

      upload.array('files', 10)(req, res, async (err: any) => {
        if (err) {
          return res.status(400).json({ message: '文件上传失败', error: err.message });
        }

        const { id: harborId, project } = req.params;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
          return res.status(400).json({ message: '请选择要上传的文件' });
        }

        const harbor = await harborRegistryRepo.findOne({ where: { id: harborId } });
        if (!harbor) {
          return res.status(404).json({ message: 'Harbor 实例不存在' });
        }

        const tasks: ImageUploadTask[] = [];

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const repoName = req.body[`repoName${i + 1}`] || req.body.repoName || 'library';
          const tag = req.body[`tag${i + 1}`] || req.body.tag || 'latest';

          const task = uploadTaskRepo.create({
            fileName: file.originalname || `image-${i}.tar`,
            targetRepo: repoName,
            targetTag: tag,
            status: UploadTaskStatus.PENDING,
            registryType: RegistryType.HARBOR,
            harborId,
            projectName: project,
            totalLayers: 0,
            uploadedLayers: 0,
          });
          await uploadTaskRepo.save(task);
          tasks.push(task);

          processHarborUpload(task.id, harbor, project, repoName, tag, file.buffer);
        }

        res.json({
          success: true,
          message: '上传任务已创建',
          data: {
            tasks: tasks.map((t) => ({
              taskId: t.id,
              fileName: t.fileName,
              targetRepo: t.targetRepo,
              targetTag: t.targetTag,
              status: t.status,
            })),
          },
        });
      });
    } catch (error: any) {
      harborLog.error('创建 Harbor 上传任务失败:', error);
      res.status(500).json({ message: '创建上传任务失败', error: error.message });
    }
  },
);

router.get(
  '/registries/:id/projects/:project/upload-tasks',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id: harborId, project } = req.params;
      const { status, limit = 50 } = req.query;

      const where: any = {
        registryType: RegistryType.HARBOR,
        harborId,
        projectName: project,
      };
      if (status) where.status = status;

      const tasks = await uploadTaskRepo.find({
        where,
        order: { createdAt: 'DESC' },
        take: Number(limit),
      });

      res.json({ success: true, data: tasks });
    } catch (error: any) {
      harborLog.error('获取上传任务列表失败:', error);
      res.status(500).json({ message: '获取任务列表失败', error: error.message });
    }
  },
);

router.get(
  '/registries/:id/projects/:project/upload-tasks/:taskId',
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { taskId } = req.params;
      const task = await uploadTaskRepo.findOne({ where: { id: taskId } });
      if (!task) {
        return res.status(404).json({ message: '任务不存在' });
      }
      res.json({ success: true, data: task });
    } catch (error: any) {
      harborLog.error('获取上传任务详情失败:', error);
      res.status(500).json({ message: '获取任务详情失败', error: error.message });
    }
  },
);

// Harbor 实例管理路由（需要认证）
router.use('/registries', authMiddleware, registriesRoutes);

// Harbor 项目/仓库/制品管理路由（需要认证）
router.use('/', authMiddleware, projectsRoutes);

// Harbor 镜像上传路由（需要认证）
router.use('/registries', authMiddleware, uploadRoutes);

// Harbor 复制规则路由（需要认证）
router.use('/', authMiddleware, replicationRoutes);

// Harbor 漏洞扫描路由（需要认证）
router.use('/', authMiddleware, scanRoutes);

// Harbor 凭证同步路由（需要认证）
router.use('/', authMiddleware, syncRoutes);

export { router as harborRoutes };
