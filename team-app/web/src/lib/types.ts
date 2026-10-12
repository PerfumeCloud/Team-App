export type ID = string;
export type UserColor = 'blue' | 'sage' | 'rose' | 'amber' | 'plum' | 'slate';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'normal' | 'high';
export type NoteColor = 'none' | 'cream' | 'blue' | 'sage' | 'rose' | 'sand';
export type PushKind = 'mail' | 'orders' | 'tasks' | 'comments' | 'reminders';

export interface User {
  id: ID;
  name: string;
  email: string;
  color: UserColor;
  role: 'admin' | 'member';
  updated_at: number;
  deleted: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Task {
  id: ID;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  category: string | null;
  assignee_id: ID | null;
  due_date: string | null;
  position: number;
  checklist: ChecklistItem[];
  source_email_id: string | null;
  completed_at: number | null;
  created_by: ID | null;
  updated_by: ID | null;
  created_at: number;
  updated_at: number;
  deleted: number;
}

export interface Note {
  id: ID;
  title: string;
  body: string | null;
  pinned: number;
  color: NoteColor;
  created_by: ID | null;
  updated_by: ID | null;
  created_at: number;
  updated_at: number;
  deleted: number;
}

export interface Comment {
  id: ID;
  task_id: ID;
  user_id: ID;
  body: string;
  created_at: number;
  updated_at: number;
  deleted: number;
}

export interface Email {
  id: string;
  mailbox: string;
  from_name: string | null;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: number;
  seen: number;
  flagged: number;
  answered: number;
  important: number;
  reasons: string[];
  score: number;
  status: 'open' | 'done';
  assignee_id: ID | null;
  done_by: ID | null;
  done_at: number | null;
  updated_at: number;
  deleted: number;
}

export interface ActivityItem {
  id: ID;
  user_id: ID | null;
  type: string;
  entity_type: string | null;
  entity_id: string | null;
  text: string;
  created_at: number;
}

export interface Meta {
  shopifyConfigured: boolean;
  mailConfigured: boolean;
  mailboxes: string[];
  jobsLastRun: number;
  ordersLastSync: number;
  mailLastFetch: number;
}

export interface SyncResponse {
  serverTime: number;
  full: boolean;
  users: User[];
  tasks: Task[];
  notes: Note[];
  comments: Comment[];
  emails: Email[];
  activity: ActivityItem[];
  meta: Meta;
}

export interface Prefs {
  push: Record<PushKind, boolean>;
}

export interface StatusResponse {
  installed: boolean;
  configExists: boolean;
  dbError: string | null;
  version: string;
  requirements: Record<string, { ok: boolean; label: string }> | null;
}

export interface Stats {
  days: number;
  currency: string;
  configured: boolean;
  lastSync: number;
  today: { revenue: number; orders: number };
  current: { revenue: number; orders: number; items: number; aov: number };
  previous: { revenue: number; orders: number; items: number; aov: number };
  series: { date: string; revenue: number; orders: number }[];
  topProducts: { title: string; qty: number; revenue: number }[];
  toShip: { count: number; oldest: number | null };
  recent: {
    id: string;
    name: string;
    created_at: number;
    total: number;
    items: number;
    financial: string | null;
    fulfillment: string | null;
    cancelled: number;
  }[];
  lowStock: { at?: number; threshold?: number; items: { title: string; variant: string; sku: string | null; qty: number }[] };
}

export interface MailboxConfig {
  id?: string;
  email: string;
  label?: string;
  host: string;
  port: number;
  security: 'ssl' | 'starttls';
  user: string;
  password?: string;
  hasPassword?: boolean;
  status?: { ok: boolean; at: number; message: string } | null;
}

export interface Integrations {
  shopify: {
    shop: string;
    client_id: string;
    hasSecret: boolean;
    configured: boolean;
    status: { ok: boolean; at: number; message: string } | null;
    lastSync: number;
    apiVersion: string;
  };
  mailboxes: MailboxConfig[];
  cron: { url: string; lastRun: number; jobsLastRun: number };
  settings: { low_stock_threshold: number; base_url: string };
  pushDevices: number;
  tests?: Record<string, { ok: boolean; message: string }>;
  test?: { ok: boolean; message: string };
  summary?: Record<string, unknown>;
}
