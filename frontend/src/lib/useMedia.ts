import { useEffect, useState } from 'react';

// Phones and narrow windows: the map page shows its panels as sheets
// over the map (styles/mobile.css uses the same width).
export const PHONE_QUERY = '(max-width: 860px)';

export function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(query);
    const change = () => setOn(m.matches);
    change();
    m.addEventListener('change', change);
    return () => m.removeEventListener('change', change);
  }, [query]);
  return on;
}
