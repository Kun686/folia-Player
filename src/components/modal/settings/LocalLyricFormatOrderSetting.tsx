import React, { useEffect, useRef, useState } from 'react';
import { Reorder, useDragControls } from 'framer-motion';
import { ArrowDown, ArrowUp, GripVertical, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { resyncAllFolders } from '../../../services/localMusicService';
import { useLyricSettingsStore } from '../../../stores/useLyricSettingsStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { DEFAULT_LOCAL_LYRIC_FORMAT_ORDER, isSameLocalLyricFormatOrder, type LocalLyricFileFormat } from '../../../utils/lyrics/localLyricFormatOrder';

// src/components/modal/settings/LocalLyricFormatOrderSetting.tsx
// Reorders the sidecar lyric formats the local import prefers when one track has several lyric files.

type LocalLyricFormatOrderSettingProps = {
    getOptionStyle: (selected: boolean) => React.CSSProperties;
    touchControls?: boolean;
    // A custom scanner returns true only when the entire batch completes.
    onResync?: () => Promise<boolean>;
    resyncDisabled?: boolean;
};

type FormatRowProps = {
    format: LocalLyricFileFormat;
    rank: number;
    style: React.CSSProperties;
    onDragEnd: () => void;
    move?: { up?: () => void; down?: () => void };
};

// Drags only from the grip, so touch scrolling over the rest of the row still scrolls the settings panel.
const FormatRow: React.FC<FormatRowProps> = ({ format, rank, style, onDragEnd, move }) => {
    const { t } = useTranslation();
    const dragControls = useDragControls();

    return (
        <Reorder.Item
            value={format}
            dragListener={false}
            dragControls={dragControls}
            onDragEnd={onDragEnd}
            className="relative flex items-center gap-3 rounded-xl border px-3 py-1.5"
            style={style}
        >
            <span className="w-4 text-center font-mono text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                {rank}
            </span>
            <span className="flex-1 font-mono text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                .{format}
            </span>
            {move ? <div className="flex gap-1">
                <button type="button" disabled={!move.up} onClick={move.up} aria-label={t('options.localLyricFormatMoveUp', { format: `.${format}` })}><ArrowUp size={18} /></button>
                <button type="button" disabled={!move.down} onClick={move.down} aria-label={t('options.localLyricFormatMoveDown', { format: `.${format}` })}><ArrowDown size={18} /></button>
            </div> : <div
                onPointerDown={event => dragControls.start(event)}
                className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-lg transition-colors hover:bg-white/10 active:cursor-grabbing"
                style={{ color: 'var(--text-primary)' }}
                aria-label={t('options.localLyricFormatDragHandle', { format: `.${format}` })}
            >
                <GripVertical size={14} className="opacity-60" />
            </div>}
        </Reorder.Item>
    );
};

const LocalLyricFormatOrderSetting: React.FC<LocalLyricFormatOrderSettingProps> = ({ getOptionStyle, touchControls, onResync, resyncDisabled }) => {
    const { t } = useTranslation();
    const { order, onOrderChange } = useLyricSettingsStore(useShallow(state => ({
        order: state.localLyricFormatOrder,
        onOrderChange: state.handleSetLocalLyricFormatOrder,
    })));
    // The drag reorders a local draft; the store (and localStorage) is written once on drop.
    // The ref gives the drop handler the latest draft even if it closed over an earlier render.
    const [draftOrder, setDraftOrder] = useState(order);
    const draftOrderRef = useRef(order);
    const updateDraftOrder = (next: LocalLyricFileFormat[]) => {
        draftOrderRef.current = next;
        setDraftOrder(next);
    };
    useEffect(() => {
        draftOrderRef.current = order;
        setDraftOrder(order);
    }, [order]);
    const isDefaultOrder = isSameLocalLyricFormatOrder(order, DEFAULT_LOCAL_LYRIC_FORMAT_ORDER);
    // The order only applies on the next scan, so a change made here offers to rescan right away.
    const [needsResync, setNeedsResync] = useState(false);
    const [isResyncing, setIsResyncing] = useState(false);
    const [saveFailed, setSaveFailed] = useState(false);

    const applyOrder = (next: LocalLyricFileFormat[]) => {
        if (isSameLocalLyricFormatOrder(next, useLyricSettingsStore.getState().localLyricFormatOrder)) {
            return;
        }
        try { onOrderChange(next); setSaveFailed(false); setNeedsResync(true); }
        catch { updateDraftOrder(useLyricSettingsStore.getState().localLyricFormatOrder); setSaveFailed(true); }
    };

    const commitDraftOrder = () => applyOrder(draftOrderRef.current);
    const moveFormat = (format: LocalLyricFileFormat, direction: number) => {
        const next = [...useLyricSettingsStore.getState().localLyricFormatOrder], index = next.indexOf(format), target = index + direction;
        if (index < 0 || target < 0 || target >= next.length) return;
        next.splice(target, 0, next.splice(index, 1)[0]); applyOrder(next);
    };

    // Folder scans broadcast LOCAL_MUSIC_UPDATED_EVENT themselves, so the library reloads without a callback here.
    const handleResync = async () => {
        const scannedOrder = useLyricSettingsStore.getState().localLyricFormatOrder;
        setIsResyncing(true);
        try {
            if (onResync) {
                if (await onResync() && isSameLocalLyricFormatOrder(scannedOrder, useLyricSettingsStore.getState().localLyricFormatOrder)) setNeedsResync(false);
                return;
            }
            const importedSongs = await resyncAllFolders();
            if (isSameLocalLyricFormatOrder(scannedOrder, useLyricSettingsStore.getState().localLyricFormatOrder)) setNeedsResync(false);
            setStatusMessage({
                type: importedSongs === null ? 'info' : 'success',
                text: t(importedSongs === null ? 'options.localLyricFormatResyncNoFolders' : 'options.localLyricFormatResyncDone'),
            });
        } catch (error) {
            console.error('[LocalLyricFormatOrder] Failed to resync local folders:', error);
            setStatusMessage({ type: 'error', text: t('options.localLyricFormatResyncFailed') });
        } finally {
            setIsResyncing(false);
        }
    };

    return (
        <div role="region" aria-label={t('options.localLyricFormatOrder')} className="p-4 space-y-3 border-t select-none" style={{ borderColor: 'var(--border-primary, rgba(255,255,255,0.06))' }}>
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.localLyricFormatOrder')}
                    </div>
                    <div className="text-[11px] opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.localLyricFormatOrderDesc')}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => applyOrder([...DEFAULT_LOCAL_LYRIC_FORMAT_ORDER])}
                    disabled={isDefaultOrder}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    <RotateCcw size={12} />
                    {t('options.localLyricFormatOrderReset')}
                </button>
            </div>
            <Reorder.Group axis="y" values={draftOrder} onReorder={updateDraftOrder} className="space-y-1.5">
                {draftOrder.map((format, index) => (
                    <FormatRow
                        key={format}
                        format={format}
                        rank={index + 1}
                        style={getOptionStyle(false)}
                        onDragEnd={commitDraftOrder}
                        move={touchControls ? { up: index > 0 ? () => moveFormat(format, -1) : undefined,
                            down: index < draftOrder.length - 1 ? () => moveFormat(format, 1) : undefined } : undefined}
                    />
                ))}
            </Reorder.Group>
            {saveFailed && <p role="alert">{t('options.localLyricFormatSaveFailed')}</p>}
            {needsResync && (
                <div className="flex items-center justify-between gap-4 rounded-xl border px-3 py-2" style={getOptionStyle(true)}>
                    <div className="text-[11px] opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.localLyricFormatResyncHint')}
                    </div>
                    <button
                        type="button"
                        onClick={() => void handleResync()}
                        disabled={isResyncing || resyncDisabled}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors hover:bg-white/10 disabled:cursor-wait disabled:opacity-50"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <RefreshCw size={12} className={isResyncing ? 'animate-spin' : undefined} />
                        {t(isResyncing ? 'options.localLyricFormatResyncing' : 'options.localLyricFormatResync')}
                    </button>
                </div>
            )}
        </div>
    );
};

export default LocalLyricFormatOrderSetting;
