import 'dotenv/config';
import { createJobDefinition } from './jobs';
import { closePool } from './connection';

async function registerDefinitions() {
  try {
    // Simple echo job
    await createJobDefinition('echo', 1, 3, 3600, 0);
    console.log('Registered: echo@1');

    // Failing job for testing retries
    await createJobDefinition('failing', 1, 3, 3600, 0);
    console.log('Registered: failing@1');

    // Video encoding simulation (CPU-intensive, longer running)
    await createJobDefinition('encode.video', 1, 2, 7200, 3); // 2 hour timeout, max 3 concurrent
    console.log('Registered: encode.video@1');

    // Math computation (CPU-intensive)
    await createJobDefinition('compute.math', 1, 3, 3600, 0);
    console.log('Registered: compute.math@1');

    // Data processing (I/O simulation)
    await createJobDefinition('process.data', 1, 3, 1800, 0);
    console.log('Registered: process.data@1');

    // API call simulation (network I/O)
    await createJobDefinition('call.api', 1, 3, 300, 0);
    console.log('Registered: call.api@1');

    // Batch processing (multiple items)
    await createJobDefinition('process.batch', 1, 2, 3600, 5); // Max 5 concurrent
    console.log('Registered: process.batch@1');

    console.log('\nAll job definitions registered successfully!');
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
