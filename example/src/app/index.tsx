import {
  forgetNetworks,
  getScanResults,
  isWifiEnabled,
  type JoinedNetwork,
  joinNetwork,
  onWifiEnabledChange,
  openWifiSettings,
  probe,
  requestLocalNetworkPermission,
  type ScannedNetwork,
  scanNetworks,
  unbindProcess,
  useCurrentNetwork,
  useWifiPermission,
} from '@wekor/react-native-wifi';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text } from 'react-native';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Field } from '@/components/field';
import { KeyValue } from '@/components/key-value';
import { Label } from '@/components/label';
import { ListRow } from '@/components/list-row';
import { LogView } from '@/components/log-view';
import { Row } from '@/components/row';
import { Screen } from '@/components/screen';
import { textStyles } from '@/components/text';
import { Toggle } from '@/components/toggle';
import { type Log, useLog } from '@/hooks/use-log';
import { errorText } from '@/lib/errors';

/** The device to wait for and check: what most devices' hotspots put themselves at. */
const DEFAULT_HOST = '192.168.4.1';
const DEFAULT_PORT = '80';

export default function WifiScreen() {
  const { lines, add, clear } = useLog();
  const [ssid, setSsid] = useState('');
  const [host, setHost] = useState(DEFAULT_HOST);
  const [port, setPort] = useState(DEFAULT_PORT);

  return (
    <Screen>
      <PermissionsCard log={add} />
      <CurrentNetworkCard />
      <JoinCard
        ssid={ssid}
        onSsidChange={setSsid}
        host={host}
        port={port}
        log={add}
      />
      <DeviceCard
        host={host}
        port={port}
        onHostChange={setHost}
        onPortChange={setPort}
        log={add}
      />
      {Platform.OS === 'android' && <AndroidCard onPick={setSsid} log={add} />}
      <LogView lines={lines} onClear={clear} />
    </Screen>
  );
}

function PermissionsCard({ log }: { log: Log }) {
  const [wifi, requestWifi] = useWifiPermission();
  const [localNetwork, setLocalNetwork] = useState<string>();

  const requestLocalNetwork = async () => {
    const startedAt = Date.now();
    try {
      const { status } = await requestLocalNetworkPermission({
        timeout: 60_000,
      });
      setLocalNetwork(status);
      log(`local network: ${status} after ${Date.now() - startedAt} ms`, 'rx');
    } catch (error) {
      log(`local network: ${errorText(error)}`, 'error');
    }
  };

  return (
    <Card>
      <Label text="Permissions" />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={textStyles.title}>Wi-Fi: {wifi?.status ?? '…'}</Text>
        {wifi && !wifi.granted && wifi.canAskAgain && (
          <Button small title="Request" onPress={requestWifi} />
        )}
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={textStyles.title}>
          Local network: {localNetwork ?? 'not asked'}
        </Text>
        <Button small title="Request" onPress={requestLocalNetwork} />
      </Row>
      <Text style={textStyles.muted}>
        Wi-Fi: reading the network's name, and scanning. Local network: reaching
        devices, on iOS.
      </Text>
    </Card>
  );
}

const withUnit = (value: number | undefined, unit: string) =>
  value === undefined ? undefined : `${value} ${unit}`;

function CurrentNetworkCard() {
  const network = useCurrentNetwork();
  return (
    <Card>
      <Label text="Current Wi-Fi network" />
      {network === undefined && <Text style={textStyles.muted}>…</Text>}
      {network === null && <Text style={textStyles.muted}>Not on Wi-Fi</Text>}
      {network && (
        <KeyValue
          entries={[
            ['SSID', network.ssid ?? '(hidden: no Wi-Fi permission)'],
            ['BSSID', network.bssid],
            ['IP', network.ip],
            ['Gateway', network.gateway],
            ['RSSI', withUnit(network.rssi, 'dBm')],
            ['Frequency', withUnit(network.frequency, 'MHz')],
            ['Link speed', withUnit(network.linkSpeed, 'Mbps')],
          ]}
        />
      )}
    </Card>
  );
}

function JoinCard({
  ssid,
  onSsidChange,
  host,
  port,
  log,
}: {
  ssid: string;
  onSsidChange: (ssid: string) => void;
  host: string;
  port: string;
  log: Log;
}) {
  const [password, setPassword] = useState('');
  const [prefix, setPrefix] = useState(false);
  const [waitForDevice, setWaitForDevice] = useState(true);
  const [bindProcess, setBindProcess] = useState(true);
  const [joined, setJoined] = useState<JoinedNetwork>();
  const [joining, setJoining] = useState<AbortController>();
  const removeLost = useRef<() => void>(undefined);

  useEffect(() => () => removeLost.current?.(), []);

  const join = async () => {
    const controller = new AbortController();
    setJoining(controller);
    const waitFor = waitForDevice ? { host, port: Number(port) } : undefined;
    log(
      `join ${ssid}${prefix ? '*' : ''}${waitFor ? `, waiting for ${host}:${port}` : ''}`,
      'tx'
    );
    const startedAt = Date.now();
    try {
      const network = await joinNetwork({
        ssid,
        prefix,
        password: password || undefined,
        waitFor,
        timeout: 45_000,
        signal: controller.signal,
        bindProcess,
      });
      log(
        `joined ${network.ssid} in ${Date.now() - startedAt} ms, ip ${network.ip ?? '?'}, gateway ${network.gateway ?? '?'}`,
        'rx'
      );
      removeLost.current?.();
      removeLost.current = network.onLost(() => {
        log(`lost ${network.ssid}`, 'error');
        setJoined(undefined);
      });
      setJoined(network);
    } catch (error) {
      log(`join: ${errorText(error)}`, 'error');
    } finally {
      setJoining(undefined);
    }
  };

  const leave = async () => {
    if (!joined) return;
    try {
      await joined.leave();
      log(`left ${joined.ssid}`);
    } catch (error) {
      log(`leave: ${errorText(error)}`, 'error');
    }
    setJoined(undefined);
  };

  const forgetAll = async () => {
    try {
      await forgetNetworks();
      log('forgot every network the app joined');
      setJoined(undefined);
    } catch (error) {
      log(`forget: ${errorText(error)}`, 'error');
    }
  };

  return (
    <Card>
      <Label text="Join a hotspot" />
      <Field placeholder="SSID" value={ssid} onChangeText={onSsidChange} />
      <Field
        placeholder="Password (empty for an open network)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <Toggle label="Match by prefix" value={prefix} onChange={setPrefix} />
      <Toggle
        label={`Wait for ${host}:${port}`}
        value={waitForDevice}
        onChange={setWaitForDevice}
      />
      {Platform.OS === 'android' && (
        <Toggle
          label="Route app traffic through it"
          value={bindProcess}
          onChange={setBindProcess}
        />
      )}
      <Row>
        {joining ? (
          <Button
            tone="danger"
            title="Cancel"
            onPress={() => joining.abort()}
          />
        ) : (
          <Button title="Join" disabled={!ssid} onPress={join} />
        )}
        <Button
          tone="plain"
          title={joined ? `Leave ${joined.ssid}` : 'Leave'}
          disabled={!joined}
          onPress={leave}
        />
        <Button tone="plain" title="Forget all" onPress={forgetAll} />
      </Row>
    </Card>
  );
}

function DeviceCard({
  host,
  port,
  onHostChange,
  onPortChange,
  log,
}: {
  host: string;
  port: string;
  onHostChange: (host: string) => void;
  onPortChange: (port: string) => void;
  log: Log;
}) {
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState('');

  const check = async () => {
    setChecking(true);
    const startedAt = Date.now();
    try {
      const answered = await probe(host, Number(port), { timeout: 3_000 });
      log(
        `${host}:${port} ${answered ? 'answered' : 'did not answer'} in ${Date.now() - startedAt} ms`,
        answered ? 'rx' : 'error'
      );
    } catch (error) {
      log(`probe: ${errorText(error)}`, 'error');
    } finally {
      setChecking(false);
    }
  };

  const fetchUrl = async () => {
    const target = url || `http://${host}:${port}/`;
    const startedAt = Date.now();
    try {
      const response = await fetch(target);
      log(
        `GET ${target}: ${response.status} in ${Date.now() - startedAt} ms`,
        'rx'
      );
    } catch (error) {
      log(`GET ${target}: ${errorText(error)}`, 'error');
    }
  };

  return (
    <Card>
      <Label text="Device" />
      <Row style={{ flexWrap: 'nowrap' }}>
        <Field
          style={{ flex: 3 }}
          placeholder="Host"
          value={host}
          onChangeText={onHostChange}
          keyboardType="numbers-and-punctuation"
        />
        <Field
          style={{ flex: 1 }}
          placeholder="Port"
          value={port}
          onChangeText={onPortChange}
          keyboardType="number-pad"
        />
      </Row>
      <Row>
        <Button
          small
          title={checking ? 'Probing…' : 'Probe'}
          disabled={checking || !host || !port}
          onPress={check}
        />
        <Button small tone="plain" title="Fetch" onPress={fetchUrl} />
      </Row>
      <Field
        placeholder={`URL to fetch (http://${host}:${port}/)`}
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
      />
    </Card>
  );
}

function AndroidCard({
  onPick,
  log,
}: {
  onPick: (ssid: string) => void;
  log: Log;
}) {
  const [enabled, setEnabled] = useState<boolean>();
  const [networks, setNetworks] = useState<ScannedNetwork[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    isWifiEnabled().then(setEnabled, () => {});
    return onWifiEnabledChange((value) => {
      log(`Wi-Fi ${value ? 'on' : 'off'}`);
      setEnabled(value);
    });
  }, [log]);

  const run = async (scan: () => Promise<ScannedNetwork[]>) => {
    setScanning(true);
    try {
      const found = await scan();
      // The strongest access point of each name, strongest first; hidden ones last.
      const byName = new Map<string, ScannedNetwork>();
      for (const network of found) {
        const known = byName.get(network.ssid);
        if (!known || network.rssi > known.rssi)
          byName.set(network.ssid, network);
      }
      setNetworks(
        [...byName.values()].sort(
          (a, b) => Number(!a.ssid) - Number(!b.ssid) || b.rssi - a.rssi
        )
      );
      log(`scan: ${found.length} access points`, 'rx');
    } catch (error) {
      log(`scan: ${errorText(error)}`, 'error');
    } finally {
      setScanning(false);
    }
  };

  const unbind = async () => {
    await unbindProcess();
    log('unbound the process');
  };

  return (
    <Card>
      <Label text="Android" />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={textStyles.title}>
          Wi-Fi {enabled === undefined ? '…' : enabled ? 'on' : 'off'}
        </Text>
        <Button
          small
          tone="plain"
          title="Wi-Fi settings"
          onPress={() => openWifiSettings().catch(() => {})}
        />
      </Row>
      <Row>
        <Button
          small
          title={scanning ? 'Scanning…' : 'Scan'}
          disabled={scanning}
          onPress={() => run(scanNetworks)}
        />
        <Button
          small
          tone="plain"
          title="Last results"
          onPress={() => run(getScanResults)}
        />
        <Button small tone="plain" title="Unbind" onPress={unbind} />
      </Row>
      {networks.map((network, index) => (
        <ListRow
          key={network.bssid}
          first={index === 0}
          title={network.ssid || '(hidden)'}
          subtitle={`${network.rssi} dBm · ${network.band} · ${network.security}`}
          onPress={network.ssid ? () => onPick(network.ssid) : undefined}
        />
      ))}
    </Card>
  );
}
