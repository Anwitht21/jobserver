import { JobDefinition } from '../src/types';

const definition: JobDefinition = {
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
};

export default definition;

