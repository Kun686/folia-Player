import type { SongResult } from '../types';

// src/services/mobileRuntime.ts — injected only by the bundled mobile entry.
export interface MobileRuntime {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  read(provider: string, key: string): string | null;
  write(provider: string, key: string, value: string | null): void;
  covers?: {
    load(song: SongResult): Promise<string | null>;
    usage(): Promise<number>;
    clear(): Promise<void>;
  };
}
let runtime: MobileRuntime | null = null;
export const installMobileRuntime = (value: MobileRuntime) => { runtime = value; };
export const getMobileRuntime = () => runtime;
export const providerFetch = (input: string, init?: RequestInit): Promise<Response> =>
  runtime ? runtime.fetch(input, init) : fetch(input, init);
