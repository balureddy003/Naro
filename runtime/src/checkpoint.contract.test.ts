import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkpointStoreContract } from '@naro/contract-tests';
import { FileCheckpointStore, InMemoryCheckpointStore } from './checkpoint.ts';

checkpointStoreContract('InMemoryCheckpointStore', () => new InMemoryCheckpointStore());

checkpointStoreContract('FileCheckpointStore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'naro-ct-'));
  return new FileCheckpointStore(dir);
});
