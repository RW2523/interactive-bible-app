/**
 * Small shared building blocks for the Explore workspace (styled by styles.css, theme-aware).
 */
import React, { useEffect, useId, useRef } from 'react';
import { Loader2, X } from 'lucide-react';

/**
 * Accessible modal dialog rendered inside .bjm-root (so it inherits the Explore theme).
 * Closes on Escape and on backdrop click unless `busy`.
 */
export function Modal({ open, onClose, title, description, icon, children, footer, size = 'md', busy = false, className = '', labelledBy }) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef(null);
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape' && !latest.current.busy) {
        e.stopPropagation();
        latest.current.onClose?.();
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    const t = window.setTimeout(() => {
      const target = panelRef.current?.querySelector('[data-autofocus]') || panelRef.current;
      target?.focus?.();
    }, 30);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(t);
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="x-modal" role="presentation">
      <button type="button" className="x-modal__backdrop" aria-label="Close" tabIndex={-1} onClick={() => !busy && onClose?.()} />
      <div
        ref={panelRef}
        className={`x-modal__panel x-modal__panel--${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        {(title || icon) && (
          <header className="x-modal__head">
            {icon ? <span className="x-modal__icon" aria-hidden>{icon}</span> : null}
            <div className="x-modal__titles">
              {title ? <h2 id={titleId}>{title}</h2> : null}
              {description ? <p id={descId}>{description}</p> : null}
            </div>
            <button type="button" className="icon-button icon-button--ghost x-modal__close" aria-label="Close" onClick={() => !busy && onClose?.()} disabled={busy}>
              <X size={18} />
            </button>
          </header>
        )}
        <div className="x-modal__body">{children}</div>
        {footer ? <footer className="x-modal__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/** Yes / No confirmation for actions that cost money or replace saved content. */
export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'default', busy = false, onConfirm, onCancel, icon, children }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      icon={icon}
      size="sm"
      busy={busy}
      footer={
        <>
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button type="button" className={tone === 'danger' ? 'primary primary--danger' : 'primary'} onClick={onConfirm} disabled={busy} data-autofocus>
            {busy ? <Loader2 size={16} className="spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/** Soft icon circle, short title, one helpful sentence and an optional next-step action. */
export function EmptyState({ icon, title, children, action, compact = false }) {
  return (
    <div className={`x-empty${compact ? ' x-empty--compact' : ''}`}>
      {icon ? <span className="x-empty__icon" aria-hidden>{icon}</span> : null}
      <h3 className="x-empty__title">{title}</h3>
      {children ? <p className="x-empty__text">{children}</p> : null}
      {action ? <div className="x-empty__action">{action}</div> : null}
    </div>
  );
}

/** Section heading used inside tab panels. */
export function SectionTitle({ icon, children, aside }) {
  return (
    <div className="x-section-title">
      <h3>{icon ? <span className="x-section-title__icon" aria-hidden>{icon}</span> : null}{children}</h3>
      {aside ? <div className="x-section-title__aside">{aside}</div> : null}
    </div>
  );
}

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}
