(() => {
  "use strict";

  const TWITCH_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";
  const DEFAULT_DELAY_SECONDS = 20;
  const MIN_DELAY_SECONDS = 5;
  const MAX_DELAY_SECONDS = 600;
  const PLAYLIST_REFRESH_MS = 15000;
  const NEAR_END_SECONDS = 4;
  const STORAGE_KEY = "rewindDelaySeconds";
  const WEB_EXTENSION = globalThis.browser || globalThis.chrome;
  const BUTTON_TEXT = {
    idle: "Rewind",
    active: "Live",
    loading: "Loading..."
  };
  const NATIVE_CONTROL_SELECTORS = [
    "[data-a-target='player-controls']",
    "[data-a-target='player-controls-overlay']",
    "[data-a-target='video-player__overlay']",
    ".player-controls",
    "[class*='player-controls']",
    "button[data-a-target='player-fullscreen-button']",
    "button[aria-label*='Full screen' i]",
    "button[aria-label*='Fullscreen' i]"
  ];

  const QUALITY_ORDER = [
    ["chunked", { name: "Source", resolution: "1920x1080", frameRate: 60 }],
    ["1080p60", { name: "1080p60", resolution: "1920x1080", frameRate: 60 }],
    ["720p60", { name: "720p60", resolution: "1280x720", frameRate: 60 }],
    ["480p30", { name: "480p", resolution: "854x480", frameRate: 30 }],
    ["360p30", { name: "360p", resolution: "640x360", frameRate: 30 }],
    ["160p30", { name: "160p", resolution: "284x160", frameRate: 30 }]
  ];

  const state = {
    button: null,
    overlay: null,
    video: null,
    hls: null,
    route: "",
    refreshTimer: null,
    messageTimer: null,
    currentVod: null,
    playerContainer: null,
    originalVideo: null,
    controlsRaf: null,
    isButtonHovered: false,
    interactionTimer: null,
    interactionAbortController: null
  };

  function clampDelay(value) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return DEFAULT_DELAY_SECONDS;
    return Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, parsed));
  }

  function log(...args) {
    console.error("[Twitch Live Rewind]", ...args);
  }

  function getChannelFromPath() {
    const segment = window.location.pathname.split("/").filter(Boolean)[0] || "";
    if (!segment || ["videos", "directory", "downloads", "settings", "subscriptions", "wallet"].includes(segment)) {
      return null;
    }
    return /^[a-zA-Z0-9_]{3,25}$/.test(segment) ? segment.toLowerCase() : null;
  }

  function getHlsLibrary() {
    return globalThis.Hls || window.Hls;
  }

  function getMediaSource() {
    const Hls = getHlsLibrary();
    return Hls?.getMediaSource?.() || window.MediaSource || window.WebKitMediaSource || null;
  }

  function canPlayMuxedCodec(codec) {
    const mediaSource = getMediaSource();
    if (!mediaSource?.isTypeSupported) return true;
    return mediaSource.isTypeSupported(`video/mp4; codecs="${codec},mp4a.40.2"`);
  }

  function findPlayerContainer() {
    const video = document.querySelector("video");
    if (!video) return null;
    return video.closest("[data-a-target='video-player']") ||
      video.closest(".video-player") ||
      video.parentElement;
  }

  function ensurePositioned(element) {
    const style = window.getComputedStyle(element);
    if (style.position === "static") {
      element.style.position = "relative";
    }
  }

  function hasVisibleBox(element) {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isEffectivelyVisible(element, stopAt) {
    let current = element;
    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      if (
        current.hidden ||
        current.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number.parseFloat(style.opacity || "1") <= 0.03
      ) {
        return false;
      }
      if (current === stopAt) break;
      current = current.parentElement;
    }
    return hasVisibleBox(element);
  }

  function isNativeControlsVisible(container) {
    const controls = NATIVE_CONTROL_SELECTORS
      .flatMap((selector) => Array.from(container.querySelectorAll(selector)))
      .filter((element) => !element.closest(".tlr-overlay") && !element.classList.contains("tlr-control"));

    return controls.some((element) => isEffectivelyVisible(element, container));
  }

  function updateControlVisibilityClass() {
    const container = state.playerContainer;
    if (!container || !state.button?.isConnected) {
      return;
    }

    const visible = isNativeControlsVisible(container) ||
      state.isButtonHovered ||
      container.matches(":hover, :focus-within");
    container.classList.toggle("tlr-native-controls-visible", visible);
  }

  function markPlayerInteracting() {
    const container = state.playerContainer;
    if (!container || !state.button?.isConnected) return;

    container.classList.add("tlr-player-interacting");
    window.clearTimeout(state.interactionTimer);
    state.interactionTimer = window.setTimeout(() => {
      if (!state.isButtonHovered) {
        container.classList.remove("tlr-player-interacting");
      }
      updateControlVisibilityClass();
    }, 2200);
    updateControlVisibilityClass();
  }

  function attachPlayerInteractionListeners(container) {
    state.interactionAbortController?.abort();
    state.interactionAbortController = new AbortController();
    const listenerOptions = { signal: state.interactionAbortController.signal };
    container.addEventListener("pointermove", markPlayerInteracting, listenerOptions);
    container.addEventListener("focusin", markPlayerInteracting, listenerOptions);
  }

  function syncNativeControlsVisibility() {
    const container = state.playerContainer;
    if (!container || !state.button?.isConnected) {
      state.controlsRaf = null;
      return;
    }

    updateControlVisibilityClass();
    state.controlsRaf = window.requestAnimationFrame(syncNativeControlsVisibility);
  }

  function startControlVisibilitySync() {
    if (state.controlsRaf) return;
    state.controlsRaf = window.requestAnimationFrame(syncNativeControlsVisibility);
  }

  function showMessage(text) {
    const container = state.playerContainer || findPlayerContainer();
    if (!container) return;
    ensurePositioned(container);
    const existing = container.querySelector(".tlr-message");
    if (existing) existing.remove();
    const message = document.createElement("div");
    message.className = "tlr-message";
    message.textContent = text;
    container.append(message);
    window.clearTimeout(state.messageTimer);
    state.messageTimer = window.setTimeout(() => message.remove(), 8000);
  }

  async function getSettings() {
    try {
      const result = await WEB_EXTENSION.storage.sync.get({ [STORAGE_KEY]: DEFAULT_DELAY_SECONDS });
      return { rewindDelaySeconds: clampDelay(result[STORAGE_KEY]) };
    } catch {
      return {
        rewindDelaySeconds: clampDelay(window.localStorage.getItem(STORAGE_KEY))
      };
    }
  }

  async function gql(query, variables) {
    const response = await fetch("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: {
        "Client-Id": TWITCH_CLIENT_ID,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
      throw new Error(`Twitch GraphQL failed with ${response.status}`);
    }
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(payload.errors[0].message || "Twitch GraphQL returned an error");
    }
    return payload.data;
  }

  async function getLiveArchive(channelLogin) {
    const data = await gql(`
      query LiveRewindChannel($login: String!) {
        user(login: $login) {
          stream {
            createdAt
            archiveVideo {
              id
              createdAt
              seekPreviewsURL
            }
          }
          videos(first: 8, type: ARCHIVE, sort: TIME) {
            edges {
              node {
                id
                createdAt
                seekPreviewsURL
              }
            }
          }
        }
      }
    `, { login: channelLogin });

    const user = data.user;
    if (!user?.stream?.createdAt) {
      throw new Error("This channel is not live.");
    }

    const streamStartedAt = new Date(user.stream.createdAt);
    const archiveVideo = user.stream.archiveVideo;
    if (archiveVideo?.id && archiveVideo?.seekPreviewsURL) {
      return { vod: archiveVideo, streamStartedAt };
    }

    const candidates = (user.videos?.edges || [])
      .map((edge) => edge.node)
      .filter((video) => video?.id && video?.seekPreviewsURL)
      .map((video) => ({
        ...video,
        distanceMs: Math.abs(new Date(video.createdAt).getTime() - streamStartedAt.getTime())
      }))
      .sort((a, b) => a.distanceMs - b.distanceMs);

    const vod = candidates.find((candidate) => candidate.distanceMs < 6 * 60 * 60 * 1000);
    if (!vod) {
      throw new Error("No growing VOD is exposed for this live stream yet.");
    }

    return { vod, streamStartedAt };
  }

  async function getVodAccessToken(vodId) {
    const data = await gql(`
      query LiveRewindPlaybackAccessToken($id: ID!) {
        videoPlaybackAccessToken(
          id: $id,
          params: {
            platform: "web",
            playerBackend: "mediaplayer",
            playerType: "site"
          }
        ) {
          signature
          value
        }
      }
    `, { id: vodId });

    return data.videoPlaybackAccessToken;
  }

  async function getUsherPlaylistUrl(vodId) {
    const token = await getVodAccessToken(vodId);
    if (!token?.signature || !token?.value) {
      log("No playback access token for VOD", vodId);
      return null;
    }

    const params = new URLSearchParams({
      allow_source: "true",
      fast_bread: "true",
      playlist_include_framerate: "true",
      player_backend: "mediaplayer",
      reassignments_supported: "true",
      sig: token.signature,
      supported_codecs: "avc1",
      token: token.value
    });

    const url = `https://usher.ttvnw.net/vod/${vodId}.m3u8?${params.toString()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      log(`Usher playlist rejected VOD ${vodId} with ${response.status}`);
      return null;
    }
    return url;
  }

  function createServingId() {
    const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
    let id = "";
    for (let i = 0; i < 32; i += 1) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return id;
  }

  function getVodSpecialId(seekPreviewsURL) {
    const url = new URL(seekPreviewsURL);
    const pathParts = url.pathname.split("/");
    const storyboardsIndex = pathParts.findIndex((part) => part.includes("storyboards"));
    if (storyboardsIndex <= 0) return null;
    return {
      domain: url.host,
      vodSpecialId: pathParts[storyboardsIndex - 1]
    };
  }

  async function detectCodec(playlistUrl) {
    const response = await fetch(playlistUrl, { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.text();
    if (body.includes(".ts") && canPlayMuxedCodec("avc1.4D001E")) return "avc1.4D001E";
    if (body.includes(".mp4") && canPlayMuxedCodec("hev1.1.6.L93.B0")) return "hev1.1.6.L93.B0";
    return null;
  }

  async function createFallbackPlaylist(vod) {
    const special = getVodSpecialId(vod.seekPreviewsURL);
    if (!special) return null;

    let bandwidth = 8534030;
    let playlist = [
      "#EXTM3U",
      `#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="${createServingId()}",CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"`
    ];

    for (const [qualityKey, quality] of QUALITY_ORDER) {
      const playlistUrl = `https://${special.domain}/${special.vodSpecialId}/${qualityKey}/index-dvr.m3u8`;
      const codec = await detectCodec(playlistUrl);
      if (!codec) continue;
      playlist.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="${codec},mp4a.40.2",RESOLUTION=${quality.resolution},FRAME-RATE=${quality.frameRate},STABLE-VARIANT-ID="${qualityKey}"`,
        playlistUrl
      );
      bandwidth -= 100;
    }

    if (playlist.length <= 2) return null;
    const blob = new Blob([playlist.join("\n")], { type: "application/vnd.apple.mpegurl" });
    return URL.createObjectURL(blob);
  }

  async function getPlayablePlaylist(vod) {
    const usherUrl = await getUsherPlaylistUrl(vod.id);
    if (usherUrl) return usherUrl;
    const fallbackUrl = await createFallbackPlaylist(vod);
    if (!fallbackUrl) {
      log("Fallback playlist could not be built for VOD", vod.id, vod.seekPreviewsURL);
    }
    return fallbackUrl;
  }

  function createOverlay(container) {
    ensurePositioned(container);
    const overlay = document.createElement("div");
    overlay.className = "tlr-overlay";
    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    overlay.append(video);
    container.append(overlay);
    state.overlay = overlay;
    state.video = video;
    return video;
  }

  function pauseOriginalVideo() {
    state.originalVideo = Array.from(document.querySelectorAll("video"))
      .find((video) => !video.closest(".tlr-overlay"));
    if (!state.originalVideo) return;
    state.originalVideo.muted = true;
    try {
      state.originalVideo.pause();
    } catch {
      state.originalVideo.muted = true;
    }
  }

  function resumeOriginalVideo() {
    if (!state.originalVideo) return;
    state.originalVideo.muted = false;
    state.originalVideo.play().catch(() => {});
  }

  function loadHls(video, playlistUrl, startPosition) {
    if (state.hls) state.hls.destroy();

    const Hls = getHlsLibrary();
    if (Hls?.isSupported()) {
      const hls = new Hls({
        enableWorker: false,
        liveDurationInfinity: true,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        }
      });
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(playlistUrl);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.currentTime = Math.max(0, startPosition);
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) {
          showMessage("The rewound video stream stopped. Returning to live.");
          stopRewind();
        }
      });
      state.hls = hls;
      return;
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playlistUrl;
      video.addEventListener("loadedmetadata", () => {
        video.currentTime = Math.max(0, startPosition);
        video.play().catch(() => {});
      }, { once: true });
      return;
    }

    throw new Error("This browser cannot play HLS streams.");
  }

  async function refreshGrowingVod() {
    if (!state.video || !state.currentVod) return;
    const duration = Number.isFinite(state.video.duration) ? state.video.duration : 0;
    const closeToEnd = duration > 0 && duration - state.video.currentTime <= NEAR_END_SECONDS;
    if (!closeToEnd) return;

    const keepTime = state.video.currentTime;
    const wasPaused = state.video.paused;
    const playlistUrl = await getPlayablePlaylist(state.currentVod);
    if (!playlistUrl) return;

    if (state.hls) {
      const Hls = getHlsLibrary();
      if (!Hls?.Events) return;
      let manifestHandled = false;
      state.hls.loadSource(playlistUrl);
      state.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (manifestHandled) return;
        manifestHandled = true;
        state.video.currentTime = keepTime;
        if (!wasPaused) state.video.play().catch(() => {});
      });
    } else {
      state.video.src = playlistUrl;
      state.video.currentTime = keepTime;
      if (!wasPaused) state.video.play().catch(() => {});
    }
  }

  async function startRewind() {
    const channelLogin = getChannelFromPath();
    const container = findPlayerContainer();
    if (!channelLogin || !container) return;

    state.playerContainer = container;
    setButtonLoading(true);

    try {
      log("Starting rewind for channel", channelLogin);
      const [{ rewindDelaySeconds }, archive] = await Promise.all([
        getSettings(),
        getLiveArchive(channelLogin)
      ]);
      log("Found live archive VOD", archive.vod.id);
      const liveElapsedSeconds = Math.floor((Date.now() - archive.streamStartedAt.getTime()) / 1000);
      const targetPosition = Math.max(0, liveElapsedSeconds - rewindDelaySeconds);
      const playlistUrl = await getPlayablePlaylist(archive.vod);
      if (!playlistUrl) {
        throw new Error("The VOD playlist is not accessible for this stream.");
      }

      stopRewind({ resumeLive: false });
      pauseOriginalVideo();
      const video = createOverlay(container);
      state.currentVod = archive.vod;
      loadHls(video, playlistUrl, targetPosition);
      state.refreshTimer = window.setInterval(() => {
        refreshGrowingVod().catch((error) => log(error));
      }, PLAYLIST_REFRESH_MS);
      updateButton(true);
    } catch (error) {
      log(error);
      showMessage(error.message || "Unable to rewind this live stream.");
      stopRewind();
    } finally {
      setButtonLoading(false);
    }
  }

  function stopRewind(options = {}) {
    const { resumeLive = true } = options;
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    if (state.overlay) {
      state.overlay.remove();
      state.overlay = null;
    }
    state.video = null;
    state.currentVod = null;
    if (resumeLive) resumeOriginalVideo();
    updateButton(false);
    if (state.button) state.button.blur();
    updateControlVisibilityClass();
  }

  function setButtonLabel(mode) {
    if (!state.button) return;
    state.button.replaceChildren();

    const label = document.createElement("span");
    label.className = "tlr-control-label";
    label.textContent = BUTTON_TEXT[mode];
    state.button.append(label);

    if (mode === "active") {
      const recDot = document.createElement("span");
      recDot.className = "tlr-rec-dot";
      recDot.setAttribute("aria-hidden", "true");
      state.button.append(recDot);
    }
  }

  function setButtonLoading(isLoading) {
    if (!state.button) return;
    state.button.disabled = isLoading;
    setButtonLabel(isLoading
      ? "loading"
      : state.button.dataset.active === "true"
        ? "active"
        : "idle");
  }

  function updateButton(isActive) {
    if (!state.button) return;
    state.button.dataset.active = String(isActive);
    setButtonLabel(isActive ? "active" : "idle");
  }

  function ensureButton() {
    const channelLogin = getChannelFromPath();
    const container = findPlayerContainer();
    if (!channelLogin || !container) {
      removeButton();
      return;
    }

    state.playerContainer = container;
    ensurePositioned(container);

    if (state.button?.isConnected) {
      if (state.button.parentElement !== container) {
        container.append(state.button);
        attachPlayerInteractionListeners(container);
      }
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "tlr-control";
    button.dataset.active = "false";
    button.addEventListener("mouseenter", () => {
      state.isButtonHovered = true;
      markPlayerInteracting();
      updateControlVisibilityClass();
    });
    button.addEventListener("mouseleave", () => {
      state.isButtonHovered = false;
      updateControlVisibilityClass();
    });
    button.addEventListener("click", () => {
      if (button.dataset.active === "true") {
        stopRewind();
      } else {
        startRewind();
      }
    });
    container.append(button);
    state.button = button;
    setButtonLabel("idle");
    attachPlayerInteractionListeners(container);
    startControlVisibilitySync();
  }

  function removeButton() {
    if (state.playerContainer) {
      state.playerContainer.classList.remove("tlr-native-controls-visible");
    }
    if (state.controlsRaf) {
      window.cancelAnimationFrame(state.controlsRaf);
    }
    window.clearTimeout(state.interactionTimer);
    state.interactionAbortController?.abort();
    state.controlsRaf = null;
    state.interactionTimer = null;
    state.interactionAbortController = null;
    state.isButtonHovered = false;
    if (state.button) {
      state.button.remove();
      state.button = null;
    }
  }

  function handleRouteChange() {
    const route = window.location.href;
    if (route === state.route) {
      ensureButton();
      return;
    }
    state.route = route;
    stopRewind();
    removeButton();
    window.setTimeout(ensureButton, 600);
  }

  const observer = new MutationObserver(() => {
    handleRouteChange();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(handleRouteChange, 1000);
  handleRouteChange();
})();
