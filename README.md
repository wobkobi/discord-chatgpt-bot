# Discord ChatGPT Bot

A Discord bot built with Discord.js and OpenAI’s ChatGPT integration.  
Features conversation memory, persona/clone modes, dynamic emoji replacement, cooldowns, LaTeX math rendering, and multimodal vision support.

All code lives under `src/`, organised into Controllers, Services, Store, Utils, Commands and Config.

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
│   ├─ latexService.ts
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
│   └─ logger.ts
│
├─ data/                    # Runtime artifacts (math images, logs…)
│   └─ output/
│
└─ index.ts                 # Entry point: hooks controllers, starts bot
```

---

## 🚀 Features

- **Persistent Conversation Context**  
  Thread-aware, auto-summarises after 10 messages into long-term memory.

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
CLIENT_ID=your_discord_client_id
OWNER_ID=your_discord_owner_id

# OpenAI
OPENAI_API_KEY=your_openai_api_key
USE_FINE_TUNED_MODEL=false
FINE_TUNED_MODEL_NAME=ft-model-name

# Persona toggle
USE_PERSONA=true

# Cooldown defaults
DEFAULT_COOLDOWN_SECONDS=5
```

In `src/config/persona.json` define your persona:

````json
{
  "cloneUserId": "1234567890",
  "baseDescription": "You are a helpful AI assistant…",
  "markdownGuide": "```md\n…Discord Markdown Guide…```"
}
````

---

## ▶️ Running

**Development** (ts-node + hot-reload):

```bash
npm run dev
```

**Production** (compile + run):

```bash
npm run start
```

---

## 📝 How It Works

1. **Startup**

   - Load slash commands from `src/commands`.
   - Register them globally via Discord REST.
   - Initialise memory caches.
   - Only then set “ready” flag—messages before ready are ignored.

2. **Message Handling**

   - `controllers/messageController.ts` bails on bots, `@everyone`, or before ready.
   - Builds prompt via `services/replyService.ts`:
     1. Persona + memory (if enabled)
     2. Markdown guide
     3. Thread history + image URLs
   - Sends one ChatCompletion to gpt-4o.
   - Renders any `\[ … \]` math via `services/latexService.ts`.
   - Replies once with text + math images attachments.

3. **Slash Commands**
   - Dispatched in `controllers/interactionController.ts`.
   - Each module in `commands/` exports `data` + `execute()`.

---

## 🛠️ Scripts

- `npm run dev` – start in watch mode (ts-node/esm).
- `npm run start` – build (`tsc`) + run compiled JS.
- `npm run build` – TypeScript compile only.

---

## 🤝 Contributing

PRs welcome! Please:

- Update/add slash commands under `src/commands`.
- Add services for new features under `src/services`.
- Keep controllers focused on Discord events.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
