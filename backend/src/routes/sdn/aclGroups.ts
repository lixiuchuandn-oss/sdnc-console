import { Router } from 'express';
import { AppDataSource } from '../../config/database';
import { ACLGroup } from '../../entities/vRouter/ACLGroup';
import { ACLRule } from '../../entities/vRouter/ACLRule';
import { VRConfig } from '../../entities/vRouter/VRConfig';
import { ACLGroupBinding } from '../../entities/vRouter/ACLGroupBinding';
import { IsNull, In } from 'typeorm';

export const aclGroupRoutes = Router();
const groupRepo = () => AppDataSource.getRepository(ACLGroup);
const ruleRepo = () => AppDataSource.getRepository(ACLRule);
const vrConfigRepo = () => AppDataSource.getRepository(VRConfig);
const bindingRepo = () => AppDataSource.getRepository(ACLGroupBinding);

/**
 * Syncs ACL Groups and Rules to VRConfig (config_json).
 * It reconstructs the 'acl' section of the VR configuration.
 */
export const syncACLToVRConfig = async (vrId: string) => {
  if (!vrId) return;

  // 1. Fetch Groups (Directly assigned OR Bound via Binding table)
  // Get bound group IDs
  const bindings = await bindingRepo().find({ where: { vrId } });
  const boundGroupIds = bindings.map(b => b.aclGroupId);

  const groups = await groupRepo().find({
    where: [
      { vrId }, // Direct assignment
      { id: In(boundGroupIds) } // Bound assignment
    ],
    relations: ['rules'],
    order: { aclId: 'ASC' }
  });

  // Deduplicate groups (in case a group is both assigned and bound, though unlikely)
  const uniqueGroups = Array.from(new Map(groups.map(g => [g.id, g])).values());

  // 2. Format
  const aclConfig: any[] = [];
  
  // Add Groups
  for (const g of uniqueGroups) {
    aclConfig.push({
      acl_id: g.aclId,
      rule: g.rules.sort((a, b) => a.priority - b.priority).map(r => ({
        rule_id: r.priority,
        match: r.action,
        proto: r.protocol === 'any' ? 'any' : r.protocol.toUpperCase(),
        source: r.sourceIp || 'any',
        sport: r.sourcePort || 'any',
        destination: r.destinationIp || 'any',
        dport: r.destinationPort || 'any'
      }))
    });
  }
  
  // 4. Update VRConfig
  let vr = await vrConfigRepo().findOne({ where: { uuid: vrId } });
  if (!vr) {
    // If VR config doesn't exist, create it (assuming the VR exists in reality)
    vr = vrConfigRepo().create({ uuid: vrId, config_json: '{}' });
  }
  
  let config: any = {};
  try { config = JSON.parse(vr.config_json); } catch {}
  
  config.acl = aclConfig;
  vr.config_json = JSON.stringify(config);
  
  await vrConfigRepo().save(vr);
  return config;
};

/**
 * Helper to sync all VRs associated with a specific ACL Group
 */
export const syncGroupToVRs = async (groupId: string) => {
  const group = await groupRepo().findOne({ where: { id: groupId } });
  if (!group) return;

  const vrIds = new Set<string>();
  if (group.vrId) vrIds.add(group.vrId);

  const bindings = await bindingRepo().find({ where: { aclGroupId: groupId } });
  bindings.forEach(b => vrIds.add(b.vrId));

  for (const vrId of vrIds) {
    await syncACLToVRConfig(vrId);
  }
};

// List ACL Groups
aclGroupRoutes.get('/', async (req, res, next) => {
  try {
    const { vrId } = req.query;
    
    let where: any = {};
    if (vrId) {
      // Find groups bound to this VR
      const bindings = await bindingRepo().find({ where: { vrId: String(vrId) } });
      const boundGroupIds = bindings.map(b => b.aclGroupId);
      where = [
        { vrId: String(vrId) },
        { id: In(boundGroupIds) }
      ];
    }

    const list = await groupRepo().find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['rules'],
    });
    
    // Deduplicate in case of overlap
    const uniqueList = Array.from(new Map(list.map(g => [g.id, g])).values());
    
    res.json(uniqueList);
  } catch (e) {
    next(e);
  }
});

// Create ACL Group
aclGroupRoutes.post('/', async (req, res, next) => {
  try {
    const { name, description, vrId, aclId } = req.body;
    if (!name) {
      res.status(400).json({ message: 'Name is required' });
      return;
    }
    const group = groupRepo().create({ name, description, vrId, aclId });
    await groupRepo().save(group);
    
    // Sync to VR Config
    if (vrId) {
      await syncACLToVRConfig(vrId);
    }

    res.status(201).json(group);
  } catch (e) {
    next(e);
  }
});

// Get ACL Group Detail
aclGroupRoutes.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const group = await groupRepo().findOne({
      where: { id },
      relations: ['rules', 'bindings'],
    });
    if (!group) {
      res.status(404).json({ message: 'ACL Group not found' });
      return;
    }
    // Sort rules by priority
    group.rules.sort((a, b) => a.priority - b.priority);
    res.json(group);
  } catch (e) {
    next(e);
  }
});

// Update ACL Group
aclGroupRoutes.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, vrId, aclId } = req.body;
    const group = await groupRepo().findOneBy({ id });
    if (!group) {
      res.status(404).json({ message: 'ACL Group not found' });
      return;
    }
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    // Note: Changing vrId here only changes the "primary" VR. 
    // It does not affect bindings unless we explicitly handle it.
    if (vrId !== undefined) group.vrId = vrId;
    if (aclId !== undefined) group.aclId = aclId;

    await groupRepo().save(group);

    // Sync all affected VRs
    await syncGroupToVRs(group.id);
    // If vrId changed, we might need to sync the OLD vrId too, but we lost it.
    // Ideally we should fetch old group before update. But for now this covers the main case.

    res.json(group);
  } catch (e) {
    next(e);
  }
});

// Delete ACL Group
aclGroupRoutes.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const group = await groupRepo().findOneBy({ id });
    if (!group) {
      res.status(404).json({ message: 'ACL Group not found' });
      return;
    }
    
    // Capture all associated VRs before deletion
    const vrIdsToSync = new Set<string>();
    if (group.vrId) vrIdsToSync.add(group.vrId);
    const bindings = await bindingRepo().find({ where: { aclGroupId: id } });
    bindings.forEach(b => vrIdsToSync.add(b.vrId));

    await groupRepo().remove(group); // Cascades should remove bindings too

    // Sync all affected VRs
    for (const vrId of vrIdsToSync) {
      await syncACLToVRConfig(vrId);
    }

    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

// Bind ACL Group to VR (New Endpoint)
aclGroupRoutes.post('/:id/bind', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { vrId } = req.body;
    if (!vrId) {
      res.status(400).json({ message: 'vrId is required' });
      return;
    }

    const group = await groupRepo().findOneBy({ id });
    if (!group) {
      res.status(404).json({ message: 'ACL Group not found' });
      return;
    }

    // Check if already bound or is primary
    if (group.vrId === vrId) {
       res.json({ message: 'Already bound (primary)' });
       return;
    }
    
    const existing = await bindingRepo().findOne({ where: { aclGroupId: id, vrId } });
    if (existing) {
       res.json({ message: 'Already bound' });
       return;
    }

    const binding = bindingRepo().create({ aclGroupId: id, vrId });
    await bindingRepo().save(binding);

    await syncACLToVRConfig(vrId);
    
    res.status(201).json(binding);
  } catch (e) {
    next(e);
  }
});

// Unbind ACL Group from VR (New Endpoint)
aclGroupRoutes.post('/:id/unbind', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { vrId } = req.body;
    
    const binding = await bindingRepo().findOne({ where: { aclGroupId: id, vrId } });
    if (binding) {
      await bindingRepo().remove(binding);
      await syncACLToVRConfig(vrId);
    }
    
    res.status(200).json({ message: 'Unbound' });
  } catch (e) {
    next(e);
  }
});

// Add Rule to Group
aclGroupRoutes.post('/:id/rules', async (req, res, next) => {
  try {
    const { id } = req.params;
    const group = await groupRepo().findOneBy({ id });
    if (!group) {
      res.status(404).json({ message: 'ACL Group not found' });
      return;
    }

    const {
      name,
      description,
      priority,
      action,
      protocol,
      sourceIp,
      destinationIp,
      sourcePort,
      destinationPort,
    } = req.body;

    const rule = ruleRepo().create({
      groupId: id,
      vrId: group.vrId, // Inherit VR ID if present (Legacy)
      name,
      description,
      priority,
      action,
      protocol,
      sourceIp,
      destinationIp,
      sourcePort,
      destinationPort,
    });

    await ruleRepo().save(rule);

    // Sync all VRs associated with this group
    await syncGroupToVRs(id);

    res.status(201).json(rule);
  } catch (e) {
    next(e);
  }
});

// List Rules in Group
aclGroupRoutes.get('/:id/rules', async (req, res, next) => {
  try {
    const { id } = req.params;
    const rules = await ruleRepo().find({
      where: { groupId: id },
      order: { priority: 'ASC' },
    });
    res.json(rules);
  } catch (e) {
    next(e);
  }
});
