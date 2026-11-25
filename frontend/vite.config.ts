import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

import pkg from './package.json';

// Build output layout (dist/):
//   index.html
//   img/                   static files from public/
//   assets/js/             app code, plus vendor-*.js for third-party code
//   assets/css/            stylesheets
//   assets/fonts/          self-hosted web fonts
//   assets/img/            images imported from source
//   vendor/cesium/         Cesium workers, assets and third-party files
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBase = 'vendor/cesium';

function assetDir(name: string): string {
  if (/\.css$/i.test(name)) return 'assets/css';
  if (/\.(woff2?|ttf|otf|eot)$/i.test(name)) return 'assets/fonts';
  if (/\.(png|jpe?g|gif|svg|webp|avif|ico)$/i.test(name)) return 'assets/img';
  return 'assets/misc';
}

function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  if (id.includes('/@cesium/') || id.includes('/cesium/')) return 'vendor-cesium';
  if (/\/(react|react-dom|react-router|react-router-dom|scheduler|@remix-run)\//.test(id)) {
    return 'vendor-react';
  }
  return 'vendor';
}

export default defineConfig({
  resolve: {
    alias: [
      // satellite.js's main entry also loads a WebAssembly build (top-level
      // await, Node threads). Argus only needs the plain JS SGP4 modules.
      {
        find: /^satellite-core\/(.*)$/,
        replacement: decodeURIComponent(new URL('./node_modules/satellite.js/dist/', import.meta.url).pathname) + '$1',
      },
    ],
  },
  worker: {
    format: 'es',
    rollupOptions: { output: { entryFileNames: 'assets/js/[name]-[hash].js' } },
  },
  define: {
    CESIUM_BASE_URL: JSON.stringify('/' + cesiumBase),
    // The release, from package.json (make release keeps it in step).
    ARGUS_VERSION: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['ThirdParty', 'Workers', 'Assets', 'Widgets'].map((dir) => ({
        src: cesiumSource + '/' + dir,
        dest: cesiumBase,
      })),
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 6000,
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/js/[name]-[hash].js',
        chunkFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: (info) => assetDir(info.names?.[0] ?? info.name ?? '') + '/[name]-[hash][extname]',
        manualChunks: vendorChunk,
      },
    },
  },
});
