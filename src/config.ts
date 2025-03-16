import fs from "fs/promises";
import { join } from "path";

export const defaultCooldownConfig = {
  useCooldown: true,
  cooldownTime: 1.25, // in seconds
  perUserCooldown: true,
};

export const guildCooldownConfigs = new Map<
  string,
  { useCooldown: boolean; cooldownTime: number; perUserCooldown: boolean }
>();

const CONFIG_FILE_PATH = join(
  process.cwd(),
  "data",
  "guildCooldownConfigs.json"
);

export async function loadGuildCooldownConfigs(): Promise<void> {
  try {
    const data = await fs.readFile(CONFIG_FILE_PATH, "utf-8");
    const parsed = JSON.parse(data) as Record<
      string,
      { useCooldown: boolean; cooldownTime: number; perUserCooldown: boolean }
    >;
    Object.entries(parsed).forEach(([guildId, config]) => {
      guildCooldownConfigs.set(guildId, config);
    });
    console.log("Loaded guild cooldown configs.");
  } catch {
    console.warn(
      "No guild cooldown config file found or failed to load; starting fresh."
    );
  }
}

export async function saveGuildCooldownConfigs(): Promise<void> {
  try {
    const obj: Record<
      string,
      { useCooldown: boolean; cooldownTime: number; perUserCooldown: boolean }
    > = {};
    guildCooldownConfigs.forEach((config, guildId) => {
      obj[guildId] = config;
    });
    await fs.mkdir(join(process.cwd(), "data"), { recursive: true });
    await fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(obj, null, 2), "utf-8");
    console.log("Saved guild cooldown configs.");
  } catch (error) {
    console.error("Failed to save guild cooldown configs.", error);
  }
}
