### README for Discord Bot

#### Overview

This Discord bot is designed to integrate OpenAI's powerful GPT-3.5 model, providing users with interactive, AI-driven responses. It's built to handle chat completions, offer concise replies, and adapt to conversation contexts dynamically.

#### Features

- **AI Conversations**: Engage in natural, flowing dialogues powered by OpenAI's GPT-3.5.
- **Context Management**: Maintains conversation history to provide relevant responses.
- **Customizable Responses**: Adjust reply length and style via settings.

#### Prerequisites

- Node.js
- Discord.js library
- OpenAI API key

#### Setup

1. **Clone the Repository**

   ```bash
   git clone https://github.com/wobkobi/chatgpt-x-discord.git
   cd chatgpt-x-discord
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Configure Environment**
   Create a `.env` file in the root directory and add your Discord Bot Token and OpenAI API Key:

   ```
   BOT_TOKEN=your_discord_bot_token
   OPENAI_API_KEY=your_openai_api_key
   ```

4. **Run the Bot**
   ```bash
   npm run start
   ```

#### Usage

Invite the bot to your Discord server and interact with it using mentions. For example:

```
@BotName How's the weather today?
```

The bot will reply based on its AI capabilities and the parameters set for conversation length and complexity.

#### Support

For support, please open an issue on the GitHub repository page.

### Conclusion

This bot offers a simple yet powerful way to add AI-driven interactions to your Discord server. Customize it to fit your needs and enjoy the advanced capabilities of GPT-3.5 in your community.
