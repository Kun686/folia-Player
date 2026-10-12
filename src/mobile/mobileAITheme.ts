import type { DualTheme } from '../types';
import { sanitizeDualTheme } from '../services/themeSanitizer';
import { parseAiThemeJsonInput } from '../utils/aiThemePrompts';
import { buildThemeSystemPrompt, buildThemeSourcePrompt, THEME_JSON_SCHEMA, THEME_JSON_SCHEMA_NAME,
  THEME_MAX_OUTPUT_TOKENS, getGeminiResponseSchema } from '../../shared/themeGenerationContract.mjs';
import { createMobileAICompletion, MobileAIError, type MobileAITransport } from './mobileAICompletion';
export { MobileAIError } from './mobileAICompletion';

// mobileAITheme.ts — original theme prompt and validation, sharing the keyless transport with lyric segmentation.
export async function generateMobileAITheme(input: { lyricsText: string; isPureMusic?: boolean; songTitle?: string },
  signal?: AbortSignal, transport?: MobileAITransport): Promise<DualTheme> {
  const { content, provider } = await createMobileAICompletion(transport)({
    system: buildThemeSystemPrompt(true),
    source: buildThemeSourcePrompt(input.lyricsText.slice(0, 2000), !!input.isPureMusic, input.songTitle?.slice(0, 512)),
    schema: THEME_JSON_SCHEMA, schemaName: THEME_JSON_SCHEMA_NAME, maxTokens: THEME_MAX_OUTPUT_TOKENS, compatibleMaxTokens: 8192,
    geminiConfig: { responseMimeType: 'application/json', responseSchema: getGeminiResponseSchema() },
  }, signal);
  if (signal?.aborted) throw new MobileAIError('ai-cancelled');
  try {
    const theme = sanitizeDualTheme(parseAiThemeJsonInput(content) as DualTheme);
    for (const mode of ['light', 'dark'] as const) {
      theme[mode].fontStyle = 'sans'; theme[mode].animationIntensity = 'normal';
      theme[mode].provider = provider === 'gemini' ? 'Google Gemini (Local)' : 'OpenAI Compatible (Local)';
    }
    return theme;
  } catch { throw new MobileAIError('ai-invalid-response'); }
}
