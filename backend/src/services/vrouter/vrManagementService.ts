import { AppDataSource } from '../../config/database';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { logger } from '../../utils/logger';
import { bindBgpRouterIdFromManagementIp } from './bgpRouterIdFromMgmt';
import { normalizeManagementIp } from './managementIpUtils';

const vrMgmLog = logger.child('VR-Mgmt');

export interface BindVRPayload {
  vr_uuid: string;
  tenant_id: string;
  org_id?: string;
  vm_id?: string;
  device_fingerprint?: string;
  display_name?: string;
  vr_type?: string;
}

export interface BindResult {
  vr_unique_id: string;
  tenant_id: string | null;
  org_id: string | null;
  display_name: string;
  device_fingerprint: string | null;
  bind_status: string;
  vr_type: string | null;
}

export interface ReportManagementIpPayload {
  vr_uuid: string;
  management_ip: string;
  /** 租户用户上报时写入/校验归属 */
  tenant_id?: string | null;
}

export interface ReportManagementIpResult {
  vr_unique_id: string;
  management_ip: string;
  updated_at: string;
}

async function syncVrCacheDeviceFromConfig(record: VRConfig): Promise<void> {
  try {
    const { VRCacheDevice } = await import('../../entities/vRouter/VRCacheDevice');
    const deviceRepo = AppDataSource.getRepository(VRCacheDevice);
    let deviceRecord = await deviceRepo.findOne({ where: { uuid: record.uuid } });
    if (!deviceRecord) {
      deviceRecord = deviceRepo.create({ uuid: record.uuid });
    }
    deviceRecord.data = JSON.stringify(record);
    await deviceRepo.save(deviceRecord);
  } catch (e) {
    vrMgmLog.error('Failed to sync to VrCacheDevice', e instanceof Error ? e.message : String(e));
  }
}

export const vrManagementService = {
  bindVRToTenant: async (payload: BindVRPayload): Promise<BindResult> => {
    const { vr_uuid, tenant_id, org_id, vm_id, device_fingerprint, display_name, vr_type } =
      payload;

    if (!tenant_id) {
      throw new Error('缺少租户信息 tenant_id');
    }

    if (!vr_uuid || typeof vr_uuid !== 'string' || vr_uuid.trim().length === 0) {
      throw new Error('缺少 vr_uuid（请使用设备/CSMctl记录的统一UUID）');
    }
    const vrUniqueId = vr_uuid.trim();

    let validRole: string | undefined;
    if (vr_type) {
      const normalizedType = String(vr_type).trim().toUpperCase();
      if (['PE', 'CE', 'SASE', '标准'].includes(normalizedType)) {
        validRole = normalizedType;
      } else {
        throw new Error('VR类型仅支持: 标准, PE, CE, SASE');
      }
    }

    const repository = AppDataSource.getRepository(VRConfig);

    let record = await repository.findOne({ where: { uuid: vrUniqueId } });
    if (!record) {
      record = repository.create({
        uuid: vrUniqueId,
        config_json: '{}',
      });
    }

    const alreadyBound = record.bindStatus === 'BOUND' && !!record.tenantId;
    if (alreadyBound && record.tenantId !== tenant_id) {
      const error: any = new Error('VR已绑定到其他租户，拒绝覆盖');
      error.details = {
        vr_unique_id: record.uuid,
        tenant_id: record.tenantId,
        org_id: record.organizationId,
        bind_status: record.bindStatus,
      };
      throw error;
    }

    record.tenantId = record.tenantId || tenant_id;
    if (org_id) {
      record.organizationId = org_id;
    }
    record.name = display_name || record.name || vrUniqueId;
    record.deviceFingerprint = device_fingerprint || record.deviceFingerprint;
    record.vmId = vm_id || record.vmId;
    record.bindStatus = 'BOUND';

    if (validRole) {
      record.role = validRole;
    }

    await repository.save(record);
    await syncVrCacheDeviceFromConfig(record);

    return {
      vr_unique_id: record.uuid,
      tenant_id: record.tenantId || null,
      org_id: record.organizationId || null,
      display_name: record.name || '',
      device_fingerprint: record.deviceFingerprint || null,
      bind_status: record.bindStatus || 'UNBOUND',
      vr_type: record.role || null,
    };
  },

  reportManagementIp: async (payload: ReportManagementIpPayload): Promise<ReportManagementIpResult> => {
    const vrUniqueId = String(payload.vr_uuid ?? '').trim();
    if (!vrUniqueId) {
      throw new Error('缺少 vr_uuid');
    }

    const managementIp = normalizeManagementIp(payload.management_ip);
    const tenantId = payload.tenant_id ? String(payload.tenant_id).trim() : '';

    const repository = AppDataSource.getRepository(VRConfig);
    let record = await repository.findOne({ where: { uuid: vrUniqueId } });
    if (!record) {
      record = repository.create({
        uuid: vrUniqueId,
        config_json: '{}',
      });
    }

    if (tenantId) {
      if (record.tenantId && record.tenantId !== tenantId) {
        const error: any = new Error('该 IBR 已绑定到其他租户，拒绝上报管理口地址');
        error.statusCode = 403;
        throw error;
      }
      record.tenantId = record.tenantId || tenantId;
    }

    const previousManagementIp = String(record.managementIp ?? '').trim() || null;
    record.managementIp = managementIp;

    const bind = bindBgpRouterIdFromManagementIp(
      record.config_json,
      managementIp,
      previousManagementIp,
    );
    if (bind.changed) {
      record.config_json = bind.configJson;
      vrMgmLog.info('Bound public BGP router_id from management_ip', {
        uuid: vrUniqueId,
        managementIp,
        reason: bind.reason,
      });
    }

    await repository.save(record);
    await syncVrCacheDeviceFromConfig(record);

    return {
      vr_unique_id: record.uuid,
      management_ip: managementIp,
      updated_at: record.updated_at.toISOString(),
    };
  },
};
