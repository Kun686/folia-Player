// nativeAI.ts — the native AI contract exposes configuration metadata; persisted keys never return to the WebView.
export interface NativeAISettings {
  provider: 'gemini' | 'openai'; revision: number;
  gemini: { hasKey: boolean };
  openai: { hasKey: boolean; apiURL: string; model: string; temperature: number; stream: boolean };
}
export type NativeAISettingsEdit = { provider: 'gemini'; apiKey?: string } | {
  provider: 'openai'; apiURL?: string; model?: string; temperature?: number; stream?: boolean; apiKey?: string;
};
export interface NativeAIResponse { status: number; body: string; contentType: string }
