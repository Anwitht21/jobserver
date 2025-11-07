import 'dotenv/config';
import { claimJob, getJobById, reclaimOrphanedJobs, updateJobStatus } from '../db/jobs';
import { jobRegistry } from './registry';
import { executeJob, handleCancellation } from './executor';
import { runMigrations } from '../db/migrations';
import { createNotificationListener, closeNotificationListener } from '../db/notifications';
import { Client } from 'pg';

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const MAX_CONCURRENT_EXECUTIONS = parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '10', 10);
const LEASE_DURATION_SECONDS = parseInt(process.env.LEASE_DURATION_SECONDS || '60', 10);
const HEARTBEAT_INTERVAL_SECONDS = parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || '10', 10);
const CANCEL_GRACE_MS = parseInt(process.env.CANCEL_GRACE_MS || '5000', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10); // Fallback polling: every 60 seconds

class Worker {
  private running = false;
  private activeExecutions = new Map<string, Promise<void>>();
  private pollInterval: NodeJS.Timeout | null = null;
  private orphanRecoveryInterval: NodeJS.Timeout | null = null;
  private notificationClient: Client | null = null;
  private pollForJobsPending = false;

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log(`[${WORKER_ID}] Starting worker with max ${MAX_CONCURRENT_EXECUTIONS} concurrent executions`);

    // Set up LISTEN/NOTIFY for real-time job notifications
    try {
      this.notificationClient = await createNotificationListener(() => {
        // Wake up worker when notification is received
        this.wakeUp();
      });
      console.log(`[${WORKER_ID}] Listening for job notifications`);
    } catch (error) {
      console.error(`[${WORKER_ID}] Failed to set up notification listener, falling back to polling:`, error);
    }

    // Fallback polling (longer interval since we have notifications)
    // This ensures we still process jobs even if notifications fail
    this.pollInterval = setInterval(() => {
      this.pollForJobs().catch((error) => {
        console.error(`[${WORKER_ID}] Error polling for jobs:`, error);
      });
    }, POLL_INTERVAL_MS);

    // Reclaim orphaned jobs periodically
    this.orphanRecoveryInterval = setInterval(() => {
      this.reclaimOrphans().catch((error) => {
        console.error(`[${WORKER_ID}] Error reclaiming orphans:`, error);
      });
    }, LEASE_DURATION_SECONDS * 1000);

    // Initial poll
    await this.pollForJobs();
    await this.reclaimOrphans();
  }

  private wakeUp(): void {
    // Wake up worker to check for jobs
    // Use a flag to prevent concurrent polling
    if (!this.running) {
      return;
    }
    
    if (!this.pollForJobsPending && this.activeExecutions.size < MAX_CONCURRENT_EXECUTIONS) {
      this.pollForJobsPending = true;
      this.pollForJobs()
        .catch((error) => {
          console.error(`[${WORKER_ID}] Error polling for jobs after notification:`, error);
        })
        .finally(() => {
          this.pollForJobsPending = false;
        });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    if (this.orphanRecoveryInterval) {
      clearInterval(this.orphanRecoveryInterval);
      this.orphanRecoveryInterval = null;
    }

    // Close notification listener
    if (this.notificationClient) {
      await closeNotificationListener(this.notificationClient);
      this.notificationClient = null;
    }

    // Wait for active executions to complete
    console.log(`[${WORKER_ID}] Waiting for ${this.activeExecutions.size} active executions to complete...`);
    await Promise.allSettled(Array.from(this.activeExecutions.values()));
    
    console.log(`[${WORKER_ID}] Worker stopped`);
  }

  private async pollForJobs(): Promise<void> {
    if (this.activeExecutions.size >= MAX_CONCURRENT_EXECUTIONS) {
      return;
    }

    const job = await claimJob(WORKER_ID, LEASE_DURATION_SECONDS);
    if (!job) {
      return;
    }

    const definition = jobRegistry.get(job.definitionKey, job.definitionVersion);
    if (!definition) {
      console.error(`[${WORKER_ID}] No definition found for ${job.definitionKey}@${job.definitionVersion}`);
      await updateJobStatus(job.id, 'failed', `No definition found for ${job.definitionKey}@${job.definitionVersion}`);
      return;
    }

    // Check if cancellation was requested before starting
    if (job.cancelRequestedAt) {
      await handleCancellation(job, definition, CANCEL_GRACE_MS);
      return;
    }

    // Execute job asynchronously
    const executionPromise = executeJob(job, definition, WORKER_ID, LEASE_DURATION_SECONDS)
      .catch((error) => {
        console.error(`[${WORKER_ID}] Execution error for job ${job.id}:`, error);
      })
      .finally(() => {
        this.activeExecutions.delete(job.id);
      });

    this.activeExecutions.set(job.id, executionPromise);
  }

  private async reclaimOrphans(): Promise<void> {
    const reclaimed = await reclaimOrphanedJobs(LEASE_DURATION_SECONDS);
    if (reclaimed > 0) {
      console.log(`[${WORKER_ID}] Reclaimed ${reclaimed} orphaned jobs`);
    }
  }
}

let workerInstance: Worker | null = null;

export function getWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker();
  }
  return workerInstance;
}

// Example job definitions - these would typically be imported from separate modules
async function registerExampleJobs() {
  // Example: Simple echo job
  jobRegistry.register({
    key: 'echo',
    version: 1,
    run: async (params, ctx) => {
      ctx.logger.info('Echo job started', params);
      await new Promise(resolve => setTimeout(resolve, 1000));
      ctx.logger.info('Echo job completed', params);
    },
  });

  // Example: Failing job for testing retries
  jobRegistry.register({
    key: 'failing',
    version: 1,
    defaultMaxAttempts: 3,
    run: async (params, ctx) => {
      ctx.logger.info('Failing job started');
      throw new Error('Intentional failure');
    },
  });

  // Video encoding - Real ffmpeg encoding
  jobRegistry.register({
    key: 'encode.video',
    version: 1,
    defaultMaxAttempts: 2,
    timeoutSeconds: 7200, // 2 hours
    concurrencyLimit: 3, // Max 3 concurrent video encodings
    run: async (params, ctx) => {
      const ffmpeg = require('fluent-ffmpeg');
      const path = require('path');
      const fs = require('fs');
      
      const { inputPath, originalFilename, format, quality } = params as { 
        inputPath: string; 
        originalFilename?: string; 
        format?: string; 
        quality?: string 
      };
      
      if (!inputPath || !fs.existsSync(inputPath)) {
        throw new Error(`Input video file not found: ${inputPath}`);
      }

      const outputFormat = format || 'mp4';
      const outputQuality = quality || '1080p';
      
      ctx.logger.info('Video encoding started', { 
        inputPath, 
        originalFilename, 
        format: outputFormat, 
        quality: outputQuality 
      });
      
      // Determine output directory and filename
      const outputDir = path.join(process.cwd(), 'outputs');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const inputBasename = path.basename(inputPath, path.extname(inputPath));
      const outputFilename = `${inputBasename}-${outputQuality}.${outputFormat}`;
      const outputPath = path.join(outputDir, outputFilename);
      
      // Map quality to video bitrate/resolution
      const qualitySettings: Record<string, { videoBitrate: string; scale?: string }> = {
        '720p': { videoBitrate: '2500k', scale: '1280:720' },
        '1080p': { videoBitrate: '5000k', scale: '1920:1080' },
        '4k': { videoBitrate: '15000k', scale: '3840:2160' },
      };
      
      const settings = qualitySettings[outputQuality] || qualitySettings['1080p'];
      
      await ctx.emitEvent('progress', { step: 'Starting encoding', progress: 0 });
      
      return new Promise<void>((resolve, reject) => {
        const command = ffmpeg(inputPath)
          .outputOptions([
            `-c:v libx264`,
            `-preset medium`,
            `-crf 23`,
            `-b:v ${settings.videoBitrate}`,
            settings.scale ? `-vf scale=${settings.scale}` : '',
            `-c:a aac`,
            `-b:a 192k`,
            `-movflags +faststart`, // Web optimization
          ].filter(Boolean))
          .format(outputFormat)
          .output(outputPath)
          .on('start', (commandLine: string) => {
            ctx.logger.info('FFmpeg command:', commandLine);
            ctx.emitEvent('progress', { step: 'Encoding started', progress: 10 });
          })
          .on('progress', (progress: { percent?: number; timemark?: string }) => {
            const percent = Math.min(progress.percent || 0, 95);
            ctx.logger.info(`Encoding progress: ${percent.toFixed(1)}%`, progress);
            ctx.emitEvent('progress', { 
              step: 'Encoding', 
              progress: percent,
              timemark: progress.timemark 
            });
          })
          .on('end', async () => {
            ctx.logger.info('Video encoding completed', { 
              outputPath: `outputs/${outputFilename}`,
              outputFilename 
            });
            
            // Emit completion event with output file info
            await ctx.emitEvent('completed', {
              outputPath: `outputs/${outputFilename}`,
              outputFilename,
              format: outputFormat,
              quality: outputQuality,
            });
            
            await ctx.emitEvent('progress', { step: 'Completed', progress: 100 });
            
            // Clean up input file (optional - comment out if you want to keep originals)
            // fs.unlinkSync(inputPath);
            
            resolve();
          })
          .on('error', (err: Error) => {
            ctx.logger.error('FFmpeg encoding error:', err);
            reject(new Error(`Video encoding failed: ${err.message}`));
          });
        
        // Handle cancellation
        ctx.abortSignal.addEventListener('abort', () => {
          ctx.logger.info('Video encoding cancelled by user');
          command.kill('SIGKILL');
          reject(new Error('Video encoding cancelled'));
        });
        
        command.run();
      });
    },
    onSuccess: async (ctx) => {
      ctx.logger.info('Video encoding succeeded - ready for delivery');
    },
    onFail: async (ctx) => {
      ctx.logger.error('Video encoding failed', { error: ctx.error });
    },
  });

  // Math computation - CPU-intensive calculation
  jobRegistry.register({
    key: 'compute.math',
    version: 1,
    defaultMaxAttempts: 3,
    run: async (params, ctx) => {
      const { operation, numbers } = params as { operation: string; numbers: number[] };
      ctx.logger.info('Math computation started', { operation, numbers });
      
      let result: number;
      
      switch (operation) {
        case 'sum':
          result = numbers.reduce((a, b) => a + b, 0);
          break;
        case 'product':
          result = numbers.reduce((a, b) => a * b, 1);
          break;
        case 'fibonacci':
          // Compute nth Fibonacci number (CPU-intensive)
          const n = numbers[0] || 30;
          const fib = (n: number): number => {
            if (n <= 1) return n;
            return fib(n - 1) + fib(n - 2);
          };
          result = fib(n);
          break;
        case 'prime':
          // Check if number is prime (CPU-intensive)
          const num = numbers[0] || 1000000;
          const isPrime = (n: number): boolean => {
            if (n < 2) return false;
            for (let i = 2; i * i <= n; i++) {
              if (n % i === 0) return false;
            }
            return true;
          };
          result = isPrime(num) ? 1 : 0;
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }
      
      ctx.logger.info('Math computation completed', { operation, result });
      await ctx.emitEvent('result', { operation, result, input: numbers });
    },
  });

  // Data processing - I/O simulation
  jobRegistry.register({
    key: 'process.data',
    version: 1,
    defaultMaxAttempts: 3,
    run: async (params, ctx) => {
      const { dataset, operation } = params as { dataset: string; operation: string };
      ctx.logger.info('Data processing started', { dataset, operation });
      
      // Simulate reading data
      await new Promise(resolve => setTimeout(resolve, 500));
      ctx.logger.info('Data loaded', { records: 1000 });
      
      // Simulate processing
      const steps = ['Validating', 'Transforming', 'Aggregating', 'Exporting'];
      for (const step of steps) {
        if (ctx.abortSignal.aborted) {
          throw new Error('Data processing cancelled');
        }
        ctx.logger.info(`Processing: ${step}`);
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      ctx.logger.info('Data processing completed', { dataset, operation, outputRecords: 950 });
    },
    onSuccess: async (ctx) => {
      ctx.logger.info('Data processing succeeded - results available');
    },
  });

  // API call simulation - network I/O
  jobRegistry.register({
    key: 'call.api',
    version: 1,
    defaultMaxAttempts: 3,
    timeoutSeconds: 300, // 5 minutes
    run: async (params, ctx) => {
      const { endpoint, method, payload } = params as { 
        endpoint: string; 
        method?: string; 
        payload?: Record<string, unknown> 
      };
      ctx.logger.info('API call started', { endpoint, method: method || 'GET' });
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Simulate API response
      const response = {
        status: 200,
        data: { message: 'API call successful', endpoint, timestamp: new Date().toISOString() },
      };
      
      ctx.logger.info('API call completed', { endpoint, status: response.status });
      await ctx.emitEvent('api_response', response);
    },
    onFail: async (ctx) => {
      ctx.logger.error('API call failed - may need to retry', { error: ctx.error });
    },
  });

  // Batch processing - multiple items
  jobRegistry.register({
    key: 'process.batch',
    version: 1,
    defaultMaxAttempts: 2,
    concurrencyLimit: 5, // Max 5 concurrent batch jobs
    run: async (params, ctx) => {
      const { items, batchSize } = params as { items: string[]; batchSize?: number };
      const size = batchSize || 10;
      const totalItems = items?.length || 50;
      
      ctx.logger.info('Batch processing started', { totalItems, batchSize: size });
      
      let processed = 0;
      const batches = Math.ceil(totalItems / size);
      
      for (let i = 0; i < batches; i++) {
        if (ctx.abortSignal.aborted) {
          throw new Error('Batch processing cancelled');
        }
        
        const start = i * size;
        const end = Math.min(start + size, totalItems);
        const batch = items?.slice(start, end) || [];
        
        ctx.logger.info(`Processing batch ${i + 1}/${batches}`, { items: batch.length });
        
        // Simulate processing each item in batch
        for (const item of batch) {
          await new Promise(resolve => setTimeout(resolve, 50));
          processed++;
        }
        
        await ctx.emitEvent('batch_progress', { 
          batch: i + 1, 
          totalBatches: batches, 
          processed, 
          total: totalItems 
        });
      }
      
      ctx.logger.info('Batch processing completed', { totalProcessed: processed });
    },
    onSuccess: async (ctx) => {
      ctx.logger.info('All batches processed successfully');
    },
  });
}

async function main() {
  try {
    // Run migrations
    await runMigrations();
    
    // Register job definitions
    await registerExampleJobs();
    
    // Start worker
    const worker = getWorker();
    await worker.start();
    
    console.log('Worker started. Press Ctrl+C to stop.');
  } catch (error) {
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${WORKER_ID}] Received SIGTERM, shutting down gracefully...`);
  if (workerInstance) {
    await workerInstance.stop();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`[${WORKER_ID}] Received SIGINT, shutting down gracefully...`);
  if (workerInstance) {
    await workerInstance.stop();
  }
  process.exit(0);
});

if (require.main === module) {
  main();
}

