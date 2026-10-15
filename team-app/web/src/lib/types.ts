export type ID = string;
export type UserColor = 'blue' | 'sage' | 'rose' | 'amber' | 'plum' | 'slate';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'normal' | 'high';
export type NoteColor = 'none' | 'cream' | 'blue' | 'sage' | 'rose' | 'sand';
export type PushKind = 'mail' | 'orders' | 'tasks' | 'comments' | 'reminders' | 'events' | 'shipping' | 'weekly' | 'feedback';
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
  /** Zeitpunkt der Antwort (aus „Gesendet“ oder aus der App) */
  answered_at?: number | null;
  /** Wer aus der App geantwortet hat */
  replied_by?: ID | null;
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
  /** Signatur unter Antworten aus der App (null = „Viele Grüße / Vorname“) */
  signature?: string | null;
  /** Wochenrückblick zusätzlich per Mail an die eigene Adresse */
  weeklyMail?: boolean;
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
  cron: { url: string; lastRun: number; jobsLastRun: number; script: string; live: LiveStatus };
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

/** Sofort-Abruf (IMAP IDLE): Zustand für die Einstellungen */
export interface LiveStatus {
  active: boolean;
  mode: 'cli' | 'url' | null;
  started: number;
  beat: number;
  boxes: Record<string, { state: 'idle' | 'poll' | 'connecting' | 'error'; message: string | null }>;
  lastMail: { at: number; delay: number } | null;
}

// ---------------- 1.5: Kundeninfos, Antworten, Versand, Auswertungen ----------------

export interface Tracking {
  company: string | null;
  number: string | null;
  url: string | null;
}

export interface CustomerOrder {
  id: string;
  name: string;
  created_at: number;
  total_cents: number;
  cancelled: boolean;
  test: boolean;
  financial: string;
  financial_label: string;
  fulfillment: string;
  status_label: string;
  delivery: string | null;
  shipped_at: number | null;
  delivered_at: number | null;
  items: { title: string; variant: string | null; qty: number }[];
  tracking: Tracking[];
  codes: string[];
  city: string | null;
  first_name: string | null;
  admin_url: string;
  /** Bestellt von einer anderen E-Mail-Adresse */
  other?: boolean;
}

export interface ClubInfo {
  error?: string;
  member?: boolean;
  joined_at?: number | null;
  tier?: { key: string; name: string } | null;
  points?: { available: number; pending: number; value_cents?: number } | null;
  codes?: { code: string; value_cents: number; status: string; expires_at: number }[];
  ratings?: { avg: number | null; count: number; last: { stars: number; product: string | null; comment: string | null; created_at: number } | null };
  referrals?: { count: number; orders: number } | null;
  ref_link?: string | null;
  admin_url?: string | null;
}

export interface CustomerNote {
  id: string;
  body: string;
  created_by: ID | null;
  created_at: number;
}

export interface CustomerInfo {
  email: string;
  order: string | null;
  shopify: { configured: boolean; missing: string[]; error: string | null };
  customer: {
    id: string;
    name: string;
    first_name: string;
    since: number;
    orders: number;
    spent_cents: number;
    tags: string[];
    note: string | null;
    newsletter: boolean;
    city: string | null;
    country: string | null;
    admin_url: string;
  } | null;
  orders: CustomerOrder[];
  mentioned: CustomerOrder | null;
  club: ClubInfo | null;
  notes: CustomerNote[];
}

export interface MailMessage {
  id: string;
  text: string;
  attachments: { name: string; size: number }[];
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  reply_to: string;
  date: number | null;
  order_number: string | null;
  replies: { id: string; to: string; subject: string; user_id: ID | null; created_at: number }[];
  signature: string;
  footer: string;
}

export interface ReplyTemplate {
  id: ID;
  title: string;
  body: string;
  position: number;
  updated_at: number;
}

export interface TemplatesResponse {
  templates: ReplyTemplate[];
  placeholders: Record<string, string>;
  footer: string;
  fromName: string;
}

export interface ReplyResult {
  from: string;
  to: string;
  subject: string;
  text: string;
  missing: string[];
  sent?: boolean;
  message?: string;
  warnings?: string[];
  email?: Email;
}

export interface ShipOrder {
  id: string;
  name: string;
  created_at: number;
  age_days: number;
  total_cents: number;
  financial: string;
  financial_label: string;
  paid: boolean;
  partial: boolean;
  customer: { name: string | null; city: string; country: string | null } | null;
  method: string | null;
  note: string | null;
  location: string | null;
  items: { title: string; variant: string | null; qty: number }[];
  can_ship: boolean;
  test: boolean;
  admin_url: string;
}

export interface ShippingSettings {
  remind_days: number;
  default_carrier: string;
  notify: boolean;
}

export interface ShippingList {
  configured: boolean;
  missing: string[];
  error: string | null;
  orders: ShipOrder[];
  settings: ShippingSettings;
  carriers: string[];
  recent: { order_id: string; name: string; carrier: string | null; tracking: string | null; url: string | null; user_id: ID | null; created_at: number }[];
}

export interface ShipResult {
  order: string;
  carrier: string;
  number: string;
  url: string | null;
  notify: boolean;
  items: string[];
  missing: string[];
  test?: boolean;
  sent?: boolean;
  message: string;
}

export interface WeeklyConfig {
  on: boolean;
  day: number;
  hour: number;
  mail: boolean;
  push: boolean;
}

export interface WeeklyMailStats {
  received: number;
  answered: number;
  measured: number;
  avg_hours: number | null;
  median_hours: number | null;
  within_24h: number | null;
}

export interface WeeklyReport {
  data: {
    from: number;
    to: number;
    shop: {
      current: { revenue: number; orders: number; items: number; aov: number };
      previous: { revenue: number; orders: number; items: number; aov: number };
      top: { title: string; qty: number; revenue: number }[];
      shipped: number;
      to_ship: number;
      oldest_days: number | null;
      configured: boolean;
    };
    mail: { configured: false } | { configured: true; current: WeeklyMailStats; previous: WeeklyMailStats; open_24h: number; replies_in_app: Record<string, number> };
    tasks: { done: number; created: number; overdue: { title: string; due: string; assignee: ID | null }[] };
    club: Record<string, unknown> | null;
  };
  subject: string;
  html: string;
  config: WeeklyConfig;
}

export interface BackupFile {
  name: string;
  size: number;
  at: number;
  weekly: boolean;
}

export interface BackupStatus {
  hasPassword: boolean;
  last: { ok: boolean; at: number; name?: string; size?: number; rows?: number; kind?: string; message?: string } | null;
  lastMail: { ok: boolean; at: number; to: string; message: string } | null;
  files: BackupFile[];
  email: string;
}

export interface BackupSummary {
  name?: string;
  token?: string;
  created_at: number;
  app: string;
  tables: { name: string; rows: number }[];
}

export interface ReportsAdmin {
  reports: { email: string; weekly: WeeklyConfig; lastWeekly: { at: number; message: string } | null; days: string[] };
  backup: BackupStatus;
  shipping: ShippingSettings;
}
