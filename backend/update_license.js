const { licenseService } = require('./dist/services/LicenseService');
const fs = require('fs');
const path = require('path');

try {
    const key = licenseService.generateTestLicense('Compute Tower Enterprise', 365, 'enterprise');
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(path.join(dataDir, 'license.key'), key);
    console.log('License updated successfully');
} catch (error) {
    console.error('Failed to update license:', error);
}
