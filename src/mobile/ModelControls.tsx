import { useState } from 'react';
import { FileUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AutomixModelRows from '../components/modal/settings/AutomixModelRows';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import type { useNativeModels } from './useNativeModels';

// ModelControls.tsx — original model rows, with system-file import in place of desktop folder scanning.
export default function ModelControls({ models, light }: { models: ReturnType<typeof useNativeModels>; light: boolean }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const { state } = models;
  return <section className="mobile-model-controls rounded-lg border border-current/15 p-3 space-y-3" aria-label={t('options.modelsTitle')}>
    <h3 className="text-sm font-medium">{t('options.modelsTitle')}</h3>
    <p className="text-xs opacity-70">{t('mobile.models.hint')}</p>
    {models.error && <p role="alert">{t('mobile.models.failed')}</p>}
    {models.error && <button onClick={models.retry}>{t('mobile.retry')}</button>}
    {!state?.ready && <p role="status">{t('mobile.loading')}</p>}
    <fieldset disabled={!state?.ready || models.removing} className="space-y-3">
      <AutomixModelRows isDaylight={light} download={models.download} cancel={models.cancel}
        models={(state?.models ?? []).map(model => ({ ...model, supported: true,
          busy: ['queued', 'downloading', 'verifying'].includes(model.phase), total: model.bytes, reasons: model.failures }))} />
      <div className="flex flex-wrap gap-2">
        <button className="flex items-center gap-2 rounded-lg border border-current/15 px-3" disabled={models.importing} onClick={() => void models.importFile()}>
          <FileUp size={16} />{t(models.importing ? 'mobile.loading' : 'mobile.models.import')}
        </button>
        {state?.models.some(model => model.installed) && <button className="flex items-center gap-2 rounded-lg border border-current/15 px-3" onClick={() => setConfirm(true)}>
          <Trash2 size={16} />{t('options.modelRemoveAll')}
        </button>}
      </div>
    </fieldset>
    <div role={confirm ? 'dialog' : undefined} aria-modal={confirm || undefined} aria-label={confirm ? t('options.modelRemoveAll') : undefined}>
      <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); void models.removeAll(); }}
        isDaylight={light} title={t('options.modelRemoveAll')} description={t('mobile.models.removeConfirm')} confirmVariant="danger" />
    </div>
  </section>;
}
