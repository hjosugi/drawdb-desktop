let handlers = Object.freeze({});

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
