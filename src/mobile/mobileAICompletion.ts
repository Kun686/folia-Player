import { buildOpenAICompatibleRequestBody, createOpenAIStreamAccumulator, extractResponseContentText,
  detectOpenAICompatibleProvider } from '../../shared/aiResponseClient.mjs';
import { sendOpenAICompatibleRequest, rejectsOpenAICompatibleParameter } from '../../shared/openAICompatibleRequest.mjs';
import { REASONING_SUPPRESSION_ATTEMPTS } from '../../shared/lyricSegmentationPrompt.mjs';
import { native, type FoliaNativePlugin } from './bridge';

// mobileAICompletion.ts — original JSON/SSE and reasoning policies over one captured, keyless native connection.
export type MobileAITransport = Pick<FoliaNativePlugin, 'getAISettings' | 'aiRequest' | 'cancelAIRequest'>;
export type MobileAIErrorCode = 'ai-key-missing' | 'ai-settings-changed' | 'ai-cancelled' | 'ai-timeout'
  | 'ai-network' | 'ai-auth' | 'ai-rate-limit' | 'ai-http' | 'ai-invalid-response' | 'ai-response-too-large' | 'ai-request-too-large';
export class MobileAIError extends Error {
  constructor(readonly code: MobileAIErrorCode) { super(code); }
}
const codes: MobileAIErrorCode[] = ['ai-key-missing', 'ai-settings-changed', 'ai-cancelled', 'ai-timeout',
  'ai-network', 'ai-auth', 'ai-rate-limit', 'ai-http', 'ai-invalid-response', 'ai-response-too-large', 'ai-request-too-large'];
export interface MobileAIPrompt {
  system: string; source: string; schema: object; schemaName: string;
  geminiConfig: object; maxTokens: number; compatibleMaxTokens?: number; disableReasoning?: boolean;
}
const httpError = (status: number) => new MobileAIError([401, 403].includes(status) ? 'ai-auth'
  : status === 429 ? 'ai-rate-limit' : 'ai-http');

// A multi-batch operation captures settings once. Later batches cannot silently move to another account/provider.
export function createMobileAICompletion(transport: MobileAITransport = native) {
  let captured: ReturnType<MobileAITransport['getAISettings']> | undefined, learned = 0;
  return async (input: MobileAIPrompt, signal?: AbortSignal) => {
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
      const settings = await (captured ??= transport.getAISettings());
      assertActive();
      if (!settings[settings.provider].hasKey) throw new MobileAIError('ai-key-missing');
      const send = async (body: string) => {
        assertActive();
        if (new TextEncoder().encode(body).byteLength > 256 * 1024) throw new MobileAIError('ai-request-too-large');
        requestId = crypto.randomUUID();
        const result = await transport.aiRequest({ id: requestId, revision: settings.revision, provider: settings.provider, body });
        assertActive(); requestId = null;
        return new Response([204, 205, 304].includes(result.status) ? null : result.body,
          { status: result.status, headers: { 'Content-Type': result.contentType } });
      };
      if (settings.provider === 'gemini') {
        const response = await send(JSON.stringify({ systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ parts: [{ text: input.source }] }], generationConfig: input.geminiConfig }));
        if (!response.ok) throw httpError(response.status);
        let content: string | undefined;
        try {
          const data = await response.json();
          content = data?.candidates?.[0]?.content?.parts?.find((part: { text?: unknown }) => typeof part?.text === 'string')?.text;
        } catch { throw new MobileAIError('ai-invalid-response'); }
        if (!content) throw new MobileAIError('ai-invalid-response');
        assertActive(); return { content, provider: settings.provider };
      }
      const config = settings.openai, provider = detectOpenAICompatibleProvider(config.apiURL);
      const attempts = input.disableReasoning ? REASONING_SUPPRESSION_ATTEMPTS : [{ params: {} }];
      for (let index = input.disableReasoning ? learned : 0; index < attempts.length; index++) {
        const { params } = attempts[index], last = index === attempts.length - 1;
        const reasoning = input.disableReasoning && provider === 'deepseek' ? { thinking: { type: 'disabled' }, ...params } : params;
        const budget = (provider === 'openai' ? input.maxTokens : input.compatibleMaxTokens ?? input.maxTokens)
          * (last && input.disableReasoning ? 4 : 1);
        const body = buildOpenAICompatibleRequestBody(config.model, provider, input.system, input.source, config.temperature,
          input.schema, input.schemaName, budget, reasoning, config.stream);
        const response = await sendOpenAICompatibleRequest({ apiUrl: config.apiURL, provider, body,
          init: { method: 'POST', signal: controller.signal }, fetchImpl: async (_url, init) => send(String(init?.body)) });
        if (!response.ok) {
          const detail = await response.text();
          if (!last && Object.keys(params).some(key => rejectsOpenAICompatibleParameter(response.status, detail, key))) continue;
          throw httpError(response.status);
        }
        let result;
        try {
          if (config.stream) {
            const accumulator = createOpenAIStreamAccumulator(); accumulator.push(await response.text()); result = accumulator.finish();
          } else {
            const data = await response.json(), choice = data?.choices?.[0];
            result = { choice, usage: data?.usage, content: extractResponseContentText(choice?.message) };
          }
        } catch { throw new MobileAIError('ai-invalid-response'); }
        assertActive();
        if (result.content) { if (input.disableReasoning) learned = index; return { content: result.content, provider: settings.provider }; }
        const exhausted = result.choice?.finish_reason === 'length'
          && (result.usage?.completion_tokens_details?.reasoning_tokens || result.choice?.message?.reasoning_content);
        if (!last && exhausted) continue;
        break;
      }
      throw new MobileAIError('ai-invalid-response');
    } catch (error) {
      assertActive();
      const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
      // Native/provider exceptions may include remote text. Only fixed local codes cross the UI boundary.
      throw new MobileAIError(codes.includes(message as MobileAIErrorCode) ? message as MobileAIErrorCode : 'ai-network');
    } finally { clearTimeout(deadline); signal?.removeEventListener('abort', cancel); }
  };
}
