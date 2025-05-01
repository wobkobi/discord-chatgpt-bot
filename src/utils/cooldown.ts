/**
 * @file src/utils/cooldown.ts
 * @description Utilities for managing message cooldowns per guild or user, including configuration lookup,
 *              context key computation, and active cooldown tracking.
 */

import {
  defaultCooldownConfig,
  GuildCooldownConfig,
  guildCooldownConfigs,
} from "../config/index.js";

/**
 * Retrieve the effective cooldown configuration for a given guild or direct message.
 * Falls back to the default if no guild-specific config exists or if in a DM.
 *
 * @param guildId - The ID of the guild, or null for direct messages.
 * @returns The cooldown settings to apply.
 */
export function getCooldownConfig(guildId: string | null): GuildCooldownConfig {
  if (!guildId) return defaultCooldownConfig;
  return guildCooldownConfigs.get(guildId) ?? defaultCooldownConfig;
}

/**
 * Compute the context key used to track cooldowns.
 * Uses per-user keys if enabled or in DMs; otherwise shares the guild key.
 *
 * @param guildId - The ID of the guild, or null for DMs.
 * @param userId  - The ID of the user.
 * @returns A string key for looking up active cooldowns.
 */
export function getCooldownContext(
  guildId: string | null,
  userId: string
): string {
  const { perUserCooldown } = getCooldownConfig(guildId);
  return !guildId || perUserCooldown ? userId : guildId;
}

/**
 * Tracks which context keys currently have an active cooldown.
 */
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
 * No-op if cooldowns are disabled or already active.
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
  setTimeout(() => {
    activeCooldowns.delete(contextKey);
  }, cooldownTime * 1000);
}

/**
 * A global flag indicating whether cooldowns are enabled by default.
 * Useful for tests or environments where you want to disable cooldown logic.
 */
export const useCooldown = defaultCooldownConfig.useCooldown;
