import { Check, Disc3, Download, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// AutomixModelRows.tsx — original model rows shared by desktop IPC and native model storage.
export interface AutomixModelRow {
    name: string; bytes: number; enables: string; supported: boolean; installed: boolean; detail?: string;
    busy: boolean; received: number; total: number; host: string; reasons: string[];
}
/** A byte count as something a person reads. Sizes here are always tens or hundreds of MB. */
const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/**
 * The features a weight switches on, one chip each.
 *
 * Keyed by feature rather than by model because they are not one-to-one: stems drive automix's
 * vocal exit and the performance build-up both, and the beat grid drives automix alone. The icon
 * belongs to the feature too, so the same mark means the same thing down the column.
 */
const scopesOf = (enables: string) => (enables === 'stems'
    ? [
        { key: 'options.modelScopeAutomix', Icon: Disc3 },
        { key: 'options.modelScopePerformance', Icon: Sparkles },
    ]
    : [{ key: 'options.modelScopeAutomix', Icon: Disc3 }]);

/**
 * Keyed by name for the runtime and by capability for the rest.
 *
 * The runtime enables stems the same as the weights do, so `enables` cannot tell them apart - and
 * they are not the same thing to a listener. One is what separation knows; the other is what runs
 * it. A row calling both 人声分离 would look like the page listing the same download twice.
 */
const rowTitle = (model: AutomixModelRow) => {
    if (model.name === 'runtime') return 'options.modelEnablesRuntime';
    return model.enables === 'stems' ? 'options.modelEnablesStems' : 'options.modelEnablesBeatGrid';
};

export default function AutomixModelRows({ models, isDaylight, download, cancel }: {
    models: AutomixModelRow[]; isDaylight: boolean; download: (name: string) => void; cancel: (name: string) => void;
}) {
    const { t } = useTranslation();
    const borderColor = isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)';
    const trackColor = isDaylight ? 'rgba(24, 24, 27, 0.10)' : 'rgba(255, 255, 255, 0.12)';
    const scopeChipColor = isDaylight ? 'rgba(24, 24, 27, 0.06)' : 'rgba(255, 255, 255, 0.07)';
    return <>
            {models.map((model) => {
                const { busy, received, total, host, reasons } = model;
                const percent = total > 0 ? Math.min(100, received / total * 100) : 0;

                return (
                    <div key={model.name} className="rounded-lg border px-3 py-2.5 space-y-2" style={{ borderColor }}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[13px] font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    {model.installed && <Check size={13} className="shrink-0 opacity-70" />}
                                    {t(rowTitle(model))}
                                    {/* No size on a row with nothing to download. "0 MB" beside a
                                        thing this machine cannot have reads like a bug. */}
                                    {model.supported && (
                                        <span className="font-mono text-[11px] opacity-50 tabular-nums">{megabytes(model.bytes)}</span>
                                    )}
                                </div>
                                {/* What this weight is for (chips keyed by feature - see scopesOf),
                                    said on the row because these are separate 83MB / 166MB downloads
                                    and "which of these do I need" is otherwise unanswered. Neither
                                    model touches a crossfade - that planner reads the profile's
                                    silence edges and nothing else. */}
                                <div className="mt-1 flex items-center gap-2">
                                    {scopesOf(model.enables).map(({ key, Icon }) => (
                                        <span
                                            key={key}
                                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] shrink-0"
                                            style={{ backgroundColor: scopeChipColor, color: 'var(--text-secondary)' }}
                                        >
                                            <Icon size={10} />
                                            {t(key)}
                                        </span>
                                    ))}
                                    <span className="text-[11px] opacity-50 truncate" style={{ color: 'var(--text-secondary)' }}>
                                        {model.supported
                                            ? model.detail ?? t(model.installed ? 'options.modelInstalled' : 'options.modelMissing')
                                            : t('options.modelUnsupportedWhy')}
                                    </span>
                                </div>
                            </div>
                            {/* Three states, not two. A machine with no build for it gets told so
                                where the button would be - the one place someone looking for the
                                download is already looking. */}
                            {!model.supported ? (
                                <span className="text-[11px] opacity-60 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.modelUnsupported')}
                                </span>
                            ) : model.installed ? (
                                <span className="text-[11px] opacity-60 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.modelInstalled')}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => (busy
                                        ? cancel(model.name)
                                        : download(model.name))}
                                    className="shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors"
                                    style={{ borderColor, color: 'var(--text-primary)' }}
                                >
                                    {busy ? <X size={12} /> : <Download size={12} />}
                                    {t(busy ? 'options.modelCancel' : 'options.modelDownload')}
                                </button>
                            )}
                        </div>

                        {busy && (
                            <div className="space-y-1">
                                <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: trackColor }}>
                                    <div
                                        className="h-full rounded-full transition-[width] duration-200"
                                        style={{ width: `${percent}%`, backgroundColor: 'var(--text-primary)', opacity: 0.55 }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] font-mono tabular-nums opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    <span>{host}</span>
                                    <span>{percent.toFixed(0)}%</span>
                                </div>
                            </div>
                        )}

                        {reasons.length > 0 && (
                            <div className="text-[10px] font-mono leading-relaxed opacity-60 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                                {reasons.map((reason, index) => <div key={index} className="truncate">{reason}</div>)}
                            </div>
                        )}
                    </div>
                );
            })}

    </>;
}
