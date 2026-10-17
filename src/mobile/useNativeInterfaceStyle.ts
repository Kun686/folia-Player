import { useEffect } from 'react';
import { isNative, native } from './bridge';

// useNativeInterfaceStyle.ts — match system pickers to the same resolved theme as the mobile shell.
export function useNativeInterfaceStyle(light: boolean) {
  useEffect(() => {
    if (!isNative) return;
    void native.setInterfaceStyle({ light }).catch(() => {
      console.warn('Unable to match native interface appearance');
    });
  }, [light]);
}
