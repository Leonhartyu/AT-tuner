import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import type { WorkspaceConfig } from '../types.js';

const GLOBAL_CONFIG_DIR = join(homedir(), '.at-tuner');
const GLOBAL_CONFIG_FILE = join(GLOBAL_CONFIG_DIR, 'config.json');

/**
 * Load merged config: CLI options > workspace config > global config.
 */
export function loadConfig(
  workspace: string,
  cliOpts: Partial<Record<
    'server' | 'apiKey' | 'datasource' | 'project' | 'llmProvider' | 'llmApiKey' | 'llmModel' | 'llmBaseUrl',
    string | undefined
  >>
): WorkspaceConfig {
  const globalCfg = readConfigFile(GLOBAL_CONFIG_FILE);
  const workspaceCfg = readConfigFile(join(workspace, 'config.json'));

  // Merge: global < workspace < CLI
  const merged: WorkspaceConfig = {
    server: cliOpts.server ?? workspaceCfg.server ?? globalCfg.server ?? '',
    api_key: cliOpts.apiKey ?? workspaceCfg.api_key ?? globalCfg.api_key ?? '',
    datasource_id: cliOpts.datasource ?? workspaceCfg.datasource_id ?? globalCfg.datasource_id ?? '',
    project_id: cliOpts.project ?? workspaceCfg.project_id ?? globalCfg.project_id ?? '',
    llm_provider: (cliOpts.llmProvider ?? workspaceCfg.llm_provider ?? globalCfg.llm_provider) as WorkspaceConfig['llm_provider'],
    llm_api_key: cliOpts.llmApiKey ?? workspaceCfg.llm_api_key ?? globalCfg.llm_api_key,
    llm_model: cliOpts.llmModel ?? workspaceCfg.llm_model ?? globalCfg.llm_model,
    llm_base_url: cliOpts.llmBaseUrl ?? workspaceCfg.llm_base_url ?? globalCfg.llm_base_url,
  };

  return merged;
}

/**
 * Validate that required config fields are present.
 */
export function requireConfig(cfg: WorkspaceConfig, fields: (keyof WorkspaceConfig)[]): void {
  const missing = fields.filter(f => !cfg[f]);
  if (missing.length > 0) {
    console.error(`❌ 缺少必需配置: ${missing.join(', ')}`);
    console.error('请通过 config 命令或 CLI 参数提供');
    process.exit(1);
  }
}

function readConfigFile(path: string): Partial<WorkspaceConfig> {
  if (!existsSync(path)) return {};
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Save a key-value pair to the global config file.
 */
export async function saveGlobalConfig(key: string, value: string): Promise<void> {
  const cfg = readConfigFile(GLOBAL_CONFIG_FILE);
  const keyMap = toInternalKey(key);
  (cfg as any)[keyMap] = value;
  await mkdir(GLOBAL_CONFIG_DIR, { recursive: true });
  await writeFile(GLOBAL_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

/**
 * Load and return all merged config as a flat record (for display).
 */
export function getAllConfig(
  workspace: string
): Record<string, string> {
  const globalCfg = readConfigFile(GLOBAL_CONFIG_FILE);
  const workspaceCfg = readConfigFile(join(workspace, 'config.json'));
  const merged = { ...globalCfg, ...workspaceCfg };

  // Mask sensitive values
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    if (k.includes('key')) {
      result[k] = maskSecret(String(v));
    } else {
      result[k] = String(v ?? '');
    }
  }
  return result;
}

function maskSecret(value: string): string {
  if (!value || value.length <= 8) return '***';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

const KEY_MAP: Record<string, string> = {
  'server': 'server',
  'api-key': 'api_key',
  'datasource': 'datasource_id',
  'project': 'project_id',
  'llm-provider': 'llm_provider',
  'llm-api-key': 'llm_api_key',
  'llm-model': 'llm_model',
  'llm-base-url': 'llm_base_url',
};

function toInternalKey(key: string): string {
  return KEY_MAP[key] ?? key;
}

export function fromInternalKey(key: string): string {
  const reverse: Record<string, string> = {};
  for (const [k, v] of Object.entries(KEY_MAP)) reverse[v] = k;
  return reverse[key] ?? key;
}
