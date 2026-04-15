import { Command } from 'commander';
import { AskTableAPI } from '../lib/asktable-api.js';
import { ensureWorkspace, writeSchema } from '../lib/storage.js';
import { loadConfig, requireConfig } from '../lib/config.js';
import { exploreDatasource } from '../steps/explore.js';

export function registerExplore(program: Command) {
  program
    .command('explore')
    .description('Step 1: Explore a datasource (fetch schema + sample queries)')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .option('--datasource <id>', 'Datasource ID')
    .option('--server <url>', 'Server URL')
    .option('--api-key <key>', 'API key')
    .action(async (opts: {
      workspace: string;
      datasource?: string;
      server?: string;
      apiKey?: string;
    }) => {
      const cfg = loadConfig(opts.workspace, opts);
      requireConfig(cfg, ['datasource_id', 'server', 'api_key']);
      const api = new AskTableAPI(cfg.server, cfg.api_key);
      await ensureWorkspace(opts.workspace);

      console.log(`🔍 探索数据源: ${cfg.datasource_id}\n`);
      const { schema, sampleQueries } = await exploreDatasource(api, cfg.datasource_id);

      await writeSchema(opts.workspace, schema);
      console.log(`\n💾 Schema 已保存到 ${opts.workspace}/schema.md`);

      if (sampleQueries.length > 0) {
        console.log(`\n📊 示例查询:`);
        for (const q of sampleQueries) {
          console.log(`  Q: ${q.question}`);
          console.log(`  SQL: ${q.sql}`);
          console.log('');
        }
      }
    });
}
