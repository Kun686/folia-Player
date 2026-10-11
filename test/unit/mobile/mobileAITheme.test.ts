import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateMobileAITheme } from '../../../src/mobile/mobileAITheme';
import type { NativeAISettings } from '../../../src/mobile/nativeAI';
import { BASE_DUAL_THEME } from '../../../src/services/baseThemes';
import { resetOpenAICompatibleCapabilities } from '../../../shared/openAICompatibleRequest.mjs';
import { buildThemeSystemPrompt, getGeminiResponseSchema } from '../../../shared/themeGenerationContract.mjs';

// mobileAITheme.test.ts — actual shared prompt/response logic with a native transport fixture; no live AI service calls.
const settings = (provider: 'openai' | 'gemini' = 'openai'): NativeAISettings => ({ provider, revision: 7,
  gemini: { hasKey: true }, openai: { apiURL: 'https://api.openai.com/v1/chat/completions', model: 'test-model', temperature: 0.7, stream: false, hasKey: true } });
const theme = JSON.stringify(BASE_DUAL_THEME);
const reply = (content = theme) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) });
const transport = (config = settings()) => ({ getAISettings: vi.fn(async () => config), aiRequest: vi.fn(async (_request: unknown) => reply()), cancelAIRequest: vi.fn(async () => undefined) });
beforeEach(resetOpenAICompatibleCapabilities);
afterEach(() => vi.restoreAllMocks());
describe('original AI theme generation over native credentials', () => {
  it('preserves the original OpenAI contract and sends no credentials through the bridge', async () => {
    const bridge = transport();
    const result = await generateMobileAITheme({ lyricsText: 'a'.repeat(3000), songTitle: 'test' }, undefined, bridge);
    const call = bridge.aiRequest.mock.calls[0][0] as { provider: string; revision: number; body: string };
    expect(call.provider).toBe('openai'); expect(call.revision).toBe(7);
    const body = JSON.parse(call.body);
    expect(body.messages[0].content).toBe(buildThemeSystemPrompt(true));
    expect(body.messages[1].content).toContain('a'.repeat(2000)); expect(body.messages[1].content).not.toContain('a'.repeat(2001));
    expect(body.response_format.json_schema.name).toBe('dual_theme'); expect(body.max_completion_tokens).toBe(4096);
    expect(call).not.toHaveProperty('headers'); expect(call).not.toHaveProperty('apiKey'); expect(call).not.toHaveProperty('url');
    expect(result.dark.provider).toBe('OpenAI Compatible (Local)');
  });
  it('preserves Gemini schema, instrumental title and dual theme response', async () => {
    const bridge = transport(settings('gemini'));
    bridge.aiRequest.mockResolvedValue({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: theme }] } }] }) });
    const result = await generateMobileAITheme({ lyricsText: 'Instrumental', songTitle: 'Instrumental', isPureMusic: true }, undefined, bridge);
    const body = JSON.parse((bridge.aiRequest.mock.calls[0][0] as { body: string }).body);
    expect(body.generationConfig.responseSchema).toEqual(getGeminiResponseSchema());
    expect(body.contents[0].parts[0].text).toContain('Pure instrumental: yes\nSong title: Instrumental');
    expect(result.light.provider).toBe('Google Gemini (Local)');
  });
  it('reuses compatible endpoint negotiation only for explicit field rejection', async () => {
    const config = settings(); config.openai.apiURL = 'https://compatible.example/v1/chat/completions';
    const bridge = transport(config);
    bridge.aiRequest.mockResolvedValueOnce({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { param: 'response_format', message: 'unsupported parameter response_format' } }) });
    await generateMobileAITheme({ lyricsText: 'test' }, undefined, bridge);
    expect(bridge.aiRequest).toHaveBeenCalledTimes(2);
    expect(JSON.parse((bridge.aiRequest.mock.calls[1][0] as { body: string }).body)).not.toHaveProperty('response_format');
  });
  for (const [status, code] of [[401, 'ai-auth'], [429, 'ai-rate-limit'], [500, 'ai-http']] as const) it(`does not retry HTTP ${status} or expose response text`, async () => {
    const bridge = transport(); bridge.aiRequest.mockResolvedValue({ status, contentType: 'text/plain', body: 'private server diagnostic' });
    await expect(generateMobileAITheme({ lyricsText: 'test' }, undefined, bridge)).rejects.toThrow(code);
    expect(bridge.aiRequest).toHaveBeenCalledTimes(1);
  });
  it('uses the desktop SSE parser and rejects refused or incomplete output', async () => {
    const config = settings(); config.openai.stream = true; const bridge = transport(config);
    bridge.aiRequest.mockResolvedValue({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: theme } }] })}\n\ndata: [DONE]\n\n` });
    expect((await generateMobileAITheme({ lyricsText: 'test' }, undefined, bridge)).dark.name).toBe(BASE_DUAL_THEME.dark.name);
    for (const message of [{ refusal: 'private diagnostic' }, { content: '{"light":' }, { content: '' }]) {
      bridge.aiRequest.mockResolvedValue({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message }] }) });
      await expect(generateMobileAITheme({ lyricsText: 'test' }, undefined, bridge)).rejects.toThrow('ai-invalid-response');
    }
  });
  it('requires a saved key without issuing a request', async () => {
    const config = settings(); config.openai.hasKey = false; const bridge = transport(config);
    await expect(generateMobileAITheme({ lyricsText: 'test' }, undefined, bridge)).rejects.toThrow('ai-key-missing');
    expect(bridge.aiRequest).not.toHaveBeenCalled();
  });
  it('classifies a successful but empty HTTP response as invalid output, not a network failure', async () => {
    const bridge = transport(); bridge.aiRequest.mockResolvedValue({ status: 204, contentType: '', body: '' });
    await expect(generateMobileAITheme({ lyricsText: 'test' }, undefined, bridge)).rejects.toThrow('ai-invalid-response');
  });
  it('cancels the exact native request and rejects a late successful response', async () => {
    const bridge = transport(), abort = new AbortController();
    let release!: (value: ReturnType<typeof reply>) => void;
    bridge.aiRequest.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const work = generateMobileAITheme({ lyricsText: 'test' }, abort.signal, bridge);
    await vi.waitFor(() => expect(bridge.aiRequest).toHaveBeenCalledOnce());
    abort.abort(); release(reply());
    await expect(work).rejects.toThrow('ai-cancelled');
    expect(bridge.cancelAIRequest).toHaveBeenCalledWith({ id: (bridge.aiRequest.mock.calls[0][0] as { id: string }).id });
  });
  it('rejects changed native configuration without logging server errors', async () => {
    const bridge = transport(), logged = vi.spyOn(console, 'error');
    bridge.aiRequest.mockRejectedValue({ message: 'ai-settings-changed' });
    await expect(generateMobileAITheme({ lyricsText: 'test' }, undefined, bridge)).rejects.toThrow('ai-settings-changed');
    expect(logged).not.toHaveBeenCalled();
  });
});
