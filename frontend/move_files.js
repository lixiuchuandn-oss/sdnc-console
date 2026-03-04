const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src/pages/Clouds/Harvester/Monitoring/Monitoring');
const destDir = path.join(__dirname, 'src/pages/Clouds/Harvester/Monitoring');

if (!fs.existsSync(srcDir)) {
  console.log('Source directory does not exist:', srcDir);
  process.exit(0);
}

const items = fs.readdirSync(srcDir);

items.forEach(item => {
  const srcPath = path.join(srcDir, item);
  const destPath = path.join(destDir, item);

  console.log(`Moving ${srcPath} to ${destPath}`);
  
  // 如果目标存在，先删除（fs.rename 在某些系统下覆盖行为不一致，特别是文件夹）
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.isDirectory()) {
      fs.rmSync(destPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(destPath);
    }
  }

  fs.renameSync(srcPath, destPath);
});

// 删除空的源目录
try {
  fs.rmdirSync(srcDir);
  console.log('Removed empty source directory');
} catch (e) {
  console.log('Could not remove source directory (might not be empty):', e.message);
}
