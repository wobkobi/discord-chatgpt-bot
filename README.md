# Discord ChatGPT Bot

A Discord bot built with Discord.js and OpenAI’s ChatGPT integration.  
Features conversation memory (for persona **and** fine‑tuned modes), dynamic emoji replacement, cooldowns, LaTeX math rendering, robust logging, and multimodal vision support.

All code lives under `src/`, organized into Commands, Config, Controllers, Services, Store, Utils, and the entry `index.ts`.

---

## 📂 Project Structure

```txt
src/
├─ commands/                # Slash-command modules
│   ├─ ask.ts                # Query the bot (anyone can use)
│   ├─ checkCredits.ts       # Show remaining OpenAI quota
│   ├─ setCooldown.ts        # (Owner) Adjust guild/user cooldowns
│   └─ stop.ts               # (Owner) Gracefully shut down
│
├─ config/                  # Static JSON & environment config
│   ├─ persona.json         # Base persona, clone ID, markdown guide
│   └─ index.ts             # Default cooldown settings
│
├─ controllers/             # Discord event handlers
│   ├─ messageController.ts # Handles incoming messages & AI replies
│   └─ interactionController.ts # Dispatches slash commands
│
├─ services/                # Core logic
│   ├─ replyService.ts      # Builds prompts, injects persona & memory, calls OpenAI
│   ├─ latexRenderer.ts     # Renders `\[ … \]` LaTeX → SVG/PNG/JPG
│   └─ characterService.ts  # Constructs persona prompt & recent style snippet
│
├─ store/                   # In-memory + persisted state
│   ├─ cloneMemory.ts       # Clone-user memory store
│   └─ userMemory.ts        # General user memory store
│
├─ utils/                   # Helpers
│   ├─ discordHelpers.ts    # Mentions, markdown, emoji, summarisation
│   ├─ cooldown.ts          # Per-guild/user rate-limiting
│   ├─ fileUtils.ts         # Encrypted persistence for memory & threads
│   └─ logger.ts            # Winston logger with daily rotation
│
└─ index.ts                 # Entry: load commands, init memory, start bot
```

---

## 🚀 Features

- **Persistent Conversation Context**  
  Thread‑aware; after every 10 messages the thread auto‑summarises into long‑term memory.

- **Universal `/ask` Command**  
  Anyone can ask the bot via `/ask`.  
  Supports both persona mode **and** fine‑tuned models, with memory injected for either.

- **Persona & Clone Memory**  
  Toggle via `USE_PERSONA` in `.env`.  
  A special `cloneUserId` whose recent style is captured and injected.

- **Fine‑Tuned Model Memory**  
  When `USE_FINE_TUNED_MODEL=true`, memory is still injected even if persona is disabled.

- **Shared Markdown Guide**  
  Every prompt includes the same Discord‑Markdown cheat‑sheet for consistency.

- **Cooldown Management**  
  `/setCooldown` to adjust per‑guild or per‑user cooldown durations.

- **Dynamic Emoji Replacement**  
  Resolves `:emoji_name:` to your server’s custom emoji tags.

- **Math Rendering**  
  Renders `\[ … \]` LaTeX blocks to PNGs (white background + padding).

- **Multimodal Vision**  
  Passes inline and attachment image URLs (including Tenor & Giphy) into GPT-4o.

- **Robust Logging**  
  Console + daily‑rotating files (separate error and combined logs), with an audible bell on errors.  
  Logs live in `logs/` with `latest.log` symlinks.  
  Controlled via `LOG_LEVEL`.

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
# Discord & OpenAI Credentials
BOT_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_application_client_id_here
OWNER_ID=your_discord_user_id_here
OPENAI_API_KEY=your_openai_api_key_here

# Feature Toggles
USE_PERSONA=true                    # inject persona & memory into prompts
USE_FINE_TUNED_MODEL=false          # switch to a fine-tuned GPT model
FINE_TUNED_MODEL_NAME=ft-model-name # name of your fine-tuned model

# Persona
USE_PERSONA=true

# Logging
LOG_LEVEL=info

# Encryption key for memory storage (AES-256-GCM)
ENCRYPTION_KEY=your_aes_256_gcm_key_base64_or_raw
```

Define your persona in `src/config/persona.json`:

````json
{
  "cloneUserId": "123456789012345678",
  "baseDescription": "You are a helpful AI assistant…",
  "markdownGuide": "```md
…Discord Markdown Guide…```"
}
````

---

## ▶️ Scripts

Defined in `package.json`:

```bash
npm run build             # Compile TypeScript to JS
npm run build:changelog   # Generate command CHANGELOG
npm run dev               # Dev mode (ts-node + nodemon hot-reload)
npm run watch             # Alias: npm run dev
npm run start             # tsc && node build/index.js
```

---

## 📝 How It Works

1. **Startup**

   - Load slash commands from `src/commands`.
   - Register globally via Discord REST.
   - Initialise `userMemory` & `cloneMemory`.
   - Ensure log folders; start Winston logger.
   - Set `botReady` before handling messages.

2. **Message Handling** (`controllers/messageController.ts`)

   - Ignore bot authors, `@everyone`, or if not ready.
   - Show typing indicator.
   - Enforce cooldown (global or per-user).
   - Thread & store messages; summarise each 10 into memory.
   - Extract image URLs (attachments, inline, Tenor, Giphy).
   - Build prompt via `services/replyService.ts`:
     1. Persona (if enabled)
     2. Memory (for persona **or** fine‑tuned)
     3. Markdown guide
     4. Thread history + URLs
   - Send single OpenAI ChatCompletion.
   - Render any `\[ … \]` math via `utils/latexRenderer.ts`.
   - Reply once with text + math attachments.

3. **Slash Commands** (`controllers/interactionController.ts`)
   - Each file in `src/commands` exports `data` and `execute()`.
   - Commands: `/ask`, `/checkCredits`, `/setCooldown`, `/stop`.

---

## ⚙️ Engines & Requirements

- **Node.js** ≥ 16.0.0
- **npm** ≥ 7.0.0

Configured in `package.json` **engines**.

---

## 🤝 Contributing

PRs welcome! Please:

- Add new commands under `src/commands`.
- Add services in `src/services`.
- Keep controllers focused on routing.
- Run `npm run build:changelog` after adding commands.

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
