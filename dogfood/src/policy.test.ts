import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAction } from '@naro/core';
import { dogfoodPolicy } from './policy.ts';

const bash = (command: string) =>
  createAction('claude-code-session', { capability: 'tool.invoke', target: 'tool://Bash', input: { command } });

const notBash = createAction('claude-code-session', { capability: 'tool.invoke', target: 'tool://Read', input: { file_path: 'x' } });

const ctx = { agentId: 'claude-code-session', goal: { id: 'g', description: 'x', constraints: [], metadata: {} }, grants: [] };

async function decide(action: ReturnType<typeof bash>) {
  const r = await dogfoodPolicy.evaluate(action, ctx as never);
  return typeof r === 'string' ? r : r.decision;
}

test('non-Bash actions are audited allow — no gating rule targets them in v1', async () => {
  assert.equal(await decide(notBash), 'audit');
});

test('denies force-push in any form', async () => {
  assert.equal(await decide(bash('git push --force origin main')), 'deny');
  assert.equal(await decide(bash('git push -f origin feature')), 'deny');
});

test('--force-with-lease escapes the force-push deny (safer: checks remote state)', async () => {
  // Not denied — but still gated by the ordinary "push to main" rule.
  assert.equal(await decide(bash('git push --force-with-lease origin main')), 'require_approval');
  // On a feature branch, force-with-lease alone is just an audited allow.
  assert.equal(await decide(bash('git push --force-with-lease origin claude/x')), 'audit');
});

test('denies git reset --hard and rm -rf on repo root/home/.git', async () => {
  assert.equal(await decide(bash('git reset --hard HEAD~1')), 'deny');
  assert.equal(await decide(bash('rm -rf /')), 'deny');
  assert.equal(await decide(bash('rm -rf ~')), 'deny');
  assert.equal(await decide(bash('rm -rf .git')), 'deny');
});

test('does not deny a scoped rm -rf (only repo-root-shaped targets)', async () => {
  assert.equal(await decide(bash('rm -rf dist')), 'audit');
  assert.equal(await decide(bash('rm -rf node_modules/.cache')), 'audit');
});

test('denies hook/signature bypass flags', async () => {
  assert.equal(await decide(bash('git commit --no-verify -m x')), 'deny');
  assert.equal(await decide(bash('git commit --no-gpg-sign -m x')), 'deny');
});

test('requires approval for push to main/master, publish, and pr merge', async () => {
  assert.equal(await decide(bash('git push origin main')), 'require_approval');
  assert.equal(await decide(bash('git push origin master')), 'require_approval');
  assert.equal(await decide(bash('npm run publish')), 'require_approval');
  assert.equal(await decide(bash('npx changeset publish')), 'require_approval');
  assert.equal(await decide(bash('gh pr merge 4 --merge')), 'require_approval');
});

test('push to a feature branch is audited, not gated', async () => {
  assert.equal(await decide(bash('git push origin claude/some-branch')), 'audit');
});

test('ordinary commands are audited allow', async () => {
  assert.equal(await decide(bash('npm test')), 'audit');
  assert.equal(await decide(bash('ls -la')), 'audit');
  assert.equal(await decide(bash('git status')), 'audit');
});
