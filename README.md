# Discord ChatGPT Bot

A lightweight Discord bot using Discord.js and OpenAI’s ChatGPT. Features thread-aware memory,
persona/fine-tuned modes, cooldowns, emoji replacement, LaTeX rendering, image-and-file inputs, and
rotating logs.

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
   git clone https://github.com/wobkobi/discord-chatgpt-bot.git
   cd discord-chatgpt-bot
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

   - Edit **`.env`** and **`src/config/persona.json`** in any text editor to set your credentials,
     keys, and persona text. `data/persona.json` also works and takes priority.

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

Mention the bot (or wait for a random interjection) in any channel to see persona-driven replies,
math rendering (`\[ … \]` → attached images), image/file support, and more.

---

## 🛠️ Configuration

- **Persona vs Fine-tune**: Toggle with `USE_PERSONA` and `USE_FINE_TUNED_MODEL` in `.env`.
- **Memory**: Threads auto-summarise every 10 messages into long-term store.
- **Logging**: Daily-rotating logs in `logs/`, level set by `LOG_LEVEL`.
- **Persona file**: Loaded from `PERSONA_FILE` if set, then `data/persona.json`, then
  `src/config/persona.json`. `markdownGuide.md` is looked up in `data/` first too.

---

## 🐳 Docker / TrueNAS

Every push to `main` builds an image and publishes it to `ghcr.io/wobkobi/chatgpt-x-discord`, tagged
`latest`, the `package.json` version and the commit SHA. The `Build:` line in the boot log names the
commit the running image came from.

```powershell
docker run --env-file .env -v ${PWD}/data:/app/data -v ${PWD}/logs:/app/logs ghcr.io/wobkobi/chatgpt-x-discord:latest
```

- `/app/data` holds memory, conversations, guild config and `persona.json`; `/app/logs` holds the
  rotated logs. Mount both, or a restart loses them.
- Secrets come from the env file only and are never baked into the image.
- One image runs any number of bots: give each its own `.env`, `data/` and `logs/`.

For TrueNAS, [deploy/truenas.yaml](deploy/truenas.yaml) is a compose file for Apps > Install via
YAML, with the folder setup steps in its header. Restarting the app pulls the newest `latest`.

---

## 📄 Licence

[MIT Licence](LICENSE)
