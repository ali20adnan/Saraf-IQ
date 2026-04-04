import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const TelegramBot: typeof import("node-telegram-bot-api") = require("node-telegram-bot-api");

export default TelegramBot;
