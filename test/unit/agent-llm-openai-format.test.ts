import { describe, expect, it } from 'vitest';
import { parseOpenAIResponse, toOpenAIMessages, toOpenAITools } from '../../lib/agent-plugin/llm/openai-format';
import type { LLMMessage } from '../../lib/agent-plugin/llm/types';

describe('openai-format conversion', () => {
  it('maps tools to OpenAI function shape', () => {
    expect(toOpenAITools([{ name: 'insert_text', description: 'd', inputSchema: { type: 'object' } }])).toEqual([
      { type: 'function', function: { name: 'insert_text', description: 'd', parameters: { type: 'object' } } },
    ]);
  });

  it('prepends the system prompt and maps string content', () => {
    expect(toOpenAIMessages([{ role: 'user', content: 'hi' }], 'SYS')).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('maps an assistant turn with text + tool_use to tool_calls', () => {
    const messages: LLMMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 't1', name: 'insert_text', input: { text: 'x' } },
        ],
      },
    ];
    expect(toOpenAIMessages(messages, 'SYS')[1]).toEqual({
      role: 'assistant',
      content: 'ok',
      tool_calls: [
        { id: 't1', type: 'function', function: { name: 'insert_text', arguments: JSON.stringify({ text: 'x' }) } },
      ],
    });
  });

  it('maps a tool_result block to a tool message', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'done' }] },
    ];
    expect(toOpenAIMessages(messages, 'SYS')[1]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'done' });
  });

  it('parses text and tool_calls (with JSON arguments) from a completion', () => {
    const parsed = parseOpenAIResponse({
      choices: [
        {
          message: {
            content: 'sure',
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'insert_text', arguments: '{"text":"hi"}' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(parsed.text).toBe('sure');
    expect(parsed.toolCalls).toEqual([{ id: 't1', name: 'insert_text', input: { text: 'hi' } }]);
    expect(parsed.stopReason).toBe('tool_calls');
  });

  it('falls back to {} for unparseable tool arguments and defaults stopReason', () => {
    const parsed = parseOpenAIResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 't1', type: 'function', function: { name: 'x', arguments: 'not json' } }],
          },
        },
      ],
    });
    expect(parsed.toolCalls[0].input).toEqual({});
    expect(parsed.text).toBe('');
    expect(parsed.stopReason).toBe('stop');
  });
});
