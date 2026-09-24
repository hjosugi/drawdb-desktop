import { describe, expect, it, vi } from "vitest";
import {
  MAX_LOG_MESSAGE_LENGTH,
  formatLogMessage,
  installFrontendLogBridge,
  redactHomePaths,
  setKnownHomeDirectories,
} from "../src/desktop/logging.js";

function fakeTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("desktop log formatting", () => {
  it("replaces home directories so user names are not logged", () => {
    expect(redactHomePaths("open /home/alice/db/shop.ddb failed")).toBe("open ~/db/shop.ddb failed");
    expect(redactHomePaths("/Users/bob/x.ddb")).toBe("~/x.ddb");
    expect(redactHomePaths("C:\\Users\\carol\\Documents\\a.ddb")).toBe("~\\Documents\\a.ddb");
    expect(redactHomePaths("c:/Users/dave/a.ddb")).toBe("~/a.ddb");
    expect(redactHomePaths("/opt/drawdb/app")).toBe("/opt/drawdb/app");
  });

  it("redacts registered home directories that contain spaces", () => {
    setKnownHomeDirectories(["C:\\Users\\Bob Smith\\", "/"]);
    expect(redactHomePaths("C:\\Users\\Bob Smith\\db\\a.ddb")).toBe("~\\db\\a.ddb");
    setKnownHomeDirectories([]);
    expect(redactHomePaths("/", [])).toBe("/");
  });

  it("formats errors, structured command errors, and objects", () => {
    const error = new Error("boom");
    error.stack = "Error: boom\n    at save (/home/alice/app.js:1:1)";

    expect(formatLogMessage(["save failed:", error])).toBe(
      "save failed: Error: boom\n    at save (~/app.js:1:1)",
    );
    expect(formatLogMessage([{ code: "RECENT_FILE_NOT_FOUND", message: "gone" }])).toBe(
      "RECENT_FILE_NOT_FOUND: gone",
    );
    expect(formatLogMessage([{ a: 1 }, 2, null])).toBe('{"a":1} 2 null');
    const cyclic = {};
    cyclic.self = cyclic;
    expect(formatLogMessage([cyclic])).toBe("[object Object]");
  });

  it("truncates oversized messages", () => {
    const message = formatLogMessage(["x".repeat(MAX_LOG_MESSAGE_LENGTH + 50)]);

    expect(message.startsWith("x".repeat(MAX_LOG_MESSAGE_LENGTH))).toBe(true);
    expect(message.endsWith("[truncated]")).toBe(true);
  });
});

describe("frontend log bridge", () => {
  it("forwards console errors and warnings while keeping console output", async () => {
    const consoleObject = { error: vi.fn(), warn: vi.fn() };
    const originalError = consoleObject.error;
    const logger = vi.fn().mockResolvedValue(undefined);
    const dispose = installFrontendLogBridge({ target: fakeTarget(), consoleObject, logger });

    consoleObject.error("autosave failed", new Error("disk full"));
    consoleObject.warn("slow snapshot");
    await settle();

    expect(originalError).toHaveBeenCalledWith("autosave failed", expect.any(Error));
    expect(logger).toHaveBeenCalledWith("error", expect.stringContaining("autosave failed Error: disk full"));
    expect(logger).toHaveBeenCalledWith("warn", "slow snapshot");

    dispose();
    expect(consoleObject.error).toBe(originalError);
  });

  it("records uncaught errors and unhandled rejections", async () => {
    const target = fakeTarget();
    const logger = vi.fn().mockResolvedValue(undefined);
    const dispose = installFrontendLogBridge({
      target,
      consoleObject: { error() {}, warn() {} },
      logger,
    });

    target.listeners.get("error")({
      error: new TypeError("x is undefined"),
      filename: "app.js",
      lineno: 3,
      colno: 7,
    });
    target.listeners.get("unhandledrejection")({ reason: "network down" });
    await settle();

    expect(logger).toHaveBeenCalledWith("error", expect.stringMatching(/^Uncaught TypeError: x is undefined[\s\S]*\(app\.js:3:7\)$/));
    expect(logger).toHaveBeenCalledWith("error", "Unhandled promise rejection: network down");

    dispose();
    expect(target.listeners.size).toBe(0);
  });

  it("does not recurse or throw when the logger itself fails", async () => {
    const warn = vi.fn();
    const consoleObject = { error: vi.fn(), warn };
    const logger = vi.fn().mockRejectedValue(new Error("ipc closed"));
    const dispose = installFrontendLogBridge({ target: fakeTarget(), consoleObject, logger });

    expect(() => consoleObject.error("first")).not.toThrow();
    await settle();

    expect(logger).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("drawDB log bridge failed:", expect.any(Error));
    dispose();
  });

  it("is a no-op outside Tauri", () => {
    const consoleObject = { error() {}, warn() {} };
    const before = consoleObject.error;
    const dispose = installFrontendLogBridge({ consoleObject });

    expect(consoleObject.error).toBe(before);
    dispose();
  });
});
