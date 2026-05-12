<p align="center">
  <img src="https://github.com/Mouchoir/Twitch-Live-Rewind/blob/main/assets/twitch-rewind-readme.png?raw=true" alt="Twitch Live Rewind" width="128">
</p>

# Twitch Live Rewind

Add instant rewind to Twitch live streams.

Twitch Live Rewind adds a small `Rewind` button directly on the Twitch player, so you can jump a few seconds behind the live broadcast without refreshing the page or leaving the stream. Choose how far behind live playback starts, enjoy the replay at your own pace, then stay behind or click `Live` to return to the real live player.

## Why Use It?

- Rewatch a moment you just missed during a live stream.
- Step back from stream delay, buffering, or a quick distraction.

## How It Works

Twitch Live Rewind looks for the live stream's growing VOD and plays it in an overlay above the normal Twitch player. The original live player stays in place, so returning to live is fast and simple.

## Supported Browsers

- Chrome and Chromium-based browsers
- Firefox

Store releases are planned for normal installs and automatic updates.

## Settings

Click the extension icon to choose how far behind live the rewind should start.

- Default delay: `20` seconds
- Minimum delay: `5` seconds
- Maximum delay: `600` seconds

## Good To Know

- Some Twitch channels do not expose an accessible growing VOD while live. In that case, the extension shows a message and leaves the normal live player untouched.
- If music disappears while using Rewind, this is expected for some channels. The extension uses the channel's VOD to play the delayed stream, and some creators or rights settings remove music from VODs even while it is audible in the live stream.
- Rewind availability depends on Twitch's VOD behavior for each channel.

## Manual Install

### Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder.

### Firefox

1. Run `scripts/build-firefox.ps1`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on...`.
4. Select `dist/firefox/manifest.json`.

## Credits

The fallback VOD playlist discovery follows the same public idea used by TwitchNoSub, with thanks to the TwitchNoSub project: https://github.com/besuper/TwitchNoSub
