/** Guild-level cooldown configuration */

export interface GuildCooldownConfig {
  useCooldown: boolean;
  cooldownTime: number;
  perUserCooldown: boolean;
}

export interface GuildConfig {
  cooldown: GuildCooldownConfig;
  interjectionRate: number;
}
