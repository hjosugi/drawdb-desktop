// @ts-check
// Error policy for the desktop layer (#27):
//
// - I/O and parsing code throws DesktopError with a stable `code` (or lets a
//   platform error bubble up unchanged).
// - UI code never shows raw exceptions: it calls notifyError(), which maps the
//   error to a DesktopError, translates `errorCode.<CODE>` in the current
//   language, adds the technical detail on a separate line, records it in the
//   log, and shows a native error dialog.
import { t as translate } from "../i18n/index.js";

export const ErrorCode = Object.freeze({
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVALID_JSON: "INVALID_JSON",
  INVALID_DIAGRAM: "INVALID_DIAGRAM",
  UNKNOWN_FORMAT: "UNKNOWN_FORMAT",
  ZIP_CORRUPT: "ZIP_CORRUPT",
  PACK_INVALID: "PACK_INVALID",
  EXCEL_INVALID: "EXCEL_INVALID",
  SQL_NO_TABLES: "SQL_NO_TABLES",
  WRITE_FAILED: "WRITE_FAILED",
  NOT_READY: "NOT_READY",
  UNKNOWN: "UNKNOWN",
});

/** @typedef {keyof typeof ErrorCode} DesktopErrorCode */

export class DesktopError extends Error {
  /**
   * @param {DesktopErrorCode} code
   * @param {{ message?: string, detail?: string, params?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(code, { message, detail, params = {}, cause } = {}) {
    super(message || detail || code);
    this.name = "DesktopError";
    this.code = code;
    this.detail = detail ?? (cause ? errorText(cause) : message ?? "");
    this.params = params;
    if (cause !== undefined) this.cause = cause;
  }
}

/** @param {unknown} error */
export function errorText(error) {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) return String(error.message);
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** @type {Array<[DesktopErrorCode, RegExp]>} */
const PATTERNS = [
  [ErrorCode.FILE_NOT_FOUND, /no such file|not found|os error 2\b|ENOENT|cannot find the (?:file|path)/i],
  [ErrorCode.PERMISSION_DENIED, /forbidden path|not allowed|permission denied|os error (?:13|5)\b|EACCES|EPERM|access is denied/i],
  [ErrorCode.ZIP_CORRUPT, /end of central directory|corrupted zip|end of data reached|is this a zip file|invalid signature|zip file/i],
];

/**
 * Classifies any thrown value.
 * @param {unknown} error
 * @param {{ kind?: "ddb" | "pack" | "xlsx" | "sql" }} [context] what was being read
 * @returns {DesktopError}
 */
export function toDesktopError(error, { kind } = {}) {
  if (error instanceof DesktopError) return error;
  const text = errorText(error);
  const structured = error && typeof error === "object" && "code" in error ? String(error.code) : "";

  if (structured === "RECENT_FILE_NOT_FOUND") {
    return new DesktopError(ErrorCode.FILE_NOT_FOUND, { detail: text, cause: error });
  }
  if (structured === "RECENT_FILE_NOT_PERMITTED") {
    return new DesktopError(ErrorCode.PERMISSION_DENIED, { detail: text, cause: error });
  }
  if (error instanceof SyntaxError && /JSON/i.test(text)) {
    return new DesktopError(ErrorCode.INVALID_JSON, { detail: text, cause: error });
  }
  for (const [code, pattern] of PATTERNS) {
    if (!pattern.test(text)) continue;
    if (code === ErrorCode.ZIP_CORRUPT && kind === "xlsx") {
      return new DesktopError(ErrorCode.EXCEL_INVALID, { detail: text, cause: error });
    }
    return new DesktopError(code, { detail: text, cause: error });
  }
  if (kind === "xlsx") return new DesktopError(ErrorCode.EXCEL_INVALID, { detail: text, cause: error });
  return new DesktopError(ErrorCode.UNKNOWN, { detail: text, cause: error });
}

/**
 * Translated message for an error.
 * @param {unknown} error
 * @param {{ t?: typeof translate, kind?: "ddb" | "pack" | "xlsx" | "sql" }} [options]
 * @returns {{ code: DesktopErrorCode, message: string, detail: string }}
 */
export function describeError(error, { t = translate, kind } = {}) {
  const desktopError = toDesktopError(error, { kind });
  const code = /** @type {DesktopErrorCode} */ (desktopError.code);
  const summary = t(`errorCode.${code}`, desktopError.params);
  const detail = desktopError.detail && desktopError.detail !== summary ? desktopError.detail : "";
  const message = detail ? `${summary}\n\n${t("errorCode.detail", { detail })}` : summary;
  return { code, message, detail };
}

/**
 * Shows a translated error dialog and records the error in the log.
 * @param {unknown} error
 * @param {{
 *   title?: string,
 *   kind?: "ddb" | "pack" | "xlsx" | "sql",
 *   show?: (message: string, title?: string) => Promise<void> | void,
 * }} [options]
 */
export async function notifyError(error, { title, kind, show } = {}) {
  const described = describeError(error, { kind });
  const present = show ?? (await import("../utils/desktopIO.js")).showDesktopError;
  await present(described.message, title ?? translate("error.title"));
  return described;
}

/**
 * Reports the first failure of a repeating background task (autosave) and
 * stays quiet until the task succeeds again, so a failing disk produces one
 * dialog instead of one per keystroke. Every failure is still logged.
 * @param {(error: unknown) => unknown} notify
 */
export function createFailureReporter(notify) {
  let failing = false;
  return {
    /** @param {unknown} error */
    report(error) {
      if (failing) {
        console.error("drawDB background task failed again:", error);
        return false;
      }
      failing = true;
      void Promise.resolve()
        .then(() => notify(error))
        .catch((failure) => console.error("drawDB could not report a failure:", failure));
      return true;
    },
    reset() {
      failing = false;
    },
    get failing() {
      return failing;
    },
  };
}
