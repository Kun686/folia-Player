import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalTrackSortStore } from '../library/core/state/useLocalTrackSortStore';

// LocalTrackSortControls.tsx — original library sort preferences, with touch controls and visible storage failures.
export default function LocalTrackSortControls() {
  const { t } = useTranslation(), field = useLocalTrackSortStore(s => s.field), direction = useLocalTrackSortStore(s => s.direction);
  const [error, setError] = useState(false);
  const save = (action: () => void) => { try { action(); setError(false); } catch { setError(true); } };
  return <div className="mobile-track-sort">
    <label>{t('localMusic.sortSongs')}<select aria-label={t('localMusic.sortSongs')} value={field} onChange={event => {
      const value = event.target.value;
      if (value === 'fileName' || value === 'fileLastModified' || value === 'albumTrack') save(() => useLocalTrackSortStore.getState().setField(value));
    }}>
      <option value="fileName">{t('localMusic.sortByFileName')}</option>
      <option value="fileLastModified">{t('localMusic.sortByModifiedDate')}</option>
      <option value="albumTrack">{t('localMusic.sortByAlbumTrack')}</option>
    </select></label>
    <label>{t('localMusic.sortDirection')}<select aria-label={t('localMusic.sortDirection')} value={direction} onChange={event => {
      const value = event.target.value;
      if (value === 'asc' || value === 'desc') save(() => useLocalTrackSortStore.getState().setDirection(value));
    }}>
      <option value="asc">{t('localMusic.sortAscending')}</option><option value="desc">{t('localMusic.sortDescending')}</option>
    </select></label>
    {error && <p role="alert">{t('localMusic.entityOperationFailed')}</p>}
  </div>;
}
