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
  /** Project-relative path of the main .tex file, if one is set. */
  rootFile: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectListResponse = z.object({ projects: z.array(ProjectSummary) });
export type ProjectListResponse = z.infer<typeof ProjectListResponse>;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const ProjectName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(200, 'Name must be at most 200 characters')
  .refine((v) => !CONTROL_CHARS.test(v), 'Name contains invalid characters');

export const ProjectTemplate = z.enum(['blank', 'article', 'math', 'cs']);
export type ProjectTemplate = z.infer<typeof ProjectTemplate>;

export const CreateProjectRequest = z.object({
  name: ProjectName,
  engine: TexEngineName.default('pdflatex'),
  template: ProjectTemplate.default('article'),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z
  .object({
    name: ProjectName.optional(),
    engine: TexEngineName.optional(),
    /** Must be an existing .tex file in the project. */
    rootFile: z.string().min(1).max(512).optional(),
  })
  .strict()
  .refine(
    (v) => v.name !== undefined || v.engine !== undefined || v.rootFile !== undefined,
    'Nothing to update',
  );
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

/** Roles that can be granted by invitation or role change. Ownership moves only by transfer. */
export const AssignableRole = z.enum(['editor', 'viewer']);
export type AssignableRole = z.infer<typeof AssignableRole>;

export const ProjectMember = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: ProjectRole,
  invitedAt: z.string().datetime(),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

export const ProjectMembersResponse = z.object({ members: z.array(ProjectMember) });
export type ProjectMembersResponse = z.infer<typeof ProjectMembersResponse>;

export const InviteMemberRequest = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: AssignableRole,
});
export type InviteMemberRequest = z.infer<typeof InviteMemberRequest>;

export const UpdateMemberRequest = z.object({ role: AssignableRole }).strict();
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

export const TransferOwnershipRequest = z.object({ userId: z.string().uuid() }).strict();
export type TransferOwnershipRequest = z.infer<typeof TransferOwnershipRequest>;

/**
 * Minimum role per project action. The API enforces these; the UI reads the
 * same table only to decide which controls to show.
 */
export const PROJECT_PERMISSIONS = {
  'project:read': 'viewer',
  'project:update': 'editor',
  'project:delete': 'owner',
  'project:transfer': 'owner',
  'members:read': 'viewer',
  'members:manage': 'owner',
  'files:read': 'viewer',
  'files:write': 'editor',
  // Viewers may compile: they need the PDF. Quotas bound the cost.
  'compile:run': 'viewer',
} as const satisfies Record<string, ProjectRole>;
export type ProjectAction = keyof typeof PROJECT_PERMISSIONS;

export function can(role: ProjectRole, action: ProjectAction): boolean {
  return roleSatisfies(role, PROJECT_PERMISSIONS[action]);
}
