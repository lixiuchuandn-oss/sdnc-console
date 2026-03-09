/**
 * 批量更新页面文件中的 token 获取方式
 * 将 localStorage.getItem('token') 替换为 getToken()
 */

const fs = require('fs');
const path = require('path');

const files = [
  'frontend/src/pages/Tenants/index.tsx',
  'frontend/src/pages/Tenants/OrgManage.tsx',
  'frontend/src/pages/Tenants/Users.tsx',
  'frontend/src/pages/InterConnect/NAT/index.tsx',
  'frontend/src/pages/InterConnect/IPsecVPN/IPsecVPNWizard.tsx',
  'frontend/src/pages/Clouds/Console/CloudConsole.tsx',
  'frontend/src/pages/Clouds/Cloudmap/CloudDetailCloudmap.tsx',
  'frontend/src/pages/Clouds/Harvester/components/HarvesterVmLogsTab.tsx',
  'frontend/src/pages/Clouds/Harvester/HarvesterVNC.tsx',
  'frontend/src/pages/Clouds/WebSSH.tsx',
  'frontend/src/pages/Clouds/Aliyun/sections/EcsSectionAliyun.tsx',
  'frontend/src/pages/SecMgrPlane/SecurityDomain/index.tsx',
  'frontend/src/pages/Clouds/InstanceDetail.tsx',
  'frontend/src/pages/Tenants/LeasedLines/Tasks.tsx',
  'frontend/src/pages/Clouds/Harvester/components/HarvesterVmDetailDrawer.tsx',
  'frontend/src/pages/Access/Actions.tsx',
  'frontend/src/pages/Access/Roles.tsx',
  'frontend/src/pages/Clouds/Harvester/modals/CloudEditModal.tsx',
];

const projectRoot = path.join(__dirname, '..');

files.forEach(file => {
  const filePath = path.join(projectRoot, file);
  if (!fs.existsSync(filePath)) {
    console.log(`跳过不存在的文件: ${file}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;

  // 替换 localStorage.getItem('token')
  content = content.replace(/localStorage\.getItem\(['"]token['"]\)/g, 'getToken()');

  // 检查是否需要添加 import
  if (content !== originalContent && !content.includes("from '../utils/tokenStorage'") && !content.includes("from '../../utils/tokenStorage'") && !content.includes("from '../../../utils/tokenStorage'") && !content.includes("from '../../../../utils/tokenStorage'")) {
    // 找到最后一个 import 语句的位置
    const importMatch = content.match(/^import .+ from .+;$/gm);
    if (importMatch && importMatch.length > 0) {
      const lastImport = importMatch[importMatch.length - 1];
      const lastImportIndex = content.lastIndexOf(lastImport);
      const insertIndex = lastImportIndex + lastImport.length;
      
      // 计算相对路径深度
      const depth = file.split('/').length - 3; // frontend/src/pages/... 减去 frontend/src/utils
      const relativePath = '../'.repeat(depth) + 'utils/tokenStorage';
      
      content = content.slice(0, insertIndex) + `\nimport { getToken } from '${relativePath}';` + content.slice(insertIndex);
    }
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ 已更新: ${file}`);
  } else {
    console.log(`⏭️  无需更新: ${file}`);
  }
});

console.log('\n批量更新完成！');
