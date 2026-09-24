import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowAllPolicy, createAgentSpec, createObservation, type Goal } from '@naro/core';
import { AgentRunner, DirectReasoner } from '@naro/runtime';
import { InMemoryPrincipalStore } from './principals.ts';
import { InMemoryAccountStore, InMemorySessionStore, LoginRateLimiter } from './accounts.ts';
import { startAgentServer, type RunnerFactory } from './serve.ts';

const factory: RunnerFactory = (goal: Goal) => new AgentRunner({
  spec: createAgentSpec({ name: 'svc', goal }),
  reasoner: new DirectReasoner(() => ({ kind: 'complete', result: 'done' })),
  executor: { execute: (a) => Promise.resolve(createObservation({ actionId: a.id, source: a.target, kind: 'env-change', success: true })) },
  policy: allowAllPolicy,
});

/** Node's fetch has no cookie jar — pull the session cookie's name=value
 *  out of Set-Cookie (dropping Path/HttpOnly/etc.) to replay on the next
 *  request, the way a browser would. */
function sessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie');
  assert.ok(raw !== null, 'expected a Set-Cookie header');
  return raw!.split(';')[0]!;
}

test('signup: creates an account, provisions it as an admin principal, and signs the browser in', async () => {
  const principalStore = new InMemoryPrincipalStore();
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore, accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    const signup = await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Owner@Example.com', password: 'correct horse battery staple' }),
    });
    assert.equal(signup.status, 201);
    const body = await signup.json() as { id: string; email: string; tenantId: string };
    assert.equal(body.email, 'owner@example.com');
    assert.match(body.id, /^acct_/);
    // Signup never returns a bearer token — session-only, per ADR 0027.
    assert.ok(!('token' in body));

    const cookie = sessionCookie(signup);
    const me = await (await fetch(`${url}/me`, { headers: { cookie } })).json() as { id: string; roles: string[]; tenantId?: string };
    assert.equal(me.id, body.id);
    assert.ok(me.roles.includes('admin'));
    assert.equal(me.tenantId, body.tenantId);

    // The account really is a principal now, independent of the session.
    const principal = await principalStore.getById(body.id);
    assert.equal(principal?.roles.has('admin'), true);
    assert.equal(principal?.tenantId, body.tenantId);
  } finally {
    await close();
  }
});

test('signup: duplicate email is rejected with 409, first account unaffected', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    const opts = { method: 'POST' as const, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@example.com', password: 'password number one' }) };
    assert.equal((await fetch(`${url}/accounts/signup`, opts)).status, 201);
    const dupe = await fetch(`${url}/accounts/signup`, { ...opts, body: JSON.stringify({ email: 'a@example.com', password: 'a different password' }) });
    assert.equal(dupe.status, 409);
  } finally {
    await close();
  }
});

test('signup: rejects a short password and a malformed email before touching the store', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    const post = (body: unknown) => fetch(`${url}/accounts/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ email: 'a@example.com', password: 'short' })).status, 400);
    assert.equal((await post({ email: 'not-an-email', password: 'a long enough password' })).status, 400);
  } finally {
    await close();
  }
});

test('login: correct password signs in; wrong password 401s with the same message either way; logout kills the session', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery staple' }),
    });

    const wrongPassword = await fetch(`${url}/accounts/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'not the right one' }),
    });
    assert.equal(wrongPassword.status, 401);
    const wrongPasswordBody = await wrongPassword.json() as { error: string };

    const unknownEmail = await fetch(`${url}/accounts/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'anything at all here' }),
    });
    assert.equal(unknownEmail.status, 401);
    const unknownEmailBody = await unknownEmail.json() as { error: string };
    // Same message for "wrong password" and "no such account" — a
    // different message would let a caller enumerate registered emails.
    assert.equal(wrongPasswordBody.error, unknownEmailBody.error);

    const login = await fetch(`${url}/accounts/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'Owner@Example.com', password: 'correct horse battery staple' }),
    });
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login);
    assert.equal((await fetch(`${url}/me`, { headers: { cookie } })).status, 200);

    const logout = await fetch(`${url}/accounts/logout`, { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);
    const afterLogout = await fetch(`${url}/me`, { headers: { cookie } });
    assert.equal(afterLogout.status, 401);
  } finally {
    await close();
  }
});

test('login: rate-limited after repeated failures against one email+IP; a different email is unaffected', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0,
    principalStore: new InMemoryPrincipalStore(),
    accountStore: new InMemoryAccountStore(),
    sessionStore: new InMemorySessionStore(),
  });
  try {
    await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'owner@example.com', password: 'correct horse battery staple' }),
    });
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${url}/accounts/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.com', password: 'wrong every time' }),
      });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);

    // A login attempt for a different account from the same client isn't limited.
    const other = await fetch(`${url}/accounts/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'someone-else@example.com', password: 'irrelevant password' }),
    });
    assert.notEqual(other.status, 429);
  } finally {
    await close();
  }
});

test('self-hosted deployment (no accounts configured): /accounts/* routes 501, never 404 or open', async () => {
  const { url, close } = await startAgentServer(factory, { port: 0, principalStore: new InMemoryPrincipalStore() });
  try {
    const signup = await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'a password of some length' }),
    });
    assert.equal(signup.status, 501);
    const login = await fetch(`${url}/accounts/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'irrelevant' }),
    });
    assert.equal(login.status, 501);
  } finally {
    await close();
  }
});

test('signup requires principalStore too — accountStore/sessionStore alone still 501s', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    const signup = await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'a password of some length' }),
    });
    assert.equal(signup.status, 501);
  } finally {
    await close();
  }
});

test('a bearer token still wins over a stale session cookie when both are sent', async () => {
  const principalStore = new InMemoryPrincipalStore();
  await principalStore.upsert('the-bearer-token', { id: 'bearer-user', roles: new Set(['admin']) });
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore, accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    const signup = await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'session-user@example.com', password: 'a password of some length' }),
    });
    const cookie = sessionCookie(signup);
    const me = await (await fetch(`${url}/me`, { headers: { cookie, authorization: 'Bearer the-bearer-token' } })).json() as { id: string };
    assert.equal(me.id, 'bearer-user');
  } finally {
    await close();
  }
});

test('LoginRateLimiter constructed fresh per server instance — one server\'s lockout never bleeds into another\'s', async () => {
  // Regression guard: this was module-global in an earlier draft, which
  // would make this test flaky depending on run order.
  const limiter = new LoginRateLimiter(1, 60_000);
  assert.equal(limiter.allow('x@example.com', '1.1.1.1'), true);
  limiter.recordFailure('x@example.com', '1.1.1.1');
  assert.equal(limiter.allow('x@example.com', '1.1.1.1'), false);

  const server1 = await startAgentServer(factory, { port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore() });
  const server2 = await startAgentServer(factory, { port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore() });
  try {
    await fetch(`${server1.url}/accounts/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', password: 'correct horse battery staple' }) });
    // Fail 5 times against server1 only.
    for (let i = 0; i < 5; i++) {
      await fetch(`${server1.url}/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', password: 'wrong' }) });
    }
    const lockedOut1 = await fetch(`${server1.url}/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', password: 'wrong' }) });
    assert.equal(lockedOut1.status, 429);

    // server2 has never seen this email — its own limiter is untouched.
    const notLockedOut2 = await fetch(`${server2.url}/accounts/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', password: 'wrong' }) });
    assert.notEqual(notLockedOut2.status, 429);
  } finally {
    await server1.close();
    await server2.close();
  }
});

test('signup: a very long password is rejected before it would ever reach scrypt', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    const res = await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(257) }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('login: a very long password gets the same generic error as a wrong one, not a distinct message', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    await fetch(`${url}/accounts/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'correct horse battery staple' }),
    });
    const tooLong = await fetch(`${url}/accounts/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(257) }),
    });
    assert.equal(tooLong.status, 400);
    const wrong = await fetch(`${url}/accounts/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.com', password: 'the wrong password' }),
    });
    const tooLongBody = await tooLong.json() as { error: string };
    const wrongBody = await wrong.json() as { error: string };
    assert.equal(tooLongBody.error, wrongBody.error);
  } finally {
    await close();
  }
});

test('signup: rate-limited by IP after repeated account creation, independent of email used', async () => {
  const { url, close } = await startAgentServer(factory, {
    port: 0, principalStore: new InMemoryPrincipalStore(), accountStore: new InMemoryAccountStore(), sessionStore: new InMemorySessionStore(),
  });
  try {
    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${url}/accounts/signup`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `spam${i}@example.com`, password: 'correct horse battery staple' }),
      });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  } finally {
    await close();
  }
});
