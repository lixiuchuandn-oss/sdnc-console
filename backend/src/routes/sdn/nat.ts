import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { NATAddressGroup } from '../../entities/vRouter/NATAddressGroup';
import { NATStaticMapping } from '../../entities/vRouter/NATStaticMapping';
import {
  getVRConfigFromDB,
  pushVRConfig,
  stripMeta,
  mapDeployErrorToResponse,
} from '../../services/vrouter/vrConfigDeploy';
import { parseRangeInput, syncNatToVRConfig } from '../../services/vrouter/natSync';

export const natRoutes = Router();

const groupRepo = () => AppDataSource.getRepository(NATAddressGroup);
const mappingRepo = () => AppDataSource.getRepository(NATStaticMapping);

export { syncNatToVRConfig };

const flattenMappingRow = (group: NATAddressGroup, mapping: NATStaticMapping) => {
  const rangeArr = Array.isArray(group.range) ? group.range : [];
  return {
    id: mapping.id,
    vrId: group.vrId,
    groupId: group.deviceGroupId,
    range: rangeArr,
    rangeText: rangeArr.join('；'),
    type: 'static' as const,
    proto: mapping.proto,
    inside: mapping.inside,
    localPort: mapping.localPort,
    outside: mapping.outside,
    externalPort: mapping.externalPort,
    vrf: mapping.vrf || '',
    twiceNat: mapping.twiceNat || '',
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  };
};

// List NAT static mappings (platform DB)
natRoutes.get('/', async (req, res, next) => {
  try {
    const { vrId } = req.query;
    const where = vrId ? { vrId: String(vrId) } : {};
    const groups = await groupRepo().find({
      where,
      relations: ['mappings'],
      order: { deviceGroupId: 'ASC' },
    });

    const list = groups.flatMap((g) =>
      (g.mappings || [])
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => flattenMappingRow(g, m)),
    );

    res.json(list);
  } catch (e) {
    next(e);
  }
});

// Create NAT static mapping (platform only — sync vr_config, no device push)
natRoutes.post('/', async (req, res, next) => {
  try {
    const {
      vrId,
      groupId,
      range,
      proto,
      inside,
      localPort,
      outside,
      externalPort,
      vrf,
      twiceNat,
    } = req.body || {};

    const vid = String(vrId || '').trim();
    const gid = Number(groupId);

    if (!vid || Number.isNaN(gid)) {
      res.status(400).json({ message: 'vrId and groupId are required' });
      return;
    }
    if (!inside || !outside || localPort == null || externalPort == null) {
      res.status(400).json({ message: 'inside, outside, localPort and externalPort are required' });
      return;
    }

    let group = await groupRepo().findOne({
      where: { vrId: vid, deviceGroupId: gid },
      relations: ['mappings'],
    });

    const rangeArr = parseRangeInput(range);

    if (!group) {
      group = groupRepo().create({
        vrId: vid,
        deviceGroupId: gid,
        range: rangeArr,
        mappings: [],
      });
      group = await groupRepo().save(group);
    } else if (rangeArr.length > 0) {
      group.range = rangeArr;
      await groupRepo().save(group);
    }

    const mapping = mappingRepo().create({
      addressGroupId: group.id,
      proto: String(proto || 'tcp').trim() || 'tcp',
      inside: String(inside).trim(),
      localPort: Number(localPort),
      outside: String(outside).trim(),
      externalPort: Number(externalPort),
      vrf: vrf != null ? String(vrf).trim() : '',
      twiceNat: twiceNat != null ? String(twiceNat).trim() : '',
    });
    const saved = await mappingRepo().save(mapping);

    await syncNatToVRConfig(vid);

    const fullGroup = await groupRepo().findOne({
      where: { id: group.id },
      relations: ['mappings'],
    });
    if (!fullGroup) {
      res.status(201).json(saved);
      return;
    }

    res.status(201).json(flattenMappingRow(fullGroup, saved));
  } catch (e) {
    next(e);
  }
});

// Delete NAT static mapping (platform only)
natRoutes.delete('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const mapping = await mappingRepo().findOne({
      where: { id },
      relations: ['addressGroup'],
    });
    if (!mapping) {
      res.status(404).json({ message: 'NAT mapping not found' });
      return;
    }

    const vrId = mapping.addressGroup?.vrId;
    await mappingRepo().remove(mapping);

    if (vrId) {
      const group = mapping.addressGroup;
      if (group) {
        const remaining = await mappingRepo().count({ where: { addressGroupId: group.id } });
        if (remaining === 0) {
          await groupRepo().remove(group);
        }
      }
      await syncNatToVRConfig(vrId);
    }

    res.json({ message: 'Deleted' });
  } catch (e) {
    next(e);
  }
});

// Deploy/Push NAT configuration (platform vr_config → device, drift-aware)
natRoutes.post('/deploy/push', async (req, res, next) => {
  try {
    const { vrId } = req.body || {};
    if (!vrId) {
      res.status(400).json({ message: 'vrId is required' });
      return;
    }

    const acknowledgeDrift = req.body?.acknowledgeDrift === true;

    await syncNatToVRConfig(String(vrId));

    let platformConfig: Record<string, unknown>;
    try {
      platformConfig = await getVRConfigFromDB(String(vrId));
    } catch (err: unknown) {
      const { status, body } = mapDeployErrorToResponse(err);
      res.status(status).json(body);
      return;
    }

    try {
      const result = await pushVRConfig({
        vrId: String(vrId),
        domain: 'nat',
        platformConfig,
        acknowledgeDrift,
      });
      res.json({
        status: 'success',
        data: stripMeta(result.mergedConfig),
        driftWarnings: result.driftWarnings,
      });
    } catch (err: unknown) {
      const { status, body } = mapDeployErrorToResponse(err);
      console.error(`[NAT Push] Failed to update VR config for ${vrId}`, err);
      res.status(status).json({
        message: body.message,
        code: body.code,
        conflicts: body.conflicts,
      });
    }
  } catch (e) {
    next(e);
  }
});
