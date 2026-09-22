import { RulePolicyEngine, type PolicyRule } from '@naro/policy';
import type { Action } from '@naro/core';

/**
 * Governs Bash commands a Claude Code session runs against Naro's own repo.
 * Everything else (Read, Edit, Write, Grep, Glob, ...) is out of scope for
 * v1 — Bash is where the irreversible or shared-state actions live (see
 * profiles/coding/README.md: "shell.exec is the dangerous one").
 *
 * This is the same Git Safety Protocol this session already operates under
 * (see the system prompt's "Git Safety Protocol" and "Executing actions
 * with care" sections), made structural instead of a instruction a model
 * has to remember: the gate runs whether or not the model chooses to recall
 * the rule.
 */

const isBash = (a: Action): boolean => a.target === 'tool://Bash';
const cmd = (a: Action): string => (a.input as { command?: string } | undefined)?.command ?? '';

function bashRule(
  id: string,
  then: PolicyRule['then'],
  test: (command: string) => boolean,
): PolicyRule {
  return { id, when: (a) => isBash(a) && test(cmd(a)), then };
}

const rules: readonly PolicyRule[] = [
  // --- hard denies: the "never" list from this session's own operating rules ---
  bashRule('deny-force-push', 'deny', (c) =>
    /\bgit\s+push\b/.test(c) && /(--force(?!-with-lease)\b|(?<!\S)-f\b)/.test(c)),
  bashRule('deny-hard-reset', 'deny', (c) => /\bgit\s+reset\s+--hard\b/.test(c)),
  bashRule('deny-clean-force', 'deny', (c) => /\bgit\s+clean\s+.*-[a-z]*f/.test(c)),
  bashRule('deny-checkout-dot', 'deny', (c) => /\bgit\s+checkout\s+\.(\s|$)/.test(c)),
  bashRule('deny-restore-all', 'deny', (c) => /\bgit\s+restore\s+\.(\s|$)/.test(c)),
  bashRule('deny-skip-hooks', 'deny', (c) => /--no-verify\b|--no-gpg-sign\b|-c\s+commit\.gpgsign=false/.test(c)),
  bashRule('deny-rm-rf-repo-root', 'deny', (c) => /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/|~\/?|\.git\/?)(\s|$)/.test(c)),
  bashRule('deny-branch-force-delete', 'deny', (c) => /\bgit\s+branch\s+-D\b/.test(c)),

  // --- require approval: reversible, but touches shared or published state ---
  bashRule('approve-push-default-branch', 'require_approval', (c) =>
    /\bgit\s+push\b/.test(c) && /\b(origin\s+)?(main|master)\b/.test(c)),
  bashRule('approve-publish', 'require_approval', (c) =>
    /\bnpm\s+(run\s+)?(publish|release)\b/.test(c) || /\bnpx\s+changeset\s+publish\b/.test(c)),
  bashRule('approve-pr-merge', 'require_approval', (c) => /\bgh\s+pr\s+merge\b/.test(c)),
  bashRule('approve-tag-push', 'require_approval', (c) => /\bgit\s+push\b.*--tags\b/.test(c)),

  // --- everything else: allowed, but on the record ---
  { id: 'audit-rest', when: () => true, then: 'audit' },
];

/** The dogfood policy: id 'naro-dogfood' so it's identifiable in the journal. */
export const dogfoodPolicy = new RulePolicyEngine(rules, { id: 'naro-dogfood', default: 'allow' });
