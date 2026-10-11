import type { DualTheme } from '../types';
import { sanitizeDualTheme } from '../services/themeSanitizer';
import { parseAiThemeJsonInput } from '../utils/aiThemePrompts';
import { buildThemeSystemPrompt, buildThemeSourcePrompt, THEME_JSON_SCHEMA, THEME_JSON_SCHEMA_NAME,
  THEME_MAX_OUTPUT_TOKENS, getGeminiResponseSchema } from '../../shared/themeGenerationContract.mjs';
import { buildOpenAICompatibleRequestBody, createOpenAIStreamAccumulator, extractResponseContentText,
  detectOpenAICompatibleProvider } from '../../shared/aiResponseClient.mjs';
import { sendOpenAICompatibleRequest } from '../../shared/openAICompatibleRequest.mjs';
import { native, type FoliaNativePlugin } from './bridge';

// mobileAITheme.ts — original desktop prompts, schema, negotiation and SSE parser over a keyless native transport.
type Transport = Pick<FoliaNativePlugin, 'getAISettings' | 'aiRequest' | 'cancelAIRequest'>;
export type MobileAIErrorCode = 'ai-key-missing' | 'ai-settings-changed' | 'ai-cancelled' | 'ai-timeout'
  | 'ai-network' | 'ai-auth' | 'ai-rate-limit' | 'ai-http' | 'ai-invalid-response' | 'ai-response-too-large';
export class MobileAIError extends Error {
  constructor(readonly code: MobileAIErrorCode) { super(code); }
}
const codes: MobileAIErrorCode[] = ['ai-key-missing', 'ai-settings-changed', 'ai-cancelled', 'ai-timeout',
  'ai-network', 'ai-auth', 'ai-rate-limit', 'ai-http', 'ai-invalid-response', 'ai-response-too-large'];
export async function generateMobileAITheme(input: { lyricsText: string; isPureMusic?: boolean; songTitle?: string },
  signal?: AbortSignal, transport: Transport = native): Promise<DualTheme> {
  const controller = new AbortController();
  let timedOut = false, requestId: string | null = null;
  const cancel = () => {
    controller.abort();
    if (requestId) void transport.cancelAIRequest({ id: requestId }).catch(() => undefined);
  };
  const deadline = setTimeout(() => { timedOut = true; cancel(); }, 120_000);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const assertActive = () => { if (controller.signal.aborted) throw new MobileAIError(timedOut ? 'ai-timeout' : 'ai-cancelled'); };
  try {
    assertActive();
    const settings = await transport.getAISettings();
    assertActive();
    if (!settings[settings.provider].hasKey) throw new MobileAIError('ai-key-missing');
    const system = buildThemeSystemPrompt(true);
    const source = buildThemeSourcePrompt(input.lyricsText.slice(0, 2000), !!input.isPureMusic, input.songTitle?.slice(0, 512));
    const send = async (body: string) => {
      assertActive();
      requestId = crypto.randomUUID();
      const result = await transport.aiRequest({ id: requestId, revision: settings.revision, provider: settings.provider, body });
      assertActive();
      requestId = null;
      return new Response([204, 205, 304].includes(result.status) ? null : result.body,
        { status: result.status, headers: { 'Content-Type': result.contentType } });
    };
    let response: Response, content: string | null;
    if (settings.provider === 'gemini') {
      response = await send(JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: source }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: getGeminiResponseSchema() } }));
    } else {
      const config = settings.openai, provider = detectOpenAICompatibleProvider(config.apiURL);
      const body = buildOpenAICompatibleRequestBody(config.model, provider, system, source, config.temperature,
        THEME_JSON_SCHEMA, THEME_JSON_SCHEMA_NAME, provider === 'openai' ? THEME_MAX_OUTPUT_TOKENS : 8192, {}, config.stream);
      response = await sendOpenAICompatibleRequest({ apiUrl: config.apiURL, provider, body,
        init: { method: 'POST', signal: controller.signal }, fetchImpl: async (_url, init) => send(String(init?.body)) });
    }
    if (!response.ok) throw new MobileAIError([401, 403].includes(response.status) ? 'ai-auth'
      : response.status === 429 ? 'ai-rate-limit' : 'ai-http');
    try {
      if (settings.provider === 'gemini') {
        const data = await response.json();
        content = data?.candidates?.[0]?.content?.parts?.find((part: { text?: unknown }) => typeof part?.text === 'string')?.text ?? null;
      } else if (settings.openai.stream) {
        const accumulator = createOpenAIStreamAccumulator();
        accumulator.push(await response.text()); content = accumulator.finish().content;
      } else {
        const data = await response.json(); content = extractResponseContentText(data?.choices?.[0]?.message);
      }
      if (!content) throw new MobileAIError('ai-invalid-response');
      const theme = sanitizeDualTheme(parseAiThemeJsonInput(content) as DualTheme);
      for (const mode of ['light', 'dark'] as const) {
        theme[mode].fontStyle = 'sans'; theme[mode].animationIntensity = 'normal';
        theme[mode].provider = settings.provider === 'gemini' ? 'Google Gemini (Local)' : 'OpenAI Compatible (Local)';
      }
      assertActive();
      return theme;
    } catch { assertActive(); throw new MobileAIError('ai-invalid-response'); }
  } catch (error) {
    assertActive();
    const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
    // Native/provider exceptions may contain remote response text; only known codes leave this boundary.
    throw new MobileAIError(codes.includes(message as MobileAIErrorCode) ? message as MobileAIErrorCode : 'ai-network');
  } finally { clearTimeout(deadline); signal?.removeEventListener('abort', cancel); }
}
