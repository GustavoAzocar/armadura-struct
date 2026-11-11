import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Help bubble for icon-only ribbon commands (issue #119).
 *
 * - Rendered in a portal with fixed positioning, so the scrolling ribbon never
 *   clips it, and kept inside the window.
 * - `pointer-events: none`: it never takes the click meant for a button.
 * - Shown on hover (short delay) and on keyboard focus; hidden on leave, blur,
 *   press, scroll, resize and Esc. Esc is not consumed, so it still cancels the
 *   running drawing command exactly as before.
 * - The visible bubble repeats the accessible name; extra information (why a
 *   command is unavailable, a real shortcut) is exposed separately through
 *   `aria-describedby` so assistive technology does not read the name twice.
 */
export type TooltipContent = {
  label: string;
  detail?: string;
  shortcut?: string;
};
type Shown = TooltipContent & { anchor: Element; key: string; tick: number };
type Controller = {
  show: (key: string, el: Element, c: TooltipContent, now: boolean) => void;
  hide: (key?: string) => void;
};
const TooltipContext = createContext<Controller | null>(null);
const SHOW_DELAY = 380;
const WARM_WINDOW = 320;
const GAP = 6;
const MARGIN = 4;

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const lastHidden = useRef(0);
  const visible = useRef(false);
  const current = useRef<string | undefined>(undefined);
  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const hide = useCallback((key?: string) => {
    if (key && current.current !== key) return;
    clear();
    current.current = undefined;
    if (visible.current) lastHidden.current = Date.now();
    visible.current = false;
    setShown(null);
  }, []);
  const show = useCallback(
    (key: string, el: Element, c: TooltipContent, now: boolean) => {
      clear();
      current.current = key;
      const open = () => {
        if (current.current !== key || !el.isConnected) return;
        visible.current = true;
        setShown({ ...c, key, anchor: el, tick: 0 });
      };
      const warm =
        visible.current || Date.now() - lastHidden.current < WARM_WINDOW;
      if (now || warm) open();
      else timer.current = window.setTimeout(open, SHOW_DELAY);
    },
    [],
  );
  const open = !!shown;
  useEffect(() => {
    if (!open) return;
    const dismiss = () => hide();
    // Scrolling the ribbon (e.g. keyboard focus bringing a command into view)
    // moves the bubble with its command instead of dropping it.
    const follow = () => setShown((s) => (s ? { ...s, tick: s.tick + 1 } : s));
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, hide]);
  useEffect(() => clear, []);
  const value = useMemo(() => ({ show, hide }), [show, hide]);
  return (
    <TooltipContext.Provider value={value}>
      {children}
      {shown && createPortal(<Bubble shown={shown} />, document.body)}
    </TooltipContext.Provider>
  );
}

function Bubble({ shown }: { shown: Shown }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [gone, setGone] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const anchor = shown.anchor.getBoundingClientRect();
    // Hidden when its command scrolled out of the visible ribbon area.
    const clip = shown.anchor
      .closest('.ribbon-content, .ribbon-peek-content')
      ?.getBoundingClientRect();
    const out =
      !shown.anchor.isConnected ||
      (!!clip &&
        (anchor.right <= clip.left + 2 || anchor.left >= clip.right - 2));
    setGone(out);
    if (out) return;
    // Position is measured in viewport pixels; fixed offsets inherit CSS zoom.
    // Resolve both in the same units so enlarged interfaces keep help on screen.
    const rect = el.getBoundingClientRect();
    const scale = rect.width / parseFloat(getComputedStyle(el).width) || 1;
    const w = rect.width,
      h = rect.height,
      vw = document.documentElement.clientWidth,
      vh = document.documentElement.clientHeight;
    let left = anchor.left + anchor.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(left, vw - w - MARGIN));
    let top = anchor.bottom + GAP;
    if (top + h > vh - MARGIN) top = anchor.top - GAP - h;
    top = Math.max(MARGIN, top);
    setPos({ left: left / scale, top: top / scale });
  }, [shown]);
  return (
    <div
      ref={ref}
      role="tooltip"
      className="ribbon-tooltip"
      data-testid="ribbon-tooltip"
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos && !gone ? 'visible' : 'hidden',
      }}
    >
      <strong>{shown.label}</strong>
      {shown.shortcut && <kbd>{shown.shortcut}</kbd>}
      {shown.detail && <span>{shown.detail}</span>}
    </div>
  );
}

/**
 * Wires a trigger (button, or the wrapper of a disabled button) to the shared
 * bubble. Returns handlers for the hover target and the focus target, plus
 * the id/text for the optional description.
 */
export function useTooltip(content: TooltipContent) {
  const ctx = useContext(TooltipContext);
  const key = useId();
  const describedId = `${key}-desc`;
  const latest = useRef(content);
  latest.current = content;
  useEffect(() => () => ctx?.hide(key), [ctx, key]);
  const described = [content.detail, content.shortcut]
    .filter(Boolean)
    .join(' · ');
  return {
    describedId: described ? describedId : undefined,
    describedText: described,
    hover: {
      onPointerEnter: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'touch') return;
        ctx?.show(key, e.currentTarget, latest.current, false);
      },
      onPointerLeave: () => ctx?.hide(key),
      onPointerDown: () => ctx?.hide(key),
    },
    focus: {
      onFocus: (e: FocusEvent<HTMLElement>) => {
        let keyboard = true;
        try {
          keyboard = e.currentTarget.matches(':focus-visible');
        } catch {
          // Older engines without :focus-visible still get the bubble.
        }
        if (keyboard) ctx?.show(key, e.currentTarget, latest.current, true);
      },
      onBlur: () => ctx?.hide(key),
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Escape') ctx?.hide(key);
      },
    },
  };
}
