import { loadCollabConfig } from './config';
import { log } from './log';
import { createCollabServer } from './server';

async function main(): Promise<void> {
  const config = loadCollabConfig();
  const collab = createCollabServer(config);
  const { port } = await collab.listen();
  log('info', 'listening', { port, host: config.COLLAB_HOST });

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('info', 'shutdown', { signal });
    try {
      await collab.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

main().catch((e: unknown) => {
  log('error', 'fatal', { message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
