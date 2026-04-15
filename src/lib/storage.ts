import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface WorkspaceFiles {
  configPath: string;
  schemaPath: string;
  testCasesPath: string;
  resultsDir: string;
  reportPath: string;
}

export function resolveWorkspace(workspace: string): WorkspaceFiles {
  return {
    configPath: join(workspace, 'config.json'),
    schemaPath: join(workspace, 'schema.md'),
    testCasesPath: join(workspace, 'test-cases.md'),
    resultsDir: join(workspace, 'results'),
    reportPath: join(workspace, 'tuning-report.md'),
  };
}

export async function ensureWorkspace(workspace: string): Promise<WorkspaceFiles> {
  const files = resolveWorkspace(workspace);
  await mkdir(files.resultsDir, { recursive: true });
  return files;
}

export async function writeSchema(workspace: string, schema: string): Promise<void> {
  const { schemaPath } = resolveWorkspace(workspace);
  await writeFile(schemaPath, schema, 'utf-8');
}

export async function readSchema(workspace: string): Promise<string> {
  const { schemaPath } = resolveWorkspace(workspace);
  return readFile(schemaPath, 'utf-8');
}

export async function writeTestCases(workspace: string, content: string): Promise<void> {
  const { testCasesPath } = resolveWorkspace(workspace);
  await writeFile(testCasesPath, content, 'utf-8');
}

export async function readTestCases(workspace: string): Promise<string> {
  const { testCasesPath } = resolveWorkspace(workspace);
  return readFile(testCasesPath, 'utf-8');
}

export async function writeResult(workspace: string, caseId: string, json: unknown): Promise<void> {
  const { resultsDir } = resolveWorkspace(workspace);
  await mkdir(resultsDir, { recursive: true });
  const path = join(resultsDir, `${caseId}.json`);
  await writeFile(path, JSON.stringify(json, null, 2), 'utf-8');
}

export async function readAllResults(workspace: string): Promise<Array<Record<string, any>>> {
  const { resultsDir } = resolveWorkspace(workspace);
  if (!existsSync(resultsDir)) return [];

  const { readdir } = await import('node:fs/promises');
  const files = await readdir(resultsDir);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  const results: Array<Record<string, any>> = [];
  for (const f of jsonFiles) {
    const content = await readFile(join(resultsDir, f), 'utf-8');
    results.push(JSON.parse(content));
  }
  return results.sort((a, b) => (a.id ?? a.caseId ?? '').localeCompare(b.id ?? b.caseId ?? ''));
}

export async function writeReport(workspace: string, content: string): Promise<void> {
  const { reportPath } = resolveWorkspace(workspace);
  await writeFile(reportPath, content, 'utf-8');
}
