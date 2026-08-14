/* ============================================================
   A note on the desktop when an interval ends, for when you've
   tabbed away and the chime is going into an empty room.
   Off unless you ask for it in Settings.
   ============================================================ */
export const possible = () => typeof Notification !== 'undefined';
export const granted = () => possible() && Notification.permission === 'granted';

/** returns true if it's on afterwards */
export async function ask() {
  if (!possible()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try { return (await Notification.requestPermission()) === 'granted'; } catch { return false; }
}

export function tell(title, body) {
  if (!granted() || !document.hidden) return;      // if you're looking at it, the chime is enough
  try {
    const n = new Notification(title, { body, icon: 'assets/icon-192.png', tag: 'artwork', silent: true });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 12000);
  } catch { /* some browsers only allow these from a service worker */ }
}
