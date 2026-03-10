export function connectorKey(machineId: string, tenantId: string): string {
  return `${tenantId}::${machineId}`;
}
