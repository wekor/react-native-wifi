# @wekor/react-native-wifi

Wi-Fi for React Native: put the phone on a device's hotspot and know when the device answers, check a device on
the phone's network, read the network the phone is on, and ask for the Wi-Fi and local network permissions.

```ts
import { joinNetwork } from '@wekor/react-native-wifi';

const network = await joinNetwork({
  ssid: 'Device_1234',
  password: 'secret123',
  waitFor: { host: '192.168.4.1', port: 80 }, // resolves once the device accepts a connection
});
try {
  await fetch('http://192.168.4.1/status');
} finally {
  await network.leave();
}
```

## Requirements

| React Native | iOS | Android | Expo |
| --- | --- | --- | --- |
| 0.80+, New Architecture | 15.1+ | 7.0+ (API 24) | Development builds; config plugin included. Not Expo Go. |

## Installation

```sh
npm i @wekor/react-native-wifi
```

With Expo, add the config plugin:

```ts
plugins: [
  ['@wekor/react-native-wifi', { localNetworkPermission: 'This app needs local network access to communicate with your devices.' }],
];
```

## Documentation

[Guides and API reference](docs/content/overview.mdx), and
[migrating from react-native-wifi-reborn](docs/content/migrating.mdx); run the site locally with
`bun run --cwd docs start`.

## Example

`example/` is a test app: permission, the live current network, joining and leaving with a fetch to check the
route, and on Android scanning and Wi-Fi on and off.

```sh
bun install
bun run example ios      # or: bun run example android
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md); releases are cut by merging release-please's PR.

## License

MIT
