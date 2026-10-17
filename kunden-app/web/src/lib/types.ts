export interface Tier {
  key: string;
  name: string;
  min_cents: number;
  rate: number;
  benefits: string[];
}

export interface Promo {
  id: string;
  name: string;
  factor: number;
  starts_at: number;
  ends_at: number;
}

export interface StartBonus {
  points: number;
  until: number | null;
  requires_order: boolean;
  min_cents: number;
  days: number;
}

export interface Program {
  name: string;
  active: boolean;
  earn_per_euro: number;
  redeem_points: number;
  redeem_cents: number;
  max_cents: number;
  code_days: number;
  code_expiry_refund: boolean;
  wait_days: number;
  welcome_points: number;
  retro_days: number;
  points_expiry_months: number;
  tiers_enabled: boolean;
  tier_months: number;
  tiers: Tier[];
  bonus: {
    birthday: number;
    newsletter: number;
    review: number;
    referrer: number;
    referred: number;
    referral_min_cents: number;
  };
  start_bonus: StartBonus | null;
  promo: Promo | null;
  next_promo: Promo | null;
}

export interface Status {
  installed: boolean;
  version: string;
  requirements?: Record<string, { ok: boolean; label: string }>;
  configExists?: boolean;
  program?: Program;
  login?: { shopify: boolean; email: boolean };
  shop_url?: string;
  terms_url?: string | null;
  team_detected?: boolean;
}

export interface Member {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  joined_at: number | null;
}

export interface Step {
  steps: number;
  points: number;
  cents: number;
  affordable: boolean;
}

export interface Points {
  balance: number;
  pending: number;
  locked: number;
  value_cents: number;
  to_next: number;
  next_cents: number;
  steps: Step[];
  lifetime: number;
  expiring: { points: number; at: number } | null;
}

export interface Code {
  id: string;
  code: string;
  points: number;
  value_cents: number;
  min_cents: number;
  status: 'creating' | 'active' | 'used' | 'expired' | 'cancelled';
  created_at: number;
  expires_at: number;
  used_at: number | null;
  order_name: string | null;
  url: string;
}

export interface TierInfo {
  key: string;
  name: string;
  rate: number;
  benefits: string[];
  until: number | null;
  spend_cents: number;
  months: number;
  next: { key: string; name: string; rate: number; min_cents: number; missing_cents: number } | null;
  keep_cents: number;
}

export type PushCategory = 'orders' | 'points' | 'news';

export interface PushState {
  devices: number;
  prefs: Record<PushCategory, boolean>;
  categories: Record<PushCategory, string>;
}

export interface Claim {
  id: string;
  kind: string;
  note: string | null;
  status: 'open' | 'approved' | 'rejected';
  points: number | null;
  created_at: number;
}

export interface BonusStatus {
  birthday: string | null;
  birthday_bonus_this_year: boolean;
  newsletter: boolean;
  referral: { code: string | null; invited: number; rewarded: number; link?: ReferralLink | null };
  claims: Claim[];
}

/** Empfehlungslink mit Rabatt für Freunde (Punkte je Bestellung über den Link) */
export interface ReferralLink {
  link: string;
  code: string;
  friend_text: string;
  reward_text: string;
  new_customers_only: boolean;
  max_year: number;
  clicks: number;
  orders: number;
  pending_points: number;
  earned_points: number;
}

/** Befragung nach der Lieferung – Stand im Konto */
export interface SurveyState {
  enabled: boolean;
  mail: boolean;
  mail_available: boolean;
  open: { token: string; order_name: string; title: string | null; image: string | null; count: number; points: number } | null;
}

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'stars' | 'choice' | 'text';
  options: string[];
}

export interface SurveyThanks {
  points: number;
  low: boolean;
  review: { url: string; label: string } | null;
  referral: { link: string; friend_text: string; reward_text: string } | null;
  join: { url: string; program: string; welcome_points: number } | null;
}

/** Öffentliche Bewertungsseite /bewertung/:token */
export interface SurveyView {
  state: 'open' | 'answered' | 'expired';
  first_name: string | null;
  order_name: string;
  items: { key: string; title: string; variant: string | null; image: string | null }[];
  ratings: Record<string, number>;
  answers: Record<string, string | number>;
  comment: string | null;
  questions: SurveyQuestion[];
  comment_enabled: boolean;
  member: boolean;
  points: number;
  privacy_url: string;
  imprint_url: string;
  shop_url: string;
  test: boolean;
  thanks: SurveyThanks | null;
}

export interface Me {
  member: Member;
  program: Program;
  shop_url: string;
  account_url: string;
  /** Admin sieht die App als dieses Mitglied (nur ansehen) */
  preview: boolean;
  admin: boolean;
  points?: Points;
  codes?: Code[];
  tier?: TierInfo | null;
  push?: PushState;
  feedback?: { id: string; title: string; body: string } | null;
  bonus?: BonusStatus;
  survey?: SurveyState;
}

export type Tone = 'good' | 'progress' | 'wait' | 'bad' | 'muted';

export interface OrderPoints {
  points: number;
  status: 'pending' | 'available' | 'void';
  reason: string | null;
  available_at: number | null;
  factor?: number;
}

export interface Order {
  id: string;
  gid: string;
  name: string;
  date: number | null;
  total_cents: number;
  currency: string;
  status: { key: string; label: string; tone: Tone };
  cancelled: boolean;
  steps: { key: string; label: string; done: boolean; at: number | null }[];
  eta: number | null;
  tracking: { company: string | null; number: string | null; url: string | null }[];
  items: { title: string; variant: string | null; quantity: number; image: string | null }[];
  item_count: number;
  status_url: string | null;
  points: OrderPoints | null;
}

export interface OrdersResponse {
  orders: Order[];
  fetched_at: number;
  error?: string;
}

export type HistoryKind =
  | 'order'
  | 'welcome'
  | 'redeem'
  | 'refund'
  | 'adjust'
  | 'bonus'
  | 'birthday'
  | 'newsletter'
  | 'review'
  | 'referral'
  | 'referred'
  | 'start'
  | 'survey'
  | 'expire';

export interface HistoryItem {
  id: string;
  kind: HistoryKind;
  title: string;
  points: number;
  status: 'pending' | 'available' | 'void';
  reason?: string | null;
  note?: string | null;
  available_at?: number | null;
  amount_cents?: number;
  factor?: number;
  rate?: number | null;
  min_cents?: number | null;
  at: number;
}

export interface PointsResponse {
  points: Points;
  history: HistoryItem[];
  codes: Code[];
  program: Program;
  tier: TierInfo | null;
}

/* ---------- Admin ---------- */

export interface Admin {
  id: string;
  name: string;
  email: string;
  source?: 'club' | 'team';
  manage?: boolean;
}

/** Anmeldeseite des Admin-Bereichs: Warum wird die Adresse des angemeldeten Mitglieds (nicht) erkannt? */
export interface AdminWhy {
  member: { email: string; recognized: boolean; via: string | null; name: string | null; reasons: string[] } | null;
}

export interface AdminMe {
  admin: Admin;
  own_member_id: string | null;
  team_url: string | null;
  open_claims: number;
}

export interface Check {
  ok: boolean;
  message: string;
}

export type CodeStatus = 'active' | 'used' | 'expired' | 'cancelled' | 'creating';

export interface Stats {
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
  bonus: Record<string, { count: number; points: number; title: string }>;
  codes: Partial<Record<CodeStatus, { count: number; cents: number }>>;
  codes_used_30: { count: number; cents: number };
  orders: { count: number; revenue_cents: number };
  orders_30: { count: number; revenue_cents: number };
  push_members: number;
  feedback: { gut: number; neutral: number; schlecht: number };
  at: number;
}

export interface PushStats {
  devices: number;
  members: number;
  week: Partial<Record<'queued' | 'sending' | 'sent' | 'failed' | 'no_device', number>>;
  errors: { device: string; status: number | null; error: string | null; fails: number }[];
  quiet: { start: number; end: number };
}

export interface Dashboard extends Stats {
  promotion: Promo | null;
  next_promotion: Promo | null;
  open_claims: number;
  push: PushStats;
  shop_program: { ok: boolean; at: number; message?: string } | null;
  jobs: { ok: boolean; at: number; trigger: string; summary: Record<string, unknown>; errors: string[] } | null;
  cron_last_run: number | null;
  checklist: { key: string; label: string; ok: boolean }[];
}

export interface AdminMember {
  id: string;
  email: string;
  name: string;
  joined_at: number;
  last_seen_at: number | null;
  balance: number;
  pending: number;
  tier: string;
  tier_name: string;
  shopify_url: string | null;
}

export interface AdminMemberDetail {
  member: AdminMember & {
    birthday: string | null;
    ref_code: string | null;
    waitlist: boolean;
    newsletter: boolean;
    tier_until: number | null;
    tier_spend_cents: number;
    referred_by: { id: string; name: string } | null;
    invited: number;
    devices: number;
    expiring: { points: number; at: number } | null;
  };
  history: HistoryItem[];
  codes: Code[];
  claims: Claim[];
  pushes: { title: string; body: string; status: string; error: string | null; at: number }[];
  tiers: { key: string; name: string }[];
}

export interface AdminPromo extends Promo {
  push: boolean;
  push_title: string | null;
  push_body: string | null;
  pushed_at: number | null;
  state: 'planned' | 'running' | 'done';
  orders: number;
  points: number;
  revenue_cents: number;
}

export interface OpenClaim {
  id: string;
  kind: string;
  note: string | null;
  status: string;
  created_at: number;
  member: { id: string; name: string; email: string };
}

export interface FeedbackItem {
  id: string;
  rating: 'gut' | 'neutral' | 'schlecht';
  text: string | null;
  name: string | null;
  email: string | null;
  broadcast: string | null;
  mailed: boolean;
  created_at: number;
}

export interface PushTemplate {
  key: string;
  label: string;
  cat: PushCategory;
  title: string;
  body: string;
  enabled: boolean;
  default_title: string;
  default_body: string;
  vars: string[];
}

export interface PushAdmin {
  templates: PushTemplate[];
  stats: PushStats;
  categories: Record<PushCategory, string>;
  own_devices?: number;
}

export interface InvitesOverview {
  counts: Record<'new' | 'queued' | 'sent' | 'failed' | 'joined', number>;
  total: number;
  loaded_at: number | null;
  tag: string;
  start_bonus: StartBonus | null;
  mail_ready: boolean;
  template: { subject: string; text: string };
  subject: string;
  recent: { email: string; first_name: string | null; status: string; error: string | null; sent_at: number | null }[];
  found?: number;
  added?: number;
}

export interface AccessOverview {
  team_mode: boolean;
  team: { id: string; name: string; email: string; source: 'team'; role: string; access: boolean }[];
  club: { id: string; name: string; email: string; source: 'club'; access: boolean; role: string; last_login_at: number | null }[];
  /** Admin-E-Mails: Anmeldung in der Club-App mit dieser Adresse → Admin-Bereich (mit den Rechten der Person, falls verknüpft) */
  emails: { email: string; admin_id: string | null; person: string | null; valid: boolean; by: string; at: number }[];
  team_url: string | null;
}

export interface DatabaseStatus {
  mode: 'team' | 'sqlite' | 'mysql';
  team_config: string | null;
  team_users: boolean;
  previous: string | null;
}

export interface FullProgram extends Omit<Program, 'bonus' | 'start_bonus' | 'promo' | 'next_promo'> {
  max_open_codes: number;
  expiry_warn_days: number;
  bonus_birthday: number;
  bonus_newsletter: number;
  bonus_review: number;
  review_max_month: number;
  bonus_referrer: number;
  bonus_referred: number;
  referral_min_cents: number;
  referral_max_year: number;
  start_bonus: number;
  start_bonus_until: string;
  start_bonus_requires_order: boolean;
  start_bonus_min_cents: number;
  start_bonus_days: number;
  waitlist_tag: string;
  count_test: boolean;
  bind_customer: boolean;
  combine_shipping: boolean;
  combine_order: boolean;
  combine_product: boolean;
}

export interface Settings {
  program: FullProgram;
  shopify: { shop: string; client_id: string; has_secret: boolean; test: Check | null };
  login_shopify: { client_id: string; has_secret: boolean; redirect_uri: string; logout_uri: string; origin: string; test: Check | null };
  login_email: boolean;
  admin_by_email: boolean;
  smtp: { host: string; port: number; user: string; from_email: string; from_name: string; has_password: boolean };
  welcome_mail: boolean;
  feedback_email: string;
  push_contact: string;
  broadcast_four_eyes: boolean;
  account_url: string;
  terms_url: string;
  base_url: string;
  cron_url: string;
  cron_cli: string;
  internal_key: string;
  database: DatabaseStatus;
  shop_program: { ok: boolean; at: number; message?: string } | null;
  version: string;
}
