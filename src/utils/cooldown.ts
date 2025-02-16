import { config } from "../config.js";

const cooldownSet = new Set<string>();

export function manageCooldown(contextId: string): void {
  cooldownSet.add(contextId);
  setTimeout(() => cooldownSet.delete(contextId), config.cooldownTime);
}

export function isCooldownActive(contextId: string): boolean {
  return cooldownSet.has(contextId);
}

export const useCooldown = config.useCooldown;
