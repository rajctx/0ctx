import type { DesktopApi } from '../shared/contracts/api';

declare global {
  interface Window {
    octxDesktop: DesktopApi;
  }
}

export {};
