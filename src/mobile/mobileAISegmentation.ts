import { segmentLyricsWithAi, type SegmentLyricsOptions } from '../services/lyricSegmentationAi';
import { buildSegmentationSystemPrompt, buildSegmentationSourcePrompt, parseSegmentationResponse,
  SEGMENTATION_JSON_SCHEMA, SEGMENTATION_SCHEMA_NAME, SEGMENTATION_GEMINI_GENERATION_CONFIG,
  SEGMENTATION_MAX_OUTPUT_TOKENS } from '../../shared/lyricSegmentationPrompt.mjs';
import { createMobileAICompletion, MobileAIError, type MobileAITransport } from './mobileAICompletion';

// mobileAISegmentation.ts — original batches, prompts and exact-text boundary repair over captured native AI settings.
export async function segmentMobileLyricsWithAi(lines: string[], options: Pick<SegmentLyricsOptions, 'signal' | 'onProgress'> = {},
  transport?: MobileAITransport) {
  const complete = createMobileAICompletion(transport);
  return segmentLyricsWithAi(lines, { ...options,
    shouldStopOnError: error => error instanceof MobileAIError && ['ai-key-missing', 'ai-settings-changed', 'ai-cancelled',
      'ai-auth', 'ai-rate-limit', 'ai-timeout', 'ai-request-too-large', 'ai-response-too-large'].includes(error.code),
    requestBatch: async (batch, signal) => {
      const { content } = await complete({ system: buildSegmentationSystemPrompt(), source: buildSegmentationSourcePrompt(batch),
        schema: SEGMENTATION_JSON_SCHEMA, schemaName: SEGMENTATION_SCHEMA_NAME, maxTokens: SEGMENTATION_MAX_OUTPUT_TOKENS,
        geminiConfig: SEGMENTATION_GEMINI_GENERATION_CONFIG, disableReasoning: true }, signal);
      try { return parseSegmentationResponse(content, batch).boundaries; }
      catch { throw new MobileAIError('ai-invalid-response'); } // The shared parser's diagnostics contain lyric/model text.
    },
  });
}
