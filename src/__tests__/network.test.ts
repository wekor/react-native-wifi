import { beforeEach, expect, test } from 'bun:test';
import { calls, callsOf, emit, flush, lastCall } from './native';

const { getCurrentNetwork, onCurrentNetworkChange, requestWifiPermission } =
  await import('../index');

beforeEach(() => {
  calls.length = 0;
});

test('getCurrentNetwork unwraps the network, null when on none', async () => {
  const first = getCurrentNetwork();
  lastCall('getCurrentWifiNetwork').deferred.resolve({
    network: { ssid: 'Home', ip: '10.0.0.2' },
  });
  expect(await first).toEqual({ ssid: 'Home', ip: '10.0.0.2' });
  const second = getCurrentNetwork();
  lastCall('getCurrentWifiNetwork').deferred.resolve({ network: null });
  expect(await second).toBeNull();
});

test('updates run while there are listeners, and a later listener gets the known network', async () => {
  const seen: unknown[] = [];
  const removeFirst = onCurrentNetworkChange((network) =>
    seen.push(['a', network])
  );
  expect(callsOf('setNetworkUpdates').map((call) => call.args)).toEqual([
    [true],
  ]);
  emit('onCurrentWifiNetworkChange', { network: { ssid: 'Home' } });
  const removeSecond = onCurrentNetworkChange((network) =>
    seen.push(['b', network])
  );
  await flush();
  emit('onCurrentWifiNetworkChange', { network: null });
  expect(seen).toEqual([
    ['a', { ssid: 'Home' }],
    ['b', { ssid: 'Home' }],
    ['a', null],
    ['b', null],
  ]);
  removeFirst();
  removeFirst();
  expect(callsOf('setNetworkUpdates')).toHaveLength(1);
  removeSecond();
  expect(callsOf('setNetworkUpdates').map((call) => call.args)).toEqual([
    [true],
    [false],
  ]);
});

test('a granted permission has native report the network again while updates run', async () => {
  const remove = onCurrentNetworkChange(() => {});
  const pending = requestWifiPermission();
  lastCall('requestWifiPermission').deferred.resolve({
    status: 'granted',
    canAskAgain: true,
  });
  expect(await pending).toEqual({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  });
  expect(callsOf('setNetworkUpdates').map((call) => call.args)).toEqual([
    [true],
    [true],
  ]);
  remove();
});
