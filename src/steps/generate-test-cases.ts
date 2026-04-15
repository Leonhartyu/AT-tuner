import type { AskTableAPI } from '../lib/asktable-api.js';
import type { TestCase, SampleQuery } from '../types.js';
import { askAgent } from '../lib/agent-conv.js';

/**
 * Step 2: Generate test case question set based on schema + sample queries.
 */
export async function generateTestCases(
  api: AskTableAPI,
  datasourceId: string,
  schema: string,
  sampleQueries: SampleQuery[],
  existingContent?: string,
  scope?: string
): Promise<TestCase[]> {
  const agentConvId = await (await import('../lib/agent-conv.js')).createAgentConv(
    api,
    datasourceId,
    '你是数据质量测试专家。请按要求生成测试问题，只返回 JSON 数组。'
  );

  const existingSection = existingContent
    ? extractUserSuppliedQuestions(existingContent)
    : '';

  const scopeLine = scope ? `\n业务场景范围：请聚焦以下业务领域生成问题：${scope}` : '';

  const prompt = `基于以下数据源结构，生成 15 个测试问题：

数据结构：
${schema.slice(0, 3000)}

示例查询（帮助理解数据）：
${sampleQueries.map(q => `Q: ${q.question}\nSQL: ${q.sql}`).join('\n')}${scopeLine}

要求：
1. 5 个简单问题（category: simple）：表结构理解、基础筛选、计数汇总
2. 5 个口径问题（category: metric）：涉及"延迟"、"占比"、"同比"等业务指标定义
3. 5 个复杂查询（category: complex）：多表 JOIN、子查询、窗口函数、复杂聚合

每个问题必须包含：
- id: "case-NNN" 格式
- category: "simple" | "metric" | "complex"
- question: 用户会问的自然语言问题
- expected_result_hint: 预期结果的方向描述

返回纯 JSON 数组，不要其他文字。`;

  const answer = await askAgent(api, agentConvId, prompt, 120_000);
  const cases = parseTestCases(answer);

  // Append user-supplied questions if any
  if (existingSection) {
    const userCases = parseUserSuppliedCases(existingSection);
    cases.push(...userCases);
  }

  return cases;
}

export function formatTestCasesMd(
  cases: TestCase[],
  datasourceId: string
): string {
  const now = new Date().toISOString().split('T')[0];
  const simple = cases.filter(c => c.category === 'simple');
  const metric = cases.filter(c => c.category === 'metric');
  const complex = cases.filter(c => c.category === 'complex');

  return [
    '# AskTable 调优测试问题集\n',
    '## 配置',
    `- 数据源：${datasourceId}`,
    `- 生成时间：${now}\n`,
    '## 说明',
    '- simple：简单表结构理解',
    '- metric：涉及业务指标口径',
    '- complex：复杂多表查询\n',
    '---\n',
    formatSection('简单问题（simple）', simple),
    formatSection('口径问题（metric）', metric),
    formatSection('复杂查询（complex）', complex),
    '## 用户补充问题\n',
    '（用户可在此区域手动添加更多测试问题，格式同上）\n',
  ].join('\n');
}

function formatSection(title: string, cases: TestCase[]): string {
  if (cases.length === 0) return `## ${title}\n\n（无）\n`;

  const parts = [`## ${title}\n`];
  for (const c of cases) {
    parts.push(`### ${c.id}`);
    parts.push(`- **问题**：${c.question}`);
    parts.push(`- **预期结果方向**：${c.expected_result_hint}`);
    parts.push('');
  }
  return parts.join('\n');
}

function parseTestCases(raw: string): TestCase[] {
  // Try to extract JSON array from response
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error('⚠️  无法解析测试用例 JSON，原始响应:', raw.slice(0, 200));
    return [];
  }

  try {
    const arr = JSON.parse(jsonMatch[0]);
    return arr.map((item: any) => ({
      id: item.id,
      category: item.category as TestCase['category'],
      question: item.question,
      expected_result_hint: item.expected_result_hint,
      sql_template: item.sql_template,
    }));
  } catch (e) {
    console.error('⚠️  JSON 解析失败:', (e as Error).message);
    return [];
  }
}

function extractUserSuppliedQuestions(content: string): string {
  const idx = content.indexOf('## 用户补充问题');
  if (idx < 0) return '';
  return content.slice(idx);
}

function parseUserSuppliedCases(section: string): TestCase[] {
  // Simple parser: extract ### case-NNN blocks
  const cases: TestCase[] = [];
  const blocks = section.split(/### (case-\d+)/).slice(1);

  for (let i = 0; i < blocks.length; i += 2) {
    const id = blocks[i];
    const body = blocks[i + 1] ?? '';
    const question = body.match(/\*\*问题\*\*：(.+)/)?.[1] ?? '';
    const hint = body.match(/\*\*预期结果方向\*\*：(.+)/)?.[1] ?? '';

    if (question) {
      cases.push({
        id,
        category: 'simple',
        question,
        expected_result_hint: hint,
      });
    }
  }
  return cases;
}
