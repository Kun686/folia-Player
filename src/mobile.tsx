import { Buffer } from 'buffer';
import { createRoot } from 'react-dom/client';
import { initializeRuntime } from './mobile/runtime';
import { isNative } from './mobile/bridge';
import './mobile/mobile.css';

// src/mobile.tsx — isolate mobile startup from desktop modules, AI and local filesystem bootstrap.
globalThis.Buffer = Buffer;
async function start() {
  const server = isNative ? await initializeRuntime() : '';
  const { default: MobileApp } = await import('./mobile/MobileApp');
  createRoot(document.getElementById('root')!).render(<MobileApp initialServer={server} />);
}
void start().catch(() => {
  document.getElementById('root')!.textContent = '安全存储无法读取，请先解锁设备并重新打开 Folia。';
});
