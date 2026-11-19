---
"@naro/adapter-openai": minor
---

PRD-005 milestone 1: `verifyOllamaCapabilities()` — real round-trip probes
(chat / tool-calling / structured-output / streaming / embeddings) that
return only the capabilities a pulled Ollama model actually proves, plus
`ollamaCheapTier()`, the one-line `EscalatingReasoner` cheap tier.
`OLLAMA_CANDIDATES` carries catalog facts; the verified column fills in
from the probe, never from marketing cards. `NARO_OLLAMA=1` runs the live
test against a local `ollama serve`.
