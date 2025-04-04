import { Collection, Interaction, SlashCommandBuilder } from "discord.js";

/**
 * Augment the Discord.js Client interface to include a "commands" collection.
 */
declare module "discord.js" {
  export interface Client {
    commands: Collection<
      string,
      {
        data: SlashCommandBuilder;
        execute: (interaction: Interaction) => Promise<void>;
      }
    >;
  }
}
