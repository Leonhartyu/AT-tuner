import type { AskTableAPI } from '../lib/asktable-api.js';
import type { SampleQuery, SchemaMeta, TableMeta } from '../types.js';

/**
 * Step 1: Explore a datasource — inspect schema and run sample queries.
 */
export async function exploreDatasource(
  api: AskTableAPI,
  datasourceId: string
): Promise<{ schema: string; sampleQueries: SampleQuery[] }> {
  // 1. Fetch full schema (JSON)
  console.log('📋 正在获取数据源结构...');
  const metaResp = await api.inspectMetadata(datasourceId);
  console.log(`✅ 已获取数据源结构`);

  // 2. Convert to Markdown
  const schemaMd = schemaToMarkdown(metaResp);
  console.log(`📝 Schema Markdown: ${schemaMd.length} 字符`);

  // 3. Identify core tables (sample queries skipped - not essential)
  console.log('🔍 正在识别核心表...');
  const coreTableNames = extractCoreTableNames(metaResp);
  console.log(`  核心表: ${coreTableNames.join(', ')}`);
  console.log('⚠️  示例查询跳过（需要 data_agent_id）');

  const sampleQueries: SampleQuery[] = [];
  for (const table of coreTableNames.slice(0, 3)) {
    sampleQueries.push({ question: `${table} 表有多少行数据？`, sql: '', result: null });
  }

  return { schema: schemaMd, sampleQueries };
}

/**
 * Convert MetaResponse JSON to Markdown.
 */
export function schemaToMarkdown(metaResp: { schemas: Record<string, SchemaMeta>; datasource_id?: string }): string {
  const lines: string[] = [];
  lines.push(`# 数据源结构: ${metaResp.datasource_id}\n`);

  for (const [schemaName, schema] of Object.entries(metaResp.schemas)) {
    lines.push(`## Schema: ${schemaName}`);
    if (schema.curr_desc) lines.push(`描述: ${schema.curr_desc}\n`);

    for (const [tableName, table] of Object.entries(schema.tables)) {
      lines.push(`### 表: ${tableName}`);
      if (table.curr_desc) lines.push(`描述: ${table.curr_desc}\n`);

      const fieldRows = Object.values(table.fields).map(f => {
        const desc = f.curr_desc || f.origin_desc || '';
        return `| ${f.name} | ${f.data_type ?? ''} | ${desc} | ${f.visibility ? '✅' : '❌'} |`;
      });

      lines.push(`| 字段 | 类型 | 描述 | 可见 |`);
      lines.push(`|------|------|------|------|`);
      lines.push(...fieldRows);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function extractCoreTableNames(metaResp: { schemas: Record<string, SchemaMeta> }): string[] {
  // Heuristic: tables with more fields are more "core"
  const tables: Array<{ name: string; fieldCount: number }> = [];

  for (const schema of Object.values(metaResp.schemas)) {
    for (const [tableName, table] of Object.entries(schema.tables)) {
      const fieldCount = Object.keys(table.fields).length;
      tables.push({ name: tableName, fieldCount });
    }
  }

  return tables
    .sort((a, b) => b.fieldCount - a.fieldCount)
    .slice(0, 5)
    .map(t => t.name);
}
