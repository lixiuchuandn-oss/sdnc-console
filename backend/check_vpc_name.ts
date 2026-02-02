
import { AppDataSource } from './src/config/database';
import { Cloud } from './src/entities/Cloud';
import { listHarvesterVMsStandard } from './src/services/harvester';

async function main() {
  try {
    await AppDataSource.initialize();
    console.log('Database connected');

    const cloudRepo = AppDataSource.getRepository(Cloud);
    const clouds = await cloudRepo.find();
    
    // Find a Harvester cloud
    const harvesterCloud = clouds.find(c => {
        const p = String((c.config as any)?.provider || '').toLowerCase();
        return p === 'harvester' || p === 'cloudmap.private';
    });

    if (!harvesterCloud) {
        console.log('No Harvester cloud found');
        return;
    }

    console.log(`Testing with cloud: ${harvesterCloud.name}`);
    
    const items = await listHarvesterVMsStandard({
        endpoint: harvesterCloud.endpoint || '',
        token: harvesterCloud.secretKey || '',
        insecure: true
    });

    console.log(`Fetched ${items.length} items`);
    items.forEach((item, index) => {
        if (index < 5) {
            console.log(`Item ${index}: Name=${item.InstanceName}, VpcName=${item.VpcName}, Namespace=${item.Extra?.Namespace}`);
        }
    });

  } catch (e) {
    console.error(e);
  } finally {
    await AppDataSource.destroy();
  }
}

main();
