import { useTranslation } from 'react-i18next';
import type { ActiveLocalLyricsSource } from '../../types';

// LocalLyricSourceSelector.tsx — the original LocalTab choices, shared with the native library tools.
export default function LocalLyricSourceSelector({ sources, active, onChange, isDaylight }: {
    sources: { key: ActiveLocalLyricsSource; label: string }[];
    active: ActiveLocalLyricsSource | null;
    onChange(source: ActiveLocalLyricsSource): void;
    isDaylight: boolean;
}) {
    const { t } = useTranslation();
    const tabActiveBg = isDaylight ? 'bg-blue-500/15 text-blue-600' : 'bg-blue-500/20 text-blue-300';
    const tabInactiveBg = isDaylight ? 'bg-black/5 text-zinc-500 hover:bg-black/10' : 'bg-white/5 text-zinc-400 hover:bg-white/10';
    return sources.length === 0 ? (
        <div className={`text-xs px-3 py-2 rounded-lg bg-white/5 ${isDaylight ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {t('localMusic.statusNone')}
        </div>
    ) : sources.length === 1 ? (
        <div className={`text-xs px-3 py-2 rounded-lg ${tabActiveBg} font-medium`}>{sources[0].label}</div>
    ) : (
        <div className="flex gap-1.5">
            {sources.map(source => <button key={source.key} aria-pressed={active === source.key}
                onClick={() => onChange(source.key)}
                className={`flex-1 text-xs py-1.5 px-2 rounded-lg font-medium transition-all ${active === source.key ? tabActiveBg : tabInactiveBg}`}>
                {source.label}
            </button>)}
        </div>
    );
}
