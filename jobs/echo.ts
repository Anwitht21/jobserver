import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
  key: 'echo',
  version: 1,
  run: async (params, ctx) => {
    ctx.logger.info('Echo job started', params);
    await new Promise(resolve => setTimeout(resolve, 1000));
    ctx.logger.info('Echo job completed', params);
  },
};

export default definition;

