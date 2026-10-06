# Play Store release

What it takes to ship the native app (`native/`) to Google Play, what the repo already does,
and what only the Play Console can do. Keep this current as the listing moves.

## Identity (fixed once published)

| | Value | Where |
|---|---|---|
| Application id | `com.feedmebooks.app` | `native/app/build.gradle.kts` (`applicationId` + release suffix) |
| POC id | `com.feedmebooks.poc` | `poc` build type; installs alongside the store app |
| Name | FeedMeBooks | `res/values/strings.xml` |
| Category | Books & Reference | Play Console |
| Minimum Android | 8.0 (API 26) | `minSdk` |
| Target Android | 16 (API 36) | `targetSdk`; Play requires 36 for new apps and updates since 2026-08-31 |
| ABI | arm64-v8a only | `abiFilters`; Play shows the app only to 64-bit ARM devices (every current phone) |

## Build types

- **release**: the store build. No Lab screens, id `com.feedmebooks.app`, signed with the
  upload key when the four `FEEDMEBOOKS_KEYSTORE_*` variables are set, otherwise unsigned.
- **poc**: what the *Native APK* workflow publishes on every push. Same optimized code plus the
  Lab screens (`src/poc/`), id `com.feedmebooks.poc`, signed with the committed throwaway key
  so new builds install over old ones.

```bash
./gradlew :app:assemblePoc      # app/build/outputs/apk/poc/app-poc.apk
./gradlew :app:bundleRelease    # app/build/outputs/bundle/release/app-release.aab
```

## Versioning

- `versionName` comes from the tag (`v1.2.3` → `1.2.3`); `VERSION_NAME` overrides it.
- `versionCode` is the *Native Release* workflow's run number (`VERSION_CODE` overrides it).
  Play requires it to go up on every upload, so never re-create that workflow under a new
  name (run numbers would restart at 1); if that ever happens, set `VERSION_CODE` above the
  last uploaded value.

## Signing: one-time setup

Use Play App Signing: Google holds the app signing key, you hold an *upload* key. Generate the
upload key once, on a machine you trust, and keep the file and passwords in a password manager.
It is never committed (`.gitignore` covers `native/app/*.keystore` except the POC key).

```bash
keytool -genkeypair -v -keystore upload.keystore -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 -storetype PKCS12
base64 -w0 upload.keystore > upload.keystore.b64
```

Then in GitHub → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `FEEDMEBOOKS_KEYSTORE_BASE64` | contents of `upload.keystore.b64` |
| `FEEDMEBOOKS_KEYSTORE_PASSWORD` | the keystore password |
| `FEEDMEBOOKS_KEY_ALIAS` | `upload` |
| `FEEDMEBOOKS_KEY_PASSWORD` | the key password (same as the keystore password for PKCS12) |
| `PLAY_SERVICE_ACCOUNT_JSON` | optional: a Play Console service-account key, so tagged builds land on the internal track by themselves |

If the upload key is ever lost, Play App Signing lets you register a new one from the Console
(App integrity → App signing → Request upload key reset).

## Releasing

1. Merge to `main`, then tag: `git tag v1.0.0 && git push origin v1.0.0`.
2. *Native Release* runs `:core:test`, builds the signed AAB, keeps it as a workflow artifact
   for 90 days, and uploads it to the **internal** track when `PLAY_SERVICE_ACCOUNT_JSON` is
   set. Without it, download the artifact and upload it in Play Console → Testing → Internal.
3. Promote in the Console: internal → closed → production. The first production release of a
   personal developer account created after November 2023 needs a closed test with at least
   12 testers opted in for 14 days first, then an application for production access.

A manual *Native Release* run (Actions → Native Release → Run workflow) builds the same
bundle from any branch without uploading it; use it to check the store build before tagging.

## Play Console checklist

Nothing below lives in the repo; it is all forms in the Console.

- **App details**: name, default language, app or game, free. Category Books & Reference.
- **Store listing**: text from [`../native/store/listing.md`](../native/store/listing.md);
  icon `native/store/icon-512.png`; feature graphic `native/store/feature-graphic-1024x500.png`;
  at least 2 phone screenshots (16:9 or 9:16, each side 320–3840 px, PNG or JPEG, 8 MB max).
  Take them from a device with a real book: the library, the reader with the narrator
  highlight, the "Resume where you were listening?" offer, the lock-screen player. Put them
  in `native/store/` so the listing can be rebuilt.
- **Privacy policy**: Play requires a public URL for every app. The text is in
  [`privacy-policy.md`](privacy-policy.md); host it (GitHub Pages on this repo is enough)
  and paste the URL under App content → Privacy policy.
- **Data safety**: the app collects and shares no user data. The only network request is the
  one-time speech-model download from Hugging Face, which is not data collection by us.
  Answer: no data collected, no data shared, data is not encrypted in transit (not applicable),
  users cannot request deletion because nothing is held.
- **Content rating**: fill in the IARC questionnaire as a Reference/Utility app with
  user-provided content; expect Everyone.
- **Target audience**: 18 and over (or 13+); not designed for children. Say no to "appeals
  to children".
- **Ads**: none. **Government app**: no. **Financial features**: none. **Health**: none.
- **Foreground service**: the app declares `mediaPlayback`. If the Console asks for a
  foreground-service declaration, the reason is background audiobook playback with
  lock-screen controls; a short screen recording of play → lock screen covers the evidence.
- **Permissions**: `INTERNET` (model download) and the two foreground-service permissions.
  No storage permissions: books and audio come in through the system file picker (Storage
  Access Framework) with persisted read grants.
- **App access**: all features are available without a login; no special access needed.
- **News app**: no.

## Before the first production release

- Pre-launch report (Console → Testing → Pre-launch report) runs the bundle on real devices
  and flags crashes, accessibility issues and the 16 KB page-size check. The native library
  is linked with 16 KB page alignment (`CMakeLists.txt`); the report will confirm it.
- Test the store build, not only the POC APK: install the AAB through the internal track
  (or `bundletool build-apks --local-testing`) on a phone that has never had the POC app, and
  walk through import, handoff both ways, background playback, and the sleep timer.
- Decide whether to enable R8 (`isMinifyEnabled`). It is off: nothing in Play requires it,
  the APK is dominated by the native library and Readium, and Readium's reflection would need
  keep rules and a device test first.
