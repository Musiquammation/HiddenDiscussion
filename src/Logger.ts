import "dotenv/config";
import fs from "fs";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	DEBUG: 0,
	INFO: 1,
	WARN: 2,
	ERROR: 3,
};

const logLevels: Record<string, LogLevel> = {};

for (const [key, value] of Object.entries(process.env)) {
	if (!key.startsWith("LOGLEVEL_"))
		continue;

	const name = key.slice("LOGLEVEL_".length).toUpperCase();
	const level = value?.toUpperCase();

	if (level && level in LEVEL_PRIORITY) {
		logLevels[name] = level as LogLevel;
	}
}

const logFilePath = process.env.LOG_FILEPATH ?? null;

if (logFilePath && !fs.existsSync(logFilePath)) {
	fs.mkdirSync(
		require("path").dirname(logFilePath),
		{ recursive: true }
	);

	fs.writeFileSync(logFilePath, "");
}


function getLevel(name: string): LogLevel {
	return logLevels[name.toUpperCase()] ?? "INFO";
}

function formatDate() {
	return new Date().toISOString();
}

function output(message: string) {
	console.log(message);

	if (logFilePath) {
		fs.appendFileSync(logFilePath, message + "\n");
	}
}


class Logger {
	constructor(private name: string) {}

	private enabled(level: LogLevel) {
		return (
			LEVEL_PRIORITY[level] >=
			LEVEL_PRIORITY[getLevel(this.name)]
		);
	}

	private write(level: LogLevel, message: string) {
		if (!this.enabled(level))
			return;

		output(
			`${formatDate()} [${this.name}] ${level}: ${message}`
		);
	}

	debug(message: string) {
		this.write("DEBUG", message);
	}

	info(message: string) {
		this.write("INFO", message);
	}

	warn(message: string) {
		this.write("WARN", message);
	}

	error(message: string) {
		this.write("ERROR", message);
	}
}


const loggers = new Map<string, Logger>();

export function getLogger(name: string) {
	let logger = loggers.get(name);

	if (!logger) {
		logger = new Logger(name);
		loggers.set(name, logger);
	}

	return logger;
}
