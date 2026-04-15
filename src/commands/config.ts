import { Command } from 'commander';
import { saveGlobalConfig, getAllConfig } from '../lib/config.js';

/**
 * Manage persistent configuration (API keys, server URL, LLM settings).
 * Config stored in ~/.at-tuner/config.json and .at-tuner/config.json.
 */
export function registerConfig(program: Command) {
  const configCmd = program
    .command('config')
    .description('Manage persistent configuration');

  configCmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Config key (server, api-key, datasource, project, llm-provider, llm-api-key, llm-model, llm-base-url)')
    .argument('<value>', 'Value to set')
    .action(async (key: string, value: string) => {
      const validKeys = ['server', 'api-key', 'datasource', 'project', 'llm-provider', 'llm-api-key', 'llm-model', 'llm-base-url'];
      if (!validKeys.includes(key)) {
        console.error(`❌ 无效配置项: ${key}`);
        console.error(`支持的配置项: ${validKeys.join(', ')}`);
        process.exit(1);
      }
      await saveGlobalConfig(key, value);
      console.log(`✅ ${key} = ${key.includes('key') ? '***' : value}`);
    });

  configCmd
    .command('list')
    .description('Show all configured values (secrets masked)')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .action(async (opts: { workspace: string }) => {
      const cfg = getAllConfig(opts.workspace);
      console.log('\n📋 当前配置:\n');
      const entries = Object.entries(cfg);
      if (entries.length === 0) {
        console.log('  (未配置任何值)');
      } else {
        for (const [k, v] of entries) {
          console.log(`  ${k}: ${v || '(未设置)'}`);
        }
      }
      console.log('');
    });

  configCmd
    .command('init')
    .description('Interactive configuration setup')
    .action(async () => {
      console.log('🔧 配置引导\n');
      console.log('请使用 at-tuner config set <key> <value> 设置各项配置：');
      console.log('  at-tuner config set server https://your-server/api/v1');
      console.log('  at-tuner config set api-key ADMIN_xxx');
      console.log('  at-tuner config set datasource ds_xxx');
      console.log('  at-tuner config set llm-provider openai');
      console.log('  at-tuner config set llm-api-key sk-xxx');
      console.log('');
    });
}
