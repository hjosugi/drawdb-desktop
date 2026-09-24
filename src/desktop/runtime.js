// @ts-check
/**
 * @typedef {{
 *   flush?: () => Promise<void>,
 *   open?: (path: string) => Promise<unknown>,
 * }} DesktopRuntimeHandlers
 */

/** @type {Readonly<DesktopRuntimeHandlers>} */
let handlers = Object.freeze({});

/** @param {DesktopRuntimeHandlers} nextHandlers */
export function registerDesktopRuntime(nextHandlers) {
  const registered = Object.freeze({ ...nextHandlers });
  handlers = registered;
  return () => {
    if (handlers === registered) handlers = Object.freeze({});
  };
}

export async function flushDesktopFile() {
  await handlers.flush?.();
}

export async function openDesktopPath(path) {
  if (typeof handlers.open !== "function") {
    throw new Error("Desktop workspace is not ready yet.");
  }
  return handlers.open(path);
}

/**
 * Serializes user-initiated file actions. While one action (typically a
 * native file dialog) is in flight, further requests coalesce into it, so a
 * shortcut that reaches both the native menu and the in-app hotkey handler, or
 * a double click, cannot open two dialogs or write the same file twice.
 */
export function createExclusiveRunner() {
  let active = null;
  return (task) => {
    if (active) return active;
    active = Promise.resolve()
      .then(task)
      .finally(() => {
        active = null;
      });
    return active;
  };
}
