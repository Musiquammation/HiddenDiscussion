// server.ts — application entry point: sets up the HTTP API, serves the
// static client, and attaches the websocket server on /ws.

import cors from "cors";
import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer } from "ws";
import { getLogger } from "./Logger";
import { router } from "./routes";
import { handleConnection } from "./wsHandlers";

const logger = getLogger("SERVER");

const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(router);

// Convenience: serve the static client so `npm start` alone is enough to try the app.
app.use(express.static(path.join(__dirname, "..", "..", "client")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", handleConnection);

server.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
  logger.info(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
});
