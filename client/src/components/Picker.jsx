import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, Star } from 'lucide-react';

/**
 * A searchable dropdown with starred items listed first.
 * options: [{ id, label, sub?, badge? }]. `custom(query)` returns true when the typed text can be used
 * as an id of its own (e.g. "owner/model"). `extra(option)` renders a control at the end of a row.
 * `groupBy` names an option field (e.g. "provider") to offer as filter chips when options differ in it.
 */
export default function Picker({ value, options, onChange, starred = [], onStar, placeholder = 'Search…', custom, extra, status, ariaLabel, groupBy }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(null);
  const groups = groupBy ? [...new Set(options.map((o) => o[groupBy]).filter(Boolean))] : [];
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const list = useRef(null);
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !root.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inGroup = group ? options.filter((o) => o[groupBy] === group) : options;
    const matches = q ? inGroup.filter((o) => `${o.label} ${o.id} ${o.sub || ''}`.toLowerCase().includes(q)) : inGroup;
    const isStarred = new Set(starred);
    const items = [
      ...matches.filter((o) => isStarred.has(o.id)).map((o) => ({ ...o, starred: true })),
      ...matches.filter((o) => !isStarred.has(o.id)),
    ];
    const typed = query.trim();
    if (typed && custom?.(typed) && !options.some((o) => o.id === typed)) items.push({ id: typed, label: `Use "${typed}"`, sub: 'Custom', isCustom: true });
    return items;
  }, [options, starred, query, custom, group, groupBy]);

  useEffect(() => setActive(0), [query, open, group]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (id) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && rows[active]) {
      e.preventDefault();
      choose(rows[active].id);
    }
  };

  const firstUnstarred = rows.findIndex((r) => !r.starred);

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        type="button"
        className="field flex items-center gap-2 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="min-w-0 flex-1 truncate">
          {current?.label || value || <span className="text-zinc-600">None</span>}
          {current?.sub && <span className="ml-1.5 text-xs text-zinc-500">{current.sub}</span>}
        </span>
        {starred.includes(value) && <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />}
        <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-xl shadow-black/50">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-2.5">
            <Search className="size-3.5 shrink-0 text-zinc-500" />
            <input
              autoFocus
              className="w-full bg-transparent py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              placeholder={placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          {groups.length > 1 && (
            <div className="flex gap-1 border-b border-zinc-800 px-2 py-1.5">
              {[null, ...groups].map((g) => (
                <button
                  key={g ?? 'all'}
                  type="button"
                  className={`rounded px-2 py-0.5 text-[11px] ${group === g ? 'bg-indigo-500/20 text-indigo-200' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}`}
                  onClick={() => setGroup(g)}
                >
                  {g ?? 'All'}
                </button>
              ))}
            </div>
          )}
          <ul ref={list} role="listbox" className="max-h-72 overflow-y-auto py-1">
            {rows.map((o, i) => (
              <li key={`${o.isCustom ? 'custom:' : ''}${o.id}`}>
                {i === 0 && o.starred && <Heading>Starred</Heading>}
                {i === firstUnstarred && firstUnstarred > 0 && <Heading>All</Heading>}
                <div
                  data-index={i}
                  role="option"
                  aria-selected={o.id === value}
                  className={`group flex items-center gap-1 px-1 ${i === active ? 'bg-zinc-800' : ''}`}
                  onMouseEnter={() => setActive(i)}
                >
                  {onStar && !o.isCustom ? (
                    <button
                      type="button"
                      className="flex size-6 shrink-0 items-center justify-center rounded text-zinc-600 hover:text-amber-300"
                      title={o.starred ? 'Unstar' : 'Star'}
                      aria-label={`${o.starred ? 'Unstar' : 'Star'} ${o.label}`}
                      onClick={() => onStar(o.id, !o.starred)}
                    >
                      <Star className={`size-3.5 ${o.starred ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>
                  ) : (
                    <span className="size-6 shrink-0" />
                  )}
                  <button type="button" className="min-w-0 flex-1 py-1.5 text-left" onClick={() => choose(o.id)}>
                    <span className="flex items-center gap-1.5 text-sm text-zinc-100">
                      <span className="truncate">{o.label}</span>
                      {o.badge && <span className="shrink-0 text-[10px] text-zinc-500">{o.badge}</span>}
                      {o.id === value && <Check className="size-3.5 shrink-0 text-indigo-400" />}
                    </span>
                    {o.sub && <span className="block truncate text-[11px] text-zinc-500" title={o.sub}>{o.sub}</span>}
                  </button>
                  {extra && !o.isCustom && extra(o)}
                </div>
              </li>
            ))}
            {!rows.length && <li className="px-3 py-3 text-xs text-zinc-500">{query ? 'No matches.' : 'Nothing to choose from yet.'}</li>}
          </ul>
          {status && <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">{status}</p>}
        </div>
      )}
    </div>
  );
}

function Heading({ children }) {
  return <p className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">{children}</p>;
}
