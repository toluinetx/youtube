import { Loader2, RotateCcw, Settings2 } from 'lucide-react';

/** Gear button that opens a ParamsPanel; shows how many settings differ from the defaults. */
export function GearButton({ open, count, onClick, title }) {
  return (
    <button
      type="button"
      className={`icon-btn relative shrink-0 border ${open ? 'border-indigo-500 text-indigo-300' : 'border-zinc-800'}`}
      title={title}
      aria-label={title}
      aria-expanded={open}
      onClick={onClick}
    >
      <Settings2 className="size-4" />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-indigo-500 text-[9px] font-semibold text-white">
          {count}
        </span>
      )}
    </button>
  );
}

const isSet = (v) => v !== undefined && v !== null && v !== '';

/** Settings that differ from the defaults (the ones that are sent). */
export const countSet = (values) => Object.values(values || {}).filter(isSet).length;

/**
 * Settings for a model, built from a list of parameters:
 * [{ name, type: number|integer|boolean|enum|string, title, description, default, minimum, maximum, enum, step }].
 * `values` holds only what the user changed; everything else keeps its default.
 */
export default function ParamsPanel({ params, values = {}, onChange, loading, error, note }) {
  const set = (name, value) => {
    const { [name]: _, ...rest } = values;
    const param = params?.find((p) => p.name === name);
    onChange(isSet(value) && value !== param?.default ? { ...rest, [name]: value } : rest);
  };
  const changed = countSet(values);

  return (
    <div className="mt-2 space-y-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-zinc-500">{note}</p>
        {changed > 0 && (
          <button type="button" className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100" onClick={() => onChange({})}>
            <RotateCcw className="size-3" /> Reset all
          </button>
        )}
      </div>
      {loading && (
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" /> Loading the model's settings…
        </p>
      )}
      {error && <p className="text-xs text-amber-400">{error}</p>}
      {params?.length === 0 && <p className="text-xs text-zinc-500">This model has no other settings.</p>}
      {params?.map((p) => (
        <Param key={p.name} param={p} value={values[p.name]} onChange={(v) => set(p.name, v)} />
      ))}
    </div>
  );
}

function Param({ param: p, value, onChange }) {
  const changed = isSet(value);
  const shown = changed ? value : p.default;
  const id = `param-${p.name}`;
  const defaultText = p.default === undefined || p.default === null ? 'none' : String(p.default);

  let control;
  if (p.type === 'boolean') {
    control = (
      <input id={id} type="checkbox" className="accent-indigo-500" checked={Boolean(shown)} onChange={(e) => onChange(e.target.checked)} />
    );
  } else if (p.type === 'enum') {
    control = (
      <select id={id} className="field py-1 text-xs" value={changed ? String(value) : ''} onChange={(e) => onChange(e.target.value === '' ? null : p.enum.find((o) => String(o) === e.target.value))}>
        <option value="">Default ({defaultText})</option>
        {p.enum.map((o) => (
          <option key={String(o)} value={String(o)}>{String(o)}</option>
        ))}
      </select>
    );
  } else if (p.type === 'number' || p.type === 'integer') {
    const parse = (raw) => {
      if (raw === '') return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      return p.type === 'integer' ? Math.round(n) : n;
    };
    const ranged = Number.isFinite(p.minimum) && Number.isFinite(p.maximum) && (p.type === 'number' || p.maximum - p.minimum <= 500);
    const step = p.step ?? (p.type === 'integer' ? 1 : ranged ? niceStep(p.maximum - p.minimum) : 'any');
    control = (
      <div className="flex items-center gap-2">
        {ranged && (
          <input
            type="range"
            min={p.minimum}
            max={p.maximum}
            step={step}
            value={shown ?? p.minimum}
            onChange={(e) => onChange(parse(e.target.value))}
            className="min-w-0 flex-1 accent-indigo-500"
            aria-label={p.title}
          />
        )}
        <input
          id={id}
          type="number"
          min={p.minimum}
          max={p.maximum}
          step={step}
          className={`field py-1 text-xs tabular-nums ${ranged ? 'w-20' : ''}`}
          placeholder={p.default === undefined || p.default === null ? 'Not set' : String(p.default)}
          value={changed ? value : ''}
          onChange={(e) => onChange(parse(e.target.value))}
        />
      </div>
    );
  } else {
    control = (
      <input
        id={id}
        className="field py-1 text-xs"
        placeholder={p.default === undefined || p.default === null ? 'Not set' : String(p.default)}
        value={changed ? String(value) : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className={`text-xs font-medium ${changed ? 'text-indigo-300' : 'text-zinc-400'}`}>
          {p.title}
        </label>
        {changed ? (
          <button type="button" className="flex items-center gap-0.5 text-[10px] text-zinc-500 hover:text-zinc-200" onClick={() => onChange(null)} title={`Back to the default (${defaultText})`}>
            <RotateCcw className="size-2.5" /> Default
          </button>
        ) : (
          <span className="text-[10px] text-zinc-600">Default</span>
        )}
      </div>
      {control}
      {p.description && (
        <p className="mt-1 line-clamp-2 text-[11px] text-zinc-600" title={p.description}>
          {p.description}
        </p>
      )}
    </div>
  );
}

function niceStep(range) {
  if (range <= 1) return 0.01;
  if (range <= 10) return 0.1;
  return 1;
}
