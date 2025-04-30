# Discord ChatGPT Bot

A Discord bot built with Discord.js and OpenAI's ChatGPT integration that supports conversation memory, dynamic emoji usage, cooldown management, clone memory functionality—and now full multimodal (vision) support plus a shared Markdown guide injected into every prompt.

## Features

- **Interactive Conversation Handling:**  
  Supports persistent conversation context with memory functions for individual users, clones, and guild-level memory.

- **Persona & Clone Memory (Optional):**

  - Toggle on/off via `USE_PERSONA` in your `.env`.
  - When on, injects a richly formatted persona + long-term memory for each user.
  - Special “clone” user ID (`cloneUserId`) whose speech style is inferred from recent messages.

- **Multimodal Vision Support:**

  - Automatically detects image attachments and passes their URLs as `image_url` blocks to OpenAI’s vision-capable models (e.g. `gpt-4o`).
  - Use models like `gpt-4.1-mini`, `gpt-image-1`, etc.

- **Shared Markdown Guide Injection:**  
  A comprehensive Discord-Markdown guide block is now defined once in `characterDescription.ts` and always injected as a **system** message, ensuring the model knows exactly how to format its output.

- **Cooldown Management:**  
  Prevents spam by enforcing cooldowns on commands and messages.

  - Global vs per-user cooldown: `/setcooldown` command
  - Default cooldown time and behavior configurable in `config.ts`

- **Slash Commands:**

  - `/ask`: Ask the bot a question privately.
  - `/setcooldown`: _(Owner only)_ Configure server cooldown settings.
  - `/stop`: _(Owner only)_ Safely shut down the bot.

- **Dynamic Emoji Usage:**  
  Replaces `:emoji_name:` shortcodes with your server’s custom emojis when replying in guild channels.

## Installation

1. **Clone the Repository:**

   ```bash
   git clone https://github.com/wobkobi/ChatGPT-Discord-Bot.git
   cd ChatGPT-Discord-Bot
   ```

2. **Install Dependencies:**

   ```bash
   npm install
   ```

3. **Character Description Setup:**

   We now provide a **single** `characterDescription.ts` exporting the persona, `fixMathFormatting`, and a shared `markdownGuide`.  
   Rename the example and customize as needed:

   ```bash
   mv src/data/characterDescription.ts.example src/data/characterDescription.ts
   ```

## Configuration

Create a `.env` file in the root directory with:

```dotenv
# Discord
BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id
OWNER_ID=your_discord_owner_id

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Optional feature toggles
USE_PERSONA=true                # inject persona & memory
USE_FINE_TUNED_MODEL=false      # toggle using your FT model
FINE_TUNED_MODEL_NAME=ft-model  # if FT is enabled

# Encryption
ENCRYPTION_KEY_BASE=your_secret
```

## Running the Bot

```bash
npm run start
```

- Registers slash commands
- Initializes memory caches
- Listens for messages, DMs, and interactions

## How It Works

1. **Message Create**

   - Ignores bots & `@everyone`.
   - Requires a DM, explicit mention, or rare 1/50 “interjection” chance in guild.
   - Displays a typing indicator (`channel.sendTyping()`).

2. **Conversation Context**

   - Maps each thread by channel-messageID or reply chain.
   - Stores up to 10 messages before summarizing into long-term memory (user or clone).

3. **Prompt Assembly (`generateReply`)**

   - Chooses `gpt-4o` (or your fine-tuned model).
   - **Always** injects:
     1. Persona & memory (if `USE_PERSONA`)
     2. Reply-to / channel history notes (if present)
     3. **Global Markdown guide** (`markdownGuide`)
   - Walks the reply chain, converts to text blocks (and `image_url` blocks for attachments).
   - Sends a single ChatCompletion with a mixed `content` array of `{ type: "text" }` and `{ type: "image_url" }` entries.

4. **Response Handling**
   - Applies `fixMathFormatting` + mention & emoji normalization
   - Replies back in Discord and logs to memory

## Contributing

PRs welcome! Please file issues or pull requests for:

- New vision integrations (e.g. file uploads)
- Additional feature toggles or memory behaviors
- Improvements to the shared Markdown guide

## License

Licensed under the [MIT License](LICENSE).
