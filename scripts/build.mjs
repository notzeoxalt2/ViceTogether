import { build } from 'esbuild';
await build({ entryPoints: ['ui/network.js'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', outfile: 'ui/network.bundle.js', minify: true });
await build({ entryPoints: ['tests/desktop-entry.js'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome140', outfile: 'ui/self-test.bundle.js', minify: true });
