import type { TestCase } from '../types.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Parse test cases from the Markdown file.
 */
export async function parseTestCasesFile(testCasesPath: string): Promise<TestCase[]> {
  if (!existsSync(testCasesPath)) {
    throw new Error(`测试问题集不存在: ${testCasesPath}`);
  }

  const content = await readFile(testCasesPath, 'utf-8');
  return parseTestCasesFromMd(content);
}

export function parseTestCasesFromMd(content: string): TestCase[] {
  const cases: TestCase[] = [];

  // Split by ### case-NNN
  const parts = content.split(/### (case-\d+)\s*/);

  for (let i = 1; i < parts.length; i += 2) {
    const id = parts[i];
    const body = parts[i + 1] ?? '';

    // Determine category from section header
    const category = inferCategory(body, content);

    const question = body.match(/\*\*问题\*\*：?\s*(.+)/)?.[1]?.trim() ?? '';
    const hint = body.match(/\*\*预期结果方向\*\*：?\s*(.+)/)?.[1]?.trim() ?? '';

    if (question) {
      cases.push({
        id,
        category,
        question,
        expected_result_hint: hint,
      });
    }
  }

  return cases;
}

function inferCategory(body: string, fullContent: string): TestCase['category'] {
  const bodyIdx = fullContent.indexOf(body);
  // Find the nearest ## header before this case
  const before = fullContent.slice(0, bodyIdx);
  const headers = [...before.matchAll(/## ([^\n]+)/g)];
  const lastHeader = headers[headers.length - 1]?.[1]?.toLowerCase() ?? '';

  if (lastHeader.includes('simple')) return 'simple';
  if (lastHeader.includes('metric') || lastHeader.includes('口径')) return 'metric';
  if (lastHeader.includes('complex') || lastHeader.includes('复杂')) return 'complex';
  return 'simple';
}
