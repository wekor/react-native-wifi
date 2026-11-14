# @wekor/react-native-wifi

Wi-Fi for React Native 0.80+, New Architecture only: join networks and hotspots and know when a device on them
answers, probe a device, read and watch the current network, and the Wi-Fi and local network permissions. The API
stays general (never shaped around one app).

## Layout

- `src/` — the TS API. `join.ts` (`joinNetwork`, `JoinedNetwork`, `forgetNetworks`), `probe.ts`, `network.ts` (the
  current network and its hook), `permission.ts`, `localNetwork.ts` / `localNetwork.ios.ts`, `platform.ts` /
  `platform.android.ts` (Android-only functions, which reject `unsupported` elsewhere), `binding.ts`, `config.ts`
  (default timeouts), `errors.ts` (`WifiError` and its codes). `NativeReactNativeWifi.ts` is the TurboModule spec;
  `operations.ts` runs native ops JS can cancel by id.
- `ios/` — `ReactNativeWifi.mm` is only the React Native boundary. `WifiCore.swift` (joining, the current network,
  location permission; state on one serial queue), `WifiProber.swift` (TCP probes), `WifiLocalNetworkPermission.swift`
  (asking for and inferring the local network permission, which iOS doesn't expose).
- `android/` — Kotlin. `WifiModule.kt` is only the React Native boundary. `WifiCentral.kt` (everything but joining and
  probing, on one handler thread), `WifiJoiner.kt` (`WifiNetworkSpecifier` joins), `WifiProber.kt`,
  `WifiSupport.kt`.
- `plugin/` — the Expo config plugin (`app.plugin.js` loads `plugin/build`).
- `docs/` — Docusaurus site, English in `docs/content`, Chinese in `docs/i18n/zh-Hans`.
- `example/` — an Expo Router test app: permissions, the live current network, joining and leaving, probing and
  fetching a device, and on Android scanning and the Wi-Fi switch. `example/scripts/cdp.mjs` drives its JS (`wifi` is
  the library); `example/scripts/e2e.js` holds the unattended checks.

## Commands

```sh
bun install
bun run check        # biome
bun run typecheck
bun run test         # bun test
bun run prepare      # lefthook install, bob build + plugin
bun run build:android:prepare && bun run build:android
bun run build:ios:prepare && bun run build:ios
bun run --cwd docs start
```

No Jest, ESLint or Prettier. Commits and PR titles follow Conventional Commits (commitlint); release-please turns
them into versions and the changelog. See CONTRIBUTING.md.

## Rules

- Every async op settles exactly once: on its callback, its timeout, a cancel, or teardown. A failure, a timeout or
  an abort leaves the phone where it was.
- No hidden timers, sleeps or retries. Only the caller's timeouts bound waiting (defaults in `config.ts`). Where the
  OS forces one (iOS reports no event on joining, and can fail right after a hotspot opens), it is a named constant
  with a comment saying why.
- A newer join replaces an earlier one; leaving the earlier one never removes the configuration the current join
  uses.
- Errors are `WifiError` with a `WifiErrorCode` that names what the caller can do; argument errors reject, never throw.
- Native method and event names (`reachable`, `getCurrentWifiNetwork`, `forgetJoinedNetworks`, ...) are older than the
  public names and stay as they are.
- Swift and Kotlin follow their own conventions and idioms, not TypeScript's. A change is judged by correctness on
  real phones, not by matching the other platform.

## Verifying a change

- Unit tests and both builds; then real phones. Simulators and emulators can't join Wi-Fi.
- Permission prompts need release builds and a fresh install per round: a debug build reaches Metro on the local
  network and so triggers the local network alert itself.
- Behavior that a shipped app relied on is ported faithfully; prove a change on real devices before replacing it.

## Docs

English and Chinese, in the style of Expo's docs; change both together. If one sentence can say it, don't use two.
