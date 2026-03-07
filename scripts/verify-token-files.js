/**
 * 验证脚本：确保找到所有使用 localStorage.getItem('token') 的文件
 */

const fs = require('fs');
const path = require('path');

const frontendSrcPath = path.join(__dirname, '../frontend/src');

// 所有找到的文件
const foundFiles = new Set();

// 递归查找所有 .ts 和 .tsx 文件
function findFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // 跳过 node_modules 和 .git
      if (file !== 'node_modules' && file !== '.git' && !file.startsWith('.')) {
        findFiles(filePath, fileList);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// 检查文件是否包含 localStorage.getItem('token')
function checkFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // 检查各种可能的模式
    const patterns = [
      /localStorage\.getItem\(['"]token['"]\)/g,
      /localStorage\.setItem\(['"]token['"]/g,
      /localStorage\.removeItem\(['"]token['"]\)/g,
      /localStorage\[['"]token['"]\]/g,
    ];
    
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        const relativePath = path.relative(frontendSrcPath, filePath);
        foundFiles.add(relativePath.replace(/\\/g, '/'));
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return false;
  }
}

// 主函数
function main() {
  console.log('🔍 扫描所有 TypeScript 文件...\n');
  
  const allFiles = findFiles(frontendSrcPath);
  console.log(`找到 ${allFiles.length} 个 TypeScript 文件\n`);
  
  console.log('🔎 检查每个文件...\n');
  
  allFiles.forEach(file => {
    checkFile(file);
  });
  
  console.log(`\n✅ 找到 ${foundFiles.size} 个使用 localStorage token 的文件:\n`);
  
  const sortedFiles = Array.from(foundFiles).sort();
  sortedFiles.forEach((file, index) => {
    console.log(`${(index + 1).toString().padStart(2, ' ')}. ${file}`);
  });
  
  console.log(`\n📊 统计: 共 ${foundFiles.size} 个文件需要修改\n`);
  
  // 保存到文件
  const outputPath = path.join(__dirname, '../docs/TOKEN_FILES_VERIFICATION.txt');
  const output = sortedFiles.map((f, i) => `${i + 1}. ${f}`).join('\n');
  fs.writeFileSync(outputPath, `Token 文件验证结果\n生成时间: ${new Date().toISOString()}\n\n共找到 ${foundFiles.size} 个文件:\n\n${output}\n`);
  
  console.log(`✅ 结果已保存到: ${outputPath}`);
}

main();
