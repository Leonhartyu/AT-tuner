import type { AskTableAPI } from '../lib/asktable-api.js';
import type { TuningReport, TuningSuggestion } from '../types.js';

/**
 * Step 5: Apply tuning suggestions via API.
 */
export async function applyTuning(
  api: AskTableAPI,
  report: TuningReport,
  options: { dryRun: boolean; datasourceId: string; projectId: string }
): Promise<{ applied: string[]; failed: string[] }> {
  if (report.suggestions.length === 0) {
    console.log('📭 没有调优建议');
    return { applied: [], failed: [] };
  }

  if (options.dryRun) {
    console.log('🔍 预演模式，只展示将执行的 API 调用\n');
  }

  const applied: string[] = [];
  const failed: string[] = [];

  // Group by priority
  const sorted = [...report.suggestions].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  // Build table → schema_name map for resolving field_desc suggestions
  const schemaMeta = await api.inspectMetadata(options.datasourceId);
  const tableSchemaMap = buildTableSchemaMap(schemaMeta);

  for (const suggestion of sorted) {
    const label = suggestion.case_id;
    try {
      if (options.dryRun) {
        console.log(`  [DRY-RUN] ${label}: ${suggestion.category}`);
        printDryRun(suggestion);
      } else {
        await applySuggestion(api, suggestion, { ...options, tableSchemaMap });
        console.log(`  ✅ ${label}: ${suggestion.category} — ${suggestion.suggested_value.slice(0, 40)}...`);
      }
      applied.push(label);
    } catch (e) {
      console.log(`  ❌ ${label}: ${(e as Error).message}`);
      failed.push(label);
    }
  }

  console.log(`\n📊 调优${options.dryRun ? '预演' : '完成'}：${applied.length} 项${options.dryRun ? '将执行' : '成功'}，${failed.length} 项失败`);
  return { applied, failed };
}

async function applySuggestion(
  api: AskTableAPI,
  suggestion: TuningSuggestion,
  options: { datasourceId: string; projectId: string; tableSchemaMap?: Map<string, string> }
): Promise<void> {
  const payload = suggestion.api_payload;

  switch (suggestion.category) {
    case 'field_desc': {
      const tableName = payload.table ?? '';
      const fieldName = payload.field ?? '';
      // Resolve schema_name: prefer stored value, fallback to table→schema map
      const schemaName = payload.schema_name ?? options.tableSchemaMap?.get(tableName);
      if (!schemaName) {
        throw new Error(`无法确定表 "${tableName}" 所属的 schema，跳过`);
      }
      await api.patchFieldDesc(options.datasourceId, {
        schemas: {
          [schemaName]: {
            desc: null,
            tables: {
              [tableName]: {
                desc: null,
                fields: {
                  [fieldName]: suggestion.suggested_value,
                },
              },
            },
          },
        },
      });
      break;
    }
    case 'glossary':
      await api.createGlossaryTerm({
        term: payload.term ?? suggestion.suggested_value.slice(0, 20),
        definition: suggestion.suggested_value,
        aliases: payload.aliases,
      });
      break;
    case 'skill':
      await api.syncSkill(
        payload.name ?? `tuning-${suggestion.case_id}`,
        suggestion.suggested_value
      );
      break;
  }
}

function printDryRun(s: TuningSuggestion) {
  const priorityLabel = { high: '🔴', medium: '🟡', low: '🟢' }[s.priority];
  console.log(`    ${priorityLabel} [${s.category}] ${s.question}`);
  console.log(`    → ${s.suggested_value.slice(0, 80)}...`);
  console.log(`    API: ${JSON.stringify(s.api_payload)}`);
  console.log('');
}

function buildTableSchemaMap(schemaData: { schemas: Record<string, { tables: Record<string, unknown> }> }): Map<string, string> {
  const map = new Map<string, string>();
  for (const [schemaName, sMeta] of Object.entries(schemaData.schemas)) {
    for (const tableName of Object.keys(sMeta.tables)) {
      map.set(tableName, schemaName);
    }
  }
  return map;
}
