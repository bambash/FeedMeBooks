# HANDOFF — FeedMeBooks (written 2026-10-06 02:40 UTC, Play Store readiness for the native app)

Committed checkpoint for the next session. Read the project's instruction files first; this file holds only what the repo and git history cannot tell you.

## Where things are
- `main` = 0092c02 (PR #30). Working branch = `ccr-b0fac2fa-o3j2ps`, 3 commits ahead of `main`, not yet a PR. No worktrees, no open spec changes.
- CI on the branch: *Native APK* run 37403807946 (ad997cc) is green on both jobs (POC APK and unsigned store bundle) with AGP 8.10.1, compileSdk/targetSdk 36. The 16 KB alignment check step added after that run has not been exercised yet.
- Cloud sessions cannot build `:app` or run Gradle at all: Google's Maven (dl.google.com) and GitHub artifact storage are blocked by the proxy. CI is the only verifier; the public Actions API (`api.github.com/.../actions/runs/<id>`) is reachable for polling.
- Lanes: none.

## What shipped this session
- cdc4d28: store build is `com.feedmebooks.app` (release) with the Lab moved to a `poc` build type (`com.feedmebooks.poc`, `src/poc/`), signing from `FEEDMEBOOKS_KEYSTORE_*` env, 16 KB linker flag on `whisper_jni`, `native-release.yml` on `v*` tags, Expo `build.yml` deleted, `docs/play-store.md`, `docs/privacy-policy.md`, `native/store/listing.md`.
- ad997cc: the POC workflow also builds the unsigned store bundle every push (manual `workflow_dispatch` is refused for the Claude integration, 403).

## Next (in order)
1. Confirm the new *Check 16 KB page alignment* step passes on the latest push (Actions → Native APK → newest run on `ccr-b0fac2fa-o3j2ps`); done when the step prints `ok: lib/arm64-v8a/libwhisper_jni.so (0x4000)`.
2. Open a PR from `ccr-b0fac2fa-o3j2ps` to `main` and merge; done when *Native APK* is green on `main`.
3. User, on a trusted machine: generate the upload key and set the four `FEEDMEBOOKS_KEYSTORE_*` secrets (commands in `docs/play-store.md`); done when a `v0.1.0` tag's *Native Release* run uploads an artifact named `feedmebooks-0.1.0-<n>.aab` without the "unsigned" warning.
4. User, Play Console: create the app `com.feedmebooks.app`, host `docs/privacy-policy.md` at a public URL, fill the forms listed in `docs/play-store.md`, take phone screenshots into `native/store/`; done when the internal-track release is live.
5. Install the store build on a phone that never had the POC app and walk through import, both handoffs, background playback, sleep timer; done when none of it regresses against the POC APK.

## Decisions and non-goals
- Decided: `applicationId = "com.feedmebooks"` with build-type suffixes `.app` (release) and `.poc`, so the store id is final and the POC APK keeps installing over itself. The namespace stays `feedmebooks.app`.
- Decided: Lab/spike screens compile only in the `poc` build type; `LibraryActivity` reaches them by intent action `feedmebooks.app.action.LAB` guarded by `BuildConfig.LAB`, so `main` never references their classes.
- Decided: `versionCode` = *Native Release* run number, `versionName` = tag. Never recreate that workflow under another name without setting `VERSION_CODE` above the last Play upload.
- Decided: Readium stays at 3.1.2 and R8 stays off; neither is a Play requirement and both need a device test.
- Decided: deleted `.github/workflows/build.yml` (Expo EAS production build) because it claimed `v*` tags; `ci.yml` (Expo typecheck/tests/debug APK) is still green and was left alone.
- Rejected: committing any store keystore; only the throwaway POC key is in git, and `.gitignore` now blocks `native/app/*.keystore` except it.
- Earlier: HANDOFF.md is committed, not git-excluded; hooks resolve the repo root from `$CLAUDE_PROJECT_DIR`; staleness is counted in commits.

## Waiting on the user
- Upload key + secrets, Play Console account/forms, screenshots, privacy-policy hosting (Next 3–4). Nothing in the repo can do these.
- Merge of the branch (Next 2).

## Gotchas learned (not in the repo)
- `git fetch origin <a> <b>` fails entirely if either ref is missing → fetch refs one at a time; the pre-created local `origin/main` can lag GitHub → `git fetch origin main` first.
- `mcp__github__actions_run_trigger` (workflow_dispatch) → 403 "Resource not accessible by integration" → add a CI job instead of dispatching by hand.
- Artifact download URLs point at `*.blob.core.windows.net`, which the proxy denies → verify build outputs with CI steps (`readelf`, `unzip`) rather than locally.
- A push to the same branch cancels the in-progress *Native APK* run (`cancel-in-progress: true`), so a wait on the old run id ends as "cancelled".
- The once-an-hour stale reminder is throttled by a stamp file in `.git/`; pass `--force` to test it twice.
