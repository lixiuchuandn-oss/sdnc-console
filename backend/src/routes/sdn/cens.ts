import { Router, Response } from 'express';
import { AppDataSource } from '../../config/database';
import { CloudEnterpriseNetwork, CenStatus } from '../../entities/CloudEnterpriseNetwork';
import { CenAttachment, CenAttachmentStatus } from '../../entities/CenAttachment';
import { VpcNetwork } from '../../entities/VpcNetwork';
import { SecurityDomain } from '../../entities/SecurityDomain';
import { isOrchestratableInternetworkRoutingDomain } from '../../utils/internetworkRoutingDomain';
import { AuthRequest } from '../../middleware/auth';
import { logOperation } from '../../utils/audit';

const router = Router();

// 获取 CEN 列表
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (
        !(
          role === 'super_admin' ||
          perms.includes('networks.cen:read') ||
          perms.includes('networks.cen:write')
        )
      ) {
        return res.status(403).json({ message: '权限不足：需要读取权限 networks.cen:read' });
      }
    }
    const repo = AppDataSource.getRepository(CloudEnterpriseNetwork);
    const cens = await repo.find();
    res.json(cens);
  } catch (err) {
    console.error('获取 CEN 列表失败:', err);
    res.status(500).json({ message: '获取 CEN 列表失败' });
  }
});

// 创建 CEN
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    {
      const role = (req as any).user?.role;
      const perms: string[] = Array.isArray((req as any).user?.permissions)
        ? (req as any).user?.permissions
        : [];
      if (!(role === 'super_admin' || perms.includes('networks.cen:write'))) {
        return res.status(403).json({ message: '权限不足：需要写入权限 networks.cen:write' });
      }
    }
    const { name, description, tenantId, strategy } = req.body;
    if (!tenantId) {
      return res.status(400).json({ message: '缺少 tenantId' });
    }
    const repo = AppDataSource.getRepository(CloudEnterpriseNetwork);
    const cen = repo.create({
      name,
      description,
      tenantId,
      strategy: strategy || 'SRv6',
      status: CenStatus.AVAILABLE,
    });
    await repo.save(cen);

    res.status(201).json({ message: 'CEN 创建成功', cen });
  } catch (err) {
    console.error('创建 CEN 失败:', err);
    res.status(500).json({ message: '创建 CEN 失败' });
  }
});

// 更新 CEN
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, strategy, topology, hubId } = req.body;
    const repo = AppDataSource.getRepository(CloudEnterpriseNetwork);
    const cen = await repo.findOne({ where: { id } });
    if (!cen) return res.status(404).json({ message: 'CEN 不存在' });

    if (name !== undefined) cen.name = name;
    if (description !== undefined) cen.description = description;
    if (strategy !== undefined) cen.strategy = strategy;
    if (topology !== undefined) cen.topology = topology;
    if (hubId !== undefined) cen.hubId = hubId;

    await repo.save(cen);
    res.json(cen);
  } catch (err) {
    console.error('更新 CEN 失败:', err);
    res.status(500).json({ message: '更新失败' });
  }
});

// 删除 CEN
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const force =
      String((req.query as any)?.force || '').toLowerCase() === '1' ||
      String((req.query as any)?.force || '').toLowerCase() === 'true';
    const repo = AppDataSource.getRepository(CloudEnterpriseNetwork);
    const cen = await repo.findOne({ where: { id } });
    if (!cen) return res.status(404).json({ message: 'CEN 不存在' });
    const attachRepo = AppDataSource.getRepository(CenAttachment);
    const attachments = await attachRepo.find({ where: { cenId: id } });

    if (!force && attachments.length > 0) {
      return res.status(400).json({
        message: `无法删除互联通道，该通道已关联 ${attachments.length} 个网际路由域，请先解除关联`,
      });
    }

    if (force && attachments.length > 0) {
      for (const att of attachments) {
        await attachRepo.remove(att);
      }
    }
    await repo.remove(cen);
    await logOperation(
      req,
      'Delete CEN',
      `删除云企业网: ${cen.name} (ID: ${id})，关联网际路由域已解绑`,
      true,
    );
    res.json({ message: force ? '已强制删除：已释放挂载网际路由域并删除 CEN' : 'CEN 删除成功' });
  } catch (err) {
    console.error('删除 CEN 失败:', err);
    res.status(500).json({ message: '删除失败' });
  }
});

// 获取 CEN 附件列表
router.get('/:id/attachments', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const repo = AppDataSource.getRepository(CenAttachment);
    const list = await repo.find({ where: { cenId: id }, relations: ['vpc', 'securityDomain'] });

    // Transform response to clean up structure as requested
    const result = list.map((att) => {
      const domain: any = att.securityDomain ? { ...att.securityDomain } : {};

      // Inject CEN ID and Attachment ID into domain object
      domain.cenId = att.cenId;
      domain.attachmentId = att.id; // Needed for frontend actions (e.g. unbind)

      // Remove unwanted fields from SecurityDomain (as per user request "没用删掉")
      delete domain.vpcMode;
      delete domain.newVpcName;
      delete domain.newVpcCidr;

      return {
        id: att.id,
        status: att.status,
        securityDomain: domain,
        // Exclude root level vpcId, vpc, cenId, etc.
      };
    });

    res.json(result);
  } catch (err) {
    console.error('获取附件失败:', err);
    res.status(500).json({ message: '获取失败' });
  }
});

// 将 VPC 挂载到 CEN
router.post('/:id/attachments', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { vpcId, securityDomainId } = req.body;

    const cenRepo = AppDataSource.getRepository(CloudEnterpriseNetwork);
    const cen = await cenRepo.findOne({ where: { id } });
    if (!cen) return res.status(404).json({ message: 'CEN 不存在' });

    let vpc: VpcNetwork | null = null;
    if (vpcId) {
      const vpcRepo = AppDataSource.getRepository(VpcNetwork);
      vpc = await vpcRepo.findOne({ where: { id: vpcId } });
      if (!vpc) return res.status(404).json({ message: 'VPC 不存在' });
    }

    // 如传入 securityDomainId，验证其存在，用于建立渲染映射
    let securityDomain: SecurityDomain | null = null;
    if (securityDomainId) {
      const domRepo = AppDataSource.getRepository(SecurityDomain);
      securityDomain = await domRepo.findOne({ where: { id: String(securityDomainId) } });
      if (!securityDomain) {
        return res.status(404).json({ message: '网际路由域不存在' });
      }
      if (!isOrchestratableInternetworkRoutingDomain(securityDomain)) {
        return res.status(400).json({
          message:
            '该网际路由域不可编排：须为可编排类型且已绑定网际路由器与防护目标网络（CSM 镜像域须先提升）',
        });
      }
    }

    const attachRepo = AppDataSource.getRepository(CenAttachment);
    const attachment = attachRepo.create({
      cenId: id,
      vpcId: vpcId || undefined,
      status: CenAttachmentStatus.ATTACHED,
      securityDomainId: securityDomainId || undefined,
      securityDomain: securityDomain || undefined,
    });
    await attachRepo.save(attachment);

    // 返回包含关系的最新对象，便于前端渲染
    const created = await attachRepo.findOne({
      where: { id: attachment.id },
      relations: ['vpc', 'securityDomain'],
    });
    res.status(201).json({ message: 'VPC 已附加', attachment: created || attachment });
  } catch (err) {
    console.error('附加失败:', err);
    res.status(500).json({ message: '附加失败' });
  }
});

// 将 VPC 从 CEN 分离
router.delete('/:id/attachments/:attId', async (req: AuthRequest, res: Response) => {
  try {
    const { id, attId } = req.params;
    const attachRepo = AppDataSource.getRepository(CenAttachment);
    const att = await attachRepo.findOne({ where: { id: attId, cenId: id } });
    if (!att) return res.status(404).json({ message: '附件不存在' });
    await attachRepo.remove(att);
    res.json({ message: '已移除 VPC 挂载' });
  } catch (err) {
    console.error('分离失败:', err);
    res.status(500).json({ message: '分离失败' });
  }
});

export { router as cenRoutes };
