// The checks that need no one at the phone, run inside the example app through cdp.mjs:
//   node example/scripts/cdp.mjs -e "globalThis.__e2eHost = '<this Mac's LAN IP>'" <device>
//   node example/scripts/cdp.mjs example/scripts/e2e.js <device>
// HOST runs a TCP service on port 18080 (the "device"); nothing listens on 18081 (its service is down).
// Each line is a check: its result, or the error's code and message.
const HOST = globalThis.__e2eHost;
const results = [];
const check = async (name, run) => {
  const startedAt = Date.now();
  try {
    const value = await run();
    results.push({ name, ok: true, ms: Date.now() - startedAt, value });
  } catch (error) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - startedAt,
      error: `${error?.code ?? error?.name}: ${error?.message}`,
    });
  }
};

await check('getWifiPermission', () => wifi.getWifiPermission());
await check('getCurrentNetwork', () => wifi.getCurrentNetwork());
await check('onCurrentNetworkChange: first event', () =>
  new Promise((resolve) => {
    const remove = wifi.onCurrentNetworkChange((network) => {
      remove();
      resolve(network);
    });
  })
);
await check('requestLocalNetworkPermission', () =>
  wifi.requestLocalNetworkPermission({ timeout: 20_000 })
);

// probe: up, service down, nothing there, bad arguments, aborted.
await check('probe: service up', () => wifi.probe(HOST, 18080, { timeout: 3_000 }));
await check('probe: service down (refused)', () =>
  wifi.probe(HOST, 18081, { timeout: 2_000 })
);
await check('probe: nothing there', () =>
  wifi.probe('10.255.255.1', 80, { timeout: 2_000 })
);
await check('probe: empty host', () => wifi.probe('', 80));
await check('probe: port 0', () => wifi.probe(HOST, 0));
await check('probe: aborted after 300 ms', () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 300);
  return wifi.probe('10.255.255.1', 80, { timeout: 10_000, signal: controller.signal });
});
await check('probe: 5 at once', async () =>
  Promise.all([18080, 18081, 18080, 18081, 18080].map((port) =>
    wifi.probe(HOST, port, { timeout: 2_000 })
  ))
);

await check('bindProcessToWifi + unbindProcess', async () => {
  await wifi.bindProcessToWifi();
  await wifi.unbindProcess();
  return 'ok';
});
await check('forgetNetworks()', () => wifi.forgetNetworks());

// Android only: on iOS each of these must reject with unsupported.
await check('isWifiEnabled', () => wifi.isWifiEnabled());
await check('getScanResults', async () => (await wifi.getScanResults()).length);
await check('scanNetworks', async () => {
  const networks = await wifi.scanNetworks();
  return { count: networks.length, first: networks[0] };
});
await check('onWifiEnabledChange', () => {
  const remove = wifi.onWifiEnabledChange(() => {});
  remove();
  return 'subscribed';
});

return results.map(({ name, ok, ms, value, error }) =>
  `${ok ? 'ok  ' : 'FAIL'} ${name} (${ms} ms): ${ok ? JSON.stringify(value) : error}`
);
