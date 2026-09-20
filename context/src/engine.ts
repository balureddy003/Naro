import type { ContextItem, ContextProvider } from '@naro/core';
import type { ContextQuery, ContextSource } from './source.ts';
import { ScoreRanker, truncateItem, type ContextBudget, type Ranker } from './pipeline.ts';

/**
 * The Context Engine — "context as a service".
 *
 * Pipeline: fan out to sources → merge → rank → select → compress →
 * budget → provide. Retrieval is a *request* made by the reasoner
 * ('need-context'), served here — never embedded in prompts by hand.
 *
 * Deliberately technology-free: sources may be keyword, SQL, vector,
 * graph, or API-backed. This engine only orchestrates.
 */
export class ContextEngine implements ContextProvider {
  private readonly sources: ContextSource[] = [];
  private readonly ranker: Ranker;
  private readonly budget: Required<ContextBudget>;

  constructor(options: {
    sources?: readonly ContextSource[];
    ranker?: Ranker;
    budget?: ContextBudget;
  } = {}) {
    this.sources.push(...(options.sources ?? []));
    this.ranker = options.ranker ?? new ScoreRanker();
    this.budget = { maxItems: 10, maxChars: 4000, ...options.budget };
  }

  addSource(source: ContextSource): this {
    this.sources.push(source);
    return this;
  }

  async retrieve(queryText: string): Promise<readonly ContextItem[]> {
    const query: ContextQuery = { text: queryText, limit: this.budget.maxItems };

    // 1-2. retrieve from every source in parallel, then merge
    const candidates = (await Promise.all(
      this.sources.map((s) => Promise.resolve(s.retrieve(query))),
    )).flat();

    // 3-4. rank + select within item budget
    const ranked = this.ranker.rank(candidates, queryText).slice(0, this.budget.maxItems);

    // 5-6. compress (truncate) + enforce char budget
    const items: ContextItem[] = [];
    let chars = 0;
    for (const item of ranked) {
      const remaining = this.budget.maxChars - chars;
      if (remaining <= 0) break;
      const trimmed = truncateItem(item, remaining);
      const size = typeof trimmed.content === 'string' ? trimmed.content.length : 256;
      chars += Math.min(size, remaining);
      items.push(trimmed);
    }
    return items;
  }
}
