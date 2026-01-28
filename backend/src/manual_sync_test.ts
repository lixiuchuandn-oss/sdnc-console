
import { AppDataSource } from './config/database';
import { syncACLToVRConfig } from './routes/aclGroups';
import { ACLGroup } from './entities/ACLGroup';
import { ACLRule, ACLAction, ACLProtocol } from './entities/ACLRule';

const main = async () => {
  try {
    await AppDataSource.initialize();
    console.log('DB Initialized');
    
    const vrId = '668712107747622912';
    const groupRepo = AppDataSource.getRepository(ACLGroup);
    const ruleRepo = AppDataSource.getRepository(ACLRule);

    // 1. Create a dummy group if not exists
    let group = await groupRepo.findOne({ where: { name: 'StructureTest' } });
    if (!group) {
        group = groupRepo.create({
            name: 'StructureTest',
            aclId: 200,
            vrId: vrId,
            description: 'Test Group'
        });
        await groupRepo.save(group);
        console.log('Created test group:', group.id);

        // 2. Create a rule
        const rule = ruleRepo.create({
            groupId: group.id,
            vrId: vrId,
            name: 'TestRule',
            priority: 1,
            action: ACLAction.DENY,
            protocol: ACLProtocol.TCP,
            sourceIp: '10.20.0.1/16',
            destinationIp: '10.2.2.2/16',
            sourcePort: '8888',
            destinationPort: '9999'
        });
        await ruleRepo.save(rule);
        console.log('Created test rule');
    }

    console.log(`Syncing for VR: ${vrId}`);
    
    const config = await syncACLToVRConfig(vrId);
    console.log('Sync completed. Config result:', JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Sync failed:', e);
  } finally {
    process.exit(0);
  }
};

main();
