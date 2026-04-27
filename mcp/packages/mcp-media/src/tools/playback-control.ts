/**
 * Playback control tools — get playback info and stream URLs from Jellyfin.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getServiceUrl } from "@rainbow/mcp-common";

const JELLYFIN_URL = getServiceUrl("jellyfin");
const API_TOKEN = process.env.JELLYFIN_API_TOKEN ?? "";

export function registerPlaybackControl(server: McpServer): void {
  server.tool(
    "get_playback_info",
    "Get playback information for a media item including available streams and codecs",
    {
      item_id: z.string().describe("Jellyfin item ID"),
    },
    async ({ item_id }) => {
      try {
        const response = await fetch(
          `${JELLYFIN_URL}/Items/${item_id}/PlaybackInfo`,
          {
            headers: {
              "X-Emby-Token": API_TOKEN,
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          const body = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to get playback info (HTTP ${response.status}): ${body}`,
              },
            ],
            isError: true,
          };
        }

        const info = await response.json();
        const sources = (info.MediaSources ?? []) as Record<string, unknown>[];

        const result = {
          item_id,
          media_sources: sources.map((source) => ({
            id: source.Id,
            name: source.Name,
            container: source.Container,
            size_bytes: source.Size,
            bitrate: source.Bitrate,
            runtime_ticks: source.RunTimeTicks,
            video_streams: (
              (source.MediaStreams as Record<string, unknown>[]) ?? []
            )
              .filter((s) => s.Type === "Video")
              .map((s) => ({
                codec: s.Codec,
                width: s.Width,
                height: s.Height,
                bitrate: s.BitRate,
              })),
            audio_streams: (
              (source.MediaStreams as Record<string, unknown>[]) ?? []
            )
              .filter((s) => s.Type === "Audio")
              .map((s) => ({
                codec: s.Codec,
                channels: s.Channels,
                language: s.Language,
                title: s.Title,
              })),
            subtitle_streams: (
              (source.MediaStreams as Record<string, unknown>[]) ?? []
            )
              .filter((s) => s.Type === "Subtitle")
              .map((s) => ({
                codec: s.Codec,
                language: s.Language,
                title: s.Title,
                is_external: s.IsExternal,
              })),
          })),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get playback info: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_stream_url",
    "Get a direct stream URL for a media item",
    {
      item_id: z.string().describe("Jellyfin item ID"),
    },
    async ({ item_id }) => {
      try {
        // Build the direct stream URL
        const streamUrl = `${JELLYFIN_URL}/Items/${item_id}/Download?api_key=${API_TOKEN}`;

        // Also fetch basic item info
        const response = await fetch(`${JELLYFIN_URL}/Items/${item_id}`, {
          headers: {
            "X-Emby-Token": API_TOKEN,
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          const body = await response.text();
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to get item info (HTTP ${response.status}): ${body}`,
              },
            ],
            isError: true,
          };
        }

        const item = await response.json();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  item_id,
                  name: item.Name,
                  type: item.Type,
                  stream_url: streamUrl,
                  hls_url: `${JELLYFIN_URL}/Videos/${item_id}/master.m3u8?api_key=${API_TOKEN}`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get stream URL: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
