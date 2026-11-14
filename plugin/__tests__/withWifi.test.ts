import { expect, test } from 'bun:test';
import type { AndroidConfig } from 'expo/config-plugins';
import { setWifiManifestPermissions } from '../src/withAndroid';
import { setWifiEntitlements, setWifiInfoPlist } from '../src/withIos';

const emptyManifest = (): AndroidConfig.Manifest.AndroidManifest => ({
  manifest: {
    $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
    queries: [],
  },
});

const permissions = (
  manifest: AndroidConfig.Manifest.AndroidManifest
): Record<string, Record<string, string | undefined>> =>
  Object.fromEntries(
    (manifest.manifest['uses-permission'] ?? []).map(({ $ }) => {
      const { 'android:name': name, ...attributes } = $;
      return [name.replace('android.permission.', ''), attributes];
    })
  );

test('the Info.plist gets both default usage descriptions and the Bonjour service', () => {
  expect(setWifiInfoPlist({}, {})).toEqual({
    NSLocationWhenInUseUsageDescription:
      'This app needs location access to show the Wi-Fi network your phone is connected to.',
    NSLocalNetworkUsageDescription:
      'This app needs local network access to communicate with your devices.',
    NSBonjourServices: ['_preflight_check._tcp'],
  });
});

test('a given text replaces the one there; without one, the one there stays', () => {
  const existing = {
    NSLocationWhenInUseUsageDescription: 'From expo-location',
    NSLocalNetworkUsageDescription: 'From the app',
    NSBonjourServices: ['_http._tcp', '_preflight_check._tcp'],
  };
  expect(
    setWifiInfoPlist(structuredClone(existing), {
      locationPermission: 'Ours',
      localNetworkPermission: 'Ours too',
    })
  ).toEqual({
    NSLocationWhenInUseUsageDescription: 'Ours',
    NSLocalNetworkUsageDescription: 'Ours too',
    NSBonjourServices: ['_http._tcp', '_preflight_check._tcp'],
  });
  expect(setWifiInfoPlist(structuredClone(existing), {})).toEqual(existing);
});

test('false leaves each permission unset', () => {
  expect(
    setWifiInfoPlist(
      {},
      { locationPermission: false, localNetworkPermission: false }
    )
  ).toEqual({});
});

test('both entitlements are added by default and each can be left out', () => {
  expect(setWifiEntitlements({}, {})).toEqual({
    'com.apple.developer.networking.HotspotConfiguration': true,
    'com.apple.developer.networking.wifi-info': true,
  });
  expect(
    setWifiEntitlements({}, { hotspotConfiguration: false, wifiInfo: false })
  ).toEqual({});
});

test('Android declares nearby Wi-Fi devices never for location, and location', () => {
  const manifest = setWifiManifestPermissions(emptyManifest(), {});
  expect(manifest.manifest.$['xmlns:tools']).toBe(
    'http://schemas.android.com/tools'
  );
  expect(permissions(manifest)).toEqual({
    NEARBY_WIFI_DEVICES: {
      'android:usesPermissionFlags': 'neverForLocation',
      'tools:targetApi': 'tiramisu',
    },
    ACCESS_FINE_LOCATION: {},
    ACCESS_COARSE_LOCATION: {},
  });
});

test('androidLocation false leaves location undeclared', () => {
  const manifest = setWifiManifestPermissions(emptyManifest(), {
    androidLocation: false,
    neverForLocation: false,
  });
  expect(permissions(manifest)).toEqual({ NEARBY_WIFI_DEVICES: {} });
});

test('a location declaration limited to old versions is extended to all', () => {
  const manifest = emptyManifest();
  manifest.manifest['uses-permission'] = [
    {
      $: {
        'android:name': 'android.permission.ACCESS_FINE_LOCATION',
        'android:maxSdkVersion': '30',
      } as { 'android:name': string },
    },
  ];
  expect(
    permissions(setWifiManifestPermissions(manifest, {})).ACCESS_FINE_LOCATION
  ).toEqual({});
});
