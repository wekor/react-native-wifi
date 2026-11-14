# Contributing

## Development workflow

This is a Bun workspaces repository: the library lives at the root and `example/` is an Expo app used to develop and
verify the native code. You need the Node.js version in [`.nvmrc`](./.nvmrc) and the Bun version in
[`.bun-version`](./.bun-version).

```sh
bun install         # also builds lib/ and plugin/build, and installs the git hooks
bun run check       # Biome lint + format check (`bun run fix` writes fixes)
bun run typecheck   # tsc for the library, the tests, the example and the config plugin
bun run test        # unit tests of the library and the config plugin
bun run prepare     # build lib/ with react-native-builder-bob, and plugin/build
```

Run the example with `bun run example ios` or `bun run example android`; start Metro alone with
`bun run example start`. JS changes reach the example without a rebuild; native changes need one.

To edit the native code in an IDE, open `example/ios/WiFiExample.xcworkspace` in Xcode (the sources are under
`Pods > Development Pods > ReactNativeWifi`) or `example/android` in Android Studio (the `wekor_react-native-wifi`
module).

The Expo config plugin lives in `plugin/src` and compiles to `plugin/build`, which `app.plugin.js` loads. After editing
it, run `bun run prepare` before `npx expo prebuild` in the example.

To compile the native code without a phone, as CI does:

```sh
bun run build:android:prepare && bun run build:android
bun run build:ios:prepare && bun run build:ios
```

Wi-Fi can't be tested on a simulator or an emulator: verify joining, leaving and probing on real phones, against a
real hotspot device or a TCP service on your computer. `example/scripts/e2e.js` holds the checks that need no one at
the phone; see the comment at its top for how to run it through `example/scripts/cdp.mjs`.

## Commit message convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `fix: …`, `feat: …`, `refactor: …`,
`docs: …`, `test: …`, `chore: …`, `ci: …`, with an optional scope such as `fix(ios): …`. Mark breaking changes with
`!` (`feat!: …`). A `commit-msg` hook (lefthook + commitlint) checks every commit, and a `pre-commit` hook runs Biome
on the staged files.

## Pull requests

Every change reaches `main` through a squash-merged pull request:

```sh
git switch main && git pull
git switch -c fix/short-description      # or feat/…
# commit with a Conventional Commit message, e.g. "fix(android): …"
git push -u origin fix/short-description
gh pr create --fill
# wait for CI to pass, then "Squash and merge"
```

The squash commit takes the **PR title** as its message, so the title must follow Conventional Commits too (the
`PR title` check enforces it). Merging a PR does not publish anything.

CI runs on pull requests only, split by platform so a PR only waits for what it touches:

- `ci.yml` (every PR): Biome, type check, the library build and the unit tests.
- `android.yml` (when `android/` or a shared path changes): an Android build of the library module.
- `ios.yml` (when `ios/`, the podspec or a shared path changes): an iOS simulator build of the example.

Shared paths are `src/`, `plugin/src/`, `example/`, `bun.lock` and the CI setup; keep the lists in `android.yml` and
`ios.yml` in sync. A docs-only PR runs `ci.yml` alone.

## Publishing to npm

Releases are automated with [release-please](https://github.com/googleapis/release-please). Every merge to `main`
opens (or updates) a release PR titled `chore(main): release X.Y.Z`, which bumps the version in `package.json` and
updates `CHANGELOG.md` from the Conventional Commits since the last release: `fix` → patch, `feat` → minor (breaking
changes also bump minor while we're on 0.x). `chore`, `docs`, `ci` and similar commits don't trigger a release.

To publish, merge that release PR. The `Release` workflow (`.github/workflows/publish.yml`) then tags `vX.Y.Z`,
creates the GitHub release, publishes to npm via Trusted Publishing, and deploys the docs to GitHub Pages. Nothing
runs locally. No CI runs on the release PR, since it only changes the version and changelog.

### Repository setup

Done once, for reference:

- **Settings → Actions → General**: "Allow GitHub Actions to create and approve pull requests", so release-please can
  open its PR.
- **Settings → General → Pull Requests**: allow squash merging only, with the PR title as the commit message.
- **Settings → Pages**: source "GitHub Actions"; the `docs` environment deploys from `main`.
- **npm**: 0.1.0 was published by hand (`npm publish --access public`), since a Trusted Publisher can only be added to
  a package that exists. Then, on npmjs.com, the package's **Settings → Trusted Publisher**: GitHub Actions,
  repository `wekor/react-native-wifi`, workflow `publish.yml`.

## Sending a pull request

- Prefer small pull requests focused on one change.
- Verify that the checks and tests pass, and that the change works on real phones.
- Update the docs (English and Chinese) when the API or its behavior changes.
- For pull requests that change the API or the implementation, discuss with maintainers first by opening an issue.

Please follow the [code of conduct](./CODE_OF_CONDUCT.md) in all your interactions with the project.
