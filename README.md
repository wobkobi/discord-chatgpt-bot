# Discord ChatGPT Bot

A Discord bot built with Discord.js and OpenAI's ChatGPT integration that supports conversation memory, dynamic emoji usage, cooldown management, and clone memory functionality.

## Features

- **Interactive Conversation Handling:**  
  Supports persistent conversation context with memory functions for individual users, clones, and guild-level memory.
- **Dynamic Emoji Usage:**  
  Retrieves and uses custom server emojis to enhance bot responses.
- **Cooldown Management:**  
  Prevents spam by enforcing cooldowns on commands and messages.
- **Clone Memory Enhancements:**  
  Logs interactions, including how other users engage with the cloned user, to help the bot learn conversation styles.
- **Slash Commands:**  
  Easily interact with the bot using commands such as `/ask`, `/setcooldown`, and `/stop`.

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

3. **Rename the Character Description File:**

   The repository includes a sample file for the character description. Rename `characterDescription.ts.example` to `characterDescription.ts`:

   ```bash
   mv src/data/characterDescription.ts.example src/data/characterDescription.ts
   ```

   _(On Windows, you can rename the file manually via File Explorer or use the `rename` command in Command Prompt.)_

## Configuration

Create a `.env` file in the root directory with the following environment variables:

```dotenv
BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_client_id
OWNER_ID=your_discord_owner_id
OPENAI_API_KEY=your_openai_api_key
ENCRYPTION_KEY_BASE=your_encryption_key_base
```

These keys are essential for authenticating with Discord, OpenAI, and for encrypting stored memory data.

## Running the Bot

Start the bot using:

```bash
npm run start
```

The bot will register its slash commands, initialize memory, and start listening for messages and interactions.

## Commands

- **/ask:** Ask the bot a question privately.
- **/setcooldown:** _(Owner only)_ Configure the cooldown settings for the server.
- **/stop:** _(Owner only)_ Safely stop the bot.

## Memory Handling

The bot maintains three types of memory:

- **User Memory:**  
  Stores conversation summaries for individual users, formatting messages with proper Discord mentions.

- **Clone Memory:**  
  Stores conversation context for the clone user, including extra context such as interaction details (e.g., which user interacted with the clone).

- **General Memory:**  
  Stores guild-level conversation summaries.

Each memory module is designed to ensure that the conversation context is preserved and formatted appropriately.

## Contributing

Contributions are welcome! Please open issues or submit pull requests for improvements or new features.

## License

This project is licensed under the [MIT License](LICENSE).
