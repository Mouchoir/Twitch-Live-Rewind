const DEFAULT_DELAY_SECONDS = 20;
const MIN_DELAY_SECONDS = 5;
const MAX_DELAY_SECONDS = 600;
const STORAGE_KEY = "rewindDelaySeconds";
const KEYBOARD_REWIND_STORAGE_KEY = "keyboardRewindEnabled";
const WEB_EXTENSION = globalThis.browser || globalThis.chrome;

const input = document.querySelector("#rewind-delay");
const keyboardRewindInput = document.querySelector("#keyboard-rewind");
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
  keyboardRewindInput.checked = true;

  try {
    const result = await WEB_EXTENSION.storage.sync.get({
      [STORAGE_KEY]: DEFAULT_DELAY_SECONDS,
      [KEYBOARD_REWIND_STORAGE_KEY]: true
    });
    input.value = clampDelay(result[STORAGE_KEY]);
    keyboardRewindInput.checked = result[KEYBOARD_REWIND_STORAGE_KEY] !== false;
  } catch (error) {
    input.value = loadLocalDelay();
    keyboardRewindInput.checked = window.localStorage.getItem(KEYBOARD_REWIND_STORAGE_KEY) !== "false";
    status.textContent = "Using local settings in this temporary install";
  }
}

async function saveSettings() {
  const value = clampDelay(input.value);
  const keyboardRewindEnabled = keyboardRewindInput.checked;
  input.value = value;

  try {
    await WEB_EXTENSION.storage.sync.set({
      [STORAGE_KEY]: value,
      [KEYBOARD_REWIND_STORAGE_KEY]: keyboardRewindEnabled
    });
    status.textContent = "Saved";
  } catch (error) {
    saveLocalDelay(value);
    window.localStorage.setItem(KEYBOARD_REWIND_STORAGE_KEY, String(keyboardRewindEnabled));
    status.textContent = "Saved locally";
  }

  window.setTimeout(() => {
    status.textContent = "";
  }, 1200);
}

input.addEventListener("change", saveSettings);
input.addEventListener("blur", saveSettings);
keyboardRewindInput.addEventListener("change", saveSettings);
document.addEventListener("DOMContentLoaded", loadSettings);
