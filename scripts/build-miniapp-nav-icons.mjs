import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const sharp = createRequire(path.join(root, 'web/package.json'))('sharp');
// One small, consistent line icon family. Generated PNGs also work in native tab components.
const drawings = {
  home: '<path d="M4 11 12 4l8 7v9h-6v-6h-4v6H4z"/>',
  book: '<path d="M12 6v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v14c-4-1-6 0-9 2-3-2-5-3-9-2z"/>',
  paw: '<ellipse cx="5" cy="9" rx="2.2" ry="3" transform="rotate(-25 5 9)"/><ellipse cx="10" cy="5" rx="2" ry="2.8"/><ellipse cx="16" cy="5.5" rx="2" ry="2.8" transform="rotate(12 16 5.5)"/><ellipse cx="20" cy="10" rx="2" ry="2.8" transform="rotate(25 20 10)"/><path d="M6 19c-2-3 2-4 3-7 1-2 4-2 5 0 1 3 5 4 4 7-1 3-4 1-6 1s-5 2-6-1z"/>',
  community: '<path d="M21 11a8.6 8.6 0 0 1-9 8 11 11 0 0 1-4-.8L3 20l1.7-4A7.4 7.4 0 0 1 3 11a9 9 0 0 1 18 0z"/><path d="M7 11h.1M12 11h.1M17 11h.1" stroke-width="2.8"/>',
  person: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 6 0 0 1 16 0v2"/>',
  settings: '<path d="m10 3-1 3-3 1-3 3 2 2-1 4 3 2 3-1 2 4 3-2 1-3 4-1 1-4-3-2-1-4-4 1z"/><circle cx="12" cy="12" r="3"/>',
  care: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 10h16m-12 5 3 3 5-5"/>',
  habitat: '<path d="M3 21V9l9-6 9 6v12zM9 21v-6h6v6"/><path d="M12 12c0-5 5-5 5-5s1 5-5 5zm0 0c0-4-5-4-5-4s0 4 5 4z"/>',
  permission: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6zM8 12l3 3 5-6"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  'care-feeding': '<path d="M3 12h18l-2 6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M7 8h.1M12 6h.1M17 8h.1" stroke-width="2.8"/>',
  'care-water': '<path d="M12 3c-3 4.5-7 8.7-7 12a7 7 0 0 0 14 0c0-3.3-4-7.5-7-12zM8.5 15.5a3.5 3.5 0 0 0 3.5 3"/>',
  'care-cleaning': '<path d="m15 3 5 5-5 5-5-5zM10 8l-6 6a2 2 0 0 0 0 3l3 3a2 2 0 0 0 3 0l6-6M5 13l6 6M20 13v5m-2.5-2.5h5"/>',
  'care-health': '<path d="M20.8 4.6a5.2 5.2 0 0 0-7.4 0L12 6l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21l8.8-9a5.2 5.2 0 0 0 0-7.4zM8 12h2l1.5-3 2 6 1.5-3h1"/>',
};
let count = 0;
for (const [name, content] of Object.entries(drawings)) {
  const colors = ['home', 'paw', 'person', 'community'].includes(name)
    ? { black: '#050505', gray: '#818181', white: '#ffffff' }
    : name === 'book' ? { black: '#050505', gray: '#818181' } : { black: '#050505' };
  for (const [variant, color] of Object.entries(colors)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96"><g fill="none" stroke="${color}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">${content}</g></svg>`;
    const filename = name.startsWith('care-') ? name : `nav-${name}-${variant}`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(root, `miniapp/assets/${filename}.png`));
    count++;
  }
}
console.log(`Generated ${count} native miniapp icons.`);
