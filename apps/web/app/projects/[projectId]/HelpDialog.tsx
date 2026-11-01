'use client';

import { useMemo, useState } from 'react';
import { Dialog, Kbd } from '@latex-cloud/ui';
import { LATEX_SHORTCUTS } from '../../../lib/editor/latex/input';
import { AUTO_RULES } from '../../../lib/latex/data/auto-expand';
import { WORD_SNIPPETS } from '../../../lib/latex/data/snippets';

type Tab = 'shortcuts' | 'snippets' | 'auto';

const APP_SHORTCUTS: [string, string][] = [
  ['Ctrl/⌘ Enter', 'Compile'],
  ['Ctrl/⌘ S', 'Save now (autosave is on)'],
  ['Ctrl/⌘ F', 'Find / replace'],
  ['Alt 1 … 4', 'Focus files, source, PDF, problems'],
  ['F2 / Del', 'Rename / delete the selected file'],
  ['Alt Shift T', 'Change theme'],
  ['?', 'This help'],
];

/** Keyboard shortcuts, snippet prefixes and math auto-expansions, searchable. */
export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('snippets');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  const snippets = useMemo(
    () =>
      WORD_SNIPPETS.filter(
        (s) => !q || `${s.prefix} ${s.label} ${s.category}`.toLowerCase().includes(q),
      ),
    [q],
  );
  const autos = useMemo(
    () =>
      AUTO_RULES.filter(
        (r) => !q || `${r.example.join(' ')} ${r.description}`.toLowerCase().includes(q),
      ),
    [q],
  );

  return (
    <Dialog open={open} onClose={onClose} title="Help: shortcuts & snippets" size="lg">
      <div className="help">
        <div className="help__bar">
          <div className="help__tabs" role="tablist">
            {(
              [
                ['snippets', `Snippets (${WORD_SNIPPETS.length})`],
                ['auto', `Math auto-expansion (${AUTO_RULES.length})`],
                ['shortcuts', 'Keyboard'],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className="palette__tab"
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="lc-input help__search"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search help"
          />
        </div>

        {tab === 'snippets' ? (
          <>
            <p className="muted">
              Type the prefix at the start of a line (anywhere inside math for math snippets) and
              press <Kbd>Tab</Kbd> or <Kbd>Enter</Kbd>. Then <Kbd>Tab</Kbd> jumps between fields.
            </p>
            <table className="help__table" data-testid="help-snippets">
              <tbody>
                {snippets.map((s) => (
                  <tr key={`${s.mode}:${s.prefix}`}>
                    <td>
                      <code>{s.prefix}</code>
                    </td>
                    <td>{s.label}</td>
                    <td className="muted">{s.mode === 'math' ? 'in math' : s.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : tab === 'auto' ? (
          <>
            <p className="muted">
              These expand as you type, inside math (except the first three). Undo with Ctrl/⌘ Z to
              keep what you typed.
            </p>
            <table className="help__table" data-testid="help-auto">
              <tbody>
                {autos.map((r) => (
                  <tr key={String(r.trigger)}>
                    <td>
                      <code>{r.example[0]}</code>
                    </td>
                    <td>
                      <code>{r.example[1]}</code>
                    </td>
                    <td className="muted">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <table className="help__table">
            <tbody>
              {[
                ...LATEX_SHORTCUTS.map(
                  (s) => [isMac ? s.mac : s.key, s.description] as [string, string],
                ),
                ...APP_SHORTCUTS,
              ]
                .filter(([k, d]) => !q || `${k} ${d}`.toLowerCase().includes(q))
                .map(([k, d]) => (
                  <tr key={k + d}>
                    <td>
                      <Kbd>{k}</Kbd>
                    </td>
                    <td colSpan={2}>{d}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}
