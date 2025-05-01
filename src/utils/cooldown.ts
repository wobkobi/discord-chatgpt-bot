// src/utils/cooldown.ts

import {
  defaultCooldownConfig,
  GuildCooldownConfig,
  guildCooldownConfigs,
} from "../config/index.js";

/**
 * Retrieve the effective cooldown configuration for a given guild.
 * Falls back to the global default if no guild-specific config exists
 * or if this is a DM (guildId === null).
 *
 * @param guildId - The ID of the guild, or null for direct messages.
 * @returns The cooldown settings to apply.
 */
function getCooldownConfig(guildId: string | null): GuildCooldownConfig {
  if (!guildId) return defaultCooldownConfig;
  return guildCooldownConfigs.get(guildId) ?? defaultCooldownConfig;
}

/**
 * Compute the context key used to track cooldowns.
 * If per-user cooldowns are enabled (or in DMs), each user has their own key;
 * otherwise the entire guild shares a single key.
 *
 * @param guildId - The ID of the guild, or null for DMs.
 * @param userId  - The ID of the user.
 * @returns A string key for the cooldown set.
 */
export function getCooldownContext(
  guildId: string | null,
  userId: string
): string {
  const { perUserCooldown } = getCooldownConfig(guildId);
  return !guildId || perUserCooldown ? userId : guildId;
}

/** Tracks which context keys currently have an active cooldown. */
const activeCooldowns = new Set<string>();

/**
 * Check whether a cooldown is currently active for the given context key.
 *
 * @param contextKey - The key returned by `getCooldownContext`.
 * @returns True if the cooldown is still in effect, false otherwise.
 */
export function isCooldownActive(contextKey: string): boolean {
  return activeCooldowns.has(contextKey);
}

/**
 * Starts a cooldown timer for the given guild/user combination.
 * If cooldowns are disabled in the config, this is a no-op.
 *
 * @param guildId - The ID of the guild, or null for DMs.
 * @param userId  - The ID of the user.
 */
export function manageCooldown(guildId: string | null, userId: string): void {
  const { useCooldown, cooldownTime } = getCooldownConfig(guildId);
  if (!useCooldown) return;

  const contextKey = getCooldownContext(guildId, userId);
  if (activeCooldowns.has(contextKey)) return;

  activeCooldowns.add(contextKey);
  // Remove the key once the cooldown expires.
  setTimeout(() => {
    activeCooldowns.delete(contextKey);
  }, cooldownTime * 1000);
}

/**
 * A global flag indicating whether cooldowns are enabled by default.
 * You can use this to quickly disable all cooldown logic in tests or
 * certain environments.
 */
export const useCooldown = defaultCooldownConfig.useCooldown;
