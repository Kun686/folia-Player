import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeLibrarySnapshot } from '../types/nativeLibrary';
import { EntityEditorWorkspace } from '../components/local-library-entity/EntityEditorWorkspace';
import { useLocalEntityEditor } from './useLocalEntityEditor';

// LocalEntityDialog.tsx — original rename/merge/split workspace inside a touch and keyboard accessible native dialog.
export default function LocalEntityDialog({ snapshot, id, light, close, selected }: {
  snapshot: NativeLibrarySnapshot; id: string; light: boolean; close(): void; selected(id: string): void;
}) {
  const { t } = useTranslation(), dialog = useRef<HTMLDialogElement>(null);
  const editor = useLocalEntityEditor(snapshot, id, selected);
  const { entity, pending, run } = editor;
  useEffect(() => { dialog.current?.showModal(); }, []);
  const dismiss = () => { if (!pending) close(); };
  return <dialog ref={dialog} className="mobile-entity-dialog" aria-label={t('localMusic.editEntityTitle', {
    kind: t(entity?.kind === 'artist' ? 'localMusic.artistLabel' : 'localMusic.albumLabel'),
  })} onCancel={event => { event.preventDefault(); dismiss(); }} onClose={dismiss}>
    <header><h2>{entity?.displayName ?? t('mobile.local')}</h2>
      <button disabled={pending} onClick={dismiss}>{t('mobile.close')}</button></header>
    {editor.error && <div role="alert"><p>{t('mobile.' + editor.error)}</p>
      <button disabled={pending} onClick={() => void run()}>{t('mobile.entityReload')}</button></div>}
    {entity ? <fieldset disabled={pending}>
      <EntityEditorWorkspace entity={entity} sameKindEntities={editor.snapshot.entities.filter(item => item.kind === entity.kind && !item.mergedInto)}
        memberSongs={editor.memberSongs} splitHint={t('mobile.entitySplitHint')} isDaylight={light} pending={pending}
        onRename={displayName => run({ type: 'rename', entityId: entity.id, displayName })}
        onMerge={(sourceId, intoCurrent) => run({ type: 'merge', entityId: intoCurrent ? entity.id : sourceId,
          sourceIds: [intoCurrent ? sourceId : entity.id] }, intoCurrent ? entity.id : sourceId)}
        onSplit={(songIds, targets, mode) => entity.kind === 'artist'
          ? run({ type: 'artists', entityId: entity.id, songIds, targets, mode })
          : targets[0]?.entityId ? run({ type: 'move', entityId: entity.id, songIds, targetId: targets[0].entityId })
            : run({ type: 'split', entityId: entity.id, songIds, displayName: targets[0]?.displayName ?? '' })} />
    </fieldset> : <p role="status">{t('mobile.entityGone')}</p>}
  </dialog>;
}
