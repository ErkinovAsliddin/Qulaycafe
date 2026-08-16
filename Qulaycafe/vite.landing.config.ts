import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// ---------------------------------------------------------------------------
// The marketing site (qulaycafe.uz) is its own Vite build, not another entry
// of the app build, on purpose:
//
//   * server.ts serves the apex hostname straight out of ./landing and 404s
//     anything file-looking it cannot find there, so the marketing page needs
//     a self-contained bundle rooted at that directory.
//   * a shared build would let Rollup hoist app code into a chunk the landing
//     page imports (and vice versa), so a visitor reading about pricing would
//     download guest-menu code — the same network-level isolation the four
//     surfaces already have.
//
// Output: landing/index.html + landing/assets/* + the files under
// src/landing/public/ copied to the root of landing/.
// ---------------------------------------------------------------------------
export default defineConfig({
  root: path.resolve(__dirname, 'src/landing'),
  publicDir: path.resolve(__dirname, 'src/landing/public'),
  // Vite loads .env from `root` by default, and root is src/landing here — so
  // without this the project's .env is never read and every VITE_* the page
  // uses (contact details, admin URL) lands as undefined.
  envDir: __dirname,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, 'landing'),
    emptyOutDir: true,
    // The apex is a single page of mostly-static markup; one file each keeps
    // the request count (and the round trips on a phone) at a minimum.
    cssCodeSplit: false
  },
  server: {
    port: 5174
  }
});
