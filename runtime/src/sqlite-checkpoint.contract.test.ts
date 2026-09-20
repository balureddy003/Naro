import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointStoreContract } from '@naro/contract-tests';
import { SqliteCheckpointStore } from './sqlite-checkpoint.ts';

checkpointStoreContract('SqliteCheckpointStore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-cp-'));
  return new SqliteCheckpointStore(join(dir, 'cp.db'));
});
