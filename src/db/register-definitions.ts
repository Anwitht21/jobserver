import 'dotenv/config';
import { createJobDefinition } from '../db/jobs';
import { closePool } from '../db/connection';

async function registerDefinitions() {
  try {
    // Register the echo job definition
    await createJobDefinition('echo', 1, 3, 3600, 0);
    console.log('Registered: echo@1');

    // Register the failing job definition (for testing retries)
    await createJobDefinition('failing', 1, 3, 3600, 0);
    console.log('Registered: failing@1');

    console.log('All job definitions registered successfully!');
  } catch (error) {
    console.error('Error registering definitions:', error);
    throw error;
  } finally {
    await closePool();
  }
}

registerDefinitions()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

