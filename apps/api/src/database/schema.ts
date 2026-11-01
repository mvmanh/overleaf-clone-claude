import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type {
  CompileArtifactKind,
  CompileJobStatus,
  CompileOutcome,
  ProjectRole,
  TexEngineName,
} from '@latex-cloud/shared';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  display_name: string;
  auth_provider: Generated<string>;
  auth_provider_subject: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface UserPasswordCredentialsTable {
  user_id: string;
  password_hash: string;
  updated_at: Timestamp;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  created_at: Timestamp;
  expires_at: Date;
  last_seen_at: Timestamp;
  revoked_at: Date | null;
  user_agent: string | null;
  ip: string | null;
}

export interface ProjectsTable {
  id: Generated<string>;
  owner_id: string;
  name: string;
  engine: ColumnType<TexEngineName, TexEngineName | undefined, TexEngineName>;
  root_file_path: string | null;
  tex_image_version: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Date | null;
}

export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  role: ProjectRole;
  invited_by: string | null;
  invited_at: Timestamp;
  accepted_at: Date | null;
}

export interface ProjectAuditEventsTable {
  id: Generated<string>;
  project_id: string;
  actor_id: string | null;
  action: string;
  metadata: ColumnType<unknown, string | undefined, string>;
  created_at: Timestamp;
}

export interface ProjectFilesTable {
  id: Generated<string>;
  project_id: string;
  path: string;
  kind: 'text' | 'binary';
  content_text: string | null;
  blob_key: string | null;
  size_bytes: number;
  sha256: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Date | null;
}

export interface ProjectRevisionsTable {
  id: Generated<string>;
  project_id: string;
  fingerprint: string;
  manifest: ColumnType<unknown, string, string>;
  source_key: string;
  created_by: string | null;
  created_at: Timestamp;
}

export interface CompileJobsTable {
  id: Generated<string>;
  project_id: string;
  revision_id: string;
  status: CompileJobStatus;
  outcome: CompileOutcome | null;
  message: string | null;
  engine: TexEngineName;
  root_file: string;
  requested_by: string | null;
  worker: string | null;
  tex_image: string | null;
  queued_at: Timestamp;
  started_at: Date | null;
  finished_at: Date | null;
  setup_ms: number | null;
  compile_ms: number | null;
  total_ms: number | null;
  diagnostics: ColumnType<unknown, string | undefined, string>;
}

export interface CompileArtifactsTable {
  id: Generated<string>;
  compile_job_id: string;
  kind: CompileArtifactKind;
  file_name: string;
  blob_key: string;
  size_bytes: number;
  sha256: string;
}

export interface CollabDocumentsTable {
  file_id: string;
  state: Buffer;
  history_authors: ColumnType<string[], string[] | undefined, string[]>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface CollabUpdatesTable {
  id: Generated<string>;
  file_id: string;
  data: Buffer;
  source: 'client' | 'api';
  user_id: string | null;
  created_at: Timestamp;
}

export type HistorySource =
  | 'create'
  | 'edit'
  | 'upload'
  | 'rename'
  | 'restore'
  | 'delete'
  | 'import';

export interface HistoryBlobsTable {
  project_id: string;
  sha256: string;
  content: string;
}

export interface FileVersionsTable {
  id: Generated<string>;
  project_id: string;
  file_id: string;
  path: string;
  kind: 'text' | 'binary';
  sha256: string;
  size_bytes: number;
  blob_key: string | null;
  source: HistorySource;
  authors: ColumnType<string[], string[] | undefined, string[]>;
  created_at: Timestamp;
}

export interface ProjectLabelsTable {
  id: Generated<string>;
  project_id: string;
  name: string;
  created_by: string | null;
  created_at: Timestamp;
}

export interface Database {
  users: UsersTable;
  user_password_credentials: UserPasswordCredentialsTable;
  auth_sessions: AuthSessionsTable;
  projects: ProjectsTable;
  project_members: ProjectMembersTable;
  project_audit_events: ProjectAuditEventsTable;
  project_files: ProjectFilesTable;
  project_revisions: ProjectRevisionsTable;
  compile_jobs: CompileJobsTable;
  compile_artifacts: CompileArtifactsTable;
  collab_documents: CollabDocumentsTable;
  collab_updates: CollabUpdatesTable;
  history_blobs: HistoryBlobsTable;
  file_versions: FileVersionsTable;
  project_labels: ProjectLabelsTable;
}

export type UserRow = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
