/**
 * Claude API client for the app builder.
 */

import Anthropic from "@anthropic-ai/sdk";

interface GenerateResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export class ClaudeClient {
  private client: Anthropic;
  private model: string;

  constructor() {
    // API key is read from ANTHROPIC_API_KEY env var by the SDK
    this.client = new Anthropic();
    this.model = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
  }

  async generate(
    systemPrompt: string,
    messages: Array<{ role: "user" | "assistant"; content: string }>
  ): Promise<GenerateResult> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => {
        if (block.type === "text") return block.text;
        return "";
      })
      .join("\n");

    return {
      text,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
