export type ID = string;
export type UserColor = 'blue' | 'sage' | 'rose' | 'amber' | 'plum' | 'slate';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'normal' | 'high';
export type NoteColor = 'none' | 'cream' | 'blue' | 'sage' | 'rose' | 'sand';
export type PushKind = 'mail' | 'orders' | 'tasks' | 'comments' | 'reminders' | 'events';
export type EventKind = 'termin' | 'meeting' | 'event' | 'frist';

/** Termin im Team-Kalender. Datum/Uhrzeit in Ortszeit; start_time null = ganztägig. */
export interface CalEvent {
  id: ID;
  title: string;
  kind: EventKind;
  start_date: string;
  start_time: string | null;
  end_date: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  /** Teilnehmer; leer = ganzes Team */
  attendees: ID[];
  /** Erinnerung so viele Minuten vorher (ganztägig: Tage × 1440, um 8 Uhr); null = keine */
  remind_minutes: number | null;
  created_by: ID | null;
  updated_by: ID | null;
  created_at: number;
  updated_at: number;
  deleted: number;
}

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
  /** „Sichtbar für“ des Postfachs: leer = alle im Team, sonst nur diese Personen. */
  visible_to?: ID[];
  /** Newsletter oder automatische Mail */
  auto?: number;
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
  /** Eigenes persönliches Postfach (z. B. marius.heub@…) oder null. */
  myMailbox?: string | null;
  /** Ändert sich bei „Datenbank aktualisieren“ → Gerät lädt komplett neu */
  syncEpoch?: number;
  /** Bundesland für Feiertage (z. B. „NW“), leer = nur bundesweite */
  holidayState?: string;
  /** Gesetzliche Feiertage im Kalender zeigen */
  holidaysOn?: boolean;
  /** Aktionstage wie Black Friday im Kalender zeigen */
  shopDays?: boolean;
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
  events?: CalEvent[];
  emails: Email[];
  activity: ActivityItem[];
  meta: Meta;
}

export interface Prefs {
  push: Record<PushKind, boolean>;
  /** Push für Mails: jede neue, wirklich alle (auch Newsletter) oder nur wichtige. */
  mailScope?: 'all' | 'everything' | 'important';
}

export interface MyMailbox {
  mailbox: {
    email: string;
    host: string;
    port: number;
    security: 'ssl' | 'starttls';
    user: string;
    hasPassword: boolean;
    status: { ok: boolean; at: number; message: string } | null;
  } | null;
  suggestedHost: string;
  lastFetch: number;
  test?: { ok: boolean; message: string };
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
  /** Gestern bis zur gleichen Uhrzeit (fehlt bei älteren Server-Versionen). */
  yesterdaySameTime?: { revenue: number; orders: number };
  current: { revenue: number; orders: number; items: number; aov: number; cancelled?: number; refunded?: number };
  previous: { revenue: number; orders: number; items: number; aov: number; cancelled?: number; refunded?: number };
  series: { date: string; revenue: number; orders: number }[];
  topProducts: { title: string; qty: number; revenue: number; prevRevenue?: number }[];
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
  /** Sichtbar für: leer = alle, sonst nur diese Personen */
  visible_to: string[];
  added_by?: string | null;
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
  settings: { low_stock_threshold: number; base_url: string; holiday_state: string; holidays_on: boolean; shop_days_on: boolean };
  pushDevices: number;
  tests?: Record<string, { ok: boolean; message: string }>;
  test?: { ok: boolean; message: string };
  summary?: Record<string, unknown>;
}
