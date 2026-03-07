import { licenseService } from './src/services/LicenseService';
import * as fs from 'fs';
import * as path from 'path';

try {
    const key = licenseService.generateTestLicense('Compute Tower Enterprise', 365, 'enterprise');
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(path.join(dataDir, 'enterprise.key'), key);
    console.log('Enterprise License generated successfully at data/enterprise.key');
} catch (error) {
    console.error('Failed to generate license:', error);
}
