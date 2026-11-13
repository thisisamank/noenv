import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

export function AuthScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-screen">
      <div className="auth-main">
        <div className="auth-card">
          <span className="brand-mark">
            <Icon name="key" />
          </span>
          <h1>{title}</h1>
          {children}
        </div>
      </div>
      <aside className="auth-art">
        <div className="term">
          <div className="term-lines">
            <span>
              <span className="faint">~/code/api ❯</span> cd api
            </span>
            <span className="muted">noenv: loaded 12 secrets for github.com/acme/api (development)</span>
          </div>
          <div className="term-rows">
            {(["development", "staging", "production"] as const).map((name) => (
              <div key={name} className="term-row">
                <span className={`env ${name === "development" ? "dev" : name === "staging" ? "staging" : "prod"}`}>{name}</span>
                <span className="masked">••••••••</span>
              </div>
            ))}
          </div>
        </div>
        <p>Values are encrypted on your machine. This dashboard can write secrets but never read them.</p>
      </aside>
    </div>
  );
}
