const DEFAULT_DELAY_SECONDS = 20;
const MIN_DELAY_SECONDS = 5;
const MAX_DELAY_SECONDS = 600;
const STORAGE_KEY = "rewindDelaySeconds";
const WEB_EXTENSION = globalThis.browser || globalThis.chrome;

const input = document.querySelector("#rewind-delay");
const status = document.querySelector("#status");

function clampDelay(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_DELAY_SECONDS;
  return Math.min(MAX_DELAY_SECONDS, Math.max(MIN_DELAY_SECONDS, parsed));
}

function loadLocalDelay() {
  return clampDelay(window.localStorage.getItem(STORAGE_KEY));
}

function saveLocalDelay(value) {
  window.localStorage.setItem(STORAGE_KEY, String(value));
}

async function loadSettings() {
  input.value = DEFAULT_DELAY_SECONDS;

  try {
    const result = await WEB_EXTENSION.storage.sync.get({ [STORAGE_KEY]: DEFAULT_DELAY_SECONDS });
    input.value = clampDelay(result[STORAGE_KEY]);
  } catch (error) {
    input.value = loadLocalDelay();
    status.textContent = "Using local settings in this temporary install";
  }
}

async function saveSettings() {
  const value = clampDelay(input.value);
  input.value = value;

  try {
    await WEB_EXTENSION.storage.sync.set({ [STORAGE_KEY]: value });
    status.textContent = "Saved";
  } catch (error) {
    saveLocalDelay(value);
    status.textContent = "Saved locally";
  }

  window.setTimeout(() => {
    status.textContent = "";
  }, 1200);
}

input.addEventListener("change", saveSettings);
input.addEventListener("blur", saveSettings);
document.addEventListener("DOMContentLoaded", loadSettings);
