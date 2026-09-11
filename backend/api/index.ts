import "../src/loadEnv";
import { createApp } from "../src/app";
import { loadConfig } from "../src/config";

const config = loadConfig();

export default createApp(undefined, { debugLogRealClientIp: config.debugLogRealClientIp });
