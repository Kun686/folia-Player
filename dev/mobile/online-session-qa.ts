// online-session-qa.ts — expose unchanged production runtime to isolated native tests; never included in the app build.
export { initializeRuntime, clearProvider, flushSessions } from '../../src/mobile/runtime';
export { getMobileRuntime } from '../../src/services/mobileRuntime';
