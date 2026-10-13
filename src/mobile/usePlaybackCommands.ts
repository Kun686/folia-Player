import { useCallback, useEffect, useRef, useState } from 'react';
import { native, type FoliaNativePlugin } from './bridge';

// usePlaybackCommands.ts — feedback belongs to the latest command and current song occurrence.
export function usePlaybackCommands(songEpoch: number) {
  const sequence = useRef(0);
  const [failedEpoch, setFailedEpoch] = useState<number | null>(null);
  useEffect(() => () => { sequence.current++; }, []);
  const send = useCallback((options: Parameters<FoliaNativePlugin['command']>[0]) => {
    const request = ++sequence.current;
    setFailedEpoch(null);
    void native.command(options).catch(() => {
      // An older seek must not replace a newer successful action or mark another song as failed.
      if (request === sequence.current) setFailedEpoch(songEpoch);
    });
  }, [songEpoch]);
  return { send, error: failedEpoch === songEpoch };
}
