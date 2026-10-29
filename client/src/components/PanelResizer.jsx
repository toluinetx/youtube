import { useRef } from 'react';

/**
 * A drag handle on the inner edge of a side panel. `edge` is the side it sits on ('right' for the
 * left panel, 'left' for the right one). Dragging calls onResize with the new width, kept between
 * `min` and `max`; double-clicking resets it to `initial`. The panel must be `position: relative`.
 */
export default function PanelResizer({ edge, width, min, max, initial, onResize }) {
  const drag = useRef(null);
  const clamp = (w) => Math.round(Math.max(min, Math.min(max, w)));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize · double-click to reset"
      className={`group absolute inset-y-0 z-20 w-1.5 cursor-col-resize ${edge === 'right' ? '-right-0.5' : '-left-0.5'}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        onResize(clamp(drag.current.width + (edge === 'right' ? dx : -dx)));
      }}
      onPointerUp={() => {
        drag.current = null;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }}
      onDoubleClick={() => onResize(initial)}
      onKeyDown={(e) => {
        // Arrow keys nudge the edge for keyboard users.
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const step = (e.key === 'ArrowRight') === (edge === 'right') ? 16 : -16;
        onResize(clamp(width + step));
      }}
      tabIndex={0}
    >
      <div className="mx-auto h-full w-0.5 bg-transparent transition-colors group-hover:bg-indigo-500/70 group-focus-visible:bg-indigo-500/70" />
    </div>
  );
}
