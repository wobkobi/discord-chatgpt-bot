import { Collection, SlashCommandBuilder } from "discord.js";

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
