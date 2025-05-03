# Discord ChatGPT Bot

A lightweight Discord bot using Discord.js and OpenAI’s ChatGPT.  
Features thread‑aware memory, persona/fine‑tuned modes, cooldowns, emoji replacement, LaTeX rendering, image‑and‑file inputs, and rotating logs.

---

## 📂 Project Layout

```txt

src/
├─ commands/         Slash commands (ask, setCooldown, stop, …)
├─ controllers/      Event handlers (messages, interactions)
├─ services/         Core logic (prompt builder, LaTeX renderer, persona)
├─ store/            In‑memory + encrypted persistence (user & clone memory)
├─ utils/            Helpers (cooldown, file I/O, logging, Discord formatting)
└─ index.ts          Entry point

```

---

## 🚀 Quickstart

1. **Clone & install**

   ```bash
   git clone https://github.com/wobkobi/ChatGPT-Discord-Bot
   cd chatgpt-x-discord
   npm install
   ```

2. **Configure**
   Copy `.env.example → .env` and fill in:

   ```dotenv
   BOT_TOKEN=…
   CLIENT_ID=…
   OWNER_ID=…
   OPENAI_API_KEY=…
   ENCRYPTION_KEY=…
   USE_PERSONA=true
   USE_FINE_TUNED_MODEL=false
   LOG_LEVEL=info
   ```

3. **Run**

   ```bash
   npm run dev
   ```

---

## ⚙️ Usage

- **/ask** – Ask the bot privately (ephemeral reply).
- **/setCooldown** – (Owner/Admin) Adjust rate limits per‑guild or per‑user.
- **/stop** – (Owner) Gracefully shut down the bot.

Type in any channel (with mention or random interjection) to see persona‑driven replies, math rendering (`\[ … \]`), and image understanding.

---

## 🛠️ Configuration

- **Persona vs Fine‑tune**: Toggle with `USE_PERSONA` and `USE_FINE_TUNED_MODEL` in `.env`.
- **Memory**: Threads auto‑summarise every 10 messages into long‑term store.
- **Logging**: Daily‑rotating logs in `logs/`, level set by `LOG_LEVEL`.

---

## 📄 License

[MIT License](LICENSE).
