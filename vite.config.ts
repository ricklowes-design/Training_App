import { type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };
// The installed MediaPipe version names the service worker's WebAssembly cache, so an upgrade never reuses old files.
const mpVersion = (JSON.parse(readFileSync(resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8')) as { version: string }).version;
const CONTENT_FILE = resolve(import.meta.dirname, 'content/programme.json');

/**
 * Programme content lives in content/programme.json and is fetched at run time,
 * so the coach's content can be edited and redeployed without touching code.
 * Dev: served by middleware. Build: copied into dist/content/.
 */
function programmeContent(): Plugin {
  return {
    name: 'programme-content',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0].endsWith('/content/programme.json')) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(readFileSync(CONTENT_FILE, 'utf8'));
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'content/programme.json', source: readFileSync(CONTENT_FILE, 'utf8') });
    },
  };
}

/**
 * MediaPipe's WebAssembly files (ES-module build) are served from /mediapipe/
 * so pose analysis needs no CDN; the model files come from Google's storage.
 */
const MP_DIR = resolve(import.meta.dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
const MP_FILES = ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm'];
function mediapipeWasm(): Plugin {
  return {
    name: 'mediapipe-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].split('/mediapipe/')[1];
        if (name && MP_FILES.includes(name)) {
          res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
          res.end(readFileSync(resolve(MP_DIR, name)));
          return;
        }
        next();
      });
    },
    generateBundle() {
      for (const f of MP_FILES) this.emitFile({ type: 'asset', fileName: `mediapipe/${f}`, source: readFileSync(resolve(MP_DIR, f)) });
    },
  };
}

/**
 * Generates sw.js with the list of built files, so the app shell works offline
 * after the first load. No workbox dependency.
 */
function serviceWorker(): Plugin {
  return {
    name: 'app-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      // MediaPipe's large WebAssembly files are left out of the offline shell; they load on first analysis.
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.startsWith('mediapipe/'));
      const shell = ['./', ...files.map((f) => './' + f), './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
      const version = `${pkg.version}-${Date.now()}`;
      const src = readFileSync(resolve(import.meta.dirname, 'src/sw-template.js'), 'utf8')
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__SHELL__', JSON.stringify(shell))
        .replace('__MP_VERSION__', JSON.stringify(mpVersion));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), programmeContent(), mediapipeWasm(), serviceWorker()],
  worker: { format: 'es' },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
