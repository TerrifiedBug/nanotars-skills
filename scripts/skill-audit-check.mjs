#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function usage() {
  console.error('Usage: node scripts/skill-audit-check.mjs [--changed <git-range>] [file ...]');
  process.exit(2);
}

function changedFiles(range) {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', range], {
    cwd: root,
    encoding: 'utf8',
  });
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const files = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--changed') {
      const range = argv[++i];
      if (!range) usage();
      files.push(...changedFiles(range));
    } else if (arg === '-h' || arg === '--help') {
      usage();
    } else {
      files.push(arg);
    }
  }
  return [...new Set(files)];
}

function isSkillMarkdown(file) {
  return (
    file.startsWith('plugins/') &&
    file.endsWith('.md') &&
    (file.includes('/skills/') || file.includes('/container-skills/'))
  );
}

function isOperatorSkill(file) {
  return file.startsWith('plugins/') && file.includes('/skills/') && file.endsWith('/SKILL.md');
}

function isTextFile(file) {
  return /\.(md|js|json|ya?ml|sh|ts|tsx|py)$/i.test(file);
}

function readFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function addIssue(issues, file, line, message) {
  issues.push({ file, line, message });
}

function scanFile(file, issues) {
  const base = path.basename(file);
  if (base.toLowerCase() === 'skill.md' && base !== 'SKILL.md') {
    addIssue(issues, file, 1, 'skill files must be named SKILL.md exactly');
  }

  if (!isTextFile(file) || !fs.existsSync(path.join(root, file))) return;

  const content = readFile(file);
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (/nanoclaw-skills|plugin install\s+nanoclaw-|plugin marketplace add\s+TerrifiedBug\/nanoclaw-skills/i.test(line)) {
      addIssue(issues, file, lineNo, 'stale marketplace reference; use nanotars-skills / nanotars-* names');
    }
    if (isSkillMarkdown(file) && /\bskill\.md\b/.test(line)) {
      addIssue(issues, file, lineNo, 'stale skill filename casing; use SKILL.md');
    }
  });

  if (isOperatorSkill(file)) {
    if (/AUTH:/.test(content) || /ANTHROPIC_API_KEY/.test(content)) {
      if (!/CLAUDE_CODE_OAUTH_TOKEN/.test(content) || !/\.claude\/\.credentials\.json/.test(content)) {
        addIssue(
          issues,
          file,
          1,
          'auth preflight must accept ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or ~/.claude/.credentials.json',
        );
      }
    }
    if (/\b(sqlite3|better-sqlite3)\b|db\.prepare\s*\(|\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}\b(FROM|INTO|SET)\b/i.test(content)) {
      addIssue(
        issues,
        file,
        1,
        'operator skills should call nanotars CLI/admin commands instead of embedding direct SQL',
      );
    }
  }
}

const files = parseArgs(process.argv);
const issues = [];
for (const file of files) scanFile(file, issues);

if (issues.length > 0) {
  console.error('Skill audit failed:');
  for (const issue of issues) {
    console.error(`- ${issue.file}:${issue.line}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`Skill audit passed (${files.length} changed file${files.length === 1 ? '' : 's'} checked).`);
