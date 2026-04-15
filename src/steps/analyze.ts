import type { AskTableAPI } from '../lib/asktable-api.js';
import type { ExecutionResult, TuningSuggestion, TuningReport, TestCase, SchemaMeta, TableMeta } from '../types.js';
import type { LLMClient } from '../lib/llm-client.js';

interface AnalyzeOptions {
  llmClient: LLMClient;
  schemaMd: string;
}

/**
 * Step 4: Analyze results using external LLM API.
 * Reads rawMessages from local JSON results and asks LLM for tuning suggestions.
 */
export async function analyzeResults(
  api: AskTableAPI,
  datasourceId: string,
  results: ExecutionResult[],
  _testCases: TestCase[],
  _schema: string,
  options: AnalyzeOptions
): Promise<TuningReport> {
  const suggestions: TuningSuggestion[] = [];

  console.log('🔍 正在分析执行结果...\n');

  // Fetch full schema metadata for reference
  const schemaMeta = await api.inspectMetadata(datasourceId);

  // Also run local SQL analysis for field desc issues
  for (const result of results) {
    if (!result.generatedSql || result.status !== 'success') continue;

    const localSuggestions = analyzeSql(result, schemaMeta);
    suggestions.push(...localSuggestions);
  }

  // Build table → schema_name map for LLM suggestions
  const tableSchemaMap = buildTableSchemaMap(schemaMeta);

  // LLM-based analysis for cases with rawMessages
  for (const result of results) {
    if (!result.rawMessages || result.status !== 'success') continue;

    console.log(`  🤖 分析 [${result.caseId}]...`);

    const prompt = buildAnalysisPrompt(options.schemaMd, result);

    try {
      const answer = await options.llmClient.chat(prompt, 2048);
      const parsed = parseSuggestions(answer, result, tableSchemaMap);
      suggestions.push(...parsed);
    } catch (e) {
      console.error(`  ⚠️  [${result.caseId}] LLM 分析失败: ${(e as Error).message}`);
    }
  }

  // Deduplicate across cases
  const deduped = deduplicateSuggestions(suggestions);

  const fieldDescCount = deduped.filter(s => s.category === 'field_desc').length;
  const glossaryCount = deduped.filter(s => s.category === 'glossary').length;
  const skillCount = deduped.filter(s => s.category === 'skill').length;
  const successCount = results.filter(r => r.status === 'success').length;

  const report: TuningReport = {
    summary: {
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      field_desc_suggestions: fieldDescCount,
      glossary_suggestions: glossaryCount,
      skill_suggestions: skillCount,
    },
    cases: results,
    suggestions: deduped,
  };

  return report;
}

function buildAnalysisPrompt(schemaMd: string, result: ExecutionResult): string {
  const rawJson = JSON.stringify(result.rawMessages, null, 2);

  return `你是 AskTable 调优专家。分析以下执行结果中的 SQL 质量问题。

Schema 摘要:
${schemaMd.slice(0, 3000)}

Case: ${result.caseId}
问题: ${result.question}
生成的 SQL: ${result.generatedSql ?? 'N/A'}

完整对话数据:
${rawJson}

找出可通过以下方式解决的问题，返回 JSON 数组：

1. **field_desc** — 字段描述不清或缺失，导致 LLM 误判类型/含义。需更新 curr_desc。
2. **glossary** — 业务术语歧义，用户用词与 schema 用词不一致。需创建新术语映射。
3. **skill** — 计算逻辑复杂（如周转率、同比环比），需创建 Skill 固化计算逻辑。

返回格式：
[
  {
    "type": "field_desc",
    "tableName": "表名",
    "fieldName": "字段名",
    "rootCause": "问题根因描述",
    "currentValue": "当前备注（如有）",
    "suggestedValue": "建议的新备注"
  },
  {
    "type": "glossary",
    "term": "术语名称",
    "rootCause": "用户提问中的术语与 schema 术语不一致的原因",
    "definition": "该术语的明确定义"
  },
  {
    "type": "skill",
    "name": "Skill 名称",
    "rootCause": "为什么需要创建此 Skill",
    "content": "计算逻辑的详细说明"
  }
]

只返回 JSON 数组，不要其他文字。如无问题返回空数组 []。`;
}

/**
 * Parse LLM response into TuningSuggestion objects.
 * Handles field_desc, glossary, and skill types.
 */
function parseSuggestions(raw: string, result: ExecutionResult, tableSchemaMap: Map<string, string>): TuningSuggestion[] {
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const arr = JSON.parse(jsonMatch[0]);
    const suggestions: TuningSuggestion[] = [];

    for (const item of arr) {
      if (!item.type) continue;

      const priority = ('priority' in item ? item.priority : inferPriority(item.type)) as 'high' | 'medium' | 'low';

      if (item.type === 'field_desc' && item.tableName && item.fieldName && item.suggestedValue) {
        const schemaName = tableSchemaMap.get(item.tableName);
        suggestions.push({
          category: 'field_desc',
          case_id: result.caseId,
          question: result.question,
          root_cause: item.rootCause ?? '',
          current_value: item.currentValue,
          suggested_value: item.suggestedValue,
          api_payload: { schema_name: schemaName, table: item.tableName, field: item.fieldName },
          priority,
        });
      } else if (item.type === 'glossary' && item.term && item.definition) {
        suggestions.push({
          category: 'glossary',
          case_id: result.caseId,
          question: result.question,
          root_cause: item.rootCause ?? '',
          suggested_value: item.definition,
          api_payload: { term: item.term, definition: item.definition },
          priority,
        });
      } else if (item.type === 'skill' && item.name && item.content) {
        suggestions.push({
          category: 'skill',
          case_id: result.caseId,
          question: result.question,
          root_cause: item.rootCause ?? '',
          suggested_value: item.content,
          api_payload: { name: item.name, content: item.content },
          priority,
        });
      }
    }

    return suggestions;
  } catch {
    return [];
  }
}

function inferPriority(type: string): string {
  if (type === 'field_desc') return 'high';
  if (type === 'glossary') return 'medium';
  return 'low';
}

/**
 * Analyze SQL for field desc issues (local heuristic analysis).
 */
function analyzeSql(
  result: ExecutionResult,
  schemaData: { schemas: Record<string, SchemaMeta> }
): TuningSuggestion[] {
  const sql = result.generatedSql ?? '';

  // Find string literals in WHERE conditions: field = 'something'
  const whereStringMatches = sql.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/gi) || [];

  const suggestions: TuningSuggestion[] = [];

  for (const { schemaName, tableName, tableMeta } of findTables(sql, schemaData)) {
    for (const [fieldName, fieldMeta] of Object.entries(tableMeta.fields)) {
      const dataType = fieldMeta.data_type?.toUpperCase() ?? '';
      const isStatusField = /status|enabled|active/i.test(fieldName);

      // Case 1: Numeric field compared with string literal in WHERE clause
      if (isNumericType(dataType)) {
        for (const match of whereStringMatches) {
          const parts = match.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/i);
          if (!parts) continue;
          const matchedField = parts[1];
          const matchedValue = parts[2];
          if (matchedField.toLowerCase() === fieldName.toLowerCase()) {
            suggestions.push({
              category: 'field_desc',
              case_id: result.caseId,
              question: result.question,
              root_cause: `${schemaName}.${tableName}.${fieldName} 为${dataType}类型，但 SQL 使用了字符串 '${matchedValue}' 匹配`,
              suggested_value: `数值类型。应使用数值匹配（如 ${fieldName} = 1 表示启用），而非字符串。`,
              api_payload: { schema_name: schemaName, table: tableName, field: fieldName },
              priority: 'high',
            });
          }
        }
      }

      // Case 2: OTHER-type status field compared with string literal
      if (dataType === 'OTHER' && isStatusField) {
        for (const match of whereStringMatches) {
          const parts = match.match(/(\w+)\s*=\s*['"]([^'"]+)['"]/i);
          if (!parts) continue;
          const matchedField = parts[1];
          const matchedValue = parts[2];
          if (matchedField.toLowerCase() === fieldName.toLowerCase()) {
            suggestions.push({
              category: 'field_desc',
              case_id: result.caseId,
              question: result.question,
              root_cause: `${schemaName}.${tableName}.${fieldName} 存储类型为 OTHER，但实际存储数值（1=启用/在职，0=禁用/离职）。SQL 使用字符串 '${matchedValue}' 匹配会失败`,
              suggested_value: `实际为数值类型：1=启用/在职/active，0=禁用/离职/inactive。查询时应使用 ${fieldName} = 1 而非字符串匹配。`,
              api_payload: { schema_name: schemaName, table: tableName, field: fieldName },
              priority: 'high',
            });
          }
        }
      }

      // Case 3: OTHER-type numeric field compared with numeric literal
      if (dataType === 'OTHER' && isNumericField(fieldName)) {
        const nums = extractNumericComparisons(sql);
        for (const num of nums) {
          if (num.field.toLowerCase() === fieldName.toLowerCase()) {
            suggestions.push({
              category: 'field_desc',
              case_id: result.caseId,
              question: result.question,
              root_cause: `${schemaName}.${tableName}.${fieldName} 存储为 OTHER 但实际表示数值，直接比较会按字典序而非数值大小`,
              suggested_value: `字符串类型但存储数值数据。使用时需显式类型转换：toFloat64(${fieldName})。`,
              api_payload: { schema_name: schemaName, table: tableName, field: fieldName },
              priority: 'high',
            });
          }
        }
      }
    }
  }

  return suggestions;
}

function isNumericType(dataType: string): boolean {
  return ['NUMBER', 'INTEGER', 'INT', 'INT64', 'INT32', 'FLOAT', 'FLOAT64', 'DOUBLE', 'DECIMAL'].includes(dataType);
}

function isNumericField(fieldName: string): boolean {
  const hints = ['limit', 'amount', 'price', 'cost', 'value', 'count', 'total', 'rate', 'ratio'];
  const lower = fieldName.toLowerCase();
  return hints.some(h => lower.includes(h));
}

function extractNumericComparisons(sql: string): Array<{ field: string; value: number }> {
  const results: Array<{ field: string; value: number }> = [];
  const regex = /(\w+)\s*[><=]+\s*(\d+)/g;
  let match;
  while ((match = regex.exec(sql)) !== null) {
    const value = parseInt(match[2], 10);
    if (value >= 1000) {
      results.push({ field: match[1], value });
    }
  }
  return results;
}

interface TableRef {
  schemaName: string;
  tableName: string;
  tableMeta: TableMeta;
}

function buildTableSchemaMap(schemaData: { schemas: Record<string, SchemaMeta> }): Map<string, string> {
  const map = new Map<string, string>();
  for (const [schemaName, sMeta] of Object.entries(schemaData.schemas)) {
    for (const tableName of Object.keys(sMeta.tables)) {
      map.set(tableName, schemaName);
    }
  }
  return map;
}

function findTables(
  sql: string,
  schemaData: { schemas: Record<string, SchemaMeta> }
): TableRef[] {
  const refs: TableRef[] = [];
  const sqlLower = sql.toLowerCase();

  for (const [schemaName, sMeta] of Object.entries(schemaData.schemas)) {
    for (const [tableName, tMeta] of Object.entries(sMeta.tables)) {
      const fullName = `${schemaName}.${tableName}`.toLowerCase();
      const shortName = tableName.toLowerCase();
      const aliasRegex = new RegExp(`\\b${shortName}\\s+(\\w+)\\b`, 'i');
      const aliasMatch = sql.match(aliasRegex);

      if (sqlLower.includes(fullName) || sqlLower.includes(shortName) || aliasMatch) {
        refs.push({ schemaName, tableName, tableMeta: tMeta });
      }
    }
  }
  return refs;
}

function deduplicateSuggestions(suggestions: TuningSuggestion[]): TuningSuggestion[] {
  const seen = new Map<string, TuningSuggestion>();
  for (const s of suggestions) {
    let key: string;
    if (s.category === 'field_desc') {
      key = `field_desc:${s.api_payload.table}.${s.api_payload.field}`;
    } else if (s.category === 'glossary') {
      key = `glossary:${s.api_payload.term}`;
    } else {
      key = `skill:${s.api_payload.name}`;
    }
    if (!seen.has(key)) {
      seen.set(key, s);
    }
  }
  return Array.from(seen.values());
}
