// PostCSS plugin: scope each agent's stylesheets to that agent, so eleven screens written as separate pages can live
// in one app without their global rules (body, :root tokens, *, .card ...) leaking into each other.
//
// While an agent is open the shell puts class "agent-<id>" on <html> and renders the agent inside
//   <div class="agent-host">  (what the agent's old <body> was)
//     <div class="agent-root">  (what its old #root was)
// A selector in src/agents/<id>/... (or in Mantine's CSS, used only by legal_verification) is rewritten:
//   :root / html / [data-theme=..] / [data-mantine-color-scheme=..]  ->  html.agent-<id>[...]
//   body -> .agent-host        #root -> .agent-root        anything else -> html.agent-<id> <selector>
// Portals rendered into document.body still match (the class is on <html>). @keyframes are left alone.

const ROOT_COMPOUND = /^((?::root|html|\[data-theme[^\]]*\]|\[data-mantine-color-scheme[^\]]*\])(?:\[[^\]]*\]|:not\([^)]*\)|:root|:where\([^)]*\)|:is\([^)]*\))*)/;

function agentOf(file) {
  const f = (file || "").replace(/\\/g, "/");
  const m = f.match(/\/src\/agents\/([a-z_]+)\//);
  if (m) return m[1];
  if (f.includes("/node_modules/@mantine/")) return "legal_verification";
  return null;
}

function rewrite(selector, scope) {
  let s = selector.trim();
  if (!s) return s;
  s = s.replace(/(^|[\s>+~(,])body(?![\w-])/g, "$1.agent-host").replace(/#root(?![\w-])/g, ".agent-root");
  const m = s.match(ROOT_COMPOUND);
  if (m) {
    const compound = m[1].replace(/:root|html/g, "");             // keep [data-theme..], :not(..)
    return `html.${scope}${compound}${s.slice(m[1].length)}`;
  }
  return `html.${scope} ${s}`;
}

function insideKeyframes(rule) {
  for (let p = rule.parent; p; p = p.parent) {
    if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true;
  }
  return false;
}

export default function scopeAgentCss() {
  return {
    postcssPlugin: "scope-agent-css",
    Once(root) {
      const agent = agentOf(root.source && root.source.input && root.source.input.file);
      if (!agent) return;
      const scope = `agent-${agent}`;
      root.walkRules((rule) => {
        if (insideKeyframes(rule) || rule.selector.includes(`html.${scope}`)) return;
        rule.selectors = rule.selectors.map((sel) => rewrite(sel, scope));
      });
    },
  };
}
scopeAgentCss.postcss = true;

export { rewrite, agentOf };
