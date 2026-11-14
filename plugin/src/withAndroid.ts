import {
  type AndroidConfig,
  type ConfigPlugin,
  withAndroidManifest,
} from 'expo/config-plugins';
import type { WifiPluginProps } from './index';

export function setWifiManifestPermissions(
  androidManifest: AndroidConfig.Manifest.AndroidManifest,
  { androidLocation = true, neverForLocation = true }: WifiPluginProps
): AndroidConfig.Manifest.AndroidManifest {
  const manifest = androidManifest.manifest;
  manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
  manifest['uses-permission'] ??= [];
  const permissions = manifest['uses-permission'];
  const find = (name: string) =>
    permissions.find(
      (permission) =>
        permission.$['android:name'] === `android.permission.${name}`
    );
  const add = (name: string, attributes: Record<string, string> = {}) => {
    const existing = find(name);
    if (existing) Object.assign(existing.$, attributes);
    else
      permissions.push({
        $: { 'android:name': `android.permission.${name}`, ...attributes },
      });
  };
  add(
    'NEARBY_WIFI_DEVICES',
    neverForLocation
      ? {
          'android:usesPermissionFlags': 'neverForLocation',
          'tools:targetApi': 'tiramisu',
        }
      : {}
  );
  if (androidLocation) {
    // A declaration the app (or another plugin) limited to some versions would hide the SSID on the others.
    for (const name of ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']) {
      const existing = find(name);
      if (existing)
        delete (existing.$ as Record<string, string>)['android:maxSdkVersion'];
      else add(name);
    }
  }
  return androidManifest;
}

export const withAndroidWifi: ConfigPlugin<WifiPluginProps> = (config, props) =>
  withAndroidManifest(config, (config) => {
    config.modResults = setWifiManifestPermissions(config.modResults, props);
    return config;
  });
