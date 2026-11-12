import { useEffect } from "react";

/**
 * MODERN HOVER TEXT ON EVERY AGENT (owner 2026-11-12: "hover karne pe bada boring likha aata hai"): the browser's own
 * `title` box is replaced by one small, simple bubble -- dark, rounded, a soft fade, above the item (below it near the
 * top of the window). It also shows for keyboard focus. Nothing in the agents changes: any element with a `title`
 * gets it.
 *
 * The `title` is moved to `data-cu-tip` while the pointer is on the element (so the browser's box never shows) and put
 * back when it leaves. An icon-only control whose only name was its title keeps that name (aria-label).
 */
export const TIP_DELAY_MS = 350;
const GAP = 8;

let tip: HTMLDivElement | null = null;
let timer: number | undefined;
let owner: HTMLElement | null = null;

function bubble(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "cu-tip";
    tip.setAttribute("role", "tooltip");
    tip.id = "cu-tip";
    document.body.appendChild(tip);
  }
  return tip;
}

function place(el: HTMLElement, box: HTMLDivElement) {
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const below = r.top - b.height - GAP < 4;
  const top = below ? r.bottom + GAP : r.top - b.height - GAP;
  const left = Math.min(Math.max(4, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - 4);
  box.style.top = `${Math.round(top)}px`;
  box.style.left = `${Math.round(left)}px`;
  box.dataset.side = below ? "below" : "above";
  box.style.setProperty("--arrow-x", `${Math.round(r.left + r.width / 2 - left)}px`);
}

/** "Open rule R3: Name matches PAN" -> a small bold first line ("Open rule R3") and the rest under it; a text without
 *  a short label before ": " stays one block. textContent only -- never HTML. */
export function fill(box: HTMLElement, text: string) {
  box.replaceChildren();
  const at = text.indexOf(": ");
  if (at > 0 && at <= 32 && text.length - at > 4) {
    const head = document.createElement("b");
    head.className = "cu-tip-head";
    head.textContent = text.slice(0, at);
    const body = document.createElement("span");
    body.className = "cu-tip-body";
    body.textContent = text.slice(at + 2);
    box.append(head, body);
  } else {
    box.textContent = text;
  }
}

function take(el: HTMLElement): string | null {
  const text = el.getAttribute("title");
  if (!text || !text.trim()) return el.dataset.cuTip ?? null;
  // an icon-only control named only by its title keeps that name
  if (!el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", text);
  el.dataset.cuTip = text;
  el.removeAttribute("title");
  return text;
}

function giveBack(el: HTMLElement) {
  if (el.dataset.cuTip !== undefined) {
    el.setAttribute("title", el.dataset.cuTip);
    delete el.dataset.cuTip;
  }
}

export function hideTip() {
  window.clearTimeout(timer);
  if (owner) { owner.removeAttribute("aria-describedby"); giveBack(owner); owner = null; }
  if (tip) tip.classList.remove("is-on");
}

function showFor(el: HTMLElement, now = false) {
  const text = take(el);
  if (!text) return;
  window.clearTimeout(timer);
  owner = el;
  const run = () => {
    if (owner !== el || !el.isConnected) return;
    const box = bubble();
    fill(box, text);
    box.classList.remove("is-on");
    box.style.top = "-9999px";
    box.style.left = "-9999px";
    place(el, box);
    el.setAttribute("aria-describedby", "cu-tip");
    box.classList.add("is-on");
  };
  if (now) run(); else timer = window.setTimeout(run, TIP_DELAY_MS);
}

const target = (e: Event) => (e.target instanceof Element ? (e.target.closest("[title], [data-cu-tip]") as HTMLElement | null) : null);

export function useModernTooltips() {
  useEffect(() => {
    const over = (e: Event) => {
      const el = target(e);
      if (el && el !== owner) { hideTip(); showFor(el); }
    };
    const out = (e: MouseEvent) => {
      if (owner && !(e.relatedTarget instanceof Node && owner.contains(e.relatedTarget))) hideTip();
    };
    const focus = (e: FocusEvent) => {
      const el = target(e);
      if (el && (el as HTMLElement).matches(":focus-visible")) { hideTip(); showFor(el); }
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hideTip);
    document.addEventListener("mousedown", hideTip, true);
    document.addEventListener("keydown", hideTip, true);
    window.addEventListener("scroll", hideTip, true);
    return () => {
      hideTip();
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hideTip);
      document.removeEventListener("mousedown", hideTip, true);
      document.removeEventListener("keydown", hideTip, true);
      window.removeEventListener("scroll", hideTip, true);
    };
  }, []);
}
