export interface LLMClientOptions {
  provider: 'openai' | 'claude';
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface LLMClient {
  chat(prompt: string, maxTokens?: number): Promise<string>;
}

const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6-20250514';

export function createLLMClient(options: LLMClientOptions): LLMClient {
  const { provider, apiKey, model, baseUrl } = options;

  if (provider === 'openai') {
    return createOpenAIClient(apiKey, model ?? DEFAULT_OPENAI_MODEL, baseUrl);
  }
  return createClaudeClient(apiKey, model ?? DEFAULT_CLAUDE_MODEL, baseUrl);
}

function createOpenAIClient(apiKey: string, model: string, baseUrl?: string): LLMClient {
  const apiUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/chat/completions`
    : 'https://api.openai.com/v1/chat/completions';

  return {
    async chat(prompt: string, maxTokens = 4096): Promise<string> {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: '你是 AskTable 调优专家。分析 SQL 质量问题并给出具体可执行的调优建议。' },
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API error: ${res.status} ${res.statusText} - ${text}`);
      }

      const json = await res.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      return json.choices[0]?.message?.content ?? '';
    },
  };
}

function createClaudeClient(apiKey: string, model: string, baseUrl?: string): LLMClient {
  const apiUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, '')}/messages`
    : 'https://api.anthropic.com/v1/messages';

  return {
    async chat(prompt: string, maxTokens = 4096): Promise<string> {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: '你是 AskTable 调优专家。分析 SQL 质量问题并给出具体可执行的调优建议。只返回 JSON 数组，不要其他文字。',
          messages: [
            { role: 'user', content: prompt },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Claude API error: ${res.status} ${res.statusText} - ${text}`);
      }

      const json = await res.json() as {
        content: Array<{ type: string; text: string }>;
      };

      return json.content.find(b => b.type === 'text')?.text ?? '';
    },
  };
}
