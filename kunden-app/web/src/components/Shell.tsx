import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Gift, House, Package, ShoppingBag, User } from 'lucide-react';
import { Duenen, Toaster, zeichen } from './ui';

export function Logo({ to = '/', zusatz }: { to?: string; zusatz?: ReactNode }) {
  return (
    <Link className="kopf-logo" to={to}>
      <img src={zeichen} alt="" width={954} height={995} />
      <b>
        Perfume <em>Cloud</em> {zusatz ?? 'Club'}
      </b>
      {/* Ergänzung nur zum Vorlesen; kein aria-label, damit der Name mit dem sichtbaren Text beginnt */}
      <span className="sr">, zur Übersicht</span>
    </Link>
  );
}

/** Rahmen für eingeloggte Kundinnen und Kunden. Ohne Weg in den Admin-Bereich: der geht über /admin oder die Team-App. */
export function KundenShell({ shopUrl, children, ohneDock }: { shopUrl: string; children: ReactNode; ohneDock?: boolean }) {
  return (
    <>
      <Duenen />
      <header className="kopf">
        <Logo />
        <div className="kopf-rechts">
          <a className="knopf" href={shopUrl} target="_blank" rel="noopener" aria-label="Shop" title="Shop">
            <ShoppingBag /> Shop
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
