import { WifiError } from './errors';
import type { NetworkSuggestion, ScannedNetwork, WaitOptions } from './types';

// What only Android can do. This is the iOS side (and any other platform's): each function fails with
// `unsupported`, so a call made by mistake shows at once instead of answering something untrue. Android's side is
// `platform.android.ts`, typed against this file.

const unsupported = (what: string) =>
  new WifiError(
    'unsupported',
    `${what} is Android only: iOS does not let apps do it`
  );

/** Scans and resolves with the networks in range. Android only. */
export const scanNetworks = async (
  _options?: Pick<WaitOptions, 'timeout'>
): Promise<ScannedNetwork[]> => {
  throw unsupported('Scanning');
};

/** What the system's last scan found, whoever ran it; no new scan. Android only. */
export const getScanResults = async (): Promise<ScannedNetwork[]> => {
  throw unsupported('Reading scan results');
};

/** Networks the system may join on its own, with the user's approval. Android 10+. */
export const addNetworkSuggestions = async (
  _suggestions: NetworkSuggestion[]
): Promise<void> => {
  throw unsupported('Suggesting networks');
};

/** Withdraws the suggestions for `ssids`, or every suggestion the app made. Android 10+. */
export const removeNetworkSuggestions = async (
  _ssids?: string[]
): Promise<void> => {
  throw unsupported('Removing network suggestions');
};

/** Whether Wi-Fi is on. Android only. */
export const isWifiEnabled = async (): Promise<boolean> => {
  throw unsupported('Reading whether Wi-Fi is on');
};

/** Calls `listener` when Wi-Fi turns on or off; returns the remover. Android only: throws on iOS. */
export const onWifiEnabledChange = (
  _listener: (enabled: boolean) => void
): (() => void) => {
  throw unsupported('Following the Wi-Fi switch');
};

/** Opens the Wi-Fi panel over the app (Android 10+), or the Wi-Fi settings. Android only. */
export const openWifiSettings = async (): Promise<void> => {
  throw unsupported('Opening the Wi-Fi settings');
};
