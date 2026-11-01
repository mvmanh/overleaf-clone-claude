import { z } from 'zod';

export const DiagnosticSeverity = z.enum(['error', 'warning', 'info']);
export type DiagnosticSeverity = z.infer<typeof DiagnosticSeverity>;

export const Diagnostic = z.object({
  severity: DiagnosticSeverity,
  message: z.string(),
  /** Project-relative path when it can be determined. */
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  /** Short machine-friendly classifier, e.g. `undefined-control-sequence`. */
  code: z.string().optional(),
  /** Up to a few lines of raw log context. */
  excerpt: z.string().optional(),
  hint: z.string().optional(),
});
export type Diagnostic = z.infer<typeof Diagnostic>;
