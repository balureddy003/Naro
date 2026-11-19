/**
 * PRD-002 milestone 2 — transaction-categorizer benchmark.
 *
 *   node templates/bench/categorizer.ts [--limit N]
 *
 * Env: OLLAMA_URL (default http://localhost:11434/v1), OLLAMA_MODEL
 * (default qwen2.5:3b), FRONTIER_IN_PRICE / FRONTIER_OUT_PRICE
 * (USD per 1M tokens, for the always-frontier cost comparison —
 * defaults are Claude-Sonnet-class list prices, labelled as such).
 */
import { OpenAiCompatibleModel } from '../../adapters/openai/src/model.ts';
import { verifyOllamaCapabilities } from '../../adapters/openai/src/ollama.ts';
import { BenchmarkRunner, formatReport, type EvalCase } from '@naro/evaluation';
import { parseJsonResult } from '../src/invoice-extractor.ts';
import { transactionCategorizer } from '../src/transaction-categorizer.ts';
import { BENCH_CATEGORIES, BENCH_HISTORY, TRANSACTIONS } from './fixtures.ts';

const limitArg = process.argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : TRANSACTIONS.length;
const modelTag = process.env['OLLAMA_MODEL'] ?? 'qwen2.5:3b';
const baseUrl = process.env['OLLAMA_URL'] ?? 'http://localhost:11434/v1';

// Capabilities from verification, not from the catalog (PRD-005 rule).
const verified = await verifyOllamaCapabilities({ model: modelTag, baseUrl });
if (!verified.reachable) {
  console.error(`ollama unreachable at ${baseUrl}:`, verified.failures);
  process.exit(1);
}
console.log(`verified ${modelTag}: ${verified.capabilities.join(', ')}`);

const model = new OpenAiCompatibleModel(modelTag, { baseUrl, capabilities: verified.capabilities }, 'ollama');

const norm = (s: string) => s.trim().toLowerCase();
const answer = (result: unknown): string | undefined => {
  const parsed = parseJsonResult(result);
  const c = parsed ? parsed['category'] : result;
  return typeof c === 'string' ? c : undefined;
};

const cases: EvalCase[] = TRANSACTIONS.slice(0, limit).map((t) => {
  const built = transactionCategorizer.build(
    { transaction: { description: t.description, amount: t.amount }, categories: [...BENCH_CATEGORIES], history: BENCH_HISTORY },
    { cheap: model },
  );
  return {
    id: t.id,
    description: t.description,
    goal: built.spec.goal,
    deps: (({ spec: _spec, ...rest }) => rest)(built),
    check: (r) => {
      const got = answer(r.result);
      return got !== undefined && norm(got) === norm(t.expected)
        ? { ok: true }
        : { ok: false, reason: `expected '${t.expected}', got ${JSON.stringify(r.result).slice(0, 120)}` };
    },
  };
});

const t0 = Date.now();
const report = await new BenchmarkRunner().run(cases);
console.log(formatReport(report));

// Token totals → cost comparison. Ollama marginal API cost is $0
// (compute/electricity, disclosed); the frontier comparison prices the
// same token counts at configurable list rates.
let inTok = 0, outTok = 0;
for (const r of report.results) {
  inTok += r.metrics.usage?.inputTokens ?? 0;
  outTok += r.metrics.usage?.outputTokens ?? 0;
}
const inPrice = Number(process.env['FRONTIER_IN_PRICE'] ?? 3);    // $/1Mtok
const outPrice = Number(process.env['FRONTIER_OUT_PRICE'] ?? 15); // $/1Mtok
const frontierCost = (inTok * inPrice + outTok * outPrice) / 1e6;
const accuracy = report.passRate * 100;

console.log(`\n=== benchmark summary ===`);
console.log(`model: ${modelTag} @ ${baseUrl}`);
console.log(`accuracy: ${report.passed}/${report.total} (${accuracy.toFixed(1)}%)`);
console.log(`tokens: ${inTok} in / ${outTok} out / ${inTok + outTok} total`);
console.log(`wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s for ${report.total} cases`);
console.log(`api cost (ollama): $0.00 (marginal; compute/electricity excluded)`);
console.log(`same tokens at frontier list rates ($${inPrice}/$${outPrice} per Mtok): $${frontierCost.toFixed(4)}`);
