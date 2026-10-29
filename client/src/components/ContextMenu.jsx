import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const MARGIN = 8;

/**
 * Right-click menu shown at { x, y } (viewport coordinates). `items` is a list of
 * { label, icon, onClick, danger, disabled, shortcut } entries, '-' separators and
 * { heading } labels. Closes on Escape, a click elsewhere, scrolling, resizing or losing focus.
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const actionable = items.map((item, i) => (isAction(item) && !item.disabled ? i : -1)).filter((i) => i >= 0);

  // Keep the menu inside the viewport: flip left/up when it would overflow.
  useLayoutEffect(() => {
    const { width, height } = ref.current.getBoundingClientRect();
    const left = x + width + MARGIN > window.innerWidth ? Math.max(MARGIN, x - width) : x;
    const top = y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - height) : y;
    setPos({ left, top });
    ref.current.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e) => !ref.current?.contains(e.target) && onClose();
    const close = () => onClose();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);

  const choose = (item) => {
    onClose();
    item.onClick();
  };

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!actionable.length) return;
      const at = actionable.indexOf(active);
      const next = e.key === 'ArrowDown' ? (at + 1) % actionable.length : (at <= 0 ? actionable.length : at) - 1;
      setActive(actionable[next]);
    } else if ((e.key === 'Enter' || e.key === ' ') && actionable.includes(active)) {
      e.preventDefault();
      choose(items[active]);
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      className="fixed z-50 min-w-48 rounded-lg border border-zinc-700 bg-zinc-900 py-1 text-sm shadow-2xl outline-none"
      style={pos}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item === '-') return <div key={i} role="separator" className="my-1 h-px bg-zinc-800" />;
        if (item.heading) {
          return (
            <div key={i} className="truncate px-3 pt-1 pb-1.5 text-[11px] font-medium text-zinc-500" title={item.heading}>
              {item.heading}
            </div>
          );
        }
        const Icon = item.icon;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left disabled:cursor-default disabled:opacity-40 ${
              item.danger ? 'text-red-300' : 'text-zinc-200'
            } ${active === i ? (item.danger ? 'bg-red-500/20' : 'bg-zinc-800') : ''}`}
            onPointerEnter={() => setActive(item.disabled ? -1 : i)}
            onPointerLeave={() => setActive(-1)}
            onClick={() => choose(item)}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">{Icon && <Icon className="size-3.5" />}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <kbd className="font-sans text-[11px] text-zinc-500">{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

const isAction = (item) => item !== '-' && !item.heading;
