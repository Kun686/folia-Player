import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PERSONAL_FM_MODES, PERSONAL_FM_SCENES, PERSONAL_FM_SCENE_CATEGORIES, getPersonalFmSelectionLabel,
  type PersonalFmSelection } from '../services/onlineMusic/fmModes';
import { usePersonalFmModeStore } from '../stores/usePersonalFmModeStore';
import { native, type PlaybackSnapshot } from './bridge';
import { flushSessions } from './runtime';

// PersonalFM.tsx — original mode catalogue and preferences, with the native player owning the continuous queue.
interface Props {
  provider: string; enabled: boolean; signedIn: boolean; state: PlaybackSnapshot; busy: boolean;
  work(action: () => Promise<unknown>): Promise<boolean>; playing(): void;
}
export default function PersonalFM(props: Props) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false);
  const { selection, setSelection } = usePersonalFmModeStore();
  const radio = props.state.personalFM, busy = props.busy || !!radio?.loading;
  const enabled = props.enabled && !!radio && props.signedIn;
  useEffect(() => { setOpen(false); }, [props.provider, enabled]);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const start = async (next: PersonalFmSelection, close = false) => {
    setFailed(false);
    const ok = await props.work(async () => { await flushSessions(['netease']); return native.startPersonalFM({ selection: next }); });
    setFailed(!ok);
    if (ok && close) { setOpen(false); props.playing(); }
  };
  const choose = (next: PersonalFmSelection) => {
    const applied = setSelection(next);
    if (radio?.active) void start(applied);
  };
  if (props.provider !== 'netease') return null;
  return <>
    <button disabled={!enabled} onClick={() => { setFailed(false); setOpen(true); }}>{t('mobile.fmTitle')}</button>
    {(!props.enabled || !radio) && <p className="muted">{t('mobile.fmUnavailable')}</p>}
    {props.enabled && !props.signedIn && <p className="muted">{t('mobile.dailySignIn')}</p>}
    <dialog ref={dialog} className="sheet personal-fm-sheet" aria-label={t('mobile.fmTitle')} onClose={() => setOpen(false)} onCancel={() => setOpen(false)}>
      <header><h2>{t('mobile.fmTitle')}</h2><button onClick={() => setOpen(false)}>{t('mobile.close')}</button></header>
      <div className="mobile-daily-actions">
        <label>{t('mobile.fmMode')}<select aria-label={t('mobile.fmMode')} disabled={busy} value={selection.mode}
          onChange={event => choose({ mode: event.target.value as PersonalFmSelection['mode'], scene: event.target.value === 'SCENE_RCMD' ? selection.scene ?? PERSONAL_FM_SCENES[0].id : null })}>
          {PERSONAL_FM_MODES.map(mode => <option key={mode.id} value={mode.id}>{t(mode.labelKey, mode.labelFallback)}</option>)}
        </select></label>
        {selection.mode === 'SCENE_RCMD' && <label>{t('mobile.fmScene')}<select aria-label={t('mobile.fmScene')} disabled={busy} value={selection.scene ?? ''}
          onChange={event => choose({ mode: 'SCENE_RCMD', scene: event.target.value })}>
          {PERSONAL_FM_SCENE_CATEGORIES.map(group => <optgroup key={group.id} label={t(group.labelKey, group.labelFallback)}>
            {PERSONAL_FM_SCENES.filter(scene => scene.category === group.id).map(scene => <option key={scene.id} value={scene.id}>{t(scene.labelKey, scene.labelFallback)}</option>)}
          </optgroup>)}
        </select></label>}
      </div>
      {radio?.active && radio.selection && <p>{t('mobile.fmCurrent', { mode: getPersonalFmSelectionLabel(radio.selection, (key, fallback) => t(key, fallback ?? '')) })}</p>}
      {radio?.fallback && <p role="status">{t('mobile.fmFallback')}</p>}
      {busy && <p role="status">{t('mobile.loading')}</p>}
      {(failed || radio?.error) && <p role="alert">{t('mobile.fmError')}</p>}
      <div className="mobile-daily-actions">
        <button disabled={busy || !enabled} onClick={() => void start(selection, true)}>{t('mobile.fmStart')}</button>
        {radio?.active && <button disabled={props.busy} onClick={() => void props.work(() => native.leavePersonalFM())}>{t('mobile.fmLeave')}</button>}
      </div>
    </dialog>
  </>;
}
