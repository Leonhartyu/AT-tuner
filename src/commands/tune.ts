import { Command } from 'commander';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { AskTableAPI } from '../lib/asktable-api.js';
import { createLLMClient } from '../lib/llm-client.js';
import { ensureWorkspace, writeSchema, writeResult, writeReport } from '../lib/storage.js';
import { loadConfig, requireConfig } from '../lib/config.js';
import { exploreDatasource } from '../steps/explore.js';
import { generateTestCases, formatTestCasesMd } from '../steps/generate-test-cases.js';
import { batchExecute } from '../steps/batch-execute.js';
import { analyzeResults } from '../steps/analyze.js';
import { applyTuning } from '../steps/apply-tuning.js';
import { formatReportMd } from '../lib/report-formatter.js';

/**
 * One-command tune: runs all 5 steps sequentially.
 */
export function registerTune(program: Command) {
  program
    .command('tune')
    .description('Run the full tuning pipeline (steps 1-5)')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .option('--datasource <id>', 'Datasource ID')
    .option('--server <url>', 'Server URL')
    .option('--api-key <key>', 'API key')
    .option('--project <id>', 'Project ID (for glossary)', '')
    .option('--concurrency <n>', 'Concurrency for execute step', '3')
    .option('--timeout <ms>', 'Per-case timeout in ms', '120000')
    .option('--dry-run', 'Dry-run the apply step', false)
    .option('--scope <text>', 'Business scope to focus on')
    .option('--llm-provider <provider>', 'LLM provider: openai or claude')
    .option('--llm-api-key <key>', 'LLM API key')
    .option('--llm-model <model>', 'LLM model name')
    .option('--llm-base-url <url>', 'LLM API base URL')
    .action(async (opts: {
      datasource?: string;
      server?: string;
      apiKey?: string;
      workspace: string;
      project: string;
      concurrency: string;
      timeout: string;
      dryRun: boolean;
      scope?: string;
      llmProvider?: string;
      llmApiKey?: string;
      llmModel?: string;
      llmBaseUrl?: string;
    }) => {
      const cfg = loadConfig(opts.workspace, opts);
      requireConfig(cfg, ['datasource_id', 'server', 'api_key']);

      const api = new AskTableAPI(cfg.server, cfg.api_key);
      await ensureWorkspace(opts.workspace);

      console.log('═══════════════════════════════════════════');
      console.log('  AskTable 调优 CLI — 全自动流水线');
      console.log('═══════════════════════════════════════════\n');

      // Step 1: Explore
      console.log('═══ Step 1/5: 探索数据源 ═══\n');
      const { schema, sampleQueries } = await exploreDatasource(api, cfg.datasource_id);
      await writeSchema(opts.workspace, schema);
      console.log('');

      // Step 2: Generate test cases
      console.log('═══ Step 2/5: 生成测试问题集 ═══\n');
      const testCases = await generateTestCases(api, cfg.datasource_id, schema, sampleQueries, undefined, opts.scope);
      const md = formatTestCasesMd(testCases, cfg.datasource_id);
      await writeFile(join(opts.workspace, 'test-cases.md'), md, 'utf-8');
      console.log(`✅ 已生成 ${testCases.length} 个问题\n`);

      // Step 3: Execute
      console.log('═══ Step 3/5: 批量执行 ═══\n');
      const results = await batchExecute(api, cfg.datasource_id, testCases, {
        concurrency: parseInt(opts.concurrency),
        timeout: parseInt(opts.timeout),
      });

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
      console.log('');

      // Step 4: Analyze
      console.log('═══ Step 4/5: 分析结果 ═══\n');

      const llmProvider = (opts.llmProvider ?? cfg.llm_provider) as 'openai' | 'claude' | undefined;
      const llmApiKey = opts.llmApiKey ?? cfg.llm_api_key;
      if (!llmProvider || !llmApiKey) {
        console.error('❌ 需要 --llm-provider 和 --llm-api-key 参数');
        process.exit(1);
      }
      const llmClient = createLLMClient({
        provider: llmProvider,
        apiKey: llmApiKey,
        model: opts.llmModel ?? cfg.llm_model,
        baseUrl: opts.llmBaseUrl ?? cfg.llm_base_url,
      });

      const report = await analyzeResults(api, cfg.datasource_id, results, testCases, schema, {
        llmClient,
        schemaMd: schema,
      });

      const reportMd = formatReportMd(report);
      await writeFile(join(opts.workspace, 'tuning-report.md'), reportMd, 'utf-8');

      // Also save JSON for apply step
      await writeFile(
        join(opts.workspace, 'tuning-report.json'),
        JSON.stringify(report, null, 2),
        'utf-8'
      );

      console.log('');

      // Step 5: Apply
      console.log('═══ Step 5/5: 执行调优 ═══\n');
      if (report.suggestions.length === 0) {
        console.log('📭 没有调优建议');
      } else if (opts.dryRun) {
        await applyTuning(api, report, {
          dryRun: true,
          datasourceId: cfg.datasource_id,
          projectId: opts.project,
        });
      } else {
        console.log(`📋 发现 ${report.suggestions.length} 条调优建议`);
        console.log('💡 使用 --dry-run 预览，或再次运行 --dry-run 后加 --confirm 执行');
        for (const s of report.suggestions) {
          const label = { high: '🔴', medium: '🟡', low: '🟢' }[s.priority];
          console.log(`  ${label} [${s.case_id}] ${s.category}: ${s.suggested_value.slice(0, 60)}...`);
        }
      }

      console.log('\n═══════════════════════════════════════════');
      console.log('  流水线完成');
      console.log('═══════════════════════════════════════════');
    });
}
