import { beforeEach, expect, test } from 'bun:test';
import { calls, callsOf, lastCall, nativeError } from './native';

const { configure, isWifiError, probe } = await import('../index');

beforeEach(() => {
  calls.length = 0;
});

test('probe answers with what native found, waiting 5 s unless told otherwise', async () => {
  const yes = probe('192.168.1.42', 80);
  expect(lastCall('reachable').args.slice(1)).toEqual([
    '192.168.1.42',
    80,
    5_000,
  ]);
  lastCall('reachable').deferred.resolve({ reachable: true });
  expect(await yes).toBe(true);

  configure({ timeouts: { probe: 1_000 } });
  const no = probe('192.168.1.42', 80);
  expect(lastCall('reachable').args[3]).toBe(1_000);
  lastCall('reachable').deferred.resolve({
    reachable: false,
    cause: 'timeout',
    vpn: false,
  });
  expect(await no).toBe(false);
  configure({ timeouts: { probe: 5_000 } });
});

test("a call's own timeout wins, and 0 waits without limit", () => {
  probe('h', 1, { timeout: 0 }).catch(() => {});
  expect(lastCall('reachable').args[3]).toBe(0);
});

test('invalid hosts and ports never reach native', async () => {
  for (const [host, port] of [
    ['', 80],
    ['h', 0],
    ['h', 65_536],
    ['h', 1.5],
  ] as const) {
    const error = await probe(host, port).catch((e) => e);
    expect(isWifiError(error, 'invalid-argument')).toBe(true);
  }
  expect(callsOf('reachable')).toHaveLength(0);
});

test('local network access denied rejects rather than answering false', async () => {
  const pending = probe('192.168.1.42', 80);
  lastCall('reachable').deferred.reject(
    nativeError('local-network-denied', 'Denied')
  );
  expect(
    isWifiError(await pending.catch((e) => e), 'local-network-denied')
  ).toBe(true);
});

test('aborting cancels the native probe by its id', () => {
  const controller = new AbortController();
  probe('h', 1, { signal: controller.signal }).catch(() => {});
  const call = lastCall('reachable');
  controller.abort();
  expect(lastCall('cancelReachable').args).toEqual([call.args[0]]);
});
