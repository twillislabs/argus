import type { ReactNode } from 'react';

import Brand from './Brand';

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <header className="cmdbar">
        <Brand />
      </header>
      <main className="auth">
        <section className="auth-art" aria-hidden="true">
          <div className="auth-globe" />
          <div className="claim">
            <b>ARGUS</b>
            <span>Self-hosted situational awareness. Your data stays on your server.</span>
          </div>
        </section>
        <section className="auth-form">{children}</section>
      </main>
    </div>
  );
}
