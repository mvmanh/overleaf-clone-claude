'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog } from '@latex-cloud/ui';
import {
  DEFAULT_SETTINGS,
  type EditorSettings,
  loadSettings,
  saveSettings,
} from '../../../lib/editor/latex/settings';

const TOGGLES: { key: keyof EditorSettings; label: string; hint: string }[] = [
  {
    key: 'autoMath',
    label: 'Math auto-expansion',
    hint: '// → \\frac{}{}, @a → \\alpha, x1 → x_1, RR → \\mathbb{R} … (only in math mode)',
  },
  {
    key: 'textShortcuts',
    label: 'Text shortcuts',
    hint: 'mk → $…$, dm → \\[…\\], beg → \\begin…\\end (dm/beg at line start)',
  },
  { key: 'mathPreview', label: 'Live math preview', hint: 'Render the formula under the cursor' },
  {
    key: 'lint',
    label: 'Check while typing',
    hint: 'Unclosed environments, unknown \\ref labels and \\cite keys, duplicate labels',
  },
  {
    key: 'autoClose',
    label: 'Auto-close',
    hint: '$…$, \\[ \\], \\( \\), and \\end{…} when pressing Enter after \\begin{…}',
  },
  { key: 'lineWrapping', label: 'Wrap long lines', hint: '' },
];

export function EditorSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<EditorSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    if (open) setS(loadSettings());
  }, [open]);
  const update = (patch: Partial<EditorSettings>) => setS(saveSettings(patch));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Editor settings"
      description="Saved in this browser and applied immediately."
    >
      <fieldset className="settings">
        <legend className="lc-visually-hidden">Suggestions</legend>
        <label className="settings__row">
          <span>
            <strong>Suggestions</strong>
            <small>Show while typing, or only with Ctrl+Space</small>
          </span>
          <select
            className="lc-input lc-select"
            value={s.autocomplete}
            onChange={(e) =>
              update({ autocomplete: e.target.value as EditorSettings['autocomplete'] })
            }
          >
            <option value="typing">While typing</option>
            <option value="manual">Ctrl+Space only</option>
          </select>
        </label>
        {TOGGLES.map((t) => (
          <label key={t.key} className="settings__row">
            <span>
              <strong>{t.label}</strong>
              {t.hint ? <small>{t.hint}</small> : null}
            </span>
            <input
              type="checkbox"
              checked={Boolean(s[t.key])}
              onChange={(e) => update({ [t.key]: e.target.checked })}
            />
          </label>
        ))}
        <label className="settings__row">
          <span>
            <strong>Font size</strong>
          </span>
          <select
            className="lc-input lc-select"
            value={s.fontSize}
            onChange={(e) => update({ fontSize: Number(e.target.value) })}
          >
            {[12, 13, 14, 15, 16, 18, 20].map((n) => (
              <option key={n} value={n}>
                {n}px
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <div className="dialog-form__actions">
        <Button onClick={() => update(DEFAULT_SETTINGS)}>Reset to defaults</Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
