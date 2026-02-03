Below is the updated README with the new repository name and the additional instructions regarding the character description file and the new .env.example:

---

# ChatGPT-Discord-Bot

## Overview

This Discord bot integrates OpenAI's GPT-4o model to provide interactive, AI-driven responses. It handles chat completions, offers concise replies, and adapts to conversation contexts dynamically.

## Features

- **AI Conversations:** Engage in natural, flowing dialogues powered by GPT-4o.
- **Context Management:** Maintains conversation history to provide relevant responses.
- **Customizable Responses:** Adjust reply length and style via settings.
- **Character Customization:** Easily modify the bot's personality by editing the character description file.

## Prerequisites

- Node.js (v18 or higher recommended)
- Discord.js library
- OpenAI API key

## Setup

1. **Clone the Repository**

   ```bash
   git clone https://github.com/wobkobi/ChatGPT-Discord-Bot.git
   cd ChatGPT-Discord-Bot
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Configure Environment**

   Rename the `.env.example` file to `.env` and update it with your credentials:

   ```env
   # REQUIRED:
   OPENAI_API_KEY="your_openai_api_key"
   BOT_TOKEN="your_discord_bot_token"
   Client_ID="your_bot_client_id"
   OWNER_ID="your_owner_user_id"

   # OPTIONAL:
   # If you want to use a different encryption key, set it here.
   ENCRYPTION_KEY_BASE="your_encryption_key"
   ```

4. **Customize Bot Personality**

   Rename the `src/data/characterDescription.ts.example` file to `src/data/characterDescription.ts` and edit it to reflect the personality you want your bot to have. This file defines how the bot introduces itself and behaves in conversations.

5. **Run the Bot**

   ```bash
   npm run start
   ```

## Usage

Invite the bot to your Discord server and interact with it by mentioning the bot or using its slash commands. For example:

```
@BotName How's the weather today?
```

The bot will reply based on its AI capabilities and the parameters set for conversation length and complexity.

## Support

For support, please open an issue on the [GitHub repository](https://github.com/wobkobi/ChatGPT-Discord-Bot).

## Conclusion

This bot provides a powerful way to add AI-driven interactions to your Discord server. Customize it to fit your needs—especially by editing the `characterDescription.ts` file—and enjoy the advanced capabilities of GPT-4o in your community.

---

Feel free to adjust any sections as needed.
