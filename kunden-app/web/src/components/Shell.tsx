import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Gift, House, LayoutDashboard, Package, ShoppingBag, User } from 'lucide-react';
import { Duenen, Toaster, zeichen } from './ui';

export function Logo({ to = '/', zusatz }: { to?: string; zusatz?: ReactNode }) {
  return (
    <Link className="kopf-logo" to={to} aria-label="Perfume Cloud Club, zur Übersicht">
      <img src={zeichen} alt="" />
      <b>
        Perfume <em>Cloud</em> {zusatz ?? 'Club'}
      </b>
    </Link>
  );
}

/** Rahmen für eingeloggte Kundinnen und Kunden: Kopf, Dock, Dünen */
export function KundenShell({ shopUrl, children, ohneDock, admin }: { shopUrl: string; children: ReactNode; ohneDock?: boolean; admin?: boolean }) {
  return (
    <>
      <Duenen />
      <header className="kopf">
        <Logo />
        <div className="kopf-rechts">
          {admin && (
            <Link className="knopf kopf-text" to="/admin" title="Zum Admin-Bereich" aria-label="Zum Admin-Bereich">
              <LayoutDashboard /> <span>Admin</span>
            </Link>
          )}
          {/* Mit Admin-Knopf auf dem Handy nur Symbole, damit der Kopf in eine Zeile passt */}
          <a className={admin ? 'knopf kopf-text' : 'knopf'} href={shopUrl} target="_blank" rel="noopener" aria-label="Shop" title="Shop">
            <ShoppingBag /> {admin ? <span>Shop</span> : 'Shop'}
          </a>
        </div>
      </header>
      {!ohneDock && (
        <div className="dock-rand rand glas">
          <nav className="dock" aria-label="Hauptmenü">
            <NavLink to="/" end>
              <House /> Übersicht
            </NavLink>
            <NavLink to="/bestellungen">
              <Package /> Bestellungen
            </NavLink>
            <NavLink to="/praemien">
              <Gift /> Prämien
            </NavLink>
            <NavLink to="/konto">
              <User /> Konto
            </NavLink>
          </nav>
        </div>
      )}
      <main className="app" style={ohneDock ? { paddingBottom: '3rem' } : undefined}>
        <div className="app-innen">{children}</div>
      </main>
      <Toaster />
    </>
  );
}
