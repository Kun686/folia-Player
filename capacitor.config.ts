import type { CapacitorConfig } from '@capacitor/cli';

// capacitor.config.ts
const config: CapacitorConfig = {
  appId: 'app.folia.personal', appName: 'Folia', loggingBehavior: 'none', webDir: 'dist-mobile',
  ios: { contentInset: 'never', scrollEnabled: false, preferredContentMode: 'mobile' },
  server: { hostname: 'localhost', iosScheme: 'capacitor', allowNavigation: [] },
  plugins: { CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false } },
};
export default config;
