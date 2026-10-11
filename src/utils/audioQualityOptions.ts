import type { AudioQualityPreference } from '../types/onlineMusic';

// src/utils/audioQualityOptions.ts — original online quality preferences shared by desktop and mobile.
export const AUDIO_QUALITY_OPTIONS: Array<{ value: AudioQualityPreference; labelKey: string }> = [
  { value: 'standard', labelKey: 'account.qualityStandard' },
  { value: 'high', labelKey: 'account.qualityExhigh' },
  { value: 'lossless', labelKey: 'account.qualityLossless' },
  { value: 'hires', labelKey: 'account.qualityHires' },
];
