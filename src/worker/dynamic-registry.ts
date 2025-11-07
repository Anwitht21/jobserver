import { JobDefinition } from '../types';
import { listJobDefinitions } from '../db/jobs';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

/**
 * Dynamic registry that auto-discovers job definitions from files
 * 
 * Structure:
 *   jobs/
 *     echo.ts
 *     encode.video.ts
 *     compute.math.ts
 *     ...
 */
class DynamicJobRegistry {
  private definitions: Map<string, JobDefinition> = new Map();
  private jobDefinitionsDir: string;

  constructor(jobDefinitionsDir: string = path.join(process.cwd(), 'jobs')) {
    this.jobDefinitionsDir = jobDefinitionsDir;
  }

  /**
   * Load all job definitions from the jobs directory
   */
  async loadAll(): Promise<void> {
    // Ensure directory exists
    if (!fs.existsSync(this.jobDefinitionsDir)) {
      console.warn(`[DynamicRegistry] Job definitions directory not found: ${this.jobDefinitionsDir}`);
      return;
    }

    // Find all .ts or .js files in the jobs directory (excluding .d.ts and example files)
    const pattern = path.join(this.jobDefinitionsDir, '**/*.{ts,js}');
    const files = await glob(pattern, { 
      ignore: ['**/*.d.ts', '**/*.example.ts', '**/node_modules/**'] 
    });

    console.log(`[DynamicRegistry] Found ${files.length} job definition files`);

    for (const file of files) {
      try {
        await this.loadFromFile(file);
      } catch (error) {
        console.error(`[DynamicRegistry] Failed to load ${file}:`, error);
      }
    }
  }

  /**
   * Load a single job definition from a file
   */
  private async loadFromFile(filePath: string): Promise<void> {
    // Get relative path for logging
    const relativePath = path.relative(this.jobDefinitionsDir, filePath);
    
    // Convert to absolute path
    const absolutePath = path.resolve(filePath);
    
    // Calculate relative path from process.cwd() for import
    // This works with tsx which supports TypeScript imports
    const relativeFromCwd = path.relative(process.cwd(), absolutePath);
    const importPath = relativeFromCwd.replace(/\\/g, '/').replace(/\.(ts|js)$/, '');

    let module;
    try {
      // Import using relative path (tsx handles .ts files)
      // Add ./ prefix if not already present
      const cleanImport = importPath.startsWith('./') || importPath.startsWith('../') 
        ? importPath 
        : `./${importPath}`;
      module = await import(cleanImport);
    } catch (error: any) {
      // Fallback: try with file:// protocol for absolute paths
      try {
        const modulePath = absolutePath.replace(/\.(ts|js)$/, '');
        const fileUrl = `file://${modulePath}`;
        module = await import(fileUrl);
      } catch (e: any) {
        throw new Error(`Failed to import ${filePath}: ${error.message}. Fallback also failed: ${e.message}`);
      }
    }
    
    // Expect the module to export a default JobDefinition or named export
    const definition: JobDefinition = module.default || module.definition || module;

    if (!definition || !definition.key) {
      throw new Error(`Invalid job definition in ${filePath}: missing 'key' property`);
    }

    this.register(definition);
    console.log(`[DynamicRegistry] ✓ Loaded: ${definition.key}@${definition.version ?? 1} from ${relativePath}`);
  }

  /**
   * Sync with database - only load definitions that exist in DB
   */
  async syncWithDatabase(): Promise<void> {
    const dbDefinitions = await listJobDefinitions();
    const dbKeys = new Set(dbDefinitions.map(d => `${d.key}@${d.version}`));

    // Remove definitions that don't exist in database
    for (const [key, definition] of this.definitions.entries()) {
      if (!dbKeys.has(key)) {
        console.warn(`[DynamicRegistry] Removing ${key} - not found in database`);
        this.definitions.delete(key);
      }
    }

    // Load all files first
    await this.loadAll();
    
    // Filter to only definitions that exist in database
    const loadedKeys = Array.from(this.definitions.keys());
    const validDefinitions = loadedKeys.filter(key => dbKeys.has(key));
    
    console.log(`[DynamicRegistry] Synced: ${validDefinitions.length} definitions loaded`);
    
    // Warn about missing definitions (filter out test definitions)
    const missingInCode = Array.from(dbKeys).filter(key => !this.definitions.has(key));
    const testDefinitions = missingInCode.filter(key => key.startsWith('test.'));
    const nonTestMissing = missingInCode.filter(key => !key.startsWith('test.'));
    
    if (nonTestMissing.length > 0) {
      console.warn(`[DynamicRegistry] ⚠️  ${nonTestMissing.length} database definitions missing code: ${nonTestMissing.slice(0, 10).join(', ')}${nonTestMissing.length > 10 ? ` ... and ${nonTestMissing.length - 10} more` : ''}`);
    }
    
    if (testDefinitions.length > 0) {
      console.log(`[DynamicRegistry] ℹ️  ${testDefinitions.length} test definitions in database (expected - no code files needed)`);
    }
  }

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

  /**
   * Watch for file changes and reload definitions
   */
  watch(): void {
    if (!fs.existsSync(this.jobDefinitionsDir)) {
      return;
    }

    fs.watch(this.jobDefinitionsDir, { recursive: true }, async (eventType, filename) => {
      if (filename && (filename.endsWith('.ts') || filename.endsWith('.js')) && !filename.includes('.example')) {
        console.log(`[DynamicRegistry] File changed: ${filename}, reloading...`);
        try {
          await this.loadAll();
        } catch (error) {
          console.error(`[DynamicRegistry] Error reloading:`, error);
        }
      }
    });

    console.log(`[DynamicRegistry] Watching ${this.jobDefinitionsDir} for changes`);
  }
}

export const dynamicJobRegistry = new DynamicJobRegistry();

