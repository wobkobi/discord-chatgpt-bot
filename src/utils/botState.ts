// src/utils/botState.ts
// Readiness flag shared between the entry point and the message controller. It lives here
// rather than in index.ts so importing the controller (or a command that uses it) never
// pulls in, and starts, the entry point.

let botReady = false;

/**
 * Indicates whether the bot has completed initialisation and is ready to process messages.
 * @returns True if initialisation is complete; false otherwise.
 */
export function isBotReady(): boolean {
  return botReady;
}

/** Mark initialisation complete so incoming messages start being handled. */
export function markBotReady(): void {
  botReady = true;
}
