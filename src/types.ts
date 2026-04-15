export interface SampleQuery {
  question: string;
  sql: string;
  result: any;
}

export interface TestCase {
  id: string;
  category: 'simple' | 'metric' | 'complex';
  question: string;
  expected_result_hint: string;
  sql_template?: string;
}

export interface ExecutionResult {
  caseId: string;
  status: 'success' | 'error' | 'timeout';
  question: string;
  convId: string | null;
  generatedSql: string | null;
  result: any;
  error: string | null;
  duration: number;
  rawMessages: ConvMessage[] | null;
}

export interface TuningSuggestion {
  category: 'field_desc' | 'glossary' | 'skill';
  case_id: string;
  question: string;
  root_cause: string;
  current_value?: string;
  suggested_value: string;
  api_payload: Record<string, any>;
  priority: 'high' | 'medium' | 'low';
}

export interface TuningReport {
  summary: {
    total: number;
    success: number;
    failed: number;
    field_desc_suggestions: number;
    glossary_suggestions: number;
    skill_suggestions: number;
  };
  cases: ExecutionResult[];
  suggestions: TuningSuggestion[];
}

export interface WorkspaceConfig {
  server: string;
  api_key: string;
  datasource_id: string;
  project_id?: string;
  llm_provider?: 'openai' | 'claude';
  llm_api_key?: string;
  llm_model?: string;
  llm_base_url?: string;
}

// Schema types (from GET /datasources/{ds_id}/meta)
export interface SchemaMeta {
  name: string;
  origin_desc: string;
  curr_desc: string;
  tables: Record<string, TableMeta>;
}

export interface TableMeta {
  name: string;
  origin_desc: string;
  curr_desc: string;
  fields: Record<string, FieldMeta>;
}

export interface FieldMeta {
  name: string;
  origin_desc: string;
  curr_desc: string;
  curr_desc_stat: string;
  data_type: string;
  sample_data: string | null;
  visibility: boolean;
}

// Conversation API types — content blocks format (ProgressStep)
export interface ConvMessage {
  role: string;
  content: Array<{
    type: string;
    text?: string;
    thinking?: string;
    tool_use_id?: string;
    id?: string;
    name?: string;
    input?: string | Record<string, unknown>;
    content?: string;
  }>;
}
