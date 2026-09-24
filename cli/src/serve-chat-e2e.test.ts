import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Action, PolicyContext, PolicyResult } from '@naro/core';
import { MockModel, type ChatRequest, type ChatResponse } from '@naro/model';
import { AgentRunner, SqliteApprovalBridge } from '@naro/runtime';
import { transactionCategorizer, type CategorizeInput } from '@naro/templates';
import { NaroClient, watchRun, type RunEvent } from '@naro/client';
import { startAgentServer, type RunnerFactory } from './serve.ts';

/**
 * PRD-006 milestone 5 — a real PRD-002 template end-to-end through the
 * served interface. Riverside Supply's bookkeeper categorizes a
 * STAPLES charge; the deployment gates vendor-history lookups behind a
 * human (financial records access), so the run pauses on an approval
 * card, the owner approves through the same endpoints the chat UI
 * calls, and the run completes with a verified category.
 */

const CHART = ['Meals & Entertainment', 'Office Supplies', 'Travel', 'Software & Subscriptions'];

const INPUT: CategorizeInput = {
  transaction: { description: 'STAPLES #441', amount: 214.10, currency: 'USD', date: '2026-02-03' },
  categories: CHART,
  history: [
    { description: 'STAPLES #441', category: 'Office Supplies' },
    { description: 'UBER *TRIP 1021', category: 'Travel' },
  ],
};

function scriptedModel(answer: string): MockModel {
  return new MockModel({
    respond: (req: ChatRequest): ChatResponse => {
      const sawToolResult = req.messages.some((m) => m.role === 'tool');
      if (!sawToolResult) {
        return {
          message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'lookup_history', arguments: { query: 'STAPLES' } }] },
          finishReason: 'tool-calls',
        };
      }
      return { message: { role: 'assistant', content: answer }, finishReason: 'stop' };
    },
  });
}

test('PRD-006 e2e: template run → approval card → verified result, all over real routes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-chat-e2e-'));
  const bridge = new SqliteApprovalBridge(join(dir, 'approvals.db'), { pollMs: 25 });

  const factory: RunnerFactory = (goal, info) => {
    assert.equal(info?.template, 'transaction-categorizer');
    const deps = transactionCategorizer.build(INPUT, { cheap: scriptedModel('Office Supplies') });
    return new AgentRunner({
      ...deps,
      human: bridge,
      // The deployment's rule on top of the template's own policy:
      // vendor-history access needs a person. require_approval → the run
      // waits on the bridge → /approvals → POST /approvals/:id answers it.
      policy: {
        evaluate: (action: Action, ctx: PolicyContext) => {
          if (action.capability === 'tool.invoke' && action.target === 'tool://lookup_history') {
            return Promise.resolve({ decision: 'require_approval', reason: 'vendor history access needs owner sign-off' });
          }
          return deps.policy.evaluate(action, ctx);
        },
      },
    });
  };

  const { url, close } = await startAgentServer(factory, {
    port: 0,
    approvals: bridge,
    chatTemplates: [{ id: 'transaction-categorizer', name: 'Transaction categorizer' }],
    principals: {
      'owner-tok': { id: 'owner@riverside', roles: ['operator', 'approver', 'viewer'] },
    },
  });

  const client = new NaroClient({ baseUrl: url, token: 'owner-tok' });
  try {
    // The call the chat composer's Send button makes — template routed
    // by the same field the UI sends.
    const { runId } = await client.submitGoal({
      description: 'Categorize STAPLES #441 $214.10 — month-end close',
      template: 'transaction-categorizer',
    });
    assert.match(runId, /^run_/);

    // The run pauses on the gated lookup — the approval surfaces in the
    // queue exactly as the chat card renders it.
    await new Promise((r) => setTimeout(r, 150));
    const pending = await client.listApprovals();
    assert.equal(pending.length, 1);
    assert.match(pending[0]!.question, /lookup_history|tool\.invoke/);

    // The same call the card's Approve button makes.
    await client.answerApproval(pending[0]!.id, { approved: true });

    // Stream to terminal — the watchRun loop the transcript uses.
    const seen: RunEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const stop = watchRun(client, runId, {
        onEvent: (e) => {
          seen.push(e);
          if (e.type === 'agent.completed' || e.type === 'agent.failed') { stop(); resolve(); }
        },
        onError: reject,
      });
      setTimeout(() => { stop(); reject(new Error('run never reached a terminal event')); }, 10_000);
    });

    const run = await client.getRun(runId);
    assert.equal(run.status, 'completed');
    assert.equal(run.result, 'Office Supplies');
    assert.equal(run.specName, 'tpl:transaction-categorizer'); // sidebar grouping field

    // The same evidence record the chip-expander and naro verify both read.
    const evidence = await client.getEvidence(runId);
    assert.equal(evidence.chain.ok, true);
    const gated = evidence.actions.find((a) => a.capability === 'tool.invoke');
    assert.equal(gated?.policy, 'approved');
    assert.equal(gated?.approvedBy, 'owner@riverside');
  } finally {
    await close();
    await rm(dir, { recursive: true, force: true });
  }
});
