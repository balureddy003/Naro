import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventExporterContract } from '@naro/contract-tests';
import { ConsoleExporter, JsonlExporter } from './exporter.ts';

let dir = '';
const makeJsonl = async () => {
  dir = await mkdtemp(join(tmpdir(), 'naro-exp-'));
  return new JsonlExporter(join(dir, 'audit.jsonl'));
};

eventExporterContract('JsonlExporter', makeJsonl, async (exp) => {
  await exp.flush?.();
  const text = await readFile(join(dir, 'audit.jsonl'), 'utf8');
  const lines = text.trim().split('\n').filter(Boolean);
  await rm(dir, { recursive: true, force: true });
  return lines;
});

eventExporterContract('ConsoleExporter', () => new ConsoleExporter());
