import { nativeImage } from 'electron';

export function createAppIcon(size = 64) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="bg" x1="7" x2="56" y1="6" y2="57" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#151313" />
          <stop offset="1" stop-color="#050505" />
        </linearGradient>
        <linearGradient id="mark" x1="13" x2="48" y1="14" y2="49" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#ffd8a8" />
          <stop offset="0.55" stop-color="#f39158" />
          <stop offset="1" stop-color="#d56333" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#bg)" />
      <path d="M38.46 21.04A15.5 15.5 0 1 0 38.46 42.96" stroke="url(#mark)" stroke-width="7" stroke-linecap="round" fill="none" />
      <path d="M14.5 38.5L42.75 25.75" stroke="url(#mark)" stroke-width="6" stroke-linecap="round" fill="none" />
      <circle cx="46" cy="24.5" r="4.5" fill="#fff3e7" />
    </svg>
  `.trim();

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
