import fs from 'fs';
import { execSync } from 'child_process';

const rev = process.argv[2] || 'c51d5bb9';
const file = process.argv[3];
if (!file) {
  console.error('usage: node restore-file-from-git.mjs <rev> <path>');
  process.exit(1);
}
const content = execSync(`git show ${rev}:${file}`, { encoding: 'utf8', maxBuffer: 20e6 });
fs.writeFileSync(file, content, 'utf8');
const bad = (content.match(/\?\?\?/g) || []).length;
const rep = (content.match(/\uFFFD/g) || []).length;
console.log(`restored ${file} from ${rev}, ???=${bad}, U+FFFD=${rep}`);
