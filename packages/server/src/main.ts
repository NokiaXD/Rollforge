import express from "express";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { VERSION } from "./version.js";

const app = express();
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

// ponytail: auth, sync rooms and db land in Fase 1 / Paso 3+. Skeleton only.
httpServer.listen(3000, () => {
  console.log(`[rollforge/server] v${VERSION} listening on :3000`);
});