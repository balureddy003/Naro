import { chat as call, type Model, type ModelCapability } from '@naro/model';
import { ReActReasoner } from '@naro/reasoning';
import { OpenAiCompatibleModel } from './model.ts';
import { OpenAiCompatibleProvider } from './provider.ts';

/**
 * Ollama as Naro's self-hosted small-model tier — PRD-005.
 *
 * Ollama serves an OpenAI-compatible API on `http://localhost:11434/v1`,
 * so this is configuration + verification on top of
 * `OpenAiCompatibleProvider`, not a new adapter. Two pieces:
 *
 *   verifyOllamaCapabilities()  real round-trips that report which
 *                               capabilities a pulled model actually
 *                               has — the catalog claims are marketing;
 *                               this is the evidence (adapter README's
 *                               "no guessed capabilities" rule).
 *   ollamaCheapTier()           a one-line EscalatingReasoner cheap tier.
 */

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1';

/** Candidate list from PRD-005 — size/license are public catalog facts.
 *  The `verified` answer comes from verifyOllamaCapabilities() against a
 *  live `ollama serve`, never from this table. */
export const OLLAMA_CANDIDATES = [
  { tag: 'llama3.2:1b', approxSize: '1B', license: 'llama-community', notes: 'smallest Meta tool-calling model' },
  { tag: 'llama3.2:3b', approxSize: '3B', license: 'llama-community', notes: '1b sibling; better tool-calling odds' },
  { tag: 'qwen2.5:1.5b', approxSize: '1.5B', license: 'apache-2.0', notes: 'permissive license' },
  { tag: 'qwen2.5:3b', approxSize: '3B', license: 'apache-2.0', notes: 'permissive license' },
  { tag: 'qwen2.5:7b', approxSize: '7B', license: 'apache-2.0', notes: 'largest qwen2.5 candidate here' },
  { tag: 'phi3.5', approxSize: '3.8B', license: 'mit', notes: 'permissive license' },
  { tag: 'gemma2:2b', approxSize: '2B', license: 'gemma-terms', notes: 'base model claims no tool-calling — verify' },
  { tag: 'smollm2', approxSize: '1.7B', license: 'apache-2.0', notes: 'claims neither tool-calling nor structured output' },
  { tag: 'nomic-embed-text', approxSize: '137M', license: 'apache-2.0', notes: 'embedding model — for retrieval, not chat' },
] as const;

export interface OllamaProbeResult {
  readonly model: string;
  readonly baseUrl: string;
  /** Whether the endpoint answered at all — false means ollama serve is down. */
  readonly reachable: boolean;
  /** Per-probe outcome — the evidence behind `capabilities`. */
  readonly probes: {
    readonly chat: boolean;
    readonly toolCalling: boolean;
    readonly structuredOutput: boolean;
    readonly streaming: boolean;
    readonly embeddings: boolean;
  };
  /** Capabilities the probes actually proved — safe to declare. */
  readonly capabilities: readonly ModelCapability[];
  /** Probe failures, keyed by probe name — for "why isn't X listed". */
  readonly failures: Readonly<Record<string, string>>;
}

export interface OllamaVerifyOptions {
  /** Ollama tag, e.g. 'qwen2.5:3b' — must be pulled (`ollama pull <tag>`). */
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

async function probe(fn: () => Promise<boolean>): Promise<{ ok: boolean; error?: string }> {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run real round-trips against an Ollama-hosted model and return the
 * capability list they prove. This is the "Verified?" column in PRD-005's
 * candidate table: each capability is declared only if the probe
 * succeeded — 'tool-calling' means the model emitted an actual
 * `tool_calls` response, not that the card says it can.
 */
export async function verifyOllamaCapabilities(opts: OllamaVerifyOptions): Promise<OllamaProbeResult> {
  const baseUrl = opts.baseUrl ?? OLLAMA_DEFAULT_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const failures: Record<string, string> = {};

  // Reachability first — GET /models answers cheaply even with no models
  // pulled, so a failure here means the endpoint, not the model.
  const reach = await probe(async () => (await fetchImpl(`${baseUrl}/models`)).ok);
  if (!reach.ok) {
    return {
      model: opts.model, baseUrl, reachable: false,
      probes: { chat: false, toolCalling: false, structuredOutput: false, streaming: false, embeddings: false },
      capabilities: [],
      failures: { reachability: reach.error ?? 'endpoint not reachable' },
    };
  }

  // Probe through the real adapter path — capabilities are declared so
  // nothing is gated; what we measure is whether the wire round-trips.
  const model: Model = await new OpenAiCompatibleProvider({
    baseUrl, fetchImpl,
    capabilities: ['chat', 'tool-calling', 'structured-output', 'streaming', 'embeddings'],
  }).getModel(opts.model);

  const chatP = await probe(async () => {
    const res = await call(model, {
      messages: [{ role: 'user', content: 'Reply with exactly the word: ok' }],
      maxTokens: 16,
    });
    return typeof res.message.content === 'string' && res.message.content.length > 0;
  });
  if (!chatP.ok) failures['chat'] = chatP.error ?? 'no usable response';

  const toolP = await probe(async () => {
    const res = await call(model, {
      messages: [{ role: 'user', content: 'Call the echo tool with text "hello". Do not answer in prose.' }],
      tools: [{
        name: 'echo',
        description: 'Echo the given text back.',
        parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      }],
      maxTokens: 128,
    });
    return (res.message.toolCalls?.length ?? 0) > 0;
  });
  if (!toolP.ok) failures['tool-calling'] = toolP.error ?? 'no tool_calls in response';

  const structP = await probe(async () => {
    const res = await call(model, {
      messages: [{ role: 'user', content: 'Answer as JSON: {"answer": "yes"}' }],
      responseFormat: { type: 'schema', schema: {
        type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'],
      } },
      maxTokens: 64,
    });
    const parsed = JSON.parse(typeof res.message.content === 'string' ? res.message.content : '') as { answer?: unknown };
    return typeof parsed.answer === 'string';
  });
  if (!structP.ok) failures['structured-output'] = structP.error ?? 'response was not schema-valid JSON';

  const streamP = await probe(async () => {
    if (model.stream === undefined) return false;
    for await (const chunk of model.stream({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 })) {
      if (chunk.delta.length > 0 || chunk.done) return true;
    }
    return false;
  });
  if (!streamP.ok) failures['streaming'] = streamP.error ?? 'no stream chunks';

  const embedP = await probe(async () => {
    if (model.embed === undefined) return false;
    const vecs = await model.embed(['probe']);
    return vecs.length === 1 && vecs[0]!.length > 0;
  });
  if (!embedP.ok) failures['embeddings'] = embedP.error ?? 'no embedding returned';

  const capabilities: ModelCapability[] = ['chat'];
  if (toolP.ok) capabilities.push('tool-calling');
  if (structP.ok) capabilities.push('structured-output');
  if (streamP.ok) capabilities.push('streaming');
  if (embedP.ok) capabilities.push('embeddings');

  return {
    model: opts.model, baseUrl, reachable: true,
    probes: {
      chat: chatP.ok, toolCalling: toolP.ok, structuredOutput: structP.ok,
      streaming: streamP.ok, embeddings: embedP.ok,
    },
    capabilities: chatP.ok ? capabilities : [],
    failures,
  };
}

export interface OllamaCheapTierOptions {
  /** Ollama tag, e.g. 'qwen2.5:3b'. */
  readonly model: string;
  readonly baseUrl?: string;
  /**
   * The verified capability list — pass `verifyOllamaCapabilities().capabilities`
   * (or a list you trust). Defaults to `['chat']` per the adapter's
   * no-guessed-capabilities rule; a chat-only tier can't answer ReAct
   * tool calls, so PRD-002 templates need the probe result.
   */
  readonly capabilities?: readonly ModelCapability[];
  readonly fetchImpl?: typeof fetch;
}

/**
 * The packaged cheap tier — one line for a template author instead of
 * assembling provider + model + reasoner. Returns the pieces so the
 * caller owns composition (the label feeds EscalatingReasoner's tiers).
 */
export function ollamaCheapTier(opts: OllamaCheapTierOptions): { model: Model; reasoner: ReActReasoner; label: string } {
  const baseUrl = opts.baseUrl ?? OLLAMA_DEFAULT_BASE_URL;
  const model = new OpenAiCompatibleModel(opts.model, {
    baseUrl,
    capabilities: opts.capabilities ?? ['chat'],
    ...(opts.fetchImpl !== undefined && { fetchImpl: opts.fetchImpl }),
  }, 'ollama');
  return {
    model,
    reasoner: new ReActReasoner(model),
    label: `ollama/${opts.model}`,
  };
}
