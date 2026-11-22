"""Minimal Python client for Naro remote environments.

Speaks the same HTTP contract as `@naro/environment`'s `HttpEnvironment` /
`serveEnvironment`. No dependency on the TypeScript runtime.

Usage:
    from naro_client import HttpEnvironment

    env = HttpEnvironment("http://127.0.0.1:8787", token="optional")
    obs = env.execute({"id": "act_1", "name": "echo", "input": {"text": "hi"}})
    print(obs)
"""

from .http_environment import HttpEnvironment

__all__ = ["HttpEnvironment"]
__version__ = "0.1.0"
