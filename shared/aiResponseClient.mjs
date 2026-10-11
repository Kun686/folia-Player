// aiResponseClient.mjs — unchanged desktop request and response helpers; no network, credentials, Node APIs or logging.
const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_OPENAI_TEMPERATURE = 0.7;

function normalizeOpenAIChatCompletionsUrl(rawUrl) {
  const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmedUrl) {
    return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
  }

  try {
    const parsed = new URL(trimmedUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');

    if (!normalizedPath || normalizedPath === '/') {
      parsed.pathname = '/v1/chat/completions';
      return parsed.toString();
    }

    if (/\/v\d+$/.test(normalizedPath)) {
      parsed.pathname = `${normalizedPath}/chat/completions`;
      return parsed.toString();
    }

    parsed.pathname = normalizedPath;
    return parsed.toString();
  } catch {
    return trimmedUrl.replace(/\/+$/, '');
  }
}

function resolveOpenAICompatibleModel(apiUrl, configuredModel) {
  const trimmedModel = typeof configuredModel === 'string' ? configuredModel.trim() : '';
  if (trimmedModel) {
    return trimmedModel;
  }

  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return DEEPSEEK_DEFAULT_MODEL;
    }
  } catch {
    // Fall back to the generic OpenAI default when URL parsing fails.
  }

  return DEFAULT_OPENAI_MODEL;
}

function detectOpenAICompatibleProvider(apiUrl) {
  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return 'deepseek';
    }
    if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
      return 'openai';
    }
  } catch {
    // Fall through to generic provider handling.
  }
  return 'generic';
}

function providerSupportsStructuredOutputs(provider) {
  return provider === 'openai';
}

function resolveOpenAICompatibleTemperature(value) {
  const temperature = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(temperature) && temperature >= 0 && temperature <= 2
    ? temperature
    : DEFAULT_OPENAI_TEMPERATURE;
}

function extractProviderErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const error = payload.error;
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error.message;
  }

  return typeof payload.message === 'string' ? payload.message : null;
}

/**
 * Explains an empty completion instead of just reporting one.
 *
 * "Model returned an empty response" is true and useless. The case that actually happens is a
 * reasoning model spending its whole output budget on `reasoning_content` and never reaching the
 * answer, which looks identical from the outside — so say so, and name the parameter that fixes it.
 */
function describeEmptyCompletion(choice, usage, model) {
  const reasoningTokens = usage
    && usage.completion_tokens_details
    && usage.completion_tokens_details.reasoning_tokens;
  const finishReason = choice && choice.finish_reason;
  const hasReasoning = Boolean(
    reasoningTokens || (choice && choice.message && choice.message.reasoning_content),
  );

  if (hasReasoning && finishReason === 'length') {
    return `Model "${model}" used its entire output budget on reasoning`
      + `${reasoningTokens ? ` (${reasoningTokens} reasoning tokens)` : ''} and returned no answer.`
      + ' This is a reasoning model doing a mechanical task. Point the app at a non-reasoning model,'
      + ' or raise the token limit if the provider ignores reasoning_effort.';
  }
  if (finishReason === 'length') {
    return `Model "${model}" hit the output token limit before finishing its answer.`;
  }
  return `Model "${model}" returned an empty response`
    + `${finishReason ? ` (finish_reason: ${finishReason})` : ''}.`;
}

function extractResponseContentText(message) {
  if (!message) {
    return null;
  }

  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new Error(`Model refused request: ${message.refusal}`);
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((part) => part && typeof part === 'object')
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    return text || null;
  }

  return null;
}

/**
 * Chat-completions body for any OpenAI-compatible endpoint. `schema` and `schemaName` are only
 * used on providers that support structured outputs; everywhere else they are ignored and the
 * request falls back to plain JSON mode.
 */
function buildOpenAICompatibleRequestBody(model, provider, systemPrompt, sourcePrompt, temperature, schema, schemaName, maxTokens, extraParams, stream) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: sourcePrompt },
  ];

  // Bounds the worst case. In plain JSON mode some providers (DeepSeek notably) can emit a long
  // run of whitespace before any content and keep going until the cap; with no cap set that is an
  // unbounded body read, which presents as a request that never finishes. A caller that knows how
  // big its answer should be passes a ceiling; truncation then fails as a JSON parse error with
  // the raw response logged, which is diagnosable, unlike a hang.
  const limit = maxTokens
    ? { [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: maxTokens }
    : {};
  const reasoning = extraParams || {};
  // Only the bare flag; no stream_options, to keep the surface other providers must accept minimal.
  const streaming = stream === true ? { stream: true } : {};

  if (schema && schemaName && providerSupportsStructuredOutputs(provider)) {
    return {
      model,
      messages,
      temperature,
      ...limit,
      ...reasoning,
      ...streaming,
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    };
  }

  return {
    model,
    messages,
    temperature,
    ...limit,
    ...reasoning,
    ...streaming,
    response_format: { type: 'json_object' },
  };
}

/**
 * Incremental reader for an OpenAI-style SSE chat-completions stream (pure, no I/O).
 *
 * The result must still be structured JSON, so nothing is surfaced until the stream ends: this only
 * stitches `choices[0].delta.content` back into the same `{ choice, content }` shape a non-streamed
 * response produces, and the caller feeds that through the identical validation path. `push` takes
 * decoded text chunks of any size (lines may be split across chunks, line endings may be \n, \r\n or
 * \r); `finish` flushes the tail and returns the outcome. A mid-stream `{"error":...}` event throws.
 * `reasoning_content` is deliberately not appended to the answer, only remembered so an
 * "all budget spent on reasoning" completion is diagnosed the same way as in the non-streamed case.
 */
function createOpenAIStreamAccumulator() {
  let buffer = '';
  let content = '';
  let refusal = '';
  let reasoning = '';
  let finishReason = null;
  let usage;
  let model;
  let sawData = false;
  let done = false;
  // Lines that are not SSE fields at all. Some proxies ignore `stream: true` and answer with one
  // plain JSON body; this keeps that body so it can still be understood at the end.
  let foreign = '';

  const handleData = (payloadText) => {
    sawData = true;
    // Nothing after [DONE] belongs to the answer (some relays append usage or junk frames).
    if (done) {
      return;
    }
    if (payloadText === '[DONE]') {
      done = true;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') {
      return;
    }
    if (payload.error) {
      throw new Error(`OpenAI compatible API error (stream): ${extractProviderErrorMessage(payload) || JSON.stringify(payload.error)}`);
    }
    if (payload.usage && typeof payload.usage === 'object') {
      usage = payload.usage;
    }
    if (typeof payload.model === 'string' && payload.model) {
      model = payload.model;
    }
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
    if (!choice) {
      return;
    }
    const delta = choice.delta;
    if (delta && typeof delta === 'object') {
      if (typeof delta.content === 'string') {
        content += delta.content;
      }
      if (typeof delta.refusal === 'string') {
        refusal += delta.refusal;
      }
      if (typeof delta.reasoning_content === 'string') {
        reasoning += delta.reasoning_content;
      }
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  };

  const handleLine = (line) => {
    if (!line || line.startsWith(':')) {
      return;
    }
    if (line.startsWith('data:')) {
      handleData(line.slice(5).replace(/^ /, '').trim());
      return;
    }
    if (/^(event|id|retry)(:|$)/.test(line)) {
      return;
    }
    if (!sawData) {
      foreign += `${line}\n`;
    }
  };

  const drain = (final) => {
    const lines = buffer.split(/\r\n|\n|\r/);
    buffer = final ? '' : lines.pop();
    for (const line of lines) {
      handleLine(line);
    }
    if (final && buffer) {
      handleLine(buffer);
    }
  };

  return {
    push(text) {
      buffer += text;
      drain(false);
    },
    finish() {
      drain(true);

      if (!sawData && foreign.trim().startsWith('{')) {
        let parsed = null;
        try {
          parsed = JSON.parse(foreign);
        } catch {
          // Not JSON either; fall through to the empty-completion diagnosis.
        }
        if (parsed && parsed.error) {
          throw new Error(`OpenAI compatible API error (stream): ${extractProviderErrorMessage(parsed) || JSON.stringify(parsed.error)}`);
        }
        const choice = parsed && Array.isArray(parsed.choices) ? parsed.choices[0] : null;
        if (choice) {
          return { choice, usage: parsed.usage, model: typeof parsed.model === 'string' ? parsed.model : undefined, content: extractResponseContentText(choice.message), done: true };
        }
      }

      const message = { content };
      if (refusal) {
        message.refusal = refusal;
      }
      if (reasoning) {
        message.reasoning_content = reasoning;
      }
      const choice = { finish_reason: finishReason, message };
      return { choice, usage, model, content: extractResponseContentText(message), done };
    },
  };
}

export { normalizeOpenAIChatCompletionsUrl, resolveOpenAICompatibleModel, detectOpenAICompatibleProvider, providerSupportsStructuredOutputs, resolveOpenAICompatibleTemperature, extractProviderErrorMessage, describeEmptyCompletion, extractResponseContentText, buildOpenAICompatibleRequestBody, createOpenAIStreamAccumulator };
