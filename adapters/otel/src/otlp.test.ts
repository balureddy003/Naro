import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OtlpExporter } from './otlp.ts';

const ev = (type: string, seq = 1) => ({
  id: `e${seq}`, type, seq, at: 1_700_000_000_000, agentId: 'a1', goalId: 'g1',
  data: { error: 'boom' },
}) as never;

test('exports OTLP/HTTP log records', async () => {
  let sentBody = '';
  let sentUrl = '';
  const fetchImpl = (async (url: string, init: { body: string }) => {
    sentUrl = url; sentBody = init.body;
    return { ok: true, status: 200 };
  }) as unknown as typeof fetch;

  const exp = new OtlpExporter({ endpoint: 'http://collector:4318', serviceName: 'naro-test', fetchImpl });
  await exp.export([ev('agent.failed'), ev('reasoning.started', 2)]);
  await exp.flush();

  assert.equal(sentUrl, 'http://collector:4318/v1/logs');
  const body = JSON.parse(sentBody) as {
    resourceLogs: { resource: { attributes: { key: string; value: { stringValue: string } }[] };
      scopeLogs: { logRecords: { body: { stringValue: string }; severityNumber: number; attributes: { key: string; value: { intValue?: string } }[] }[] }[] }[];
  };
  const recs = body.resourceLogs[0]!.scopeLogs[0]!.logRecords;
  assert.equal(recs.length, 2);
  assert.equal(recs[0]!.body.stringValue, 'agent.failed');
  assert.equal(recs[0]!.severityNumber, 17); // ERROR
  assert.equal(recs[1]!.severityNumber, 9);  // INFO
  const svc = body.resourceLogs[0]!.resource.attributes.find((a) => a.key === 'service.name');
  assert.equal(svc?.value.stringValue, 'naro-test');
});

test('export errors surface on flush', async () => {
  const fetchImpl = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
  const exp = new OtlpExporter({ endpoint: 'http://x', fetchImpl });
  await assert.rejects(exp.export([ev('agent.created')]), /503/);
});
