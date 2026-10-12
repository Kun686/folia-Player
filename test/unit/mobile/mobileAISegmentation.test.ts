import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { segmentMobileLyricsWithAi } from '../../../src/mobile/mobileAISegmentation';
import type { NativeAISettings, NativeAIResponse } from '../../../src/mobile/nativeAI';
import { resetOpenAICompatibleCapabilities } from '../../../shared/openAICompatibleRequest.mjs';
import { buildSegmentationSystemPrompt, SEGMENTATION_GEMINI_GENERATION_CONFIG } from '../../../shared/lyricSegmentationPrompt.mjs';

// mobileAISegmentation.test.ts — original parsing and request policy, with no real credentials or inference.
const settings = (provider: 'openai' | 'gemini' = 'openai'): NativeAISettings => ({ provider, revision: 7,
  gemini: { hasKey: true }, openai: { apiURL: 'https://api.openai.com/v1/chat/completions', model: 'test-model',
    temperature: 0.7, stream: false, hasKey: true } });
const reply = (rows: unknown): NativeAIResponse => ({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines: rows }) } }] }) });
const transport = (config = settings()) => ({ getAISettings: vi.fn(async () => structuredClone(config)),
  aiRequest: vi.fn(async (_request: { id: string; revision: number; provider: string; body: string }): Promise<NativeAIResponse> => reply([['第', '一句', '歌词']])),
  cancelAIRequest: vi.fn(async () => undefined) });
beforeEach(resetOpenAICompatibleCapabilities);
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('preserves segmentation prompts/schema/reasoning policy without sending keys, URLs or headers from JS', async () => {
  const bridge = transport();
  const result = await segmentMobileLyricsWithAi(['第一句歌词'], {}, bridge);
  expect(result.boundaries).toEqual([['第', '一句', '歌词']]);
  const call = bridge.aiRequest.mock.calls[0][0], body = JSON.parse(call.body);
  expect(body.messages[0].content).toBe(buildSegmentationSystemPrompt());
  expect(body.response_format.json_schema.name).toBe('lyric_word_segmentation');
  expect(body.reasoning_effort).toBe('none'); expect(body.max_completion_tokens).toBe(8192);
  expect(Object.keys(call).sort()).toEqual(['body', 'id', 'provider', 'revision']); expect(call.revision).toBe(7);
});
it('preserves Gemini zero-thinking config and repairs only whitespace, rejecting rewritten rows', async () => {
  const bridge = transport(settings('gemini'));
  bridge.aiRequest.mockResolvedValue({ status: 200, contentType: 'application/json', body: JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ lines: [['Hello', 'world'], ['changed']] }) }] } }] }) });
  const result = await segmentMobileLyricsWithAi(['Hello  world ', '第一句歌词'], {}, bridge);
  expect(result.boundaries[0]?.join('')).toBe('Hello  world '); expect(result.boundaries[1]).toBeNull();
  expect(result.appliedCount).toBe(1);
  expect(JSON.parse(bridge.aiRequest.mock.calls[0][0].body).generationConfig).toEqual(SEGMENTATION_GEMINI_GENERATION_CONFIG);
});
it('captures one native configuration across sequential batches and retains valid batches on malformed output', async () => {
  const bridge = transport(), lines = Array.from({ length: 205 }, (_, i) => 'line ' + i), progress: number[] = [];
  bridge.aiRequest.mockResolvedValueOnce(reply(lines.slice(0, 100).map(l => [l])))
    .mockResolvedValueOnce(reply([['wrong count']])).mockResolvedValueOnce(reply(lines.slice(200).map(l => [l])));
  const result = await segmentMobileLyricsWithAi(lines, { onProgress: p => progress.push(p.done) }, bridge);
  expect(bridge.getAISettings).toHaveBeenCalledTimes(1);
  expect(progress).toEqual([100, 200, 205]); expect(result.appliedCount).toBe(105);
  expect(result.failures).toEqual(['ai-invalid-response']); expect(result.boundaries.slice(100, 200)).toEqual(Array(100).fill(null));
});
for (const [status, code] of [[401, 'ai-auth'], [429, 'ai-rate-limit']] as const) it('stops all later batches on HTTP ' + status, async () => {
  const bridge = transport(); bridge.aiRequest.mockResolvedValue({ status, contentType: 'text/plain', body: 'private diagnostics' });
  await expect(segmentMobileLyricsWithAi(Array(205).fill('第一句歌词'), {}, bridge)).rejects.toThrow(code);
  expect(bridge.aiRequest).toHaveBeenCalledTimes(1);
});
it('rejects a changed captured configuration on a later batch, without reading new credentials', async () => {
  const bridge = transport(), lines = Array(101).fill('第一句歌词');
  bridge.aiRequest.mockResolvedValueOnce(reply(Array(100).fill(['第一句歌词']))).mockRejectedValueOnce(Error('ai-settings-changed'));
  await expect(segmentMobileLyricsWithAi(lines, {}, bridge)).rejects.toThrow('ai-settings-changed');
  expect(bridge.getAISettings).toHaveBeenCalledTimes(1);
  expect(bridge.aiRequest.mock.calls.map(([r]) => r.revision)).toEqual([7, 7]);
});
it('cancels the exact native operation even if the final batch later succeeds', async () => {
  const bridge = transport(), abort = new AbortController();
  let release!: (r: NativeAIResponse) => void;
  bridge.aiRequest.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const work = segmentMobileLyricsWithAi(['第一句歌词'], { signal: abort.signal }, bridge);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  abort.abort(); release(reply([['第一句歌词']]));
  await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  expect(bridge.cancelAIRequest).toHaveBeenCalledWith({ id: bridge.aiRequest.mock.calls[0][0].id });
});
it('uses the existing reasoning ladder and remembers the accepted rung for later batches', async () => {
  const config = settings(); config.openai.apiURL = 'https://compatible.example/v1/chat/completions';
  const bridge = transport(config);
  bridge.aiRequest.mockResolvedValueOnce({ status: 400, contentType: 'application/json',
    body: JSON.stringify({ error: { param: 'reasoning_effort', message: 'unsupported parameter reasoning_effort' } }) })
    .mockResolvedValueOnce(reply(Array(100).fill(['第一句歌词']))).mockResolvedValueOnce(reply([['第一句歌词']]));
  expect((await segmentMobileLyricsWithAi(Array(101).fill('第一句歌词'), {}, bridge)).appliedCount).toBe(101);
  const bodies = bridge.aiRequest.mock.calls.map(([r]) => JSON.parse(r.body));
  expect(bodies).toHaveLength(3); expect(bodies[1].chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(bodies[2].chat_template_kwargs).toEqual({ enable_thinking: false });
});
it('reads SSE and advances only when reasoning exhausted an empty completion', async () => {
  const config = settings(); config.openai.stream = true; const bridge = transport(config);
  const sse = (content: string, reasoning: boolean) => ({ status: 200, contentType: 'text/event-stream',
    body: 'data: ' + JSON.stringify({ choices: [{ delta: { content, ...(reasoning ? { reasoning_content: 'thinking' } : {}) },
      finish_reason: reasoning ? 'length' : 'stop' }] }) + '\n\ndata: [DONE]\n\n' });
  bridge.aiRequest.mockResolvedValueOnce(sse('', true)).mockResolvedValueOnce(sse(JSON.stringify({ lines: [['第一句歌词']] }), false));
  expect((await segmentMobileLyricsWithAi(['第一句歌词'], {}, bridge)).appliedCount).toBe(1);
  expect(bridge.aiRequest).toHaveBeenCalledTimes(2);
});
it('bounds oversized input before sending and never logs or returns model text on parser failures', async () => {
  const bridge = transport(), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
  await expect(segmentMobileLyricsWithAi(['字'.repeat(100000)], {}, bridge)).rejects.toThrow('ai-request-too-large');
  expect(bridge.aiRequest).not.toHaveBeenCalled();
  bridge.aiRequest.mockResolvedValue(reply([['private model text']]));
  await expect(segmentMobileLyricsWithAi(['第一句歌词'], {}, bridge)).rejects.toThrow(/^ai-invalid-response$/);
  expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
});
it('rejects missing keys without attempting any batch', async () => {
  const config = settings(); config.openai.hasKey = false; const bridge = transport(config);
  await expect(segmentMobileLyricsWithAi(['第一句歌词'], {}, bridge)).rejects.toThrow('ai-key-missing');
  expect(bridge.aiRequest).not.toHaveBeenCalled();
});
it('enforces the per-batch deadline and releases the native request', async () => {
  vi.useFakeTimers();
  const bridge = transport(); let release!: (r: NativeAIResponse) => void;
  bridge.aiRequest.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const work = segmentMobileLyricsWithAi(['第一句歌词'], {}, bridge);
  const rejected = expect(work).rejects.toThrow('ai-timeout');
  await vi.advanceTimersByTimeAsync(120001); release(reply([['第一句歌词']])); await rejected;
  expect(bridge.cancelAIRequest).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
});
