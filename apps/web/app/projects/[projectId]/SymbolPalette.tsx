'use client';

import { useMemo, useState } from 'react';
import { paletteCategories } from '../../../lib/latex/data/commands';

/** Searchable grid of math symbols; click inserts at the cursor (wrapped in $…$ outside math). */
export function SymbolPalette({
  onInsert,
  onClose,
}: {
  onInsert: (tex: string) => void;
  onClose: () => void;
}) {
  const groups = useMemo(() => paletteCategories(), []);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(groups[0]?.category ?? '');
  const q = query.trim().toLowerCase().replace(/^\\/, '');
  const shown = q
    ? groups
        .flatMap((g) => g.items)
        .filter((i) => i.name.toLowerCase().includes(q) || i.glyph === query.trim())
    : (groups.find((g) => g.category === active)?.items ?? []);

  return (
    <div
      className="palette"
      role="dialog"
      aria-label="Symbol palette"
      data-testid="symbol-palette"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="palette__head">
        <input
          className="lc-input palette__search"
          placeholder="Search symbols (e.g. alpha, leq, →)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          aria-label="Search symbols"
        />
        <button
          type="button"
          className="lc-dialog__close"
          onClick={onClose}
          aria-label="Close symbol palette"
        >
          ×
        </button>
      </div>
      {!q ? (
        <div className="palette__tabs" role="tablist">
          {groups.map((g) => (
            <button
              key={g.category}
              type="button"
              role="tab"
              aria-selected={g.category === active}
              className="palette__tab"
              onClick={() => setActive(g.category)}
            >
              {g.category}
            </button>
          ))}
        </div>
      ) : null}
      <div className="palette__grid">
        {shown.map((item) => (
          <button
            key={`${item.category}:${item.name}`}
            type="button"
            className="palette__cell"
            title={`\\${item.name}${item.pkg ? ` (${item.pkg})` : ''}`}
            aria-label={`Insert \\${item.name}`}
            onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
            onClick={() => onInsert(item.snippet ?? `\\${item.name}`)}
          >
            <span className="palette__glyph">{item.glyph}</span>
            <span className="palette__name">\{item.name}</span>
          </button>
        ))}
        {!shown.length ? <p className="muted">No symbol matches “{query}”.</p> : null}
      </div>
    </div>
  );
}
