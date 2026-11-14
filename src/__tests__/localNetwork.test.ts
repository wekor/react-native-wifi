import { beforeEach, expect, test } from 'bun:test';
import { calls, lastCall } from './native';

const fallback = await import('../localNetwork');
const ios = await import('../localNetwork.ios');

beforeEach(() => {
  calls.length = 0;
});

test('without the permission (Android), it is granted at once', async () => {
  expect(await fallback.requestLocalNetworkPermission()).toEqual({
    status: 'granted',
    granted: true,
    canAskAgain: false,
    expires: 'never',
  });
  expect(calls).toHaveLength(0);
});

test('iOS asks native, without a time limit unless given one', async () => {
  const pending = ios.requestLocalNetworkPermission();
  expect(lastCall('requestLocalNetworkPermission').args[1]).toBe(0);
  lastCall('requestLocalNetworkPermission').deferred.resolve({
    status: 'denied',
    canAskAgain: false,
  });
  expect(await pending).toEqual({
    status: 'denied',
    granted: false,
    canAskAgain: false,
    expires: 'never',
  });
});

test('aborting cancels the native request by its id', () => {
  const controller = new AbortController();
  ios
    .requestLocalNetworkPermission({
      signal: controller.signal,
      timeout: 3_000,
    })
    .catch(() => {});
  const request = lastCall('requestLocalNetworkPermission');
  expect(request.args[1]).toBe(3_000);
  controller.abort();
  expect(lastCall('cancelLocalNetworkPermissionRequest').args).toEqual([
    request.args[0],
  ]);
});
