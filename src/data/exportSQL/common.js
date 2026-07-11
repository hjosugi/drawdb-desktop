export function findField(table, fieldId) {
  return table?.fields?.find((field, index) => field?.id === fieldId || index === fieldId);
}
