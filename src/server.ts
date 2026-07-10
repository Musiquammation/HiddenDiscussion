// server.ts — application entry point

import cors from "cors";
import express from "express";
import http from "http";
import https from "https";
import fs from "fs";
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


const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCertPath = process.env.SSL_CERT_PATH;

let server: http.Server | https.Server;
let protocol: "ws" | "wss";


if (sslKeyPath && sslCertPath) {
	const httpsOptions = {
		key: fs.readFileSync(sslKeyPath),
		cert: fs.readFileSync(sslCertPath),
	};

	server = https.createServer(httpsOptions, app);
	protocol = "wss";
} else {
	server = http.createServer(app);
	protocol = "ws";
}


const wss = new WebSocketServer({
	server,
	path: "/ws",
});

wss.on("connection", handleConnection);


server.listen(PORT, () => {
	logger.info(`Server listening on port ${PORT}`);
	logger.info(`WebSocket endpoint available at ${protocol}://localhost:${PORT}/ws`);
});