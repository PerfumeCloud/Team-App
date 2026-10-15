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
  /** Zugang zum Members Club (Admins haben ihn immer) */
  club_access?: number;
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
  /** Members Club verbunden und diese Person darf ihn sehen */
  clubConfigured?: boolean;
  version?: string;
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
  test?: MailCheck;
}

/** Ein Schritt der Verbindungsprüfung, z. B. „Anmeldung als info@…“ */
export interface MailCheckStep {
  label: string;
  ok: boolean;
  detail: string;
  hint: string | null;
}

export interface MailCheck {
  ok: boolean;
  /** Abruf (IMAP) klappt */
  imap: boolean;
  /** Versand (SMTP) klappt – null = nicht geprüft */
  smtp: boolean | null;
  message: string;
  steps: MailCheckStep[];
}

export interface PushDevice {
  id: string;
  device: string;
  created_at: number;
  last_ok_at: number | null;
  last_status: number | null;
  last_error: string | null;
  fail_count: number;
}

export interface PushTestResult {
  devices: number;
  sent: number;
  results: { id: string; device: string; ok: boolean; status: number; reason: string }[];
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
  mail?: {
    lastFetch: number;
    lastError: { at: number; mailbox: string; message: string } | null;
    smtpHost: string;
    /** 0 = automatisch (465, sonst 587) */
    smtpPort: number;
    sender: string | null;
  };
  cron: { url: string; lastRun: number; jobsLastRun: number };
  settings: { low_stock_threshold: number; base_url: string; holiday_state: string; holidays_on: boolean; shop_days_on: boolean };
  pushDevices: number;
  tests?: Record<string, MailCheck>;
  test?: { ok: boolean; message: string };
  summary?: Record<string, unknown>;
}

// ---------------- Members Club ----------------

export interface ClubSettings {
  club: {
    url: string;
    hasKey: boolean;
    /** Aus der gemeinsamen Datenbank erkannt (club_settings) */
    detected: { url: string; hasKey: boolean } | null;
    effectiveUrl: string;
    urlSource: 'manual' | 'auto' | '';
    keySource: 'manual' | 'auto' | '';
    configured: boolean;
    status: { ok: boolean; message: string; at: number } | null;
  };
  test?: { ok: boolean; message: string } | null;
}

export interface ClubStats {
  members: number;
  new_7: number;
  new_30: number;
  active_30: number;
  joins_by_month: { month: string; count: number }[];
  tiers: { key: string; name: string; count: number }[];
  points: {
    earned: number;
    earned_30: number;
    redeemed: number;
    redeemed_30: number;
    expired: number;
    available: number;
    available_value_cents: number;
    pending: number;
    locked: number;
  };
  bonus: Record<string, { count: number; points: number; title: string }> | [];
  codes: Partial<Record<'active' | 'used' | 'expired' | 'cancelled' | 'creating', { count: number; cents: number }>> | [];
  codes_used_30: { count: number; cents: number };
  orders: { count: number; revenue_cents: number };
  orders_30: { count: number; revenue_cents: number };
  push_members: number;
  feedback: { gut: number; neutral: number; schlecht: number };
  promotion: { name: string; factor: number; ends_at: number } | null;
  open_claims: number;
  app_url: string;
  at: number;
}

export type BroadcastStatus = 'draft' | 'review' | 'approved' | 'sending' | 'sent';

export interface Broadcast {
  id: string;
  kind: 'news' | 'feedback';
  template: string | null;
  title: string;
  body: string;
  url: string | null;
  audience: string;
  status: BroadcastStatus;
  status_label: string;
  scheduled_at: number | null;
  created_by: string;
  created_by_name: string;
  approved_by_name: string | null;
  approved_at: number | null;
  sent_at: number | null;
  recipients: number;
  delivered?: number;
  queued?: number;
  answers?: number;
  review_note: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface BroadcastTemplate {
  key: string;
  label: string;
  kind: 'news' | 'feedback';
  title: string;
  body: string;
  url: string;
  audience: string;
  /** Platzhalter, die das Team ausfüllt, z. B. { duft: 'Name des Dufts' } */
  fields: Record<string, string> | [];
}

export interface BroadcastOverview {
  broadcasts: Broadcast[];
  templates: BroadcastTemplate[];
  audiences: { key: string; label: string; count: number }[];
  four_eyes: boolean;
  quiet: { start: number; end: number };
  app_url: string;
  me: { id: string; name: string; email: string };
}
