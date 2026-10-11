import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DualTheme } from '../../../types';
import { THEME_GENERATION_PROMPT_PREFIX, buildThemeSourcePrompt, parseAiThemeJsonInput } from '../../../utils/aiThemePrompts';
import { sanitizeDualTheme } from '../../../services/themeSanitizer';

// src/components/modal/theme-park/ThemeParkAiPanel.tsx
// AI tab: the manual round trip the quick editor already offered — copy the generation prompt,
// paste an AI JSON result back in, or copy the current draft as JSON.

type ThemeParkAiPanelProps = {
    promptSourceText: string | null;
    isPureMusic: boolean;
    songTitle: string | undefined;
    buildFinalTheme: () => DualTheme;
    fallbackTheme: DualTheme;
    onImportTheme: (theme: DualTheme) => void;
    writeClipboard?: (text: string) => Promise<void>;
    maxInputLength?: number;
};

const ThemeParkAiPanel: React.FC<ThemeParkAiPanelProps> = ({
    promptSourceText,
    isPureMusic,
    songTitle,
    buildFinalTheme,
    fallbackTheme,
    onImportTheme,
    writeClipboard = text => navigator.clipboard.writeText(text),
    maxInputLength,
}) => {
    const { t } = useTranslation();
    const [isPromptCopied, setIsPromptCopied] = useState(false);
    const [isJsonCopied, setIsJsonCopied] = useState(false);
    const [importJsonText, setImportJsonText] = useState('');
    const [importError, setImportError] = useState<string | null>(null);
    const [copyError, setCopyError] = useState(false);
    const timers = useRef<Partial<Record<'prompt' | 'json', ReturnType<typeof setTimeout>>>>({});
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; Object.values(timers.current).forEach(clearTimeout); };
    }, []);
    const copied = (kind: 'prompt' | 'json') => {
        if (!mounted.current) return;
        setCopyError(false);
        const update = kind === 'prompt' ? setIsPromptCopied : setIsJsonCopied;
        update(true); clearTimeout(timers.current[kind]);
        timers.current[kind] = setTimeout(() => update(false), 2000);
    };

    const handleCopyPrompt = async () => {
        try {
            const prompt = `${THEME_GENERATION_PROMPT_PREFIX}\n\n${buildThemeSourcePrompt(promptSourceText || '', isPureMusic, songTitle)}`;
            await writeClipboard(prompt);
            copied('prompt');
        } catch (error) {
            if (mounted.current) setCopyError(true);
        }
    };

    const handleCopyJson = async () => {
        try {
            await writeClipboard(JSON.stringify(buildFinalTheme(), null, 2));
            copied('json');
        } catch (error) {
            if (mounted.current) setCopyError(true);
        }
    };

    // Imported JSON lands in the draft rather than being saved straight away, so it can be
    // previewed and tweaked before it replaces the live theme.
    const handleImport = () => {
        setImportError(null);
        if (!importJsonText.trim()) {
            return;
        }

        try {
            if (maxInputLength !== undefined && importJsonText.length > maxInputLength) throw new Error('theme-input-too-large');
            const parsed = parseAiThemeJsonInput(importJsonText);
            onImportTheme(sanitizeDualTheme(parsed as DualTheme, fallbackTheme));
            setImportJsonText('');
        } catch (error) {
            setImportError(t('options.invalidJsonFormat'));
        }
    };

    return (
        <div className="space-y-4">
            {copyError && <p role="alert">{t('status.copyFailed')}</p>}
            <div className="space-y-3 rounded-[24px] border border-white/10 p-4">
                <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('aiHelp.copyPromptTitle')}
                    </div>
                    <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                        {t('aiHelp.copyPromptDesc')}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleCopyPrompt}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                    style={{ color: 'var(--text-primary)' }}
                >
                    {isPromptCopied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{isPromptCopied ? t('status.copied') : t('aiHelp.copyPrompt')}</span>
                </button>
            </div>

            <div className="space-y-3 rounded-[24px] border border-white/10 p-4">
                <div>
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('aiHelp.importJsonTitle')}
                    </div>
                    <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                        {t('theme.importJsonToDraftHint')}
                    </div>
                </div>
                <textarea
                    aria-label={t('options.pasteJsonHere')}
                    maxLength={maxInputLength}
                    value={importJsonText}
                    onChange={(event) => {
                        setImportJsonText(event.target.value);
                        setImportError(null);
                    }}
                    rows={6}
                    placeholder={t('options.pasteJsonHere')}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-xs outline-none transition-colors focus:border-white/20"
                    style={{ color: 'var(--text-primary)' }}
                    spellCheck={false}
                />
                {importError && (
                    <div className="text-xs" style={{ color: '#f87171' }}>{importError}</div>
                )}
                <button
                    type="button"
                    onClick={handleImport}
                    disabled={!importJsonText.trim()}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <Download size={14} />
                    <span>{t('theme.importJsonToDraft')}</span>
                </button>
            </div>

            <div className="space-y-3 rounded-[24px] border border-white/10 p-4">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('theme.exportDraftJson')}
                </div>
                <button
                    type="button"
                    onClick={handleCopyJson}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                    style={{ color: 'var(--text-primary)' }}
                >
                    {isJsonCopied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{isJsonCopied ? t('status.copied') : t('options.copyThemeJson')}</span>
                </button>
            </div>
        </div>
    );
};

export default ThemeParkAiPanel;
