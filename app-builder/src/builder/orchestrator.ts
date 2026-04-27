/**
 * Orchestrator — Main build loop for creating custom apps.
 *
 * Flow: user prompt -> system prompt construction -> Claude API -> code generation -> deploy
 */

import { ClaudeClient } from "./claude-client.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { Deployer } from "./deployer.js";
import { validateGeneratedCode } from "./sandbox.js";
import { AppRegistry, type AppEntry } from "../registry/app-registry.js";

interface BuildRequest {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  app_id?: string; // For iterating on existing app
}

interface BuildResult {
  message: string;
  app?: AppEntry;
  error?: string;
}

export class Orchestrator {
  private claude: ClaudeClient;
  private deployer: Deployer;

  constructor(private registry: AppRegistry) {
    this.claude = new ClaudeClient();
    this.deployer = new Deployer();
  }

  async build(request: BuildRequest): Promise<BuildResult> {
    const systemPrompt = buildSystemPrompt({
      existingApp: request.app_id
        ? this.registry.get(request.app_id)
        : undefined,
    });

    // Build conversation messages
    const messages = [
      ...(request.history || []),
      { role: "user" as const, content: request.message },
    ];

    try {
      // Call Claude to generate the app
      const response = await this.claude.generate(systemPrompt, messages);

      // Parse the response for code blocks
      const files = this.extractFiles(response.text);

      if (files.length === 0) {
        // Claude responded with a question or clarification, not code
        return { message: response.text };
      }

      // Validate the generated code
      const validation = validateGeneratedCode(files);
      if (!validation.valid) {
        return {
          message: `I generated some code but it had safety issues: ${validation.error}. Let me try again with a safer approach.`,
          error: validation.error,
        };
      }

      // Determine app name from the conversation
      const appName = this.extractAppName(request.message, response.text);

      // Create or update app entry
      let app: AppEntry;
      if (request.app_id) {
        app = this.registry.update(request.app_id, { files });
      } else {
        app = this.registry.create({
          name: appName,
          description: request.message.slice(0, 200),
          files,
        });
      }

      // Deploy the app
      const deployResult = await this.deployer.deploy(app);

      if (deployResult.success) {
        this.registry.update(app.id, {
          status: "running",
          url: deployResult.url,
        });
        app = this.registry.get(app.id)!;

        return {
          message: `Your app "${appName}" is now live at ${deployResult.url}!\n\n${response.text}`,
          app,
        };
      } else {
        this.registry.update(app.id, { status: "stopped" });
        return {
          message: `I built the app but deployment failed: ${deployResult.error}. The code has been saved and can be retried.`,
          error: deployResult.error,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return {
        message: `Sorry, I encountered an error: ${msg}`,
        error: msg,
      };
    }
  }

  /**
   * Extract file contents from Claude's response.
   * Looks for code blocks with file paths.
   */
  private extractFiles(
    text: string
  ): Array<{ path: string; content: string }> {
    const files: Array<{ path: string; content: string }> = [];
    // Match ```filename\ncontent``` or ```language:filename\ncontent```
    const codeBlockRegex = /```(?:[\w]+:)?([\w./\-]+)\n([\s\S]*?)```/g;

    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const path = match[1];
      const content = match[2].trimEnd();
      if (path && content && !path.includes("..")) {
        files.push({ path, content });
      }
    }

    return files;
  }

  /** Extract a reasonable app name from the user's request. */
  private extractAppName(userMessage: string, _aiResponse: string): string {
    // Simple heuristic: take first few words, title case
    const words = userMessage
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .slice(0, 4);
    if (words.length === 0) return "Custom App";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
}
