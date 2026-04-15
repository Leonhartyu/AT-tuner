import type { TuningReport, TuningSuggestion } from '../types.js';

/**
 * Format a TuningReport into Markdown.
 */
export function formatReportMd(report: TuningReport): string {
  const lines: string[] = [];

  lines.push('# AskTable 调优报告\n');
  lines.push('## 执行摘要\n');
  lines.push('| 指标 | 数值 |');
  lines.push('|------|------|');
  lines.push(`| 总问题数 | ${report.summary.total} |`);
  lines.push(`| 成功 | ${report.summary.success} |`);
  lines.push(`| 失败 | ${report.summary.failed} |`);
  lines.push(`| 字段备注建议 | ${report.summary.field_desc_suggestions} |`);
  lines.push(`| 术语库建议 | ${report.summary.glossary_suggestions} |`);
  lines.push(`| Skill 建议 | ${report.summary.skill_suggestions} |`);
  lines.push('');

  if (report.suggestions.length === 0) {
    lines.push('## 调优建议\n');
    lines.push('没有发现调优建议。\n');
    return lines.join('\n');
  }

  lines.push('## 调优建议\n');

  const sorted = [...report.suggestions].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  for (const s of sorted) {
    const priorityIcon = { high: '🔴', medium: '🟡', low: '🟢' }[s.priority];
    lines.push(`### ${priorityIcon} ${s.priority === 'high' ? '高' : s.priority === 'medium' ? '中' : '低'}优先级`);
    lines.push('');
    lines.push(`#### ${s.case_id}：${s.root_cause}`);
    lines.push(`- **问题**：${s.question}`);
    lines.push(`- **根因**：${s.root_cause}`);
    if (s.current_value) {
      lines.push(`- **当前值**：${s.current_value}`);
    }
    lines.push(`- **建议**：${s.suggested_value}`);
    lines.push(`- **类型**：${s.category}`);
    lines.push('');
    lines.push('**API 操作**：');
    lines.push('```bash');
    lines.push(formatApiCall(s));
    lines.push('```\n');
  }

  return lines.join('\n');
}

function formatApiCall(s: TuningSuggestion): string {
  const payload = JSON.stringify(s.api_payload, null, 2);
  switch (s.category) {
    case 'field_desc':
      return `curl -X PATCH "SERVER/v1/{ds_id}/meta" \\\n  -H "Authorization: Bearer API_KEY" \\\n  -d '${payload}'`;
    case 'glossary':
      return `at-tuner glossary add --term "${s.api_payload.term ?? ''}" --definition "${s.suggested_value.slice(0, 50)}..."`;
    case 'skill':
      return `# SKILL.md 草稿\n${s.suggested_value.slice(0, 200)}...`;
  }
}
