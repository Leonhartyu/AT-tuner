export class AskTableAPI {
  constructor(
    private serverUrl: string,
    private apiKey: string
  ) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    const init: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, init);
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`API ${method} ${path} failed: ${res.status} ${res.statusText} ${text}`);
        }
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
          return (await res.text()) as T;
        }
        return res.json() as Promise<T>;
      } catch (e) {
        lastError = e as Error;
        if (attempt < 2) await sleep(2000 * (attempt + 1));
      }
    }
    throw lastError!;
  }

  // ── Data Agents ───────────────────────────────────────────────

  async listDataAgents(): Promise<Array<{
    id: string;
    name: string;
    is_builtin: boolean;
    datasource_ids: string[];
    memory_enabled: boolean;
  }>> {
    return this.request('GET', '/data-agents');
  }

  async findAgentForDatasource(datasourceId: string): Promise<string | null> {
    const agents = await this.listDataAgents();
    for (const agent of agents) {
      if (agent.datasource_ids?.includes(datasourceId)) {
        return agent.id;
      }
    }
    return null;
  }

  // ── Conversations ─────────────────────────────────────────────

  async createConversation(payload: {
    datasource_ids?: string[];
    skill_ids?: string[];
    data_agent_id?: string;
    role_id?: string;
    name?: string;
  }): Promise<{ id: string; project_id: string; status: string }> {
    return this.request('POST', '/conversations', payload);
  }

  async sendMessage(convId: string, question: string): Promise<{ status: string }> {
    return this.request('POST', `/conversations/${convId}/messages`, { question });
  }

  async getConversation(convId: string): Promise<{
    id: string;
    status: string;
    messages: Array<{
      role: string;
      content: Array<{
        type: string;
        text?: string;
        thinking?: string;
        tool_use_id?: string;
        id?: string;
        name?: string;
        input?: unknown;
        content?: string;
      }>;
    }>;
  }> {
    return this.request('GET', `/conversations/${convId}`);
  }

  // ── Meta ──────────────────────────────────────────────────────

  async inspectMetadata(datasourceId: string): Promise<{
    schemas: Record<string, {
      name: string;
      origin_desc: string;
      curr_desc: string;
      tables: Record<string, {
        name: string;
        origin_desc: string;
        curr_desc: string;
        fields: Record<string, {
          name: string;
          origin_desc: string;
          curr_desc: string;
          curr_desc_stat: string;
          data_type: string;
          sample_data: string | null;
          visibility: boolean;
        }>;
      }>;
    }>;
    datasource_id: string;
  }> {
    return this.request('GET', `/datasources/${datasourceId}/meta`);
  }

  async patchFieldDesc(
    datasourceId: string,
    payload: {
      schemas: Record<string, {
        desc: string | null;
        tables: Record<string, {
          desc: string | null;
          fields: Record<string, string>;
        }>;
      }>;
    }
  ): Promise<void> {
    await this.request('PATCH', `/datasources/${datasourceId}/meta`, payload);
  }

  // ── Glossary / Skills (placeholders) ─────────────────────────

  async createGlossaryTerm(_payload: {
    term: string;
    definition: string;
    aliases?: string[];
  }): Promise<void> {
    // TODO: verify actual endpoint path
    await this.request('POST', '/glossary', _payload);
  }

  async syncSkill(_name: string, _content: string): Promise<void> {
    // TODO: verify actual endpoint path
    await this.request('POST', '/skills', { name: _name, content: _content });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
