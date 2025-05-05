/**
 * @file src/utils/cooldown.ts
 * @description Utilities for managing message cooldowns per guild or user, including configuration lookup,
 *   context key computation, and active cooldown tracking.
 * @remarks
 *   Cooldowns prevent spam by delaying bot responses in high-traffic scenarios.
 *   Provides detailed debug logging to trace the cooldown flow using logger.debug.
 */

import {
  defaultCooldownConfig,
  GuildCooldownConfig,
  guildCooldownConfigs,
} from "../config/index.js";
import logger from "../utils/logger.js";

/**
 * Retrieve the effective cooldown configuration for a given guild or direct message.
 * Falls back to the default if no guild-specific config exists or if in a DM.
 *
 * @param guildId - The ID of the guild, or null for direct messages.
 * @returns The cooldown settings to apply.
 */
export function getCooldownConfig(guildId: string | null): GuildCooldownConfig {
  logger.debug(`[cooldown] getCooldownConfig invoked with guildId=${guildId}`);
  if (!guildId) {
    logger.debug("[cooldown] No guildId provided; using default config");
    return defaultCooldownConfig;
  }
  const config = guildCooldownConfigs.get(guildId) ?? defaultCooldownConfig;
  logger.debug(
    `[cooldown] Using config for guildId=${guildId}: ${JSON.stringify(config)}`
  );
  return config;
}

/**
 * Compute the context key used to track cooldowns.
 * Uses per-user keys if enabled or in DMs; otherwise shares the guild key.
 *
 * @param guildId - The ID of the guild, or null for direct messages.
 * @param userId  - The ID of the user.
 * @returns A string key for looking up active cooldowns.
 */
export function getCooldownContext(
  guildId: string | null,
  userId: string
): string {
  logger.debug(
    `[cooldown] getCooldownContext invoked with guildId=${guildId}, userId=${userId}`
  );
  const { perUserCooldown } = getCooldownConfig(guildId);
  const contextKey = !guildId || perUserCooldown ? userId : guildId;
  logger.debug(`[cooldown] Computed contextKey=${contextKey}`);
  return contextKey;
}

/**
 * Tracks which context keys currently have an active cooldown.
 */
const activeCooldowns = new Set<string>();

/**
 * Check whether a cooldown is currently active for the given context key.
 *
 * @param contextKey - The key returned by `getCooldownContext`.
 * @returns True if the cooldown is still in effect; false otherwise.
 */
export function isCooldownActive(contextKey: string): boolean {
  const active = activeCooldowns.has(contextKey);
  logger.debug(
    `[cooldown] isCooldownActive for contextKey=${contextKey}: ${active}`
  );
  return active;
}

/**
 * Starts a cooldown timer for the given guild/user combination.
 * No-op if cooldowns are disabled or already active.
 *
 * @param guildId - The ID of the guild, or null for direct messages.
 * @param userId  - The ID of the user.
 */
export function manageCooldown(guildId: string | null, userId: string): void {
  logger.debug(
    `[cooldown] manageCooldown invoked for guildId=${guildId}, userId=${userId}`
  );
  const { useCooldown, cooldownTime } = getCooldownConfig(guildId);
  if (!useCooldown) {
    logger.debug("[cooldown] Cooldown feature disabled; skipping");
    return;
  }

  const contextKey = getCooldownContext(guildId, userId);
  if (activeCooldowns.has(contextKey)) {
    logger.debug(
      `[cooldown] Cooldown already active for contextKey=${contextKey}`
    );
    return;
  }

  activeCooldowns.add(contextKey);
  logger.debug(
    `[cooldown] Started cooldown for contextKey=${contextKey} (${cooldownTime}s)`
  );
  setTimeout(() => {
    activeCooldowns.delete(contextKey);
    logger.debug(`[cooldown] Cleared cooldown for contextKey=${contextKey}`);
  }, cooldownTime * 1000);
}

/**
 * Global flag indicating whether cooldowns are enabled by default.
 * Useful for tests or environments where cooldown logic should be disabled.
 */
export const useCooldown = defaultCooldownConfig.useCooldown;
