import { useState, type ReactNode } from "react";
import { displayName } from "../format.ts";
import { href, type Route } from "../router.ts";
import type { Me } from "../types.ts";
import { signOut } from "../passkeys.ts";
import { applyTheme, storedTheme, type Theme } from "../theme.ts";
import { Avatar } from "./Avatar.tsx";
import { Icon, type IconName } from "./Icon.tsx";

type NavItem = { page: Route["page"]; route: Route; icon: IconName; label: string; adminOnly?: boolean };

const NAV: NavItem[] = [
  { page: "overview", route: { page: "overview" }, icon: "home", label: "Overview" },
  { page: "projects", route: { page: "projects" }, icon: "repo", label: "Projects" },
  { page: "team", route: { page: "team" }, icon: "users", label: "Team", adminOnly: true },
  { page: "policies", route: { page: "policies" }, icon: "shield", label: "Policies" },
  { page: "devices", route: { page: "devices" }, icon: "laptop", label: "Devices", adminOnly: true },
];

const THEMES: { value: Theme; icon: IconName; label: string }[] = [
  { value: "system", icon: "monitor", label: "System theme" },
  { value: "light", icon: "sun", label: "Light theme" },
  { value: "dark", icon: "moon", label: "Dark theme" },
];

const SECTION: Partial<Record<Route["page"], Route["page"]>> = { project: "projects", secret: "projects" };

type LayoutProps = { me: Me; route: Route; attention: number; onSignedOut: () => void; children: ReactNode };

export function Layout({ me, route, attention, onSignedOut, children }: LayoutProps) {
  const current = SECTION[route.page] ?? route.page;
  const [theme, setTheme] = useState(storedTheme);
  const choose = (next: Theme) => (setTheme(next), applyTheme(next));

  return (
    <>
      <aside className="side">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="key" />
          </span>
          noenv
        </div>
        {NAV.filter((item) => me.isAdmin || !item.adminOnly).map((item) => (
          <a key={item.page} className="nav-item" href={href(item.route)} aria-current={item.page === current ? "page" : undefined}>
            <Icon name={item.icon} />
            {item.label}
            {item.page === "devices" && attention > 0 && <span className="count">{attention}</span>}
          </a>
        ))}
        <div className="side-foot">
          <div className="theme" role="group" aria-label="Theme">
            {THEMES.map((item) => (
              <button key={item.value} aria-label={item.label} title={item.label} aria-pressed={theme === item.value} onClick={() => choose(item.value)}>
                <Icon name={item.icon} />
              </button>
            ))}
          </div>
          <a className="account-link" href={href({ page: "account" })} title="Account" aria-current={route.page === "account" ? "page" : undefined}>
            <Avatar email={me.email} />
            <div>
              <b>{displayName(me.email)}</b>
              <span>{me.isAdmin ? "Org admin" : "Member"}</span>
            </div>
          </a>
          <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => signOut().then(onSignedOut)}>
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <main>{children}</main>
    </>
  );
}
