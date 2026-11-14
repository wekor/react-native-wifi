import { beforeEach, expect, test } from 'bun:test';
import {
  calls,
  callsOf,
  emit,
  flush,
  lastCall,
  nativeError,
  platform,
} from './native';

const { configure, forgetNetworks, isWifiError, joinNetwork } = await import(
  '../index'
);

beforeEach(() => {
  calls.length = 0;
});

/** Starts a join and answers it as native would, with `ssid` as the network joined. */
const joined = async (
  options: Parameters<typeof joinNetwork>[0],
  ssid = options.ssid
) => {
  const pending = joinNetwork(options);
  const call = lastCall('joinNetwork');
  call.deferred.resolve({ ssid, ip: '192.168.4.2' });
  return { network: await pending, joinId: call.args[0] as number };
};

const answerLeave = async () => {
  await flush();
  lastCall('leaveNetwork').deferred.resolve(undefined);
};

test('the defaults reach native, and the network resolves with what native reported', async () => {
  const pending = joinNetwork({ ssid: 'Camera_12', password: 'secret123' });
  const call = lastCall('joinNetwork');
  expect(call.args[1]).toEqual({
    ssid: 'Camera_12',
    prefix: false,
    password: 'secret123',
    security: 'wpa2',
    hidden: false,
    timeout: 30_000,
    bindProcess: true,
    joinOnce: false,
  });
  call.deferred.resolve({
    ssid: 'Camera_12',
    ip: '192.168.4.2',
    gateway: '192.168.4.1',
  });
  const network = await pending;
  expect([network.ssid, network.ip, network.gateway, network.active]).toEqual([
    'Camera_12',
    '192.168.4.2',
    '192.168.4.1',
    true,
  ]);
  expect(callsOf('reachable')).toHaveLength(0);
});

test('an open network defaults to open security, and configure sets the timeout', () => {
  configure({ timeouts: { join: 5_000 } });
  joinNetwork({ ssid: 'Open' }).catch(() => {});
  expect(lastCall('joinNetwork').args[1]).toMatchObject({
    security: 'open',
    password: '',
    timeout: 5_000,
  });
  configure({ timeouts: { join: 30_000 } });
});

test('options native would refuse are rejected before reaching it', async () => {
  for (const options of [
    { ssid: '' },
    { ssid: 'A', prefix: true, hidden: true },
    { ssid: 'A', security: 'wpa2' as const },
    { ssid: 'A', security: 'open' as const, password: 'x' },
    { ssid: 'A', waitFor: { host: '', port: 80 } },
    { ssid: 'A', waitFor: { host: '192.168.4.1', port: 0 } },
  ]) {
    const error = await joinNetwork(options).catch((caught) => caught);
    expect(isWifiError(error, 'invalid-argument')).toBe(true);
  }
  expect(callsOf('joinNetwork')).toHaveLength(0);
  const badTimeout = await joinNetwork({ ssid: 'A', timeout: -1 }).catch(
    (caught) => caught
  );
  expect(isWifiError(badTimeout, 'invalid-argument')).toBe(true);
});

test('a native rejection becomes a WifiError with its native code', async () => {
  const pending = joinNetwork({ ssid: 'Camera' });
  lastCall('joinNetwork').deferred.reject(
    nativeError('user-denied', 'Declined', 7)
  );
  const error = await pending.catch((caught) => caught);
  expect(isWifiError(error, 'user-denied')).toBe(true);
  expect(error.nativeCode).toBe(7);
});

test('aborting cancels the native join by its id; an aborted signal never reaches native', async () => {
  const controller = new AbortController();
  const pending = joinNetwork({ ssid: 'Camera', signal: controller.signal });
  const call = lastCall('joinNetwork');
  controller.abort();
  expect(lastCall('cancelJoin').args).toEqual([call.args[0]]);
  call.deferred.reject(nativeError('cancelled', 'The join was cancelled'));
  expect(isWifiError(await pending.catch((e) => e), 'cancelled')).toBe(true);

  const error = await joinNetwork({
    ssid: 'Camera',
    signal: controller.signal,
  }).catch((e) => e);
  expect(isWifiError(error, 'cancelled')).toBe(true);
  expect(callsOf('joinNetwork')).toHaveLength(1);
});

test('leave goes to native once, with the join and the names it went by', async () => {
  const { network, joinId } = await joined(
    { ssid: 'Camera_', prefix: true },
    'Camera_42'
  );
  const leaving = network.leave();
  await answerLeave();
  await leaving;
  expect(network.active).toBe(false);
  expect(callsOf('leaveNetwork').map((call) => call.args)).toEqual([
    [joinId, ['Camera_', 'Camera_42']],
  ]);
  await network.leave();
  expect(callsOf('leaveNetwork')).toHaveLength(1);
});

test('a lost network calls its listeners once and can still be left', async () => {
  const { network, joinId } = await joined({ ssid: 'Camera' });
  let lost = 0;
  network.onLost(() => lost++);
  emit('onJoinLost', { joinId, ssid: 'Camera' });
  emit('onJoinLost', { joinId, ssid: 'Camera' });
  expect(lost).toBe(1);
  expect(network.active).toBe(false);
  const leaving = network.leave();
  await answerLeave();
  await leaving;
  expect(lastCall('leaveNetwork').args).toEqual([joinId, ['Camera']]);
});

test('leaving a lost network leaves a newer join of the same name to native, which spares it', async () => {
  const first = await joined({ ssid: 'Camera' });
  emit('onJoinLost', { joinId: first.joinId, ssid: 'Camera' });
  const second = await joined({ ssid: 'Camera' });
  const leaving = first.network.leave();
  await answerLeave();
  await leaving;
  expect(lastCall('leaveNetwork').args).toEqual([first.joinId, ['Camera']]);
  expect(second.network.active).toBe(true);
});

test('waitFor resolves once the device accepts, within what is left of the timeout', async () => {
  const pending = joinNetwork({
    ssid: 'Camera',
    timeout: 10_000,
    waitFor: { host: '192.168.4.1', port: 80 },
  });
  lastCall('joinNetwork').deferred.resolve({ ssid: 'Camera' });
  await flush();
  const probe = lastCall('reachable');
  const [, host, port, timeout] = probe.args as [
    number,
    string,
    number,
    number,
  ];
  expect([host, port]).toEqual(['192.168.4.1', 80]);
  expect(timeout).toBeGreaterThan(0);
  expect(timeout).toBeLessThanOrEqual(10_000);
  probe.deferred.resolve({ reachable: true });
  expect((await pending).active).toBe(true);
});

test('a device that never answers rejects the join as unreachable, and the phone leaves', async () => {
  const pending = joinNetwork({
    ssid: 'Camera',
    waitFor: { host: '192.168.4.1', port: 80 },
  });
  const join = lastCall('joinNetwork');
  join.deferred.resolve({ ssid: 'Camera' });
  await flush();
  lastCall('reachable').deferred.resolve({
    reachable: false,
    cause: 'refused',
    vpn: true,
  });
  await answerLeave();
  const error = await pending.catch((e) => e);
  expect(isWifiError(error, 'unreachable')).toBe(true);
  expect(error.message).toContain('refused');
  expect(error.message).toContain('VPN');
  expect(lastCall('leaveNetwork').args).toEqual([join.args[0], ['Camera']]);
});

test('local network access denied while waiting rejects as such, and the phone leaves', async () => {
  const pending = joinNetwork({
    ssid: 'Camera',
    waitFor: { host: '192.168.4.1', port: 80 },
  });
  lastCall('joinNetwork').deferred.resolve({ ssid: 'Camera' });
  await flush();
  lastCall('reachable').deferred.reject(
    nativeError('local-network-denied', 'Denied')
  );
  await answerLeave();
  expect(
    isWifiError(await pending.catch((e) => e), 'local-network-denied')
  ).toBe(true);
  expect(callsOf('leaveNetwork')).toHaveLength(1);
});

test('aborting while waiting cancels the probe, leaves, and rejects as cancelled', async () => {
  const controller = new AbortController();
  const pending = joinNetwork({
    ssid: 'Camera',
    signal: controller.signal,
    waitFor: { host: '192.168.4.1', port: 80 },
  });
  lastCall('joinNetwork').deferred.resolve({ ssid: 'Camera' });
  await flush();
  const probe = lastCall('reachable');
  controller.abort();
  expect(lastCall('cancelReachable').args).toEqual([probe.args[0]]);
  probe.deferred.reject(nativeError('cancelled', 'Cancelled'));
  await answerLeave();
  expect(isWifiError(await pending.catch((e) => e), 'cancelled')).toBe(true);
});

test('forgetNetworks ends the matching joins and tells native which names', async () => {
  const camera = await joined({ ssid: 'Camera' });
  const other = await joined({ ssid: 'Other' });
  const forgetting = forgetNetworks(['Camera']);
  lastCall('forgetJoinedNetworks').deferred.resolve(undefined);
  await forgetting;
  expect(lastCall('forgetJoinedNetworks').args).toEqual([
    { ssids: ['Camera'] },
  ]);
  expect([camera.network.active, other.network.active]).toEqual([false, true]);
  // Forgotten is left: nothing more to do.
  await camera.network.leave();
  expect(callsOf('leaveNetwork')).toHaveLength(0);

  const all = forgetNetworks();
  lastCall('forgetJoinedNetworks').deferred.resolve(undefined);
  await all;
  expect(lastCall('forgetJoinedNetworks').args).toEqual([{}]);
  expect(other.network.active).toBe(false);
});

/** Runs `test` as on Android at `version`, then puts the platform back. */
const onAndroid = async (version: number, test: () => Promise<void>) => {
  Object.assign(platform, { OS: 'android', Version: version });
  try {
    await test();
  } finally {
    Object.assign(platform, { OS: 'ios', Version: '18.0' });
  }
};

const permission = (status: string, canAskAgain = true) => ({
  status,
  canAskAgain,
});

test('before Android 10, a join without the Wi-Fi permission asks for it, then joins', () =>
  onAndroid(28, async () => {
    const pending = joinNetwork({ ssid: 'Camera', password: 'secret123' });
    lastCall('getWifiPermission').deferred.resolve(permission('undetermined'));
    await flush();
    lastCall('requestWifiPermission').deferred.resolve(permission('granted'));
    await flush();
    lastCall('joinNetwork').deferred.resolve({ ssid: 'Camera' });
    expect((await pending).ssid).toBe('Camera');
  }));

test('before Android 10, a refused permission rejects as unauthorized and never reaches native', () =>
  onAndroid(28, async () => {
    const pending = joinNetwork({ ssid: 'Camera' });
    lastCall('getWifiPermission').deferred.resolve(permission('denied'));
    await flush();
    lastCall('requestWifiPermission').deferred.resolve(
      permission('denied', false)
    );
    const error = await pending.catch((e) => e);
    expect(isWifiError(error, 'unauthorized')).toBe(true);
    expect(callsOf('joinNetwork')).toHaveLength(0);
  }));

test('before Android 10, a granted permission is not asked for again', () =>
  onAndroid(24, async () => {
    const pending = joinNetwork({ ssid: 'Camera' });
    lastCall('getWifiPermission').deferred.resolve(permission('granted'));
    await flush();
    lastCall('joinNetwork').deferred.resolve({ ssid: 'Camera' });
    await pending;
    expect(callsOf('requestWifiPermission')).toHaveLength(0);
  }));

test('aborting while the permission is asked for rejects as cancelled, without joining', () =>
  onAndroid(28, async () => {
    const controller = new AbortController();
    const pending = joinNetwork({ ssid: 'Camera', signal: controller.signal });
    lastCall('getWifiPermission').deferred.resolve(permission('undetermined'));
    await flush();
    controller.abort();
    lastCall('requestWifiPermission').deferred.resolve(permission('granted'));
    const error = await pending.catch((e) => e);
    expect(isWifiError(error, 'cancelled')).toBe(true);
    expect(callsOf('joinNetwork')).toHaveLength(0);
  }));

test('Android 10+ and iOS join without asking for any permission', async () => {
  for (const join of [
    () => onAndroid(29, () => joined({ ssid: 'Camera' }).then(() => {})),
    () => joined({ ssid: 'Camera' }).then(() => {}),
  ]) {
    await join();
  }
  expect(callsOf('getWifiPermission')).toHaveLength(0);
  expect(callsOf('requestWifiPermission')).toHaveLength(0);
});
