/**
 * Token 使用情况检查脚本
 * 用于在迁移到 httpOnly Cookie 时，确保不遗漏任何使用 token 的地方
 * 
 * 使用方法：
 * node scripts/check-token-usage.js
 */

const fs = require('fs');
const path = require('path');

const frontendSrcPath = path.join(__dirname, '../frontend/src');

// 需要检查的模式
const patterns = [
  {
    name: 'localStorage.getItem("token")',
    regex: /localStorage\.getItem\(['"]token['"]\)/g,
    severity: 'high',
  },
  {
    name: 'localStorage.setItem("token")',
    regex: /localStorage\.setItem\(['"]token['"]/g,
    severity: 'high',
  },
  {
    name: 'localStorage.removeItem("token")',
    regex: /localStorage\.removeItem\(['"]token['"]\)/g,
    severity: 'high',
  },
  {
    name: 'Authorization Bearer token',
    regex: /Authorization.*Bearer.*token|Bearer\s+\$\{token\}/g,
    severity: 'high',
  },
  {
    name: 'getAuthHeaders (可能包含 token)',
    regex: /getAuthHeaders\(\)/g,
    severity: 'medium',
  },
  {
    name: 'credentials: include (已迁移)',
    regex: /credentials:\s*['"]include['"]/g,
    severity: 'info',
    isGood: true,
  },
];

function findInFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const results = [];

    patterns.forEach(({ name, regex, severity, isGood }) => {
      const matches = [...content.matchAll(regex)];
      if (matches.length > 0) {
        matches.forEach((match) => {
          const lineIndex = content.substring(0, match.index).split('\n').length;
          const lineContent = content.split('\n')[lineIndex - 1]?.trim() || '';
          
          results.push({
            pattern: name,
            line: lineIndex,
            match: match[0].trim(),
            lineContent: lineContent.substring(0, 80),
            severity,
            isGood,
          });
        });
      }
    });

    return results;
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error);
    return [];
  }
}

function scanDirectory(dir, fileList = []) {
  try {
    const files = fs.readdirSync(dir);

    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        // 跳过 node_modules 和 .git
        if (file !== 'node_modules' && file !== '.git' && !file.startsWith('.')) {
          scanDirectory(filePath, fileList);
        }
      } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        fileList.push(filePath);
      }
    });
  } catch (error) {
    console.error(`扫描目录失败: ${dir}`, error);
  }

  return fileList;
}

// 扫描所有文件
console.log('🔍 开始扫描文件...\n');
const allFiles = scanDirectory(frontendSrcPath);
const report = [];
const stats = {
  total: 0,
  high: 0,
  medium: 0,
  info: 0,
  good: 0,
};

allFiles.forEach((filePath) => {
  const results = findInFile(filePath);
  if (results.length > 0) {
    const relativePath = path.relative(frontendSrcPath, filePath);
    const issues = results.filter(r => !r.isGood);
    const good = results.filter(r => r.isGood);
    
    if (issues.length > 0 || good.length > 0) {
      report.push({
        file: relativePath,
        issues,
        good,
      });

      issues.forEach(({ severity }) => {
        stats.total++;
        if (severity === 'high') stats.high++;
        if (severity === 'medium') stats.medium++;
        if (severity === 'info') stats.info++;
      });
      
      good.forEach(() => stats.good++);
    }
  }
});

// 生成报告
console.log('='.repeat(80));
console.log('📊 Token 使用情况检查报告');
console.log('='.repeat(80));
console.log(`\n✅ 总共检查 ${allFiles.length} 个文件`);
console.log(`⚠️  发现 ${report.length} 个文件包含 token 相关代码\n`);

console.log('📈 统计信息:');
console.log(`   🔴 高优先级问题: ${stats.high} 处`);
console.log(`   🟡 中优先级问题: ${stats.medium} 处`);
console.log(`   🔵 信息: ${stats.info} 处`);
console.log(`   ✅ 已迁移: ${stats.good} 处\n`);

// 按优先级分组显示
const highPriorityFiles = report.filter(r => r.issues.some(i => i.severity === 'high'));
const mediumPriorityFiles = report.filter(r => 
  r.issues.some(i => i.severity === 'medium') && 
  !r.issues.some(i => i.severity === 'high')
);

if (highPriorityFiles.length > 0) {
  console.log('🔴 高优先级文件（必须修改）:');
  console.log('='.repeat(80));
  highPriorityFiles.forEach(({ file, issues, good }) => {
    console.log(`\n📄 ${file}`);
    console.log(`   ⚠️  需要修改: ${issues.length} 处`);
    console.log(`   ✅ 已迁移: ${good.length} 处`);
    
    const grouped = {};
    issues.forEach(({ pattern, line, lineContent, severity }) => {
      if (!grouped[pattern]) {
        grouped[pattern] = [];
      }
      grouped[pattern].push({ line, lineContent, severity });
    });

    Object.entries(grouped).forEach(([pattern, items]) => {
      const icon = items[0].severity === 'high' ? '🔴' : '🟡';
      console.log(`   ${icon} ${pattern}: ${items.length} 处`);
      items.slice(0, 3).forEach(({ line, lineContent }) => {
        console.log(`      第 ${line} 行: ${lineContent}`);
      });
      if (items.length > 3) {
        console.log(`      ... 还有 ${items.length - 3} 处`);
      }
    });
  });
}

if (mediumPriorityFiles.length > 0) {
  console.log('\n\n🟡 中优先级文件（需要检查）:');
  console.log('='.repeat(80));
  mediumPriorityFiles.forEach(({ file, issues }) => {
    console.log(`\n📄 ${file}`);
    console.log(`   需要检查: ${issues.length} 处`);
  });
}

// 生成 JSON 报告
const jsonReport = {
  scanTime: new Date().toISOString(),
  totalFiles: allFiles.length,
  filesWithToken: report.length,
  stats,
  details: report.map(({ file, issues, good }) => ({
    file,
    issueCount: issues.length,
    goodCount: good.length,
    issues: issues.map(({ pattern, line, severity }) => ({
      pattern,
      line,
      severity,
    })),
  })),
};

const reportPath = path.join(__dirname, '../token-usage-report.json');
fs.writeFileSync(reportPath, JSON.stringify(jsonReport, null, 2));

console.log('\n' + '='.repeat(80));
console.log('✅ 检查完成！');
console.log(`📄 详细报告已保存到: ${path.relative(process.cwd(), reportPath)}`);
console.log('='.repeat(80));

// 退出码：如果有高优先级问题，返回 1
if (stats.high > 0) {
  console.log('\n⚠️  发现高优先级问题，请尽快修复！');
  process.exit(1);
} else {
  console.log('\n✅ 未发现高优先级问题！');
  process.exit(0);
}