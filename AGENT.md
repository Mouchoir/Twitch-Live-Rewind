# AGENT.md — Twitch Live Rewind

This file orients AI coding agents working in this repository. Read it before making changes.

## 1. What this project is

A browser extension (Chrome + Firefox, Manifest V3) that adds a "Rewind" button to the Twitch live player. Clicking it (or pressing the Left Arrow key) overlays the channel's growing VOD a configurable number of seconds behind live, so the user can replay what they just missed without reloading the page. Clicking "Live" (or pressing Right Arrow past the seek point) returns to the real live player.

No backend, no build tooling, no package manager, no tests. It is plain HTML/CSS/JS loaded directly by the browser as a content script + popup.

- Current version: `1.3.1` (see `manifest.json` / `manifest.firefox.json`)
- Repo: https://github.com/Mouchoir/Twitch-Live-Rewind
- Published on the Chrome Web Store and Firefox Add-ons (see README badges)
- License: none declared in the repo (no LICENSE file present)

## 2. Repository layout

```
manifest.json            Chrome/Chromium MV3 manifest
manifest.firefox.json    Firefox MV3 manifest (adds browser_specific_settings.gecko)
src/
  content.js              All content-script logic (single IIFE, no modules, no bundler)
  content.css             Styles injected into the Twitch page (rewind button, overlay, messages)
popup/
  popup.html              Extension toolbar popup UI
  popup.js                Popup logic (reads/writes settings)
  popup.css                Popup styles
lib/
  hls.min.js              Vendored third-party library (hls.js), used verbatim, NOT authored here
icons/                    Extension icons (16/32/48/128)
assets/                   README/store images
scripts/
  build-chrome.ps1         Copies source files into dist/chrome
  build-firefox.ps1        Copies source files into dist/firefox and renames manifest.firefox.json -> manifest.json
dist/                      Generated build output (gitignored, checked out locally here but not tracked) — DO NOT hand-edit
.github/ISSUE_TEMPLATE/    GitHub issue template(s) shown when someone opens "New issue"
README.md                 User-facing documentation
.gitignore / .gitattributes
```

There is **no** `package.json`, no npm scripts, no linter config, no CI workflow, and no automated tests anywhere in this repo. Everything is authored as plain, dependency-free JavaScript that runs directly in the browser.

`dist/` is listed in `.gitignore` but exists on disk in this checkout as leftover local build output (from `scripts/build-*.ps1`). Never edit files under `dist/` directly — they are copies of `src/`, `popup/`, `lib/`, `icons/`, `assets/`, `README.md`, and the relevant `manifest*.json`. Edit the source files and rebuild instead.

## 3. Build & packaging

There is no dev server and nothing to compile. "Building" just means assembling the unpacked extension folder per browser:

- Chrome: `powershell -File scripts/build-chrome.ps1` → produces `dist/chrome/` (includes `manifest.json` as-is).
- Firefox: `powershell -File scripts/build-firefox.ps1` → produces `dist/firefox/`, and copies `manifest.firefox.json` to `dist/firefox/manifest.json`.

Both scripts simply delete and recreate the target `dist/<browser>` folder, then copy: `assets`, `icons`, `lib`, `popup`, `src`, `README.md`, plus the manifest. They must be run with PowerShell (`.ps1`); there is no cross-platform build script.

Manual load for testing:
- Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" → select the repo root (uses `manifest.json` directly) or `dist/chrome`.
- Firefox: run the Firefox build script first, then `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on..." → select `dist/firefox/manifest.json` (Firefox cannot load the repo root directly because it needs `manifest.firefox.json` renamed to `manifest.json`).

Release zips (e.g. `dist/twitch-live-rewind-1.3.1-chrome.zip`) are produced manually and are gitignored (`*.zip`, `*.xpi`).

### When bumping the version

Update the `version` field in **both** `manifest.json` and `manifest.firefox.json` — they are not templated from a single source and must be kept in sync manually. Also keep `name`, `description`, `icons`, `host_permissions`, and `content_scripts` in sync between the two manifest files; the only intentional differences are `browser_specific_settings.gecko` (Firefox-only) and, historically, whichever host-permission/manifest quirks each store requires.

## 4. Architecture & data flow (src/content.js)

`content.js` is a single self-invoking function, no imports, relying on `lib/hls.min.js` being loaded first (both are listed in `content_scripts.js` in that order in the manifest). It also assumes `browser` (Firefox) or `chrome` (Chromium) as the WebExtension API namespace, aliased once as `WEB_EXTENSION`.

High-level flow when the user triggers Rewind:

1. `getChannelFromPath()` parses the channel login from the current Twitch URL path, filtering out non-channel routes (`videos`, `directory`, `downloads`, `settings`, `subscriptions`, `wallet` as the first path segment) as well as channel-scoped clip/VOD routes (`/<channel>/clip/<slug>`, `/<channel>/clips`, `/<channel>/v/<id>`), which render their own short-form player instead of the live player.
2. `getLiveArchive(channelLogin)` calls the **Twitch GraphQL API** (`https://gql.twitch.tv/gql`) with a hardcoded public web client ID (`TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"`, the same ID Twitch's own web player uses) to find the currently-live stream's `archiveVideo` (the growing VOD), or falls back to scanning the channel's recent `ARCHIVE` videos for one that started close to the live stream's `createdAt` timestamp (within 6 hours).
3. `getVodAccessToken()` requests a playback access token (signature + value) for that VOD id via another GQL query.
4. `getUsherPlaylistUrl()` builds a `usher.ttvnw.net` HLS manifest URL from the access token and validates it's fetchable.
5. If Usher rejects the VOD (common — many channels don't expose an accessible growing VOD while live), `createFallbackPlaylist()` builds a manifest **manually** by deriving the VOD's CDN "special id" from its `seekPreviewsURL` (storyboard thumbnails URL) and probing `index-dvr.m3u8` files per quality directly on the CDN host. This fallback technique mirrors the public approach used by the TwitchNoSub project (credited in README).
6. `loadHls()` attaches `hls.js` (if `Hls.isSupported()`) or falls back to native HLS (`video.canPlayType(...)`, e.g. Safari) to a `<video>` element created inside an absolutely-positioned overlay (`createOverlay()`) on top of the real Twitch player. Playback starts at `liveElapsedSeconds - rewindDelaySeconds`.
7. Because the source VOD keeps growing while the user watches, `refreshGrowingVod()` runs on an interval (`PLAYLIST_REFRESH_MS = 15000`) and reloads the HLS source when playback nears the currently-known end of the manifest (`NEAR_END_SECONDS = 4`), preserving current time/pause state.
8. `stopRewind()` tears down the HLS instance/overlay and resumes the original (muted-while-rewinding) live `<video>` element.

Other important behaviors:

- **Route/SPA handling**: Twitch is a single-page app, so a `MutationObserver` on `document.documentElement` plus a 1s `setInterval` both call `handleRouteChange()`, which detects URL changes, tears down rewind state, and re-creates the button (`ensureButton()`) after a 600ms delay to let Twitch's own player remount.
- **Button placement & visibility**: the button is injected into the detected player container (`getContainer()`, which walks up from the first non-overlay `<video>`). Its visibility is synced with Twitch's native controls visibility (mouse movement/focus) via a 250ms poll (`syncNativeControlsVisibility`) plus pointer/focus event listeners, since there's no reliable native event for "controls just became visible."
- **Live-only gating**: the button is only shown when the channel is actually live. Since an offline channel's page can autoplay a past VOD/rerun at the same URL as the live page (`twitch.tv/<channel>`), URL-based detection alone (`getChannelFromPath`) is not enough. `ensureButton()` calls `isChannelLive(channelLogin)` (a lightweight GQL query for `user.stream.id`, cached for `LIVE_STATUS_TTL_MS` = 30s per channel) and only creates/keeps the button when it resolves `true`; otherwise it calls `removeButton()`. This check is skipped (button always kept) while a rewind is actively playing (`state.overlay` set), so the "Live" control to exit rewind doesn't disappear mid-session if the stream ends. Because `ensureButton()` runs on every ~1s route-poll tick, this also makes the button appear/disappear automatically if the channel goes live/offline without a page reload, without spamming the API (thanks to the cache).
- **Keyboard shortcuts**: Left Arrow starts rewind or seeks backward by the configured delay; Right Arrow seeks forward (only while already rewinding). Ignored while typing in editable fields, and ignored if any modifier key is held. Can be toggled off entirely via the `keyboardRewindEnabled` setting. The listener uses `capture: true` on `keydown` to intercept before Twitch's own handlers. Like the button (see live-only gating below), the hotkeys are only hijacked when not already rewinding and `isKnownLive(channelLogin)` confirms (from the same cache `ensureButton()` populates) that the channel is live; otherwise `preventDefault`/`stopImmediatePropagation` are never called and the event falls through to Twitch's native player (e.g. native VOD/clip seeking still works with the arrow keys). This check is synchronous (reads the cache only) since a `keydown` handler cannot await a network call.
- **Settings storage**: uses `chrome.storage.sync` / `browser.storage.sync` (works across the user's signed-in browser instances) for `rewindDelaySeconds` (5–600s, default 20) and `keyboardRewindEnabled` (default true), falling back to `window.localStorage` if the storage API throws (e.g. unpacked/temporary installs without sync). Both `content.js` and `popup.js` implement `clampDelay()` and the storage fallback independently (duplicated logic — keep both in sync if you change validation rules or default values).
- **Fullscreen**: pressing `f`/`F` while the rewind overlay is active toggles fullscreen on the overlay itself rather than Twitch's player, and double-clicking the overlay does the same.
- Logging is minimal and prefixed: `log(...)` → `console.log("[Twitch Live Rewind]", ...)`. These logs only ever go to the DevTools console of the Twitch tab (F12 → Console, filter for "[Twitch Live Rewind]") — there is no persistent storage of logs, no crash reporting, and no telemetry sent anywhere (consistent with the `permissions`/`host_permissions` list in the manifest, which only cover `storage` and the specific Twitch/CDN hosts the extension talks to).

## 5. Manifest / permissions

- `permissions`: `storage` only.
- `host_permissions`: Twitch's main domain, GraphQL API (`gql.twitch.tv`), Usher (`usher.ttvnw.net`), and the CDN hosts used for VOD segments/manifests (`*.cloudfront.net`, `*.twitchcdn.net`, `*.ttvnw.net`).
- Content script runs on `*://*.twitch.tv/*` at `document_idle`, injecting `lib/hls.min.js` then `src/content.js`, plus `src/content.css`.
- Firefox manifest additionally declares `browser_specific_settings.gecko` with `strict_min_version: "109.0"` and `data_collection_permissions.required: ["none"]`.

If you add a new remote endpoint the extension talks to, add its origin to `host_permissions` in **both** manifest files.

## 6. Conventions for changes in this repo

- Vanilla JS only, ES2020+ features are fine (used already: optional chaining, nullish coalescing, arrow functions, `Array.prototype.flatMap`). No TypeScript, no build step — code must run as-is in the browser.
- Keep `content.js` dependency-free aside from the globally-loaded `Hls` object from `lib/hls.min.js`.
- Do not modify `lib/hls.min.js` — it's a vendored, minified third-party library. Update it by replacing the whole file with a newer official build if ever needed.
- CSS class names use a `tlr-` prefix (Twitch Live Rewind) to avoid colliding with Twitch's own classes; keep using that prefix for anything new.
- Match the existing code style: 2-space indentation, double quotes, semicolons, `const`/`let` (no `var`), small single-purpose functions attached to a shared `state` object rather than classes.
- Update `README.md` if you change user-facing behavior (default/min/max delay, keyboard shortcut behavior, settings UI, install steps).
- There is no test suite; verify changes by manually loading the unpacked extension in Chrome and/or Firefox against a live Twitch channel (per §3) and exercising: starting/stopping rewind, keyboard shortcuts, settings popup persistence, and route changes (navigating between channels without a full page reload).
- Commit message style in history is short imperative/conventional-ish (`feat: ...`, `fix: ...`, `chore: ...`); follow that pattern.

## 7. Known constraints / things to be careful about

- The Twitch GraphQL client ID is hardcoded and public (it's the same one Twitch's own web client uses); it is not a secret, but if Twitch rotates or blocks it, VOD lookups will break entirely.
- Not all live channels expose a growing VOD (subscriber-only VODs, VOD-disabled channels, or channels where Twitch hasn't attached `archiveVideo` yet). The extension is expected to show a message and leave the native player untouched in that case — don't "fix" this by trying to force a rewind when no VOD is available.
- Music/audio may be muted in the VOD-based rewind for some channels due to Twitch's copyright/rights handling on VODs even though it played live — this is a documented, expected limitation, not a bug to chase.
- The fallback manual playlist builder (`createFallbackPlaylist`) is inherently fragile: it depends on parsing undocumented Twitch/CDN URL conventions (`seekPreviewsURL` storyboard path) that can change without notice.
- `dist/` in this local checkout contains generated files that mirror `src/`/`popup/`/etc. Never treat `dist/` as the source of truth or edit it directly — always edit the top-level `src/`, `popup/`, `manifest*.json` and rerun the build scripts.
- No automated CI/tests exist to catch regressions — be extra careful with manual QA on both Chromium and Firefox-based browsers before considering a change done, since MV3 behavior and `browser`/`chrome` namespace availability differ subtly between them.
- **Sandbox/mount sync lag on large edited files**: in an agent session where this repo is mounted into a separate shell sandbox (e.g. a network/host drive bridged into a Linux VM), the shell's view of a file that was just modified via the editing tool (not shell commands) can lag or serve a truncated snapshot — observed concretely on `src/content.js` (tens of KB), where `wc -l`/`cat`/`node --check` run from the shell repeatedly reported a shorter, stale version of the file well after it was correctly written. The file-editing tool's own view (re-reading the file through it) was always correct and consistent. Lesson: after editing a non-trivial file in such a setup, verify by re-reading it through the same editing/file tool used to write it — not through shell commands — and never build a release package (zip, `dist/` copy) by shell-copying a large file that was edited earlier in the same session; instead re-write its known-correct content directly through the file tool at the destination path.
- **The same mount is also unsafe for stateful git operations**: running `git add`/`git status` repeatedly against this mount was observed to corrupt `.git/index` ("bad signature" / "index file corrupt") after only two `update-index` calls, and separately left a stray `.git/index.lock` that blocked all further git commands (the shell also could not `rm` it — file deletion in the mounted folder needs to be explicitly re-enabled per session). Safe pattern: don't build up the index incrementally across multiple shell calls. Instead, write file contents directly via `git hash-object -w` (fed from a heredoc or from a file already known to be correct, e.g. a copy staged under `/tmp`), assemble tree objects with `git mktree` by combining new blob SHAs with unchanged entries from `git ls-tree HEAD`/`git ls-tree HEAD:<subdir>`, create the commit with `git commit-tree <tree> -p HEAD -m "..."`, and move the branch with `git update-ref refs/heads/main <commit>`. This never touches `.git/index` and is safe to run repeatedly. Finish with a single `git reset --hard` to resync the working tree and rebuild a fresh index in one shot.

## 8. Release pipeline — owned end-to-end by the agent

Once the user gives the go-ahead to ship a validated change, the agent is expected to run the **entire** release pipeline itself, without asking the user to run commands manually, up to (but not including) the actual store submissions:

1. Bump `version` in both `manifest.json` and `manifest.firefox.json` if not already done (§3, "When bumping the version").
2. Rebuild both targets: regenerate `dist/chrome` and `dist/firefox` (mirroring `scripts/build-chrome.ps1` / `scripts/build-firefox.ps1`; the sandbox cannot execute `.ps1` directly, so replicate the same copy steps and manifest rename — see the sync-lag caveat above for how to do this safely).
3. Produce versioned release zips (e.g. `dist/twitch-live-rewind-<version>-chrome.zip`, `dist/twitch-live-rewind-<version>-firefox.zip`) ready for upload.
4. Commit the changes and push to `origin/main` (or open a PR if asked), and tag the release (e.g. `v<version>`) / create a GitHub release if requested.
5. Hand off only the final store submission step to the user: uploading the zip and filling out the listing on the Chrome Web Store Developer Dashboard and the Firefox Add-on Developer Hub, since that requires the user's own store accounts/credentials that the agent doesn't have access to.

The user should not have to manually run build scripts, zip files, or git commands themselves for a routine release — that is the agent's job once given the go-ahead. Note: pushing to `origin` requires the user's own git credentials, which the agent does not have access to in a sandboxed session — the agent should still prepare the commit/tag locally (this repo checkout lives on the user's real machine) so the user only needs to run `git push origin main --tags` themselves.
