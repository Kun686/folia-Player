import { useState, type Dispatch, type SetStateAction } from 'react';
import { usePlayerChromeAutoHide } from '../../src/hooks/usePlayerChromeAutoHide';
import type { ProbeDefinition } from './definition';

// playerChromeIdle.probe.tsx — exercise the desktop policy with the shared mobile idle clock in StrictMode.
function DesktopPolicy({ hidden, setHidden }: { hidden: boolean; setHidden: Dispatch<SetStateAction<boolean>> }) {
    const [autoHide, setAutoHide] = useState(() => localStorage.getItem('auto_hide_player_chrome') !== 'false');
    const [suppress, setSuppress] = useState(false);
    const { playerChromeVisibilityMode, cyclePlayerChromeVisibilityMode } = usePlayerChromeAutoHide({
        autoHidePlayerChrome: autoHide, initialPlayerChromeHidden: hidden, suppressPointerReveal: suppress,
        setIsPlayerChromeHidden: setHidden, setAutoHidePlayerChromePreference: setAutoHide,
    });
    return <div data-mode={playerChromeVisibilityMode} data-preference={autoHide}>
        <button onClick={cyclePlayerChromeVisibilityMode}>cycle</button>
        <button onClick={() => setSuppress(value => !value)}>suppress</button>
        <button onClick={() => setAutoHide(value => !value)}>preference</button>
    </div>;
}

function PlayerChromeIdleProbe() {
    const [hidden, setHidden] = useState(false);
    const [mounted, setMounted] = useState(true);
    return <div data-hidden={hidden}>
        <button onClick={() => setMounted(value => !value)}>mount toggle</button>
        {mounted && <DesktopPolicy hidden={hidden} setHidden={setHidden} />}
    </div>;
}

export default {
    id: 'playerChromeIdle', title: 'Player chrome idle policy',
    description: 'Desktop modes, pointer holds and listener cleanup after shared mobile extraction.',
    Component: PlayerChromeIdleProbe,
} satisfies ProbeDefinition;
