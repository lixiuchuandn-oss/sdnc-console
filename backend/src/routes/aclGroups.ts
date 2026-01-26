import { Router } from 'express';
import { AppDataSource } from '../config/database';
import { ACLGroup } from '../entities/ACLGroup';
import { ACLRule } from '../entities/ACLRule';

export const aclGroupRoutes = Router();
const groupRepo = () => AppDataSource.getRepository(ACLGroup);
const ruleRepo = () => AppDataSource.getRepository(ACLRule);

// List ACL Groups
aclGroupRoutes.get('/', async (req, res, next) => {
  try {
    const { vrId } = req.query;
    const where = vrId ? { vrId: String(vrId) } : {};
    const list = await groupRepo().find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['rules'],
    });
    res.json(list);
  } catch (e) {
    next(e);
  }
});

// Create ACL Group
aclGroupRoutes.post('/', async (req, res, next) => {
  try {
    const { name, description, vrId } = req.body;
    if (!name) {
      res.status(400).json({ message: 'Name is required' });
      return;
    }
    const group = groupRepo().create({ name, description, vrId });
    await groupRepo().save(group);
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
      relations: ['rules'],
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
    const { name, description, vrId } = req.body;
    const group = await groupRepo().findOneBy({ id });
    if (!group) {
      res.status(404).json({ message: 'ACL Group not found' });
      return;
    }
    if (name) group.name = name;
    if (description !== undefined) group.description = description;
    if (vrId !== undefined) group.vrId = vrId;

    await groupRepo().save(group);
    res.json(group);
  } catch (e) {
    next(e);
  }
});

// Delete ACL Group
aclGroupRoutes.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await groupRepo().delete(id);
    if (result.affected === 0) {
      res.status(404).json({ message: 'ACL Group not found' });
      return;
    }
    res.status(204).send();
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
      vrId: group.vrId, // Inherit VR ID if present
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
