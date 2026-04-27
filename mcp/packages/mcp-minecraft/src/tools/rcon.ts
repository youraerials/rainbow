/**
 * RCON client and raw rcon_command tool.
 *
 * Implements the Minecraft RCON protocol over TCP.
 * Protocol: https://wiki.vg/RCON
 *
 * Packet format:
 *   4 bytes - length (int32 LE, not including these 4 bytes)
 *   4 bytes - request ID (int32 LE)
 *   4 bytes - type (int32 LE): 3 = login, 2 = command, 0 = command response
 *   N bytes - payload (null-terminated ASCII string)
 *   1 byte  - padding null byte
 */

import * as net from "node:net";
import { execSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const RCON_HOST = process.env.RCON_HOST ?? "localhost";
const RCON_PORT = parseInt(process.env.RCON_PORT ?? "25575", 10);

/** Packet type constants. */
const PACKET_TYPE = {
  COMMAND_RESPONSE: 0,
  COMMAND: 2,
  LOGIN: 3,
} as const;

let requestIdCounter = 1;

function nextRequestId(): number {
  return requestIdCounter++;
}

/**
 * Encode an RCON packet.
 */
function encodePacket(
  requestId: number,
  type: number,
  payload: string
): Buffer {
  const payloadBytes = Buffer.from(payload, "ascii");
  // length = 4 (requestId) + 4 (type) + payload length + 2 (null terminators)
  const length = 4 + 4 + payloadBytes.length + 2;
  const buffer = Buffer.alloc(4 + length);

  buffer.writeInt32LE(length, 0);
  buffer.writeInt32LE(requestId, 4);
  buffer.writeInt32LE(type, 8);
  payloadBytes.copy(buffer, 12);
  buffer.writeUInt8(0, 12 + payloadBytes.length);
  buffer.writeUInt8(0, 13 + payloadBytes.length);

  return buffer;
}

/**
 * Decode an RCON packet from a buffer.
 * Returns the parsed packet and the number of bytes consumed.
 */
function decodePacket(buffer: Buffer): {
  requestId: number;
  type: number;
  payload: string;
  bytesRead: number;
} | null {
  if (buffer.length < 4) return null;

  const length = buffer.readInt32LE(0);
  const totalLength = 4 + length;

  if (buffer.length < totalLength) return null;

  const requestId = buffer.readInt32LE(4);
  const type = buffer.readInt32LE(8);
  // Payload is everything from offset 12 up to (but not including) the 2 trailing nulls
  const payloadEnd = totalLength - 2;
  const payload = buffer.subarray(12, payloadEnd).toString("ascii");

  return { requestId, type, payload, bytesRead: totalLength };
}

/**
 * Get the RCON password from macOS Keychain.
 */
function getRconPassword(): string {
  if (process.env.RCON_PASSWORD) {
    return process.env.RCON_PASSWORD;
  }

  try {
    const result = execSync(
      'security find-generic-password -s "rainbow-minecraft-rcon" -w 2>/dev/null',
      { encoding: "utf-8" }
    ).trim();
    return result;
  } catch {
    throw new Error(
      "RCON password not found. Set RCON_PASSWORD env var or add to macOS Keychain with service name 'rainbow-minecraft-rcon'"
    );
  }
}

/**
 * Send an RCON command and return the response.
 */
export async function sendRconCommand(command: string): Promise<string> {
  const password = getRconPassword();

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseBuffer = Buffer.alloc(0);
    let authenticated = false;
    let commandRequestId: number | null = null;
    const loginRequestId = nextRequestId();

    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("RCON connection timed out"));
    }, 10000);

    socket.on("connect", () => {
      // Send login packet
      socket.write(encodePacket(loginRequestId, PACKET_TYPE.LOGIN, password));
    });

    socket.on("data", (data: Buffer) => {
      responseBuffer = Buffer.concat([responseBuffer, data]);

      // Process all complete packets in the buffer
      let packet = decodePacket(responseBuffer);
      while (packet) {
        responseBuffer = responseBuffer.subarray(packet.bytesRead);

        if (!authenticated) {
          // Login response
          if (packet.requestId === -1) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error("RCON authentication failed"));
            return;
          }
          authenticated = true;
          // Send the actual command
          commandRequestId = nextRequestId();
          socket.write(
            encodePacket(commandRequestId, PACKET_TYPE.COMMAND, command)
          );
        } else if (packet.requestId === commandRequestId) {
          // Command response
          clearTimeout(timeout);
          socket.destroy();
          resolve(packet.payload);
          return;
        }

        packet = decodePacket(responseBuffer);
      }
    });

    socket.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(new Error(`RCON connection error: ${err.message}`));
    });

    socket.on("close", () => {
      clearTimeout(timeout);
    });

    socket.connect(RCON_PORT, RCON_HOST);
  });
}

export function registerRcon(server: McpServer): void {
  server.tool(
    "rcon_command",
    "Send a raw RCON command to the Minecraft server",
    {
      command: z.string().describe("The RCON command to execute"),
    },
    async ({ command }) => {
      try {
        const response = await sendRconCommand(command);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  command,
                  response: response || "(no output)",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: message }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
