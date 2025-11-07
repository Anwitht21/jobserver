import { JobDefinition } from '../types';

class JobRegistry {
  private definitions: Map<string, JobDefinition> = new Map();

  register(definition: JobDefinition): void {
    const key = `${definition.key}@${definition.version ?? 1}`;
    this.definitions.set(key, definition);
  }

  get(key: string, version: number = 1): JobDefinition | undefined {
    const lookupKey = `${key}@${version}`;
    return this.definitions.get(lookupKey);
  }

  getAll(): JobDefinition[] {
    return Array.from(this.definitions.values());
  }
}

export const jobRegistry = new JobRegistry();

