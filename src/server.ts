import app from './app';
import { env } from './config/env';
import { connectDB } from './config/db';

async function main(): Promise<void> {
  await connectDB();
  app.listen(env.port, () => {
    console.log(`API listening on port ${env.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
