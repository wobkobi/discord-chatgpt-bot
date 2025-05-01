# Discord ChatGPT Bot

A Discord bot built with Discord.js and OpenAI’s ChatGPT integration.  
Features conversation memory, persona/clone modes, dynamic emoji replacement, cooldowns, LaTeX math rendering, robust logging, and multimodal vision support.

All code lives under `src/`, organized into Controllers, Services, Store, Utils, Commands, and Config.

---

## 📂 Project Structure

```txt
src/
├─ commands/                # Slash-command modules
│   ├─ ask.ts
│   ├─ checkCredits.ts
│   ├─ setCooldown.ts
│   └─ stop.ts
│
├─ config/                  # Static JSON & environment config
│   ├─ persona.json
│   └─ index.ts
│
├─ controllers/             # Discord event handlers
│   ├─ messageController.ts
│   └─ interactionController.ts
│
├─ services/                # Core logic (AI prompts, LaTeX → image, memory)
│   ├─ replyService.ts
│   ├─ latexRenderer.ts
│   └─ characterService.ts
│
├─ store/                   # In-memory + persisted state
│   ├─ cloneMemory.ts
│   └─ userMemory.ts
│
├─ utils/                   # Generic helpers
│   ├─ discordHelpers.ts
│   ├─ cooldown.ts
│   ├─ fileUtils.ts
│   └─ logger.ts            # Winston logger with daily rotation
│
└─ index.ts                 # Entry point: loads controllers, starts bot
```

---

## 🚀 Features

- **Persistent Conversation Context**  
  Thread-aware; auto-summarises every 10 messages into long-term memory.

- **Persona & Clone Memory**  
  Toggle via `USE_PERSONA` in `.env`.  
  Special `cloneUserId` whose style is learned from recent messages.

- **Shared Markdown Guide**  
  Injects a complete Discord-Markdown cheat-sheet into every system prompt.

- **Cooldown Management**  
  `/setCooldown` to adjust per-guild or per-user cooldowns.

- **Slash Commands**

  - `/ask` – Ask the bot a question via DM.
  - `/checkCredits` – Show remaining OpenAI quota.
  - `/setCooldown` – (Owner only) Change cooldown.
  - `/stop` – (Owner only) Gracefully shut down.

- **Dynamic Emoji Replacement**  
  Replaces `:emoji_name:` with your server’s custom emoji tags.

- **Math Rendering**  
  Renders `\[ … \]` LaTeX blocks to PNG (white background + border).

- **Multimodal Vision**  
  For image attachments, passes `[image_url]` blocks into gpt-4o.

- **Robust Logging**  
  Console + daily-rotating file logs (error-specific and combined), with an audible bell on errors. Logs output to `logs/` (including `latest.log` symlinks). Controlled via `LOG_LEVEL`.

---

## 📥 Installation

```bash
git clone https://github.com/your-org/ChatGPT-Discord-Bot.git
cd ChatGPT-Discord-Bot
npm install
```

---

## ⚙️ Configuration

Copy and edit `.env.example` to `.env`:

```dotenv
# Discord credentials
BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
OWNER_ID=your_discord_user_id

# OpenAI
OPENAI_API_KEY=your_openai_api_key
USE_FINE_TUNED_MODEL=false
FINE_TUNED_MODEL_NAME=ft-model-name

# Persona toggle
USE_PERSONA=true

# Logging
LOG_LEVEL=info

# Encryption (for on-disk memory)
ENCRYPTION_KEY=your_aes_256_gcm_key_base64_or_raw
```

In `src/config/persona.json`, define your persona:

````json
{
  "cloneUserId": "123456789012345678",
  "baseDescription": "You are a helpful AI assistant…",
  "markdownGuide": "```md\n…Discord Markdown Guide…```"
}
````

---

## ▶️ Scripts

Scripts are defined in `package.json`:

```bash
npm run build              # Compile TypeScript to JS
npm run build:changelog    # Generate CHANGELOG from commands via @discordx/changelog
npm run dev                # Run in dev mode (ts-node with hot-reload)
npm run watch              # Alias for dev with nodemon watching
npm run start              # tsc && node build/index.js
```

---

## 📝 How It Works

1. **Startup**

   - Load slash commands from `src/commands`.
   - Register them via Discord REST.
   - Initialise memory caches (`userMemory` & `cloneMemory`).
   - Ensure log directories and start Winston logger.
   - Set `botReady` before processing messages.

2. **Message Handling** (`controllers/messageController.ts`)

   - Ignore bots, `@everyone`, or before ready.
   - Show typing indicator.
   - Apply cooldowns (global or per-user).
   - Thread messages and summarise past 10 into memory.
   - Extract image URLs (attachments, inline, Tenor, Giphy).
   - Build prompt via `services/replyService.ts`:
     1. Persona + memory
     2. Markdown guide
     3. Thread history + URLs
   - Send ChatCompletion to gpt-4o.
   - Render `\[ … \]` math via `utils/latexRenderer.ts`.
   - Reply once with text + math attachments.

3. **Slash Commands**
   - Dispatched in `controllers/interactionController.ts`.
   - Each module in `src/commands/` exports `data` + `execute()`.

---

## ⚙️ Engines & Requirements

- **Node.js** ≥ 16.0.0
- **npm** ≥ 7.0.0

Set via `package.json` `"engines"` field.

---

## 🤝 Contributing

PRs welcome! Please:

- Add slash commands under `src/commands`.
- Add services under `src/services`.
- Keep controllers focused on event routing.
- Run `npm run build:changelog` when adding new commands.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
