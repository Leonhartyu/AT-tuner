#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load version from package.json
let version = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
  version = pkg.version;
} catch {}

const program = new Command();

program
  .name('at-tuner')
  .description('AskTable Datasource Tuning CLI — problem-driven optimization via API')
  .version(version);

// Register commands
import { registerInit } from './commands/init.js';
import { registerConfig } from './commands/config.js';
import { registerExplore } from './commands/explore.js';
import { registerGenerate } from './commands/generate.js';
import { registerExecute } from './commands/execute.js';
import { registerAnalyze } from './commands/analyze.js';
import { registerApply } from './commands/apply.js';
import { registerTune } from './commands/tune.js';

registerInit(program);
registerConfig(program);
registerExplore(program);
registerGenerate(program);
registerExecute(program);
registerAnalyze(program);
registerApply(program);
registerTune(program);

program.parse();
