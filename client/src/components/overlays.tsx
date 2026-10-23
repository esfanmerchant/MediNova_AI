"use client";

/**
 * Things that float over the page: dialogs, drawers, and toasts.
 *
 * All three share one set of rules. They render into `document.body` through a
 * portal, so no ancestor's `overflow` or stacking context can clip them. They
 * trap focus while open and return it where it was on close, because a control
 * that steals focus and does not give it back strands a keyboard user. And they
 * animate in *and out* — an element that vanishes reads as a bug, however fast
 * it appeared.
 */

import { AnimatePresence, motion, useAnimate } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/Icon";
import { ConsoleSurface, cx } from "@/components/ui";
import { useTr } from "@/lib/lang";
import { SPRING, TRANSITION, useCalmMotion } from "@/lib/motion";
// Portals need the document, which the server does not have.
import { useHydrated as useMounted } from "@/lib/useHydrated";

/** Springs for position and scale; opacity on a curve, so a fade never wobbles. */
const PANEL = { ...SPRING, opacity: TRANSITION.base } as const;

/**
 * Keeps Tab inside `ref` while `active`, and restores focus on unmount.
 *
 * Written by hand rather than pulled in: the whole behaviour is "find the
 * focusable children, wrap at the ends", and a dependency for that would be
 * larger than the code.
 */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const container = ref.current;

    const focusables = () =>
      Array.from(
        container?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    // Focus the first control, or the panel itself when it holds none.
    const first = focusables()[0] ?? container;
    first?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const start = items[0];
      const end = items[items.length - 1];
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [active, ref]);
}

/** Escape closes; the page behind stops scrolling. */
function useDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);
}

// ---------------------------------------------------------------------------
// Floating
// ---------------------------------------------------------------------------

/**
 * Renders something pinned to the screen from outside the page's own tree.
 *
 * `position: fixed` is only fixed to the screen while no ancestor has a
 * transform; the moment one does — a page arriving, a section rising into
 * view — it becomes fixed to *that*, and a bar meant for the bottom of the
 * window lands at the bottom of a 3,000px list instead. A portal puts it where
 * no entrance can reach it.
 */
export function Floating({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  const inConsole = useContext(ConsoleSurface);
  if (!mounted) return null;
  return createPortal(inConsole ? <div className="console-tokens contents">{children}</div> : children, document.body);
}

// ---------------------------------------------------------------------------
// The two motion shells
// ---------------------------------------------------------------------------

/**
 * The scrim behind a modal or a drawer.
 *
 * Its blur fades in with it: the blur lives on this layer, so animating the
 * layer's opacity brings the blur up from nothing rather than snapping it on
 * under a dimming that is still arriving.
 */
function Backdrop({ onClose, label = "Close" }: { onClose: () => void; label?: string }) {
  const inConsole = useContext(ConsoleSurface);
  return (
    <motion.button
      type="button"
      aria-label={label}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={TRANSITION.base}
      onClick={onClose}
      className={cx(
        "absolute inset-0 cursor-default",
        inConsole ? "bg-[#050D1F]/[0.38] backdrop-blur-[2px]" : "bg-[#071129]/55 backdrop-blur-sm",
      )}
    />
  );
}

/**
 * Anything centred over the page: in at 95% and 10px low, out the same way.
 *
 * The motion, the portal and the scrim, and nothing else — what goes inside is
 * the caller's. `Dialog` is the usual one; the command palette is another.
 * `trap` hands focus and Escape to the shell; a panel that manages its own
 * keyboard (the palette does) turns it off.
 */
export function AnimatedModal({
  open,
  onClose,
  children,
  className,
  labelledBy,
  label,
  placement = "center",
  layer = "z-[100]",
  trap = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** The panel: its width, ground and radius. */
  className?: string;
  labelledBy?: string;
  label?: string;
  /** `top` sits a little below the header, for a panel that grows downwards. */
  placement?: "center" | "top";
  layer?: string;
  trap?: boolean;
}) {
  const mounted = useMounted();
  const calm = useCalmMotion();
  const inConsole = useContext(ConsoleSurface);
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open && trap);
  useDismiss(open && trap, onClose);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cx(
            "fixed inset-0 flex justify-center p-4",
            placement === "center" ? "items-center" : "items-start pt-[12vh]",
            layer,
            inConsole && "console-tokens",
          )}
        >
          <Backdrop onClose={onClose} />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : label}
            tabIndex={-1}
            initial={calm ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            animate={calm ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 10 }}
            transition={calm ? TRANSITION.fast : PANEL}
            className={cx("relative w-full", className)}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * A panel thrown in from the edge of the screen on a spring, over a dimmed
 * page — for detail that belongs beside a list rather than in place of it.
 */
export function AnimatedDrawer({
  open,
  onClose,
  children,
  className,
  labelledBy,
  label,
  side = "right",
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  label?: string;
  side?: "right" | "left";
  width?: number;
}) {
  const mounted = useMounted();
  const calm = useCalmMotion();
  const inConsole = useContext(ConsoleSurface);
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open);
  useDismiss(open, onClose);

  if (!mounted) return null;
  // A percentage of the panel's own width, so it starts fully off-screen at any
  // width — including the 92vw it is capped to on a phone.
  const away = side === "right" ? "100%" : "-100%";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cx("fixed inset-0 z-[100]", inConsole && "console-tokens")}>
          <Backdrop onClose={onClose} />
          <motion.aside
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={labelledBy ? undefined : label}
            tabIndex={-1}
            initial={calm ? { opacity: 0 } : { x: away }}
            animate={calm ? { opacity: 1 } : { x: 0 }}
            exit={calm ? { opacity: 0 } : { x: away }}
            transition={calm ? TRANSITION.fast : SPRING}
            style={{ width }}
            className={cx(
              "absolute inset-y-0 flex max-w-[92vw] flex-col border-line bg-card",
              inConsole ? "shadow-[-30px_0_60px_-30px_rgba(5,13,31,0.5)]" : "shadow-float",
              side === "right" ? "right-0 border-l" : "left-0 border-r",
              className,
            )}
          >
            {children}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** A Material Symbol, shown in a gradient square beside the title. */
  icon?: string;
  children: ReactNode;
  /** Actions. Right-aligned by convention: ghost cancel, then the commit. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const tr = useTr();
  const labelId = useId();
  const inConsole = useContext(ConsoleSurface);
  const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

  return (
    <AnimatedModal
      open={open}
      onClose={onClose}
      labelledBy={labelId}
      className={cx(
        "max-h-[calc(100dvh-2rem)] overflow-y-auto border border-line bg-card",
        inConsole ? "rounded-3xl shadow-[0_40px_90px_-30px_rgba(5,13,31,0.45)]" : "rounded-2xl shadow-float",
        widths[size],
      )}
    >
      <header className={cx("flex items-start gap-3 border-b border-line", inConsole ? "px-[22px] py-[18px]" : "px-6 py-5")}>
        {icon &&
          (inConsole ? (
            // The console's icon tile: the sunken square every card heads with.
            <span aria-hidden className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[13px] bg-sunken text-primary">
              <Icon name={icon} className="text-[19px]" />
            </span>
          ) : (
            <span
              aria-hidden
              className="bg-gradient-brand grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm"
            >
              <Icon name={icon} filled className="text-[22px]" />
            </span>
          ))}
        <div className="min-w-0 flex-1">
          <h2 id={labelId} className={cx("font-display font-bold text-strong", inConsole ? "text-[18px] leading-tight" : "text-lg")}>
            {title}
          </h2>
          {description && <p className={inConsole ? "mt-[3px] text-[13px] leading-[1.5] text-muted" : "mt-1 text-sm text-muted"}>{description}</p>}
        </div>
        <button
          type="button"
          aria-label={tr("Close", "Band karein")}
          onClick={onClose}
          className={cx(
            "grid shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-primary",
            inConsole
              ? "h-8 w-8 border border-line-strong bg-card text-strong transition-colors hover:bg-sunken"
              : "h-9 w-9 text-muted transition-[background-color,color,transform] hover:rotate-90 hover:scale-110 hover:bg-sunken hover:text-strong",
          )}
        >
          <Icon name="close" className={inConsole ? "text-[16px]" : "text-[20px]"} />
        </button>
      </header>

      <div className={inConsole ? "p-[22px]" : "px-6 py-5"}>{children}</div>

      {footer && (
        <footer
          className={cx(
            "flex flex-wrap items-center justify-end gap-2 border-t border-line",
            inConsole ? "px-[22px] py-3.5" : "px-6 py-4",
          )}
        >
          {footer}
        </footer>
      )}
    </AnimatedModal>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = "right",
  width = 560,
  titleHidden = false,
  monoTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** For a panel whose body opens with the name set large: the title still
      names the dialog, but only the description shows in the header. */
  titleHidden?: boolean;
  /** For a title that is a code — an invoice number. */
  monoTitle?: boolean;
  children: ReactNode;
  /** Sticky, so the commit stays reachable in a long panel. */
  footer?: ReactNode;
  side?: "right" | "left";
  width?: number;
}) {
  const tr = useTr();
  const labelId = useId();
  const inConsole = useContext(ConsoleSurface);

  return (
    <AnimatedDrawer open={open} onClose={onClose} labelledBy={labelId} side={side} width={width}>
      <header
        className={cx(
          "flex gap-3 border-b border-line",
          inConsole ? "items-center px-[22px] py-[18px]" : "items-start px-5 py-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <h2
            id={labelId}
            className={
              titleHidden
                ? "sr-only"
                : monoTitle
                  ? "!font-mono text-[17px] leading-tight font-semibold tracking-normal text-strong"
                  : cx("font-display leading-tight font-bold text-strong", inConsole ? "text-[18px]" : "text-lg")
            }
          >
            {title}
          </h2>
          {description && (
            <p className={titleHidden || inConsole ? cx("text-[13px] text-muted", !titleHidden && "mt-0.5") : "mt-0.5 text-sm text-muted"}>
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={tr("Close", "Band karein")}
          onClick={onClose}
          className={cx(
            "grid shrink-0 place-items-center rounded-full transition-[background-color,color,transform] focus-visible:outline-2 focus-visible:outline-primary",
            inConsole
              ? "h-8 w-8 border border-line-strong bg-card text-strong hover:bg-sunken"
              : "h-9 w-9 text-muted hover:rotate-90 hover:bg-sunken hover:text-strong",
          )}
        >
          <Icon name="close" className={inConsole ? "text-[16px]" : "text-[20px]"} />
        </button>
      </header>

      <div className={cx("min-h-0 flex-1 overflow-y-auto", inConsole ? "p-[22px]" : "px-5 py-5")}>{children}</div>

      {footer && (
        <footer
          className={cx(
            "flex flex-wrap items-center justify-end gap-2 border-t border-line bg-card",
            inConsole ? "px-[22px] py-3.5" : "px-5 py-4",
          )}
        >
          {footer}
        </footer>
      )}
    </AnimatedDrawer>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export type ToastTone = "success" | "warning" | "critical" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  duration: number;
}

interface ToastApi {
  show: (toast: { tone?: ToastTone; title: string; body?: string; duration?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Confirms what just happened, in the words of the button that did it.
 *
 * Deliberately not a place for errors that need a decision: those belong in the
 * form, next to the control. A toast is for "it worked", and for the rare
 * failure a person cannot act on from here.
 */
export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  // A no-op rather than a throw: a component that toasts should still render
  // in a test that did not mount the provider.
  return context ?? { show: () => {} };
}

const TONES: Record<ToastTone, { icon: string; bar: string; text: string }> = {
  success: { icon: "check_circle", bar: "bg-stable", text: "text-stable" },
  warning: { icon: "warning", bar: "bg-warning", text: "text-warning" },
  critical: { icon: "error", bar: "bg-critical", text: "text-critical" },
  info: { icon: "info", bar: "bg-info", text: "text-info" },
};

/**
 * How long a toast stays when the caller does not say.
 *
 * Three seconds is enough to read "Saved". It is not enough to read a sentence
 * under it, so a body buys more time, and a warning — something that did not
 * go the way the person meant — stays long enough to be read twice.
 */
function defaultDuration(tone: ToastTone, body: string | undefined): number {
  if (tone === "warning" || tone === "critical") return 6000;
  return body ? 5000 : 3000;
}

/**
 * One toast, and the clock it runs on.
 *
 * Hovering or focusing it stops the clock — and the line that shows it running
 * out — so a toast somebody is in the middle of reading does not leave under
 * their eyes. It resumes with whatever was left.
 */
function ToastItem({
  toast,
  depth,
  onDismiss,
}: {
  toast: Toast;
  depth: number;
  onDismiss: (id: number) => void;
}) {
  const calm = useCalmMotion();
  const tone = TONES[toast.tone];
  const [line, animateLine] = useAnimate<HTMLSpanElement>();
  const clock = useRef<{
    timer?: number;
    left: number;
    since: number;
    running: boolean;
    run?: ReturnType<typeof animateLine>;
  }>({ left: toast.duration, since: 0, running: false });

  const start = useCallback(() => {
    const state = clock.current;
    if (state.running) return;
    state.running = true;
    state.since = performance.now();
    state.timer = window.setTimeout(() => onDismiss(toast.id), state.left);
    if (state.run) state.run.play();
    else if (line.current) {
      state.run = animateLine(line.current, { scaleX: [1, 0] }, { duration: state.left / 1000, ease: "linear" });
    }
  }, [animateLine, line, onDismiss, toast.id]);

  const pause = useCallback(() => {
    const state = clock.current;
    if (!state.running) return;
    state.running = false;
    window.clearTimeout(state.timer);
    state.left = Math.max(400, state.left - (performance.now() - state.since));
    state.run?.pause();
  }, []);

  useEffect(() => {
    start();
    const state = clock.current;
    return () => {
      state.running = false;
      window.clearTimeout(state.timer);
      state.run?.stop();
      state.run = undefined;
    };
  }, [start]);

  return (
    <motion.div
      layout
      // From below, into place; out the way it came. Older toasts recede: the
      // newest is at full size in front.
      initial={calm ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
      animate={calm ? { opacity: 1 } : { opacity: 1, y: depth * 2, scale: 1 - depth * 0.03 }}
      exit={calm ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.97 }}
      transition={calm ? TRANSITION.fast : PANEL}
      onPointerEnter={pause}
      onPointerLeave={start}
      onFocus={pause}
      onBlur={start}
      className="glass pointer-events-auto relative overflow-hidden rounded-2xl"
    >
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", tone.bar)} />
      <div className="flex items-start gap-3 py-3 pl-5 pr-3">
        <span aria-hidden className={cx("pop-scale mt-0.5 shrink-0", tone.text)}>
          <Icon name={tone.icon} filled className="text-[22px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-strong">{toast.title}</p>
          {toast.body && <p className="mt-0.5 text-sm text-muted">{toast.body}</p>}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onDismiss(toast.id)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-sunken hover:text-strong focus-visible:outline-2 focus-visible:outline-primary"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
      {/* How long is left, as a line that runs out. */}
      <span
        ref={line}
        aria-hidden
        className={cx("absolute bottom-0 left-0 h-0.5 w-full origin-left", tone.bar)}
      />
    </motion.div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mounted = useMounted();
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(({ tone = "success", title, body, duration }) => {
    const id = (nextId.current += 1);
    setToasts((current) => [
      ...current.slice(-2),
      { id, tone, title, body, duration: duration ?? defaultDuration(tone, body) },
    ]);
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed right-4 top-4 z-[110] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
          >
            <AnimatePresence initial={false}>
              {toasts.map((toast, index) => (
                <ToastItem
                  key={toast.id}
                  toast={toast}
                  depth={toasts.length - 1 - index}
                  onDismiss={dismiss}
                />
              ))}
            </AnimatePresence>
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
