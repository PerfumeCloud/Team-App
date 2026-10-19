export type ID = string;
export type UserColor = 'blue' | 'sage' | 'rose' | 'amber' | 'plum' | 'slate';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type Priority = 'low' | 'normal' | 'high';
export type NoteColor = 'none' | 'cream' | 'blue' | 'sage' | 'rose' | 'sand';
export type PushKind = 'mail' | 'orders' | 'tasks' | 'comments' | 'reminders' | 'events' | 'shipping' | 'weekly' | 'feedback' | 'instagram';
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
  /** Zugang zu Instagram: Auswertung, Planer, Kommentare (Admins haben ihn immer) */
  instagram_access?: number;
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
  /** Instagram: null = kein Zugang (oder noch nicht verbunden und kein Admin) */
  instagram?: { connected: boolean; username: string | null } | null;
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
  /** Eigene Reihenfolge der Postfächer (Adressen) – ab 1.9 */
  mailboxOrder?: string[];
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
    /** Letzte Prüfung der Berechtigungen („Speichern & testen“ / „Erneut prüfen“) */
    check?: ShopifyCheck | null;
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
  instagram: InstagramSettings;
  tests?: Record<string, MailCheck>;
  test?: ShopifyCheck;
  summary?: Record<string, unknown>;
}

export interface ShopifyCheck {
  ok: boolean;
  message: string;
  at?: number;
  missing?: string[];
  /** In der App-Version angefragt, im Shop aber noch nicht bestätigt */
  unapproved?: string[];
  approve_url?: string;
  open_url?: string;
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
  /** Bild unter der eigenen Signatur bzw. unter der Team-Fußzeile (data:-URL) */
  signature_image?: string | null;
  footer_image?: string | null;
}

export interface SignatureImage {
  image: string | null;
  /** angezeigte Breite in der Mail (Pixel) */
  width: number;
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
  footerImage?: SignatureImage;
  /** KI-Entwürfe eingerichtet (Admin hat einen API-Schlüssel hinterlegt) */
  ai?: boolean;
}

export interface AiSettings {
  configured: boolean;
  model: string;
  models: Record<string, string>;
  month: { month: string; drafts: number; input: number; output: number };
  last: { ok: boolean; at: number; model?: string; message?: string } | null;
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
  /** Kopie in einen S3-kompatiblen Speicher (Cloudflare R2, Hetzner, AWS); das Geheimnis kommt nie zurück */
  s3: BackupS3;
}

export interface BackupS3 {
  on: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  access_key: string;
  hasSecret: boolean;
  last: { ok: boolean; message: string; at: number; name?: string; size?: number } | null;
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

// ---------------- Instagram ----------------

export interface InstagramSettings {
  app_id: string;
  hasSecret: boolean;
  /** Muss im Meta App Dashboard als Weiterleitungs-URI eingetragen sein */
  redirectUri: string;
  connected: boolean;
  username: string | null;
  expires: number | null;
  connectedAt: number | null;
  status: { ok: boolean; at: number; message: string } | null;
  lastSync: number;
  four_eyes: boolean;
  hashtags: string;
  scopes: string[];
  /** null = unbekannt (Zugang direkt eingefügt) */
  missingScopes: string[] | null;
}

export type IgFormat = 'reel' | 'carousel' | 'image' | 'video' | 'story';

export interface IgMedia {
  id: string;
  format: IgFormat;
  caption: string;
  permalink: string | null;
  thumb: string | null;
  posted_at: number;
  likes: number;
  comments: number;
  saved: number | null;
  shares: number | null;
  reach: number | null;
  views: number | null;
  interactions: number;
  avg_watch_s: number | null;
  /** Interaktionen je erreichtem Konto in % */
  rate: number | null;
}

export interface IgGroup {
  count: number;
  avg: number | null;
  avg_interactions: number | null;
  avg_rate: number | null;
}

export type IgTotals = Partial<Record<'reach' | 'views' | 'accounts_engaged' | 'total_interactions' | 'profile_links_taps' | 'likes' | 'comments' | 'saves' | 'shares', number>>;

export interface IgOverview {
  connected: boolean;
  admin: boolean;
  profile: { username: string; name: string; account_type: string; picture: string; followers: number | null; follows: number | null; media_count: number | null; at: number } | null;
  status: { ok: boolean; at: number; message: string } | null;
  lastSync: number;
  kpis: {
    followers: number | null;
    followers_7: number | null;
    followers_30: number | null;
    cur: IgTotals;
    prev: IgTotals;
    posts_30: number;
    rate_30: number | null;
    unanswered: number;
  };
  followers_series: { day: string; value: number }[];
  reach_series: { day: string; value: number }[];
  media: IgMedia[];
  analysis: {
    metric: 'reach' | 'interactions';
    posts: number;
    overall: number | null;
    formats: Partial<Record<IgFormat, IgGroup>>;
    weekdays: Record<string, IgGroup>;
    slots: Partial<Record<'morgen' | 'mittag' | 'nachmittag' | 'abend' | 'nacht', IgGroup>>;
    hashtags: { avg_count: number | null; top: { tag: string; count: number; avg: number | null }[] };
    captions: { length: Record<string, IgGroup>; question: Record<string, IgGroup> };
    rhythm: { per_week: number; days_since: number | null };
    top: string[];
    tips: { kind: string; text: string }[];
  };
  audience: { at: number; age?: { label: string; value: number }[]; gender?: { label: string; value: number }[]; city?: { label: string; value: number }[]; country?: { label: string; value: number }[] } | null;
  planned: IgPost[];
  message?: string;
}

export type IgPostKind = 'image' | 'carousel' | 'story' | 'reel';
export type IgPostStatus = 'draft' | 'review' | 'approved' | 'publishing' | 'published' | 'failed';

export interface IgPost {
  id: string;
  kind: IgPostKind;
  /** auto = die App veröffentlicht, manual = Erinnerung, ihr postet selbst */
  mode: 'auto' | 'manual';
  caption: string;
  note: string | null;
  images: { token: string; url: string; w: number; h: number }[];
  scheduled_at: number | null;
  status: IgPostStatus;
  status_label: string;
  review_note: string | null;
  error: string | null;
  created_by: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  published_at: number | null;
  permalink: string | null;
  source: 'team' | 'import' | null;
  metrics: { reach: number | null; likes: number; comments: number; saved: number | null; shares: number | null; interactions: number | null } | null;
  updated_at: number;
}

export interface IgPostList {
  posts: IgPost[];
  me: { id: string };
  four_eyes: boolean;
  hashtags: string;
  connected: boolean;
  username: string;
  shopify: boolean;
  created?: number;
  notes?: string[];
}

export interface IgProduct {
  id: string;
  title: string;
  handle: string;
  url: string;
  description: string;
  price: number | null;
  images: { url: string; w: number; h: number }[];
}

export interface IgComment {
  id: string;
  username: string;
  text: string;
  at: number;
  likes: number;
  open: boolean;
  replied: boolean;
  replied_by: string | null;
  post: { caption: string; permalink: string | null; thumb: string | null };
}

export interface IgComments {
  comments: IgComment[];
  unanswered: number;
  username: string;
}
