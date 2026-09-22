import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collect(path));
    else if (extname(entry.name) === '.js' || extname(entry.name) === '.mjs') out.push(path);
  }
  return out;
}

const roots = ['src', 'dist', 'tests', 'scripts'];
let failed = false;
for (const root of roots) {
  for (const file of await collect(root)) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
  }
}
if (failed) process.exit(1);
console.log('Sintaxe JavaScript válida.');
