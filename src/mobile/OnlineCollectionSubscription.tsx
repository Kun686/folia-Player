import { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProviderCollection, ProviderUser } from '../types/onlineMusic';
import type { CollectionMutationController, CollectionMutationSnapshot } from '../library/core/contracts/mutations';
import type { MobilePlaylistEditor } from './mobilePlaylistEditor';

// OnlineCollectionSubscription.tsx — touch subscription controls backed by the original mutation controller.
interface Props { collection: ProviderCollection; editor: MobilePlaylistEditor; writable: boolean; user?: ProviderUser | null }
function Subscription({ collection, editor }: Props) {
  const { t } = useTranslation(), controller = useRef<CollectionMutationController | null>(null);
  const [state, setState] = useState<CollectionMutationSnapshot | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'hidden' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let generation = 0, unsubscribe = () => {};
    const dispose = () => { generation++; unsubscribe(); controller.current?.dispose(); controller.current = null; };
    const start = () => {
      dispose(); setState(null); setPhase('loading');
      if (document.hidden) return;
      const ticket = generation;
      void editor.readAccount(collection.providerId).then(async account => {
        if (ticket !== generation) return;
        const current = await editor.subscription(collection, account);
        if (ticket !== generation) { current?.dispose(); return; }
        if (!current) { setPhase('hidden'); return; }
        controller.current = current;
        unsubscribe = current.subscribe(() => setState(current.getSnapshot()));
        setState(current.getSnapshot()); setPhase('ready');
      }).catch(() => { if (ticket === generation) setPhase('error'); });
    };
    start(); document.addEventListener('visibilitychange', start);
    return () => { document.removeEventListener('visibilitychange', start); dispose(); };
  }, [collection, editor, retry]);
  const change = async () => {
    const current = controller.current;
    if (!current || phase !== 'ready' || state?.subscribed == null || !state.capabilities.subscribe.enabled) return;
    const result = await current.toggleSubscribe();
    if (current === controller.current && !result.ok) setPhase('error');
  };
  if (phase === 'hidden') return null;
  return <div className="online-song-like" aria-label={t('mobile.subscriptionState')}>
    {phase === 'error' ? <><p role="alert">{t('mobile.subscriptionError')}</p>
      <button onClick={() => setRetry(value => value + 1)}>{t('mobile.subscriptionReload')}</button></>
      : phase === 'loading' || state?.subscribed == null ? <p role="status">{t('mobile.loading')}</p>
      : <button aria-pressed={state.subscribed} disabled={!state.capabilities.subscribe.enabled} onClick={() => void change()}>
        <Heart size={18} fill={state.subscribed ? 'currentColor' : 'none'} aria-hidden="true" />
        {t(state.subscribing ? 'mobile.loading' : state.subscribed ? 'mobile.collectionUnsubscribe' : 'mobile.collectionSubscribe')}
      </button>}
  </div>;
}
export default function OnlineCollectionSubscription(props: Props) {
  const { t } = useTranslation();
  if (!props.editor.supportsSubscription(props.collection) ||
      (props.user && !props.editor.canSubscribe(props.collection, props.user))) return null;
  if (!props.writable) return <p className="muted">{t('mobile.subscriptionUnavailable')}</p>;
  return <Subscription {...props} />;
}
