import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { AskTableAPI } from '../lib/asktable-api.js';
import { ensureWorkspace, readTestCases, writeTestCases, readSchema } from '../lib/storage.js';
import { loadConfig, requireConfig } from '../lib/config.js';
import { generateTestCases, formatTestCasesMd } from '../steps/generate-test-cases.js';

export function registerGenerate(program: Command) {
  program
    .command('generate')
    .description('Step 2: Generate test case question set')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .option('--datasource <id>', 'Datasource ID (overrides config)')
    .option('--server <url>', 'Server URL (overrides config)')
    .option('--api-key <key>', 'API key (overrides config)')
    .option('--scope <text>', 'Business scope to focus on (e.g. "利润、销售、产量")')
    .action(async (opts: {
      workspace: string;
      datasource?: string;
      server?: string;
      apiKey?: string;
      scope?: string;
    }) => {
      const cfg = loadConfig(opts.workspace, opts);
      requireConfig(cfg, ['datasource_id', 'server', 'api_key']);
      const api = new AskTableAPI(cfg.server, cfg.api_key);
      await ensureWorkspace(opts.workspace);

      // Interactive scope prompt when not provided via flag
      let scope = opts.scope;
      if (!scope) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string) => new Promise<string>(r => rl.question(q, r));
        scope = await ask('\n📋 请输入关注业务范围（如：销售、成本、利润、同比环比，留空则全范围）: ');
        rl.close();
        if (scope) {
          console.log(`🎯 将聚焦: ${scope}\n`);
        } else {
          console.log('📋 无范围限制，将生成通用测试问题\n');
        }
      }

      console.log(`🧠 正在生成测试问题集...\n`);

      const schema = await readSchema(opts.workspace);
      const existingContent = await safeReadTestCases(opts.workspace);

      const cases = await generateTestCases(api, cfg.datasource_id, schema, [], existingContent, scope || undefined);

      const md = formatTestCasesMd(cases, cfg.datasource_id);
      await writeTestCases(opts.workspace, md);

      console.log(`✅ 已生成 ${cases.length} 个测试问题`);
      console.log(`📁 保存到 ${opts.workspace}/test-cases.md`);
      console.log(`\n💡 请编辑文件补充你的业务问题，然后运行 at-tuner execute`);
    });
}

async function safeReadTestCases(workspace: string): Promise<string | undefined> {
  try {
    return await readTestCases(workspace);
  } catch {
    return undefined;
  }
}
