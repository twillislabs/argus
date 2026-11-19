import { useEffect, useRef, useState } from 'react';

// Themed hover tips for every element with a title attribute: the
// title moves to data-tip (so the browser's own grey tooltip doesn't
// show) and a dark tip in Argus's style appears near the element.
export default function Tooltips() {
  const [tip, setTip] = useState<{
    text: string;
    x: number;
    y: number;
    below: boolean;
  } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    function show(el: Element) {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      const r = el.getBoundingClientRect();
      const below = r.top < 60;
      setTip({
        text,
        x: Math.min(window.innerWidth - 12, Math.max(12, r.left + r.width / 2)),
        y: below ? r.bottom + 8 : r.top - 8,
        below,
      });
    }
    // Move a title to data-tip so the browser's grey tip never shows.
    function adopt(el: Element) {
      const title = el.getAttribute('title');
      if (!title) return;
      el.setAttribute('data-tip', title);
      el.removeAttribute('title');
      if (!el.getAttribute('aria-label') || el.getAttribute('data-tip-label') === '1') {
        el.setAttribute('aria-label', title);
        el.setAttribute('data-tip-label', '1');
      }
    }
    function onOver(e: PointerEvent) {
      const el = (e.target as Element | null)?.closest?.('[title], [data-tip]');
      if (!el) return;
      // Also when the element is the current one: React puts a changed
      // title back (pages that refresh, like the Brief).
      adopt(el);
      if (el === current.current) return;
      current.current = el;
      window.clearTimeout(timer.current);
      setTip(null);
      timer.current = window.setTimeout(() => show(el), 450);
    }
    function onOut(e: PointerEvent) {
      const el = current.current;
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      current.current = null;
      window.clearTimeout(timer.current);
      setTip(null);
    }
    function hide() {
      current.current = null;
      window.clearTimeout(timer.current);
      setTip(null);
    }
    // Titles React sets or changes while the pointer is already there.
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (!el.getAttribute?.('title')) continue;
        adopt(el);
        if (el === current.current) show(el);
      }
    });
    watch.observe(document.body, { attributes: true, attributeFilter: ['title'], subtree: true });
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      watch.disconnect();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  if (!tip) return null;
  return (
    <div className={'tip' + (tip.below ? ' below' : '')} role="tooltip" style={{ left: tip.x, top: tip.y }}>
      {tip.text}
    </div>
  );
}
