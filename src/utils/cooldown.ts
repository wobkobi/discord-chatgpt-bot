const cooldownSet = new Set<string>();

// 2.5 seconds
const cooldownTime = 2500;
export const useCooldown = true;

export function manageCooldown(contextId: string) {
  cooldownSet.add(contextId);
  setTimeout(() => cooldownSet.delete(contextId), cooldownTime);
}

export function isCooldownActive(contextId: string): boolean {
  return cooldownSet.has(contextId);
}
