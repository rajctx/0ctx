import { nativeImage } from 'electron';

export function createAppIcon(size = 64) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="bg" x1="8" x2="56" y1="8" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#17c3b2" />
          <stop offset="1" stop-color="#ff9f1c" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="#111827" />
      <path d="M17 32c0-8.3 6.7-15 15-15h10v7H32c-4.4 0-8 3.6-8 8s3.6 8 8 8h10v7H32c-8.3 0-15-6.7-15-15z" fill="url(#bg)"/>
      <circle cx="45.5" cy="32" r="5.5" fill="#f8fafc"/>
    </svg>
  `.trim();

  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}
