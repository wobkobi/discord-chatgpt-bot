import { defaultCooldownConfig, guildCooldownConfigs } from "../config.js";

function getCooldownConfig(guildId: string | null): {
  useCooldown: boolean;
  cooldownTime: number;
  perUserCooldown: boolean;
} {
  if (!guildId) return defaultCooldownConfig;
  return guildCooldownConfigs.get(guildId) || defaultCooldownConfig;
}

export function getCooldownContext(
  guildId: string | null,
  userId: string
): string {
  const config = getCooldownConfig(guildId);
  // If per-user cooldown is true or if in DMs, use userId; otherwise, use guildId.
  return !guildId || config.perUserCooldown ? userId : guildId;
}

const cooldownSet = new Set<string>();

export function isCooldownActive(contextKey: string): boolean {
  return cooldownSet.has(contextKey);
}

export function manageCooldown(guildId: string | null, userId: string): void {
  const config = getCooldownConfig(guildId);
  const contextKey = getCooldownContext(guildId, userId);
  cooldownSet.add(contextKey);
  // Convert seconds to milliseconds.
  setTimeout(() => {
    cooldownSet.delete(contextKey);
  }, config.cooldownTime * 1000);
}

export const useCooldown = defaultCooldownConfig.useCooldown;
