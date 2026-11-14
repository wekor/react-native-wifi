import { checkTimeout, settings } from './config';
import { WifiError, wrap } from './errors';
import { Listeners } from './listeners';
import native from './NativeReactNativeWifi';
import { securityOf } from './security';
import type * as Fallback from './platform';
import type { NetworkSuggestion, ScannedNetwork } from './types';

// Android's side of `platform.ts`: each export is typed as the fallback's, so the two cannot drift apart.

type Networks = { networks: ScannedNetwork[] };

let pendingScan: Promise<ScannedNetwork[]> | undefined;

/**
 * Scans and resolves with the networks in range, one entry per access point. Android allows 4 scans in 2 minutes in
 * the foreground (since Android 9) and rejects more with `scan-throttled`; `getScanResults()` then has the last
 * ones. Calls while a scan runs share it.
 */
export const scanNetworks: typeof Fallback.scanNetworks = async (options) => {
  const timeout = checkTimeout(
    options?.timeout ?? settings.timeouts.scan,
    'timeout'
  );
  pendingScan ??= wrap(native.scanNetworks(timeout))
    .then((result) => (result as Networks).networks)
    .finally(() => {
      pendingScan = undefined;
    });
  return pendingScan;
};

export const getScanResults: typeof Fallback.getScanResults = async () =>
  ((await wrap(native.getLastScanResults())) as Networks).networks;

const nativeSuggestion = (suggestion: NetworkSuggestion) => {
  const { ssid, password } = suggestion;
  if (!ssid)
    throw new WifiError('invalid-argument', 'A suggestion needs an ssid');
  return {
    ssid,
    password: password ?? '',
    security: securityOf(suggestion),
    hidden: suggestion.hidden ?? false,
    appInteractionRequired: suggestion.appInteractionRequired ?? false,
  };
};

/** Suggesting a network again replaces its earlier suggestion. */
export const addNetworkSuggestions: typeof Fallback.addNetworkSuggestions =
  async (suggestions) => {
    const converted = suggestions.map(nativeSuggestion);
    await wrap(native.addNetworkSuggestions({ suggestions: converted }));
  };

export const removeNetworkSuggestions: typeof Fallback.removeNetworkSuggestions =
  (ssids) => wrap(native.removeNetworkSuggestions(ssids ? { ssids } : {}));

export const isWifiEnabled: typeof Fallback.isWifiEnabled = () =>
  wrap(native.isWifiEnabled());

const wifiEnabledListeners = new Listeners<(enabled: boolean) => void>();

native.onWifiEnabledChange((payload) => {
  const { enabled } = payload as { enabled: boolean };
  for (const listener of wifiEnabledListeners.list()) listener(enabled);
});

export const onWifiEnabledChange: typeof Fallback.onWifiEnabledChange = (
  listener
) =>
  wifiEnabledListeners.subscribe(
    listener,
    () => native.setWifiEnabledUpdates(true),
    () => native.setWifiEnabledUpdates(false)
  );

/** Only the user can switch Wi-Fi on Android 10+; this is where they do. */
export const openWifiSettings: typeof Fallback.openWifiSettings = () =>
  wrap(native.openWifiSettings());
