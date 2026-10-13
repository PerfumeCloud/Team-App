import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Gift, House, Package, ShoppingBag, User } from 'lucide-react';
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
export function KundenShell({ shopUrl, children, ohneDock }: { shopUrl: string; children: ReactNode; ohneDock?: boolean }) {
  return (
    <>
      <Duenen />
      <header className="kopf">
        <Logo />
        <div className="kopf-rechts">
          <a className="knopf" href={shopUrl}>
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
