import type { ReactNode } from 'react';
import './AuthExperience.scss';

export type AuthExperienceHighlight = {
  description: string;
  icon: ReactNode;
  title: string;
};

type AuthExperienceProps = {
  brandContext: string;
  brandName: string;
  children: ReactNode;
  description: string;
  eyebrow: string;
  highlights: AuthExperienceHighlight[];
  logoSrc: string;
  panelDescription: string;
  panelEyebrow: string;
  panelFooter: ReactNode;
  panelTitle: string;
  title: ReactNode;
  variant?: 'workspace' | 'admin';
};

export function AuthExperience({
  brandContext,
  brandName,
  children,
  description,
  eyebrow,
  highlights,
  logoSrc,
  panelDescription,
  panelEyebrow,
  panelFooter,
  panelTitle,
  title,
  variant = 'workspace',
}: AuthExperienceProps) {
  return (
    <main className={`auth-experience auth-experience--${variant}`}>
      <div className="auth-experience__orb auth-experience__orb--one" aria-hidden="true" />
      <div className="auth-experience__orb auth-experience__orb--two" aria-hidden="true" />

      <div className="auth-experience__shell">
        <section className="auth-experience__story" aria-labelledby="auth-experience-title">
          <div className="auth-experience__brand">
            <span className="auth-experience__logo-wrap">
              <img src={logoSrc} alt={`${brandName} 标志`} />
            </span>
            <span>
              <strong>{brandName}</strong>
              <small>{brandContext}</small>
            </span>
          </div>

          <div className="auth-experience__copy">
            <span className="auth-experience__eyebrow">{eyebrow}</span>
            <h1 id="auth-experience-title">{title}</h1>
            <p>{description}</p>
          </div>

          <div className="auth-experience__highlights">
            {highlights.map((item) => (
              <article className="auth-experience__highlight" key={item.title}>
                <span className="auth-experience__highlight-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
              </article>
            ))}
          </div>

          <div className="auth-experience__signature" aria-hidden="true">
            <span />
            <span />
            <span />
            <small>AI CREATIVE STUDIO</small>
          </div>
        </section>

        <section className="auth-experience__panel" aria-labelledby="auth-panel-title">
          <div className="auth-experience__panel-accent" aria-hidden="true" />
          <div className="auth-experience__panel-content">
            <header className="auth-experience__panel-header">
              <span>{panelEyebrow}</span>
              <h2 id="auth-panel-title">{panelTitle}</h2>
              <p>{panelDescription}</p>
            </header>

            {children}

            <footer className="auth-experience__panel-footer">{panelFooter}</footer>
          </div>
        </section>
      </div>
    </main>
  );
}
