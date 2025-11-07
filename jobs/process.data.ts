import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
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
};

export default definition;

