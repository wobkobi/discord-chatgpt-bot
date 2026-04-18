/**
 * @file src/utils/rateControl.ts
 * @description Utilities for managing per-guild message cooldowns and interjection probabilities.
 */

import { defaultCooldownConfig, defaultInterjectionRate, guildConfigs } from "@/config/index.js";
import { GuildConfig } from "@/types/guild.js";
import logger from "@/utils/logger.js";

/**
 * Retrieves the effective cooldown configuration for a given guild or DM.
 * @param guildId - The ID of the guild, or null when in a DM.
 * @returns The cooldown settings to apply (useCooldown, cooldownTime, perUserCooldown).
 */
export function getCooldownConfig(guildId: string | null): GuildConfig["cooldown"] {
  if (!guildId) return defaultCooldownConfig;
  return guildConfigs.get(guildId)?.cooldown ?? defaultCooldownConfig;
}

/**
 * Computes the context key used to track an active cooldown.
 * @param guildId - The ID of the guild, or null when in a DM.
 * @param userId - The ID of the user invoking the command.
 * @returns A string key (either userId or guildId) under which the cooldown is stored.
 */
export function getCooldownContext(guildId: string | null, userId: string): string {
  const { perUserCooldown } = getCooldownConfig(guildId);
  return !guildId || perUserCooldown ? userId : guildId;
}

const activeCooldowns = new Set<string>();

/**
 * Checks whether a cooldown is currently active for the given context key.
 * @param key - The cooldown context key (userId or guildId).
 * @returns True if a cooldown is active; false otherwise.
 */
export function isCooldownActive(key: string): boolean {
  return activeCooldowns.has(key);
}

/**
 * Begins a cooldown period for a given user or guild. No-ops if cooldowns are disabled or one is already active.
 * @param guildId - The ID of the guild, or null when in a DM.
 * @param userId - The ID of the user invoking the command.
 */
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
 * Retrieves the random interjection probability for a given guild or DM.
 * @param guildId - The ID of the guild, or null when in a DM.
 * @returns A number between 0 and 1 representing the chance that the bot will interject.
 */
export function getInterjectionChance(guildId: string | null): number {
  const rate =
    guildId && guildConfigs.get(guildId)?.interjectionRate !== undefined
      ? guildConfigs.get(guildId)!.interjectionRate
      : defaultInterjectionRate;
  return 1 / rate;
}
