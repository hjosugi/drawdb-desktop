import { t } from "../i18n/index.js";
import { desktopAvailable } from "./desktopIO.js";

let _dialog = null;
let _process = null;
let _updater = null;
let inFlight = null;

async function dialog() {
  if (!_dialog) _dialog = await import("@tauri-apps/plugin-dialog");
  return _dialog;
}

async function processPlugin() {
  if (!_process) _process = await import("@tauri-apps/plugin-process");
  return _process;
}

async function updater() {
  if (!_updater) _updater = await import("@tauri-apps/plugin-updater");
  return _updater;
}

function updateNotes(update) {
  const body = typeof update.body === "string" ? update.body.trim() : "";
  return body || t("update.noNotes");
}

function dispatchProgress(detail, onProgress) {
  try {
    onProgress?.(detail);
  } catch (error) {
    console.warn("update progress handler failed", error);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("drawdb-update-progress", { detail }));
  }
}

function progressPercent(downloaded, contentLength) {
  if (!contentLength || contentLength <= 0) return null;
  return Math.min(100, Math.round((downloaded / contentLength) * 100));
}

async function runUpdateCheck({ manual = false, onProgress } = {}) {
  if (!desktopAvailable()) return { status: "unavailable" };

  dispatchProgress({ status: "checking" }, onProgress);

  try {
    const { check } = await updater();
    const update = await check();

    if (!update) {
      dispatchProgress({ status: "idle" }, onProgress);
      if (manual) {
        const { message } = await dialog();
        await message(t("update.none"), {
          title: t("update.title"),
          kind: "info",
        });
      }
      return { status: "none" };
    }

    dispatchProgress({
      status: "available",
      version: update.version,
    }, onProgress);

    const { ask, message } = await dialog();
    const install = await ask(
      t("update.availableMessage", {
        version: update.version,
        notes: updateNotes(update),
      }),
      {
        title: t("update.availableTitle"),
        kind: "info",
        okLabel: t("update.install"),
        cancelLabel: t("update.later"),
      },
    );

    if (!install) {
      dispatchProgress({ status: "skipped", version: update.version }, onProgress);
      return { status: "skipped", version: update.version };
    }

    let downloaded = 0;
    let contentLength = null;
    dispatchProgress({
      status: "downloading",
      version: update.version,
      downloaded,
      contentLength,
      percent: null,
    }, onProgress);

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        downloaded = 0;
        contentLength = event.data.contentLength ?? null;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
      } else if (event.event === "Finished") {
        downloaded = contentLength ?? downloaded;
      }

      dispatchProgress({
        status: event.event === "Finished" ? "downloaded" : "downloading",
        version: update.version,
        downloaded,
        contentLength,
        percent: progressPercent(downloaded, contentLength),
      }, onProgress);
    });

    dispatchProgress({ status: "installed", version: update.version }, onProgress);

    const restart = await ask(t("update.installedMessage"), {
      title: t("update.installedTitle"),
      kind: "info",
      okLabel: t("update.restart"),
      cancelLabel: t("update.restartLater"),
    });

    if (restart) {
      const { relaunch } = await processPlugin();
      await relaunch();
    } else {
      await message(t("update.restartDeferred"), {
        title: t("update.installedTitle"),
        kind: "info",
      });
    }

    return { status: "installed", version: update.version, restart };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    dispatchProgress({ status: "error", error: messageText }, onProgress);
    console.warn("update check failed", error);

    if (manual) {
      const { message } = await dialog();
      await message(t("update.error", { message: messageText }), {
        title: t("update.title"),
        kind: "error",
      });
    }

    return { status: "error", error: messageText };
  }
}

export async function checkForAppUpdates(options = {}) {
  if (inFlight) return inFlight;
  inFlight = runUpdateCheck(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}
