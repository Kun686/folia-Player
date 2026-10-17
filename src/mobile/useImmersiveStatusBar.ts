import { useEffect, useState } from 'react';
import { native } from './bridge';

// useImmersiveStatusBar.ts — view-scoped presentation only; never persist a hidden system status bar.
export function useImmersiveStatusBar(hidden: boolean) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setFailed(false);
    void native.setStatusBarHidden({ hidden }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [hidden]);
  useEffect(() => () => {
    // Unmount must restore system chrome even when the playback view was still expanded.
    void native.setStatusBarHidden({ hidden: false }).catch(() => {
      console.warn('Unable to restore system status bar');
    });
  }, []);
  return failed;
}
