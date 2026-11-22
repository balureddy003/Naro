# naro-client (Python)

Minimal client for Naro remote environments (`serveEnvironment` / `HttpEnvironment`).

Speaks the same HTTP contract as the TypeScript client. No runtime dependency.

## Install (editable)

```bash
cd clients/python
pip install -e .
```

## Usage

```python
from naro_client import HttpEnvironment

env = HttpEnvironment("http://127.0.0.1:8787", token="optional-bearer")
print(env.health())
obs = env.execute({"id": "act_1", "name": "echo", "input": {"text": "hello"}})
print(obs)
```

This closes the language-reach gap for remote hands. The kernel remains TypeScript.
