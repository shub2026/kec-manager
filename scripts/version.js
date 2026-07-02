#!/usr/bin/env node

/**
 * KEC 课程管理平台 - 版本号管理脚本
 *
 * 用法：
 *   node scripts/version.js          查看当前版本
 *   node scripts/version.js patch    递增补丁版本 (1.0.1 → 1.0.2)
 *   node scripts/version.js minor    递增次版本   (1.0.1 → 1.1.0)
 *   node scripts/version.js major    递增主版本   (1.0.1 → 2.0.0)
 *   node scripts/version.js 1.2.3    设置为指定版本
 *
 * 自动同步更新以下文件：
 *   - package.json (根目录)
 *   - client/package.json (前端)
 *   - server/package.json (后端)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PACKAGE_FILES = [
  resolve(ROOT, 'package.json'),
  resolve(ROOT, 'client', 'package.json'),
  resolve(ROOT, 'server', 'package.json'),
];

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

function readVersion(filePath) {
  const pkg = JSON.parse(readFileSync(filePath, 'utf-8'));
  return pkg.version;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`无效的版本号: ${version}`);
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bumpVersion(current, type) {
  const v = parseVersion(current);
  switch (type) {
    case 'patch':
      v.patch++;
      break;
    case 'minor':
      v.minor++;
      v.patch = 0;
      break;
    case 'major':
      v.major++;
      v.minor = 0;
      v.patch = 0;
      break;
    default:
      throw new Error(`未知的版本递增类型: ${type}（可选: patch, minor, major）`);
  }
  return formatVersion(v);
}

function updateVersion(filePath, newVersion) {
  const content = readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(content);
  const old = pkg.version;
  pkg.version = newVersion;
  // 保持原始缩进（检测文件中的缩进风格）
  const indent = content.match(/^(\s+)"name"/m)?.[1] || '  ';
  const output = JSON.stringify(pkg, null, indent.replace(/\t/g, '\t')) + '\n';
  writeFileSync(filePath, output, 'utf-8');
  return old;
}

// ──────────────────────────────────────────────
// 主逻辑
// ──────────────────────────────────────────────

const currentVersion = readVersion(PACKAGE_FILES[0]);
const arg = process.argv[2];

if (!arg) {
  console.log(`\n📦 当前版本: v${currentVersion}\n`);
  console.log('用法:');
  console.log('  node scripts/version.js patch   递增补丁版本');
  console.log('  node scripts/version.js minor   递增次版本');
  console.log('  node scripts/version.js major   递增主版本');
  console.log('  node scripts/version.js 1.2.3   设置指定版本\n');
  process.exit(0);
}

// 确定目标版本
let newVersion;
if (['patch', 'minor', 'major'].includes(arg)) {
  newVersion = bumpVersion(currentVersion, arg);
} else {
  // 直接指定版本号
  parseVersion(arg); // 验证格式
  newVersion = arg;
}

if (newVersion === currentVersion) {
  console.log(`\n⚠️  版本号未变化，仍为 v${currentVersion}\n`);
  process.exit(0);
}

console.log(`\n🔄 更新版本: v${currentVersion} → v${newVersion}`);

let updatedCount = 0;
for (const filePath of PACKAGE_FILES) {
  const rel = filePath.replace(ROOT + '/', '').replace(ROOT + '\\', '');
  try {
    const old = updateVersion(filePath, newVersion);
    console.log(`  ✓ ${rel}: ${old} → ${newVersion}`);
    updatedCount++;
  } catch (e) {
    console.error(`  ✗ ${rel}: ${e.message}`);
  }
}

if (updatedCount > 0) {
  console.log(`\n✅ 成功更新 ${updatedCount} 个文件`);
  console.log('\n下一步:');
  console.log('  git add package.json client/package.json server/package.json');
  console.log(`  git commit -m "chore: bump version to v${newVersion}"`);
  console.log(`  git tag v${newVersion}`);
  console.log('  git push && git push --tags\n');
} else {
  console.error('\n❌ 没有文件被更新\n');
  process.exit(1);
}
