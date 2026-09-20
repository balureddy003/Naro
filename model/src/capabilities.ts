/**
 * What a model can do — declared as data, never assumed.
 *
 * "Not every model supports every capability" is a first-class rule in
 * Naro: a capability you cannot declare is a capability callers cannot
 * invoke. Calling one anyway throws CapabilityNotSupportedError rather
 * than silently degrading.
 */
export type ModelCapability =
  | 'chat'              // conversational turn-taking
  | 'completion'        // raw text continuation
  | 'reasoning'         // exposes chain-of-thought / thinking tokens
  | 'structured-output' // schema-constrained generation
  | 'tool-calling'      // can emit tool invocations
  | 'streaming'         // incremental token stream
  | 'vision'            // image inputs
  | 'embeddings'        // text → vector
  | 'reranking'         // scored reordering of candidates
  | 'batch';            // offline bulk inference
