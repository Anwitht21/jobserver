import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
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
};

export default definition;

