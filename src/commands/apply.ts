import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AskTableAPI } from '../lib/asktable-api.js';
import { ensureWorkspace } from '../lib/storage.js';
import { loadConfig, requireConfig } from '../lib/config.js';
import { applyTuning } from '../steps/apply-tuning.js';
import type { TuningReport } from '../types.js';

export function registerApply(program: Command) {
  program
    .command('apply')
    .description('Step 5: Apply tuning suggestions via API')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .option('--datasource <id>', 'Datasource ID')
    .option('--server <url>', 'Server URL')
    .option('--api-key <key>', 'API key')
    .option('--project <id>', 'Project ID (for glossary)', '')
    .option('--dry-run', 'Show what will be done without executing', false)
    .option('--confirm', 'Skip confirmation prompt', false)
    .action(async (opts: {
      workspace: string;
      datasource?: string;
      server?: string;
      apiKey?: string;
      project: string;
      dryRun: boolean;
      confirm: boolean;
    }) => {
      const cfg = loadConfig(opts.workspace, opts);
      requireConfig(cfg, ['datasource_id', 'server', 'api_key']);
      const api = new AskTableAPI(cfg.server, cfg.api_key);
      await ensureWorkspace(opts.workspace);

      // Load report from JSON (we store it alongside the markdown)
      const report = await loadReportJson(opts.workspace);
      if (!report) {
        console.error('❌ 没有找到调优报告数据，请先运行 at-tuner analyze');
        process.exit(1);
      }

      if (report.suggestions.length === 0) {
        console.log('📭 没有调优建议');
        return;
      }

      if (!opts.confirm && !opts.dryRun) {
        console.log(`即将执行 ${report.suggestions.length} 项调优：`);
        for (const s of report.suggestions) {
          console.log(`  - [${s.priority}] ${s.case_id}: ${s.category} — ${s.suggested_value.slice(0, 50)}...`);
        }
        console.log('\n使用 --dry-run 预览，或 --confirm 跳过确认');
        process.exit(1);
      }

      await applyTuning(api, report, {
        dryRun: opts.dryRun,
        datasourceId: cfg.datasource_id,
        projectId: opts.project,
      });
    });
}

async function loadReportJson(workspace: string): Promise<TuningReport | null> {
  const jsonPath = join(workspace, 'tuning-report.json');
  if (!existsSync(jsonPath)) return null;
  const content = await readFile(jsonPath, 'utf-8');
  return JSON.parse(content);
}
