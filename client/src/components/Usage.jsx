import { useCallback, useEffect, useMemo, useState } from 'react';
import { DollarSign, ExternalLink, Loader2, RotateCcw, X } from 'lucide-react';
import { api, currentProject } from '../api.js';

const PROVIDERS = {
  gemini: { label: 'Gemini', billing: 'https://console.cloud.google.com/billing', billingLabel: 'Google Cloud billing' },
  replicate: { label: 'Replicate', billing: 'https://replicate.com/account/billing', billingLabel: 'Replicate billing' },
  elevenlabs: { label: 'ElevenLabs', billing: 'https://elevenlabs.io/app/subscription', billingLabel: 'ElevenLabs subscription' },
};

const FIELD_LABELS = {
  input: 'Input $/1M tokens',
  text_output: 'Text out $/1M',
  image_output: 'Image out $/1M',
  video_output: 'Video out $/1M',
  per_image: '$ per image',
  per_second: '$ per second',
  per_1k_credits: '$ per 1,000 credits',
};

const PERIODS = [
  ['today', 'Today'],
  ['month', 'This month'],
  ['all', 'All time'],
];

function since(period) {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(0);
}

export const money = (n) => (n == null ? '?' : n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

const num = (n) => (n == null ? '?' : Number(n).toLocaleString());

function unitsText(e) {
  const text = reportedText(e);
  return e.backfilled ? `${text} · estimated (before logging started)` : text;
}

function reportedText(e) {
  const u = e.units || {};
  if (e.provider === 'gemini' && e.kind === 'video') {
    return `${u.seconds?.toFixed(1) ?? '?'} s · ${num(u.video_output_tokens)} video tokens${u.estimated ? ' (from length)' : ''}`;
  }
  if (e.provider === 'gemini') {
    return `${num(u.input_tokens)} in · ${num(u.image_output_tokens)} image · ${num(u.text_output_tokens)} text tokens`;
  }
  if (e.provider === 'replicate') return `${u.images ?? 1} image${u.predict_time != null ? ` · ${u.predict_time.toFixed(1)} s run` : ''}`;
  if (e.provider === 'elevenlabs') return `${u.credits != null ? `${num(u.credits)} credits` : 'credits not reported'}${u.characters ? ` · ${num(u.characters)} chars` : ''}`;
  return '';
}

/** Total of known costs and how many entries have no known cost. */
function total(entries) {
  return entries.reduce((t, e) => ({ usd: t.usd + (e.cost_usd ?? 0), unknown: t.unknown + (e.cost_usd == null ? 1 : 0), n: t.n + 1 }), { usd: 0, unknown: 0, n: 0 });
}

/** "$" button for the top bar: this month's spending (all projects), opening the usage report. */
export function UsageButton() {
  const [report, setReport] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => api.usage().then(setReport).catch(() => {}), []);

  // Refresh now and then, and whenever the window regains focus, so the figure stays current.
  useEffect(() => {
    load();
    const timer = setInterval(load, 20_000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  const month = useMemo(() => {
    const from = since('month');
    return total((report?.entries || []).filter((e) => new Date(e.at) >= from));
  }, [report]);

  return (
    <>
      <button
        className="btn-ghost px-2 tabular-nums"
        onClick={() => {
          load();
          setOpen(true);
        }}
        title="API usage and spending"
        aria-label="API usage and spending"
      >
        <DollarSign className="size-4" />
        {report && (
          <span className="text-xs">
            {month.usd.toFixed(2)}
            {month.unknown > 0 && '+'}
          </span>
        )}
      </button>
      {open && report && <UsageModal report={report} onChange={setReport} onClose={() => setOpen(false)} />}
    </>
  );
}

function UsageModal({ report, onChange, onClose }) {
  const [period, setPeriod] = useState('month');
  const [scope, setScope] = useState('project');
  const project = currentProject();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries = useMemo(() => {
    const from = since(period);
    return report.entries.filter((e) => new Date(e.at) >= from && (scope === 'all' || e.project === project));
  }, [report, period, scope, project]);

  const sum = total(entries);
  const byProvider = Object.keys(PROVIDERS).map((p) => [p, total(entries.filter((e) => e.provider === p))]);
  const [accounts, setAccounts] = useState(null);

  useEffect(() => {
    api.usageAccounts().then(setAccounts).catch((e) => setAccounts({ error: e.message }));
  }, []);

  // Prices for every model in the log (and ElevenLabs), unpriced ones first.
  const priceRows = useMemo(() => {
    const seen = new Map();
    for (const e of report.entries) {
      const key = e.provider === 'elevenlabs' ? 'elevenlabs' : e.model;
      if (!seen.has(key)) seen.set(key, e.provider);
    }
    return [...seen].sort(([a], [b]) => Number(Boolean(report.prices[a])) - Number(Boolean(report.prices[b])));
  }, [report]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full w-full max-w-5xl flex-col rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="usage-title">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div>
            <h2 id="usage-title" className="text-sm font-semibold text-zinc-100">API usage and spending</h2>
            <p className="text-xs text-zinc-500">Every generation the editor ran, with what each provider reported.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-2.5">
          <Toggle value={scope} onChange={setScope} options={[['project', 'This project'], ['all', 'All projects']]} />
          <Toggle value={period} onChange={setPeriod} options={PERIODS} />
          <p className="ml-auto text-sm text-zinc-300">
            <span className="text-lg font-semibold text-zinc-100 tabular-nums">{money(sum.usd)}</span>
            <span className="ml-2 text-xs text-zinc-500">
              {sum.n} request{sum.n === 1 ? '' : 's'}
              {sum.unknown > 0 && ` · ${sum.unknown} without a price (not included)`}
            </span>
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Balances accounts={accounts} />

          {byProvider.length > 0 && (
            <table className="w-full text-xs">
              <thead className="text-left text-zinc-500">
                <tr>
                  <th className="pb-1 font-medium">Provider</th>
                  <th className="pb-1 text-right font-medium">Requests</th>
                  <th className="pb-1 text-right font-medium">Cost</th>
                  <th className="pb-1 pl-4 font-medium">Exact bill</th>
                </tr>
              </thead>
              <tbody className="text-zinc-300">
                {byProvider.map(([p, t]) => (
                  <tr key={p} className="border-t border-zinc-800">
                    <td className="py-1.5">{PROVIDERS[p].label}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.n}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {money(t.usd)}
                      {t.unknown > 0 && <span className="text-amber-400"> + {t.unknown} unpriced</span>}
                    </td>
                    <td className="py-1.5 pl-4">
                      <a className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100" href={PROVIDERS[p].billing} target="_blank" rel="noreferrer">
                        {PROVIDERS[p].billingLabel} <ExternalLink className="size-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <section>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-300 uppercase">Requests</h3>
            {entries.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-zinc-500">
                    <tr>
                      <th className="pb-1 font-medium">When</th>
                      {scope === 'all' && <th className="pb-1 font-medium">Project</th>}
                      <th className="pb-1 font-medium">Scene</th>
                      <th className="pb-1 font-medium">What</th>
                      <th className="pb-1 font-medium">Model</th>
                      <th className="pb-1 font-medium">Usage reported</th>
                      <th className="pb-1 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="text-zinc-300">
                    {entries.slice(0, 500).map((e, i) => (
                      <tr key={`${e.at}-${i}`} className="border-t border-zinc-800 align-top">
                        <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-500 tabular-nums">{new Date(e.at).toLocaleString()}</td>
                        {scope === 'all' && <td className="py-1.5 pr-3">{e.project}</td>}
                        <td className="py-1.5 pr-3 tabular-nums">{e.scene_id ?? ''}</td>
                        <td className="py-1.5 pr-3">{e.kind}</td>
                        <td className="max-w-48 truncate py-1.5 pr-3" title={e.model}>{e.model}</td>
                        <td className="py-1.5 pr-3 text-zinc-400">{unitsText(e)}</td>
                        <td className={`py-1.5 text-right tabular-nums ${e.cost_usd == null ? 'text-amber-400' : ''}`} title={e.cost_usd == null ? 'No price for this model yet: set one below' : undefined}>
                          {money(e.cost_usd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {entries.length > 500 && <p className="mt-1 text-[11px] text-zinc-500">Showing the latest 500 of {entries.length}.</p>}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">No paid requests {period === 'all' ? '' : 'in this period '}yet. Each generation is logged here from now on.</p>
            )}
          </section>

          {priceRows.length > 0 && (
            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-zinc-300 uppercase">Prices</h3>
              <p className="mb-2 text-[11px] text-zinc-500">
                Costs are the reported usage times these prices (USD). Gemini and the fixed-price Replicate models are filled in from the
                providers' price lists; set the rest yourself. ElevenLabs depends on your plan.
              </p>
              <div className="space-y-1.5">
                {priceRows.map(([key, provider]) => (
                  <PriceRow
                    key={key}
                    name={key === 'elevenlabs' ? 'ElevenLabs (voice and sound effects)' : key}
                    priceKey={key}
                    fields={report.price_fields[provider]}
                    price={report.prices[key]}
                    onChange={onChange}
                  />
                ))}
              </div>
            </section>
          )}

          <p className="text-[11px] leading-relaxed text-zinc-600">
            How exact is this? Gemini reports the tokens of every request, so its costs are the tokens times Google's prices. ElevenLabs reports the
            credits each request used. Replicate reports run time but not cost, so its costs come from the per-image prices above. Your bill
            is on each provider's page (links above); requests made outside this editor aren't included here.
          </p>
        </div>
      </div>
    </div>
  );
}

/** What's left on each account, where the provider's API reports it. */
function Balances({ accounts }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-300 uppercase">Remaining credits</h3>
      {!accounts ? (
        <p className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Loader2 className="size-3.5 animate-spin" /> Asking the providers…
        </p>
      ) : accounts.error ? (
        <p className="text-xs text-red-400">{accounts.error}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(PROVIDERS).map(([key, p]) => {
            const a = accounts[key] || {};
            return (
              <div key={key} className="rounded-md border border-zinc-800 p-3">
                <p className="text-xs font-medium text-zinc-300">{p.label}</p>
                {a.ok ? (
                  <>
                    <p className="mt-1 text-lg font-semibold text-zinc-100 tabular-nums">
                      {a.remaining != null ? a.remaining.toLocaleString() : '?'} <span className="text-xs font-normal text-zinc-500">credits left</span>
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {a.used != null && a.limit != null && `${a.used.toLocaleString()} of ${a.limit.toLocaleString()} used`}
                      {a.tier && ` · ${a.tier} plan`}
                      {a.resets_at && ` · resets ${new Date(a.resets_at).toLocaleDateString()}`}
                    </p>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                    {key === 'elevenlabs' && /user_read/.test(a.error || '')
                      ? 'Add the "User: read" permission to your ElevenLabs API key to see your remaining credits here.'
                      : a.error}
                  </p>
                )}
                <a className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100" href={p.billing} target="_blank" rel="noreferrer">
                  {p.billingLabel} <ExternalLink className="size-3" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Toggle({ value, onChange, options }) {
  return (
    <div className="flex rounded-md bg-zinc-950 p-0.5 text-xs ring-1 ring-zinc-800">
      {options.map(([key, label]) => (
        <button
          key={key}
          className={`rounded px-2.5 py-1 ${value === key ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PriceRow({ name, priceKey, fields, price, onChange }) {
  const [draft, setDraft] = useState(price || {});
  const [error, setError] = useState(null);
  useEffect(() => setDraft(price || {}), [price]);

  const save = async (next) => {
    setError(null);
    try {
      onChange(await api.setPrice(priceKey, next));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 px-3 py-2">
      <span className={`min-w-48 flex-1 truncate text-xs ${price ? 'text-zinc-300' : 'text-amber-400'}`} title={name}>
        {name}
        {!price && ' · no price'}
      </span>
      {fields.map((f) => (
        <label key={f} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          {FIELD_LABELS[f]}
          <input
            type="number"
            min={0}
            step="any"
            className="field w-20 py-0.5 text-xs tabular-nums"
            value={draft[f] ?? ''}
            onChange={(e) => setDraft({ ...draft, [f]: e.target.value === '' ? null : Number(e.target.value) })}
            onBlur={() => JSON.stringify(draft) !== JSON.stringify(price || {}) && save(draft)}
          />
        </label>
      ))}
      <button className="icon-btn size-6" title="Back to the default price" onClick={() => save(null)}>
        <RotateCcw className="size-3" />
      </button>
      {error && <p className="w-full text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
