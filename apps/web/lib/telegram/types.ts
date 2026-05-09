// Tiny client-side typings for the Telegram Mini App SDK exposed on `window.Telegram.WebApp`.
// We only declare the surface we actually use; full types are at
// https://core.telegram.org/bots/webapps#initializing-mini-apps

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    start_param?: string;
  };
  version?: string;
  platform?: string;
  isVersionAtLeast?: (version: string) => boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  themeParams?: Record<string, string>;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy") => void;
  };
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    /** Bot API 6.1+. Older clients are missing offClick — use it
     *  defensively so cleanup never throws. */
    offClick?: (cb: () => void) => void;
    isVisible?: boolean;
  };
  // LocationManager — Bot API 8.0+. Use this in preference to
  // navigator.geolocation inside the Mini App: browser geolocation often
  // returns "denied" because Telegram doesn't proxy the OS permission
  // prompt, but LocationManager handles it natively.
  LocationManager?: TelegramLocationManager;
};

export type TelegramLocationData = {
  latitude: number;
  longitude: number;
  altitude?: number | null;
  course?: number | null;
  speed?: number | null;
  horizontal_accuracy?: number | null;
  vertical_accuracy?: number | null;
  course_accuracy?: number | null;
  speed_accuracy?: number | null;
};

export type TelegramLocationManager = {
  isInited: boolean;
  isLocationAvailable: boolean;
  isAccessRequested: boolean;
  isAccessGranted: boolean;
  init: (callback?: () => void) => void;
  getLocation: (callback: (data: TelegramLocationData | null) => void) => void;
  openSettings: () => void;
};

export {};
