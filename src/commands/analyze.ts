import { Command } from 'commander';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { AskTableAPI } from '../lib/asktable-api.js';
import { createLLMClient } from '../lib/llm-client.js';
import { ensureWorkspace, writeReport, readAllResults, readSchema } from '../lib/storage.js';
import { loadConfig, requireConfig } from '../lib/config.js';
import { analyzeResults } from '../steps/analyze.js';
import { formatReportMd } from '../lib/report-formatter.js';

export function registerAnalyze(program: Command) {
  program
    .command('analyze')
    .description('Step 4: Analyze results and generate tuning report')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .option('--datasource <id>', 'Datasource ID')
    .option('--server <url>', 'Server URL')
    .option('--api-key <key>', 'API key')
    .option('--llm-provider <provider>', 'LLM provider: openai or claude')
    .option('--llm-api-key <key>', 'LLM API key')
    .option('--llm-model <model>', 'LLM model name')
    .option('--llm-base-url <url>', 'LLM API base URL')
    .action(async (opts: {
      workspace: string;
      datasource?: string;
      server?: string;
      apiKey?: string;
      llmProvider?: string;
      llmApiKey?: string;
      llmModel?: string;
      llmBaseUrl?: string;
    }) => {
      const cfg = loadConfig(opts.workspace, opts);
      requireConfig(cfg, ['datasource_id', 'server', 'api_key']);

      // LLM client: prefer CLI > config
      const llmProvider = (opts.llmProvider ?? cfg.llm_provider) as 'openai' | 'claude' | undefined;
      const llmApiKey = opts.llmApiKey ?? cfg.llm_api_key;
      if (!llmProvider || !llmApiKey) {
        console.error('❌ 需要 --llm-provider 和 --llm-api-key 参数（或在 config 中配置）');
        process.exit(1);
      }
      if (llmProvider !== 'openai' && llmProvider !== 'claude') {
        console.error('❌ --llm-provider 必须是 openai 或 claude');
        process.exit(1);
      }
      const llmClient = createLLMClient({
        provider: llmProvider,
        apiKey: llmApiKey,
        model: opts.llmModel ?? cfg.llm_model,
        baseUrl: opts.llmBaseUrl ?? cfg.llm_base_url,
      });

      const api = new AskTableAPI(cfg.server, cfg.api_key);
      await ensureWorkspace(opts.workspace);

      const rawResults = await readAllResults(opts.workspace);
      if (rawResults.length === 0) {
        console.error('❌ 没有找到执行结果，请先运行 at-tuner execute');
        process.exit(1);
      }

      const results = rawResults.map(r => ({
        caseId: r.id ?? r.caseId,
        status: r.status,
        question: r.question,
        convId: r.convId,
        generatedSql: r.generatedSql,
        result: r.result,
        error: r.error,
        duration: r.duration,
        rawMessages: r.rawMessages ?? null,
      }));

      const testCases = await parseTestCasesFile(join(opts.workspace, 'test-cases.md'));
      const schemaMd = await readSchema(opts.workspace);

      console.log(`📊 读取到 ${results.length} 个执行结果\n`);

      const report = await analyzeResults(api, cfg.datasource_id, results, testCases, schemaMd, {
        llmClient,
        schemaMd,
      });

      const md = formatReportMd(report);
      await writeReport(opts.workspace, md);

      // Also save JSON for apply step
      await writeFile(join(opts.workspace, 'tuning-report.json'), JSON.stringify(report, null, 2), 'utf-8');

      printSummary(report);
      console.log(`\n📁 报告保存到 ${opts.workspace}/tuning-report.md`);
      console.log(`💡 查看报告后，运行 at-tuner apply 执行调优`);
    });
}

async function parseTestCasesFile(path: string) {
  const { parseTestCasesFile } = await import('../lib/parser.js');
  return parseTestCasesFile(path);
}

function printSummary(report: Awaited<ReturnType<typeof analyzeResults>>) {
  console.log('\n📋 调优报告摘要:');
  console.log(`  总问题数: ${report.summary.total}`);
  console.log(`  成功: ${report.summary.success}`);
  console.log(`  失败: ${report.summary.failed}`);
  console.log(`  字段备注建议: ${report.summary.field_desc_suggestions}`);
  console.log(`  术语库建议: ${report.summary.glossary_suggestions}`);
  console.log(`  Skill 建议: ${report.summary.skill_suggestions}`);
}
