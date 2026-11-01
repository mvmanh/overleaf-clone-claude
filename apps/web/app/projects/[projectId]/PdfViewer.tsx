'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Alert, Button, Spinner } from '@latex-cloud/ui';

type Zoom = 'fit' | number;

const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pdfjsPromise;
}

/**
 * PDF.js viewer that keeps zoom and scroll position when the document is
 * replaced by a newer build (pages are re-rendered in place, never blanked).
 */
export function PdfViewer({ url, fileName }: { url: string; fileName: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pagesHost = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [page, setPage] = useState(1);
  const scrollRatio = useRef(0);
  const renderToken = useRef(0);
  /** Scale actually used by the last render (resolves 'fit' to a number). */
  const effectiveScale = useRef(1);

  // Load (or replace) the document. The previous one stays visible until the new one renders.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    void loadPdfjs()
      .then(
        (pdfjs) =>
          pdfjs.getDocument({ url, withCredentials: true, isEvalSupported: false }).promise,
      )
      .then((d) => {
        if (cancelled) return void d.destroy();
        const el = scroller.current;
        if (el && el.scrollHeight > 0) scrollRatio.current = el.scrollTop / el.scrollHeight;
        setDoc((prev) => {
          void prev?.destroy();
          return d;
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open the PDF.');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const render = useCallback(async () => {
    const host = pagesHost.current;
    const el = scroller.current;
    if (!doc || !host || !el) return;
    const token = ++renderToken.current;
    const available = el.clientWidth - 32;
    const first = await doc.getPage(1);
    const base = first.getViewport({ scale: 1 });
    const scale = zoom === 'fit' ? Math.max(0.25, available / base.width) : zoom;
    effectiveScale.current = scale;
    const dpr = window.devicePixelRatio || 1;

    const canvases: HTMLCanvasElement[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      if (token !== renderToken.current) return;
      const viewport = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf__page';
      canvas.dataset.page = String(i);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      await p.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;
      canvases.push(canvas);
    }
    if (token !== renderToken.current) return;
    // Swap all pages at once: no flash of an empty viewer between builds.
    host.replaceChildren(...canvases);
    el.scrollTop = scrollRatio.current * el.scrollHeight;
  }, [doc, zoom]);

  useEffect(() => {
    void render();
  }, [render]);

  // Re-fit on resize when in fit-width mode.
  useEffect(() => {
    const el = scroller.current;
    if (!el || zoom !== 'fit') return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) > 4) {
        last = el.clientWidth;
        scrollRatio.current = el.scrollHeight ? el.scrollTop / el.scrollHeight : 0;
        void render();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [render, zoom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    scrollRatio.current = el.scrollHeight ? el.scrollTop / el.scrollHeight : 0;
    const pages = Array.from(pagesHost.current?.children ?? []) as HTMLElement[];
    const mid = el.scrollTop + el.clientHeight / 3;
    const current = pages.find((c) => c.offsetTop + c.offsetHeight > mid);
    if (current?.dataset.page) setPage(Number(current.dataset.page));
  };

  const step = (dir: 1 | -1) => {
    const el = scroller.current;
    const current = effectiveScale.current;
    const next =
      dir === 1
        ? (ZOOM_STEPS.find((z) => z > current + 0.01) ?? ZOOM_STEPS.at(-1)!)
        : ([...ZOOM_STEPS].reverse().find((z) => z < current - 0.01) ?? ZOOM_STEPS[0]!);
    scrollRatio.current = el?.scrollHeight ? el.scrollTop / el.scrollHeight : 0;
    setZoom(next);
  };

  return (
    <div className="pdf">
      <div className="pdf__toolbar" role="toolbar" aria-label="PDF controls">
        <Button size="sm" variant="ghost" onClick={() => step(-1)} aria-label="Zoom out">
          −
        </Button>
        <span className="pdf__zoom">
          {zoom === 'fit' ? 'Fit width' : `${Math.round(zoom * 100)}%`}
        </span>
        <Button size="sm" variant="ghost" onClick={() => step(1)} aria-label="Zoom in">
          +
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom('fit')} disabled={zoom === 'fit'}>
          Fit
        </Button>
        <span className="editor__spacer" />
        <span className="pdf__zoom" data-testid="pdf-pages">
          {doc ? `${page} / ${doc.numPages}` : ''}
        </span>
        <a className="lc-button" data-size="sm" data-variant="ghost" href={url} download={fileName}>
          Download
        </a>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="pdf__scroller" ref={scroller} onScroll={onScroll} data-testid="pdf-viewer">
        {!doc && !error ? (
          <div className="source-editor__center">
            <Spinner label="Loading PDF" />
          </div>
        ) : null}
        <div className="pdf__pages" ref={pagesHost} />
      </div>
    </div>
  );
}
