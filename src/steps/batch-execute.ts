import type { AskTableAPI } from '../lib/asktable-api.js';
import type { TestCase, ExecutionResult, ConvMessage } from '../types.js';
import { pollForResult } from '../lib/agent-conv.js';

/**
 * Step 3: Batch execute conversations against AskTable.
 * Automatically discovers data_agent_id for the datasource.
 */
export async function batchExecute(
  api: AskTableAPI,
  datasourceId: string,
  testCases: TestCase[],
  options: { concurrency: number; timeout: number }
): Promise<ExecutionResult[]> {
  // 1. Find data_agent_id for this datasource
  const dataAgentId = await api.findAgentForDatasource(datasourceId);
  if (dataAgentId) {
    console.log(`🤖 找到数据 Agent: ${dataAgentId}`);
  } else {
    console.log(`⚠️  未找到匹配的数据 Agent，将使用 datasource_ids 创建对话`);
  }

  const results: ExecutionResult[] = [];

  console.log(`\n🚀 开始批量执行，共 ${testCases.length} 个问题`);
  console.log(`⏱️  单题超时: ${options.timeout}ms | 并发数: ${options.concurrency}\n`);

  for (let i = 0; i < testCases.length; i += options.concurrency) {
    const batch = testCases.slice(i, i + options.concurrency);
    const batchResults = await Promise.all(
      batch.map(task => executeOne(api, datasourceId, dataAgentId ?? undefined, task, options.timeout))
    );
    results.push(...batchResults);
    printProgress(results, testCases.length);
  }

  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status !== 'success').length;
  const totalMs = results.reduce((sum, r) => sum + r.duration, 0);
  const totalSec = Math.round(totalMs / 1000);

  console.log(`\n\n✅ 执行完成 | ✅ ${successCount} 成功 | ❌ ${failCount} 失败 | ⏱️ 总耗时 ${formatTime(totalSec)}`);
  console.log(`📁 结果保存在 results/ 目录`);

  return results;
}

async function executeOne(
  api: AskTableAPI,
  datasourceId: string,
  dataAgentId: string | undefined,
  task: TestCase,
  timeout: number
): Promise<ExecutionResult> {
  const start = Date.now();

  try {
    // 1. Create conversation with data_agent_id (if available)
    const convPayload: Record<string, unknown> = {};
    if (dataAgentId) {
      convPayload.data_agent_id = dataAgentId;
      convPayload.name = `tuner-${task.id}`;
    } else {
      convPayload.datasource_ids = [datasourceId];
    }
    const conv = await api.createConversation(convPayload);
    console.log(`  📝 [${task.id}] 创建对话: ${conv.id}`);

    // 2. Send question
    await api.sendMessage(conv.id, task.question);

    // 3. Poll for result
    const messages = await pollForResult(api, conv.id, {
      timeout,
      interval: 2000,
      onProgress: (elapsed) => {
        safeClearLine();
        process.stdout.write(`  ⏳ [${task.id}] 已等待 ${elapsed}s...`);
      },
    });

    const duration = Date.now() - start;
    const { sql, text, error } = parseMessages(messages);

    return {
      caseId: task.id,
      status: error ? 'error' : 'success',
      question: task.question,
      convId: conv.id,
      generatedSql: sql,
      result: text,
      error,
      duration,
      rawMessages: messages,
    };
  } catch (e) {
    const duration = Date.now() - start;
    const msg = (e as Error).message;
    const status = msg.includes('timeout') ? 'timeout' : 'error';

    return {
      caseId: task.id,
      status,
      question: task.question,
      convId: null,
      generatedSql: null,
      result: null,
      error: msg,
      duration,
      rawMessages: null,
    };
  }
}

function safeClearLine(): void {
  if (typeof process.stdout.clearLine === 'function') {
    process.stdout.clearLine(0);
  }
  if (typeof process.stdout.cursorTo === 'function') {
    process.stdout.cursorTo(0);
  }
}

function parseMessages(messages: ConvMessage[]): { sql: string | null; text: string; error: string | null } {
  let sql: string | null = null;
  const textParts: string[] = [];
  let error: string | null = null;

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      // Extract SQL from execute_sql tool calls
      if (block.type === 'tool_use' && block.name === 'execute_sql' && block.input) {
        try {
          const input = typeof block.input === 'string' ? JSON.parse(block.input) : block.input;
          if (!sql && input?.sql && typeof input.sql === 'string') {
            sql = input.sql;
          }
        } catch {}
      }
      // Collect text blocks
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      }
    }
  }

  // Fallback: extract SQL from text if not found in tool calls
  if (!sql && textParts.length > 0) {
    const fullText = textParts.join('\n');
    const match = fullText.match(/```sql\n?([\s\S]*?)```/i);
    if (match) sql = match[1].trim();
  }

  return { sql, text: textParts.join('\n'), error };
}

function printProgress(results: ExecutionResult[], total: number) {
  const success = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status !== 'success').length;
  const completed = results.length;

  safeClearLine();
  process.stdout.write(
    `📊 进度: ${completed}/${total} | ✅ ${success} | ❌ ${failed}`
  );

  const last = results[results.length - 1];
  if (last) {
    const status = last.status === 'success' ? '✅' : '❌';
    const detail = last.status === 'success'
      ? `SQL: ${last.generatedSql?.slice(0, 60) ?? 'N/A'}`
      : `错误: ${last.error?.slice(0, 60) ?? ''}`;
    process.stdout.write(`\n  ${status} [${last.caseId}] ${last.status} (${(last.duration / 1000).toFixed(1)}s) | ${detail}\n`);
  }
}

function formatTime(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m${s}s` : `${s}s`;
}
