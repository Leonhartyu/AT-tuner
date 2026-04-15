import { Command } from 'commander';
import { ensureWorkspace } from '../lib/storage.js';

/**
 * Initialize workspace directory.
 */
export function registerInit(program: Command) {
  program
    .command('init')
    .description('Initialize a tuning workspace')
    .option('-w, --workspace <path>', 'Workspace directory', '.at-tuner')
    .action(async (opts: { workspace: string }) => {
      console.log(`📁 初始化工作区: ${opts.workspace}`);
      await ensureWorkspace(opts.workspace);
      console.log(`✅ 工作区已创建: ${opts.workspace}`);
      console.log(`   - results/`);
      console.log(`\n💡 运行 at-tuner config set 配置 API 地址和密钥`);
    });
}
