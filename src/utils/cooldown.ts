import { config } from "../config.js";

/**
 * In-memory set of context IDs currently on cooldown.
 * A context ID can represent a guild, channel, or user depending on how the caller defines it.
 */
const cooldownSet: Set<string> = new Set<string>();

/**
 * Adds a context ID to the cooldown set and schedules its removal after the configured cooldown time.
 * @param contextId - Identifier for the context to apply cooldown to (e.g. guild ID, channel ID, or user ID).
 */
export function manageCooldown(contextId: string): void {
  cooldownSet.add(contextId);
  setTimeout(() => cooldownSet.delete(contextId), config.cooldownTime);
}

/**
 * Checks whether a context ID is currently in cooldown.
 * @param contextId - Identifier for the context to check (e.g. guild ID, channel ID, or user ID).
 * @returns True if the context is on cooldown; otherwise false.
 */
export function isCooldownActive(contextId: string): boolean {
  return cooldownSet.has(contextId);
}

/**
 * Whether cooldown behaviour is enabled (read from configuration).
 */
export const useCooldown: boolean = config.useCooldown;
