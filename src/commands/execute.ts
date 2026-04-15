import { Command } from 'commander';
import { join } from 'node:path';
import { AskTableAPI } from '../lib/asktable-api.js';
import { ensureWorkspace, writeResult } from '../lib/storage.js';
import { loadConfig, requireConfig } from '../lib/config.js';
import { parseTestCasesFile } from '../lib/parser.js';
import { batchExecute } from '../steps/batch-execute.js';

export function registerExecute(program: Command) {
  program
    .command('execute')
    .description('Step 3: Batch execute conversations')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .option('--datasource <id>', 'Datasource ID')
    .option('--server <url>', 'Server URL')
    .option('--api-key <key>', 'API key')
    .option('--concurrency <n>', 'Concurrency level', '3')
    .option('--timeout <ms>', 'Per-case timeout in ms', '120000')
    .action(async (opts: {
      workspace: string;
      datasource?: string;
      server?: string;
      apiKey?: string;
      concurrency: string;
      timeout: string;
    }) => {
      const cfg = loadConfig(opts.workspace, opts);
      requireConfig(cfg, ['datasource_id', 'server', 'api_key']);
      const api = new AskTableAPI(cfg.server, cfg.api_key);
      await ensureWorkspace(opts.workspace);

      const testCases = await parseTestCasesFile(join(opts.workspace, 'test-cases.md'));
      if (testCases.length === 0) {
        console.error('❌ 没有找到测试问题，请先运行 at-tuner generate');
        process.exit(1);
      }

      const results = await batchExecute(api, cfg.datasource_id, testCases, {
        concurrency: parseInt(opts.concurrency),
        timeout: parseInt(opts.timeout),
      });

      // Save each result to a JSON file
      for (const r of results) {
        await writeResult(opts.workspace, r.caseId, {
          id: r.caseId,
          status: r.status,
          question: r.question,
          convId: r.convId,
          generatedSql: r.generatedSql,
          result: r.result,
          error: r.error,
          duration: r.duration,
          executedAt: new Date().toISOString(),
          rawMessages: r.rawMessages,
        });
      }
    });
}
