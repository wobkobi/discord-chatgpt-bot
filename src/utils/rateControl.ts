/**
 * @file src/utils/rateControl.ts
 * @description Utilities for managing per-guild message cooldowns and interjection probabilities.
 * @remarks
 *   Protects against spam by delaying bot responses and controls how often the bot may interject randomly.
 *   Each step emits detailed debug logs via logger.debug for traceability.
 */

import {
  defaultCooldownConfig,
  defaultInterjectionRate,
  GuildConfig,
  guildConfigs,
} from "../config/index.js";
import logger from "./logger.js";

/**
 * Retrieve the effective cooldown configuration for a given guild or DM.
 * Falls back to the default if no guild-specific config exists or if in a DM.
 */
export function getCooldownConfig(
  guildId: string | null
): GuildConfig["cooldown"] {
  logger.debug(
    `[rateControl] getCooldownConfig invoked with guildId=${guildId}`
  );
  if (!guildId) return defaultCooldownConfig;
  return guildConfigs.get(guildId)?.cooldown ?? defaultCooldownConfig;
}

/**
 * Compute the context key for tracking active cooldowns.
 */
export function getCooldownContext(
  guildId: string | null,
  userId: string
): string {
  const { perUserCooldown } = getCooldownConfig(guildId);
  const key = !guildId || perUserCooldown ? userId : guildId;
  logger.debug(`[rateControl] Computed cooldown key=${key}`);
  return key;
}

const activeCooldowns = new Set<string>();

export function isCooldownActive(key: string): boolean {
  const active = activeCooldowns.has(key);
  logger.debug(`[rateControl] isCooldownActive for ${key}: ${active}`);
  return active;
}

export function manageCooldown(guildId: string | null, userId: string): void {
  const { useCooldown, cooldownTime } = getCooldownConfig(guildId);
  if (!useCooldown) return;
  const key = getCooldownContext(guildId, userId);
  if (activeCooldowns.has(key)) return;
  activeCooldowns.add(key);
  logger.debug(`[rateControl] Started cooldown for ${key} (${cooldownTime}s)`);
  setTimeout(() => {
    activeCooldowns.delete(key);
    logger.debug(`[rateControl] Cleared cooldown for ${key}`);
  }, cooldownTime * 1000);
}

/**
 * Retrieve the random interjection **chance** (0–1) for a given guild or DM.
 * Falls back to the default if no guild-specific config exists.
 */
export function getInterjectionChance(guildId: string | null): number {
  const rate =
    guildId && guildConfigs.get(guildId)?.interjectionRate !== undefined
      ? guildConfigs.get(guildId)!.interjectionRate
      : defaultInterjectionRate;
  const chance = 1 / rate;
  logger.debug(
    `[rateControl] Using interjection chance 1-in-${rate} → ${chance}`
  );
  return chance;
}
