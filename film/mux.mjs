#!/usr/bin/env node
import { resolve } from 'node:path';
import { run } from './render.mjs';

const [video, voice, music, output, level = '0.12'] = process.argv.slice(2);
try {
  if (!video || !voice || !music || !output || !Number.isFinite(Number(level)) || Number(level) < 0 || Number(level) > 1)
    throw new Error('Usage: node film/mux.mjs picture.mp4 voice.wav music.wav final.mp4 [music-level 0..1]');
  if ([video, voice, music].some(file => resolve(file) === resolve(output))) throw new Error('Output must be a new file');
  const duration = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video]).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid picture duration');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-i', video, '-i', voice, '-i', music,
    '-filter_complex', `[1:a]apad[voice];[2:a]volume=${Number(level)},apad[music];[voice][music]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:latency=1[mix]`,
    '-map', '0:v:0', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(duration), '-movflags', '+faststart', output]);
  console.log(`Muxed picture, voice and music at ${Number(level)} gain.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
