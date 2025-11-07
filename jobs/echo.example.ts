import { JobDefinition } from '../src/types';

/**
 * Example job definition file
 * 
 * This file would be auto-discovered by the dynamic registry
 */
const definition: JobDefinition = {
  key: 'echo',
  version: 1,
  defaultMaxAttempts: 3,
  timeoutSeconds: 3600,
  run: async (params, ctx) => {
    ctx.logger.info('Echo job started', params);
    await new Promise(resolve => setTimeout(resolve, 1000));
    ctx.logger.info('Echo job completed', params);
  },
};

export default definition;

