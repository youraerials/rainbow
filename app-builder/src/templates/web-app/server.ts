/**
 * Simple static file server for Rainbow custom apps.
 */

const port = 8000;

Deno.serve({ port }, async (req: Request) => {
  const url = new URL(req.url);
  let path = url.pathname;
  if (path === "/") path = "/index.html";

  try {
    const file = await Deno.readFile(`.${path}`);
    const contentType = getContentType(path);
    return new Response(file, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
});

function getContentType(path: string): string {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

console.log(`Serving on http://localhost:${port}`);
