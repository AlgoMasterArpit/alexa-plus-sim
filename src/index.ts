import { once } from 'node:events';

import { ConfigError, loadConfig } from './config.ts';
import { StaticAssets } from './http/static.ts';
import { createWebServer } from './http/server.ts';
import { createLlmClient } from './llm.ts';
import { createLogger } from './logger.ts';
import { SessionStore } from './sessions.ts';

const WEB_ROOT = new URL('../build/web/', import.meta.url);
const SHUTDOWN_TIMEOUT_MS = 5_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const sessions = new SessionStore({
    llm: createLlmClient(config.llm),
    model: config.llm.model,
    effort: config.llm.effort,
    logger,
  });
  const server = createWebServer({
    sessions,
    assets: new StaticAssets(WEB_ROOT),
    appConfig: {
      defaultServerUrl: config.defaultServerUrl ?? null,
      provider: config.llm.provider,
      model: config.llm.model,
    },
    logger,
  });

  server.listen(config.port, config.host);
  await once(server, 'listening');
  logger.info(
    { url: `http://${config.host}:${String(config.port)}`, ...config.llm },
    'alexa-plus-sim is ready',
  );

  const shutdown = (): void => {
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close();
    server.closeAllConnections();
    void sessions.closeAll().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof ConfigError ? error.message : String((error as Error).stack ?? error)}\n`,
  );
  process.exit(1);
});
