import { z } from 'zod';

/** Project-level ACL roles. Ordered from least to most privileged. */
export const ProjectRole = z.enum(['viewer', 'editor', 'owner']);
export type ProjectRole = z.infer<typeof ProjectRole>;

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, owner: 2 };

/** True when `actual` grants at least the privileges of `required`. */
export function roleSatisfies(actual: ProjectRole, required: ProjectRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export const TexEngineName = z.enum(['pdflatex', 'xelatex', 'lualatex']);
export type TexEngineName = z.infer<typeof TexEngineName>;

export const ProjectSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  engine: TexEngineName,
  role: ProjectRole,
  owner: z.object({ id: z.string().uuid(), displayName: z.string() }),
  memberCount: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectListResponse = z.object({ projects: z.array(ProjectSummary) });
export type ProjectListResponse = z.infer<typeof ProjectListResponse>;
