import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

const root = resolve(process.env.SERVE_DIR || ".");
const port = Number(process.env.PORT || 3000);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".json": "application/json",
};
http
  .createServer(async (req, res) => {
    try {
      const path = resolve(
        root,
        `.${decodeURIComponent(new URL(req.url, "http://local").pathname)}`,
      );
      if (path !== root && !path.startsWith(`${root}/`)) {
        res.writeHead(403).end();
        return;
      }
      const file = path === root ? `${root}/index.html` : path;
      res.setHeader(
        "Content-Type",
        types[extname(file)] || "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(port, "0.0.0.0", () =>
    console.log(`Local: http://localhost:${port}`),
  );
