import { useEffect } from "react";

/** "Name (about)" in a dropdown option -> three spaces before the "(" (owner 2026-11-12). Non-breaking, because a
 *  plain run of spaces collapses to one inside an <option>. Native <option>s and Mantine's / the suggestion lists' items. */
const OPTION = "option, [role=option], .dd-option";
const BRACKET = /([^\s ])[  ]*\(/;          // first "(" that follows some text

const spaceOut = (node: Text) => {
  const v = node.nodeValue ?? "";
  const m = BRACKET.exec(v);
  if (!m) return;
  const at = m.index + 1;
  const next = v.slice(0, at) + "   (" + v.slice(at + m[0].length - 1);
  if (next !== v) node.nodeValue = next;
};

function fix(root: Node) {
  const el = root.nodeType === 1 ? (root as Element) : root.parentElement;
  if (!el) return;
  const items = el.closest(OPTION) ? [el.closest(OPTION) as Element] : Array.from(el.querySelectorAll(OPTION));
  for (const item of items) {
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) spaceOut(n as Text);
  }
}

export function useOptionSpacing() {
  useEffect(() => {
    fix(document.body);
    const seen = new MutationObserver((list) => { for (const m of list) { fix(m.target); m.addedNodes.forEach(fix); } });
    seen.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => seen.disconnect();
  }, []);
}
