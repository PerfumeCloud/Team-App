export interface Program {
  name: string;
  active: boolean;
  earn_per_euro: number;
  redeem_points: number;
  redeem_cents: number;
  max_cents: number;
  code_days: number;
  wait_days: number;
  welcome_points: number;
  retro_days: number;
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
  value_cents: number;
  to_next: number;
  next_cents: number;
  steps: Step[];
  lifetime: number;
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

export interface Me {
  member: Member;
  program: Program;
  shop_url: string;
  account_url: string;
  points?: Points;
  codes?: Code[];
}

export type Tone = 'good' | 'progress' | 'wait' | 'bad' | 'muted';

export interface OrderPoints {
  points: number;
  status: 'pending' | 'available' | 'void';
  reason: string | null;
  available_at: number | null;
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

export interface HistoryItem {
  id: string;
  kind: 'order' | 'welcome' | 'redeem' | 'refund' | 'adjust';
  title: string;
  points: number;
  status: 'pending' | 'available' | 'void';
  reason?: string | null;
  note?: string | null;
  available_at?: number | null;
  amount_cents?: number;
  at: number;
}

export interface PointsResponse {
  points: Points;
  history: HistoryItem[];
  codes: Code[];
  program: Program;
}

export interface Admin {
  id: string;
  name: string;
  email: string;
}

export interface Check {
  ok: boolean;
  message: string;
}

export interface Dashboard {
  members: number;
  new_30: number;
  points_available: number;
  points_value_cents: number;
  points_pending: number;
  codes: Partial<Record<'active' | 'used' | 'expired' | 'cancelled', { count: number; cents: number }>>;
  club_orders: number;
  club_revenue_cents: number;
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
  shopify_url: string | null;
}

export interface FullProgram extends Program {
  max_open_codes: number;
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
  smtp: { host: string; port: number; user: string; from_email: string; from_name: string; has_password: boolean };
  account_url: string;
  terms_url: string;
  base_url: string;
  cron_url: string;
  cron_cli: string;
  version: string;
}
