import OpenAI from "openai";

import { settings } from "../config/settings.js";

/** OpenRouter via OpenAI-compatible API (mirrors Python `openrouter_client`). */
export class OpenRouterClient {
  private readonly client: OpenAI;

  constructor(apiKey?: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey: apiKey ?? settings.api.openrouterApiKey,
      baseURL: baseUrl ?? settings.api.openrouterBaseUrl,
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_REFERRER ?? "",
        "X-Title": "kalshi-ai-trading-bot",
      },
    });
  }

  async chat(
    model: string,
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    maxTokens?: number,
  ): Promise<string> {
    const res = await this.client.chat.completions.create({
      model,
      messages,
      temperature: settings.trading.aiTemperature,
      max_tokens: maxTokens ?? settings.trading.aiMaxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }
}
