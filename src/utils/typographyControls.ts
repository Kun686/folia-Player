import type { Theme } from '../types';

// typographyControls.ts — shared labels and constraints used by desktop and touch typography controls.
export const LYRICS_FONT_SIZE_AUTO_NOTICE_KEYS: Partial<Record<string, string>> = {
    sonnet: 'options.sonnetFontSizeAutoNotice',
    tempera: 'options.temperaFontSizeAutoNotice',
    lumiere: 'options.lumiereFontSizeAutoNotice',
};

export const FONT_STYLE_OPTIONS: { value: Theme['fontStyle']; labelKey: string }[] = [
    { value: 'sans', labelKey: 'options.fontSans' },
    { value: 'serif', labelKey: 'options.fontSerif' },
    { value: 'mono', labelKey: 'options.fontMono' },
];
