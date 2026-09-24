// @ts-check
/**
 * @param {import("../../types/drawdb").Table} table
 * @param {import("../../types/drawdb").EntityId} fieldId field id or index
 * @returns {import("../../types/drawdb").Field | undefined}
 */
export function findField(table, fieldId) {
  return table?.fields?.find((field, index) => field?.id === fieldId || index === fieldId);
}
