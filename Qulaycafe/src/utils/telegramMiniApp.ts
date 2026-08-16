// ---------------------------------------------------------------------------
// Telegram Mini App support. When a customer opens a restaurant's ordering
// link from inside Telegram via the bot's "🛵 Buyurtma berish" button, this
// same web app loads inside Telegram's in-app browser and Telegram hands it
// a signed `initData` string proving who the person is. This calls the
// backend to validate that signature and returns the verified identity —
// on a normal web browser (no Telegram context), this is a harmless no-op.
// ---------------------------------------------------------------------------

export interface TelegramWebAppUser {
  id: string;
  username?: string;
  firstName?: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initData: string;
        colorScheme?: 'light' | 'dark';
      };
    };
  }
}

export function isTelegramMiniApp(): boolean {
  return !!(typeof window !== 'undefined' && window.Telegram?.WebApp?.initData);
}

export async function initTelegramMiniApp(): Promise<TelegramWebAppUser | null> {
  const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
  if (!webApp?.initData) return null;

  try {
    webApp.ready();
    webApp.expand();
  } catch {
    /* not fatal — verification below is what actually matters */
  }

  try {
    const res = await fetch('/api/auth/telegram/webapp-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: webApp.initData })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.verified) return null;
    return { id: data.telegramUserId, username: data.telegramUsername, firstName: data.telegramFirstName };
  } catch {
    return null;
  }
}
