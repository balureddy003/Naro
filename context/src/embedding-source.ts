import { CapabilityNotSupportedError, newId, type ContextItem } from '@naro/core';
import { requireCapability, type Model } from '@naro/model';
import type { Document } from './keyword-source.ts';
import type { ContextQuery, ContextSource } from './source.ts';

/** requireCapability confirms the declaration; this narrows `embed` for TS
 * the same way @naro/model's own `stream()` helper narrows `model.stream`. */
function embedder(model: Model): NonNullable<Model['embed']> {
  requireCapability(model, 'embeddings');
  if (!model.embed) throw new CapabilityNotSupportedError('embeddings', `model '${model.id}'`);
  // Bound, not a bare property reference — an unbound `model.embed` loses
  // `this` the moment it's called through this indirection.
  return model.embed.bind(model);
}

interface EmbeddedDocument {
  readonly id: string;
  readonly text: string;
  readonly embedding: readonly number[];
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Semantic retrieval over an in-memory document set — the vector-backed
 * counterpart to `KeywordSource`, same one-method contract. Documents are
 * embedded once at construction (`create`, since embedding is async);
 * each `retrieve` embeds only the query and scores by cosine similarity.
 *
 * This is the reference implementation, not a production vector index:
 * every retrieve is an O(docs) scan in application code. Swap in a
 * Qdrant/pgvector-backed ContextSource behind the same contract once a
 * document set outgrows an in-process scan.
 */
export class EmbeddingSource implements ContextSource {
  readonly id: string;
  private readonly model: Model;
  private readonly docs: readonly EmbeddedDocument[];

  private constructor(id: string, model: Model, docs: readonly EmbeddedDocument[]) {
    this.id = id;
    this.model = model;
    this.docs = docs;
  }

  /** Requires 'embeddings' on `model`. Embeds every document up front. */
  static async create(id: string, model: Model, docs: readonly Document[]): Promise<EmbeddingSource> {
    const embed = embedder(model);
    const vectors = docs.length ? await embed(docs.map((d) => d.text)) : [];
    const embedded = docs.map((d, i) => ({
      id: d.id ?? newId('ctx'),
      text: d.text,
      embedding: vectors[i] ?? [],
    }));
    return new EmbeddingSource(id, model, embedded);
  }

  async retrieve(query: ContextQuery): Promise<ContextItem[]> {
    if (this.docs.length === 0) return [];
    const [queryVector] = await embedder(this.model)([query.text]);
    return this.docs
      .map((doc) => ({
        id: doc.id,
        source: this.id,
        content: doc.text,
        score: cosineSimilarity(queryVector ?? [], doc.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit ?? 10);
  }
}
