/**
 * OpenAI chat-completions format conversion.
 *
 * Shared by the WebLLM provider (in-browser, OpenAI-compatible) and the OpenAI
 * cloud provider. Translates the neutral LLMMessage/LLMToolDef shapes to/from
 * OpenAI's `messages` / `tools` / completion shapes. Pure and unit-testable.
 */
import type { LLMContent, LLMMessage, LLMResponse, LLMToolDef } from './types';

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}
export interface OpenAICompletion {
  choices: Array<{
    message: { content?: string | null; tool_calls?: OpenAIToolCall[] };
    finish_reason?: string;
  }>;
}

function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return args ? (JSON.parse(args) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Convert neutral tool defs to OpenAI function-tool shape. */
export function toOpenAITools(tools: LLMToolDef[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));
}

/** Convert neutral messages (+ system prompt) to OpenAI chat messages. */
export function toOpenAIMessages(messages: LLMMessage[], systemPrompt: string): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    let text = '';
    const toolCalls: OpenAIToolCall[] = [];
    const toolResults: OpenAIMessage[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input) },
        });
      } else if (block.type === 'tool_result') {
        toolResults.push({ role: 'tool', tool_call_id: block.toolUseId, content: block.content });
      }
    }
    if (message.role === 'assistant' && (text || toolCalls.length)) {
      const assistant: OpenAIMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length) assistant.tool_calls = toolCalls;
      out.push(assistant);
    } else if (message.role === 'user' && text) {
      out.push({ role: 'user', content: text });
    }
    out.push(...toolResults);
  }
  return out;
}

/** Parse an OpenAI completion into the neutral {@link LLMResponse}. */
export function parseOpenAIResponse(completion: OpenAICompletion): LLMResponse {
  const choice = completion.choices?.[0];
  const message = choice?.message ?? {};
  const text = message.content ?? '';
  const toolCalls = (message.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    input: safeParseArgs(call.function.arguments),
  }));
  const assistant: LLMContent[] = [];
  if (text) assistant.push({ type: 'text', text });
  for (const call of toolCalls) {
    assistant.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
  }
  return {
    text,
    toolCalls,
    stopReason: choice?.finish_reason ?? 'stop',
    assistant: { role: 'assistant', content: assistant },
  };
}
