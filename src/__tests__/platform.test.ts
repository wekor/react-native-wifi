import { beforeEach, expect, test } from 'bun:test';
import { calls, callsOf, emit, lastCall } from './native';

const fallback = await import('../platform');
const android = await import('../platform.android');
const { isWifiError } = await import('../index');

beforeEach(() => {
  calls.length = 0;
});

test('elsewhere than Android, each Android-only function fails with unsupported', async () => {
  const pending = [
    fallback.scanNetworks(),
    fallback.getScanResults(),
    fallback.addNetworkSuggestions([]),
    fallback.removeNetworkSuggestions(),
    fallback.isWifiEnabled(),
    fallback.openWifiSettings(),
  ];
  for (const result of await Promise.allSettled(pending)) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected')
      expect(isWifiError(result.reason, 'unsupported')).toBe(true);
  }
  expect(() => fallback.onWifiEnabledChange(() => {})).toThrow('Android only');
  expect(calls).toHaveLength(0);
});

test('scans at once share one native scan', async () => {
  const first = android.scanNetworks();
  const second = android.scanNetworks({ timeout: 1 });
  expect(callsOf('scanNetworks').map((call) => call.args)).toEqual([[15_000]]);
  lastCall('scanNetworks').deferred.resolve({ networks: [{ ssid: 'A' }] });
  expect(await first).toEqual([{ ssid: 'A' }] as never);
  expect(await second).toEqual([{ ssid: 'A' }] as never);
  android.scanNetworks().catch(() => {});
  expect(callsOf('scanNetworks')).toHaveLength(2);
});

test('suggestions get their defaults, and invalid ones are refused', async () => {
  android.addNetworkSuggestions([{ ssid: 'Home', password: 'secret123' }]);
  expect(lastCall('addNetworkSuggestions').args[0]).toEqual({
    suggestions: [
      {
        ssid: 'Home',
        password: 'secret123',
        security: 'wpa2',
        hidden: false,
        appInteractionRequired: false,
      },
    ],
  });
  for (const suggestion of [
    { ssid: 'X', security: 'wpa3' as const },
    { ssid: 'X', security: 'open' as const, password: 'secret123' },
  ]) {
    const error = await android
      .addNetworkSuggestions([suggestion])
      .catch((caught) => caught);
    expect(isWifiError(error, 'invalid-argument')).toBe(true);
  }
  expect(callsOf('addNetworkSuggestions')).toHaveLength(1);
});

test('an invalid timeout rejects with a WifiError rather than throwing', async () => {
  const { bindProcessToWifi } = await import('../binding');
  for (const call of [
    () => android.scanNetworks({ timeout: Number.NaN }),
    () => bindProcessToWifi({ timeout: -1 }),
  ]) {
    let result: Promise<unknown> | undefined;
    expect(() => {
      result = call();
    }).not.toThrow();
    const error = await result?.catch((caught) => caught);
    expect(isWifiError(error, 'invalid-argument')).toBe(true);
  }
  expect(callsOf('scanNetworks')).toHaveLength(0);
  expect(callsOf('bindProcessToWifi')).toHaveLength(0);
});

test('Wi-Fi switch updates run while there are listeners', () => {
  const seen: boolean[] = [];
  const remove = android.onWifiEnabledChange((enabled) => seen.push(enabled));
  emit('onWifiEnabledChange', { enabled: false });
  remove();
  remove();
  expect(seen).toEqual([false]);
  expect(callsOf('setWifiEnabledUpdates').map((call) => call.args)).toEqual([
    [true],
    [false],
  ]);
});
