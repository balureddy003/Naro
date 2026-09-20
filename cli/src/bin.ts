#!/usr/bin/env node
import { main } from './commands.ts';

process.exit(await main(process.argv.slice(2), {
  out: (s) => console.log(s),
  err: (s) => console.error(s),
}));
