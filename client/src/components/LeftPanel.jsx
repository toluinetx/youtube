import { useState } from 'react';
import { Library, Loader2, PanelLeftClose, Settings2 } from 'lucide-react';
import PanelResizer from './PanelResizer.jsx';

const hasFiles = (e) => [...e.dataTransfer.types].includes('Files');

const TABS = [
  { key: 'library', label: 'Library', icon: Library },
  { key: 'project', label: 'Project Settings', icon: Settings2 },
];

/**
 * The left side: the media library and the project's settings, as tabs, `width` pixels wide (its
 * right edge drags to resize). Collapses to a strip of icons; files dropped on the strip still go
 * into the library.
 */
export default function LeftPanel({
  tab, onTab, collapsed, onToggle, width, onResize, resize, libraryCount, uploading, onUploadFiles, library, project,
}) {
  const [dropping, setDropping] = useState(false);

  if (collapsed) {
    return (
      <aside
        className="relative flex w-11 shrink-0 flex-col items-center gap-1 border-r border-zinc-800 bg-zinc-900/40 py-2"
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropping(false)}
        onDrop={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(false);
          onUploadFiles([...e.dataTransfer.files]);
        }}
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className="icon-btn"
            title={`Show ${label.toLowerCase()}`}
            aria-label={`Show ${label.toLowerCase()}`}
            onClick={() => {
              onTab(key);
              onToggle();
            }}
          >
            <Icon className="size-4" />
          </button>
        ))}
        <span className="text-[10px] text-zinc-500 tabular-nums" title="Files in the library">{libraryCount}</span>
        {uploading.length > 0 && <Loader2 className="size-4 animate-spin text-zinc-400" />}
        {dropping && <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-indigo-400 bg-indigo-500/15" />}
      </aside>
    );
  }

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40" style={{ width }}>
      <PanelResizer edge="right" width={width} onResize={onResize} {...resize} />
      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 p-1.5" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => onTab(key)}
            className={`btn min-w-0 flex-1 px-2 ${tab === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}
          >
            <Icon className="size-4 shrink-0" /> <span className="truncate">{label}</span>
            {key === 'library' && <span className="text-xs font-normal text-zinc-500 tabular-nums">{libraryCount}</span>}
          </button>
        ))}
        <button className="icon-btn shrink-0" title="Hide this panel" aria-label="Hide this panel" onClick={onToggle}>
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      {tab === 'library' ? library : <div className="min-h-0 flex-1 overflow-y-auto">{project}</div>}
    </aside>
  );
}
