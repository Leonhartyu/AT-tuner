import type { AskTableAPI } from './asktable-api.js';
import type { ConvMessage } from '../types.js';

/**
 * Create a conversation for agent self-analysis.
 */
export async function createAgentConv(
  api: AskTableAPI,
  datasourceId: string,
  _systemPrompt: string,
  options?: { useDataAgent?: boolean }
): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (options?.useDataAgent !== false) {
    const dataAgentId = await api.findAgentForDatasource(datasourceId);
    if (dataAgentId) {
      payload.data_agent_id = dataAgentId;
    } else {
      payload.datasource_ids = [datasourceId];
    }
  } else {
    payload.datasource_ids = [datasourceId];
  }
  const conv = await api.createConversation(payload);
  return conv.id;
}

/**
 * Ask the agent a question and wait for the answer.
 */
export async function askAgent(
  api: AskTableAPI,
  convId: string,
  question: string,
  timeout = 120_000
): Promise<string> {
  await api.sendMessage(convId, question);
  const messages = await pollForResult(api, convId, { timeout });
  return extractAnswer(messages);
}

/**
 * Poll conversation until content is fully synced.
 * Measures serialized message length between polls; returns only when
 * the length stays the same for `stableThreshold` consecutive checks.
 */
export async function pollForResult(
  api: AskTableAPI,
  convId: string,
  options: { timeout: number; interval?: number; onProgress?: (elapsedSec: number) => void; stableThreshold?: number }
): Promise<ConvMessage[]> {
  const { timeout, interval = 2000, onProgress, stableThreshold = 3 } = options;
  const start = Date.now();

  let lastLen = 0;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const conv = await api.getConversation(convId);
    const elapsed = Math.floor((Date.now() - start) / 1000);

    if (conv.status === 'warning') {
      onProgress?.(elapsed);
      return (conv.messages ?? []) as ConvMessage[];
    }

    if (conv.status === 'streaming') {
      onProgress?.(elapsed);
      lastLen = 0;
      stableCount = 0;
      await sleep(interval);
      continue;
    }

    // Status is active (or other non-streaming) — check content stability
    const msgs = conv.messages ?? [];
    const hasAiResponse = msgs.some(m => m.role === 'assistant');

    if (!hasAiResponse) {
      stableCount = 0;
      await sleep(interval);
      continue;
    }

    // Compute content fingerprint
    const currentLen = contentFingerprint(msgs as ConvMessage[]);
    onProgress?.(elapsed);

    if (currentLen === lastLen && currentLen > 0) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        return msgs as ConvMessage[];
      }
    } else {
      stableCount = 0;
    }

    lastLen = currentLen;
    await sleep(interval);
  }

  // Timeout: return whatever we have
  const conv = await api.getConversation(convId);
  return (conv.messages ?? []) as ConvMessage[];
}

/**
 * Compute a numeric fingerprint of all message content.
 * If the fingerprint length changes between polls, content is still being written.
 */
function contentFingerprint(messages: ConvMessage[]): number {
  let len = 0;
  for (const msg of messages) {
    if (msg.role) len += msg.role.length;
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) len += block.text.length;
        if (block.thinking) len += block.thinking.length;
        if (block.input) len += typeof block.input === 'string' ? block.input.length : JSON.stringify(block.input).length;
      }
    }
  }
  return len;
}

function extractAnswer(messages: ConvMessage[]): string {
  if (!messages || messages.length === 0) return '';

  const aiMsg = [...messages].reverse().find(m => m.role === 'assistant');
  if (aiMsg && aiMsg.content && Array.isArray(aiMsg.content)) {
    const textBlocks = aiMsg.content.filter(b => b.type === 'text' && b.text);
    if (textBlocks.length > 0) {
      return textBlocks.map(b => b.text!).join('\n');
    }
  }

  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
