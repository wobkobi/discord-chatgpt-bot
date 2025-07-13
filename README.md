# Discord ChatGPT Bot

A lightweight Discord bot using Discord.js and OpenAI’s ChatGPT.
Features thread-aware memory, persona/fine-tuned modes, cooldowns, emoji replacement, LaTeX rendering, image-and-file inputs, and rotating logs.

---

## 📂 Project Layout

```txt
src/
├─ commands/         Slash commands (ask, setCooldown, stop, …)
├─ controllers/      Event handlers (messages, interactions)
├─ services/         Core logic (prompt builder, LaTeX renderer, persona)
├─ store/            In-memory + encrypted persistence (user & clone memory)
├─ utils/            Helpers (cooldown, file I/O, logging, Discord formatting)
└─ index.ts          Entry point
```

---

## 🚀 Quickstart

1. **Clone & install**

   ```bash
   git clone https://github.com/wobkobi/ChatGPT-Discord-Bot.git
   cd ChatGPT-Discord-Bot
   npm install
   ```

2. **Configure**
   - Copy the environment example and fill in your values:
     - On macOS/Linux:

       ```bash
       cp .env.example .env
       ```

     - On Windows (PowerShell or CMD):

       ```powershell
       copy .env.example .env
       ```

   - Copy the persona template:
     - On macOS/Linux:

       ```bash
       cp src/config/persona.example.json src/config/persona.json
       ```

     - On Windows (PowerShell or CMD):

       ```powershell
       copy src\config\persona.example.json src\config\persona.json
       ```

   - Edit **`.env`** and **`src/config/persona.json`** in any text editor to set your credentials, keys, and persona text.

3. **Run**

   ```bash
   npm run dev
   ```

---

## ⚙️ Usage

- **/ask** – Ask the bot privately (ephemeral reply).
- **/setbot** – (Owner) Change the bot’s username and/or avatar image.
- **/setCooldown** – (Owner/Admin) Adjust rate limits per-guild.
- **/setinterjection** – (Owner/Admin) Configure random interjection frequency.
- **/stop** – (Owner) Gracefully shut down the bot.

Mention the bot (or wait for a random interjection) in any channel to see persona-driven replies, math rendering (`\[ … \]` → attached images), image/file support, and more.

---

## 🛠️ Configuration

- **Persona vs Fine-tune**: Toggle with `USE_PERSONA` and `USE_FINE_TUNED_MODEL` in `.env`.
- **Memory**: Threads auto-summarise every 10 messages into long-term store.
- **Logging**: Daily-rotating logs in `logs/`, level set by `LOG_LEVEL`.

---

## 📄 Licence

[MIT Licence](LICENSE)
