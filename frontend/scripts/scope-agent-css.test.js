import postcss from "postcss";
import scopeAgentCss, { agentOf, rewrite } from "./scope-agent-css.js";

const S = "agent-eligibility";

describe("scope-agent-css", () => {
  it("finds the agent from the stylesheet path", () => {
    expect(agentOf("C:\\x\\frontend\\src\\agents\\eligibility\\styles.css")).toBe("eligibility");
    expect(agentOf("/x/node_modules/@mantine/core/styles.css")).toBe("legal_verification");
    expect(agentOf("/x/src/shared/styles/shell.css")).toBeNull();
  });

  it("rewrites root, body, #root and plain selectors", () => {
    expect(rewrite(":root", S)).toBe("html.agent-eligibility");
    expect(rewrite(':root[data-theme="dark"]', S)).toBe('html.agent-eligibility[data-theme="dark"]');
    expect(rewrite(':root:not([data-theme="light"]) .badge', S))
      .toBe('html.agent-eligibility:not([data-theme="light"]) .badge');
    expect(rewrite(":root:root:root .hero", S)).toBe("html.agent-eligibility .hero");
    expect(rewrite("body", S)).toBe("html.agent-eligibility .agent-host");
    expect(rewrite("body.is-empty .rules", S)).toBe("html.agent-eligibility .agent-host.is-empty .rules");
    expect(rewrite("#root", S)).toBe("html.agent-eligibility .agent-root");
    expect(rewrite(".card > h2", S)).toBe("html.agent-eligibility .card > h2");
    expect(rewrite("*", S)).toBe("html.agent-eligibility *");
    expect(rewrite("[data-mantine-color-scheme='dark'] .x", S)).toBe("html.agent-eligibility[data-mantine-color-scheme='dark'] .x");
  });

  it("leaves keyframes and other agents alone", async () => {
    const css = "@keyframes spin{from{opacity:0}to{opacity:1}} .a,.b{color:red}";
    const out = await postcss([scopeAgentCss()]).process(css, { from: "/x/src/agents/eligibility/s.css" });
    expect(out.css).toContain("from{opacity:0}");
    expect(out.css).toContain("html.agent-eligibility .a,html.agent-eligibility .b{color:red}");
    const shared = await postcss([scopeAgentCss()]).process(css, { from: "/x/src/shared/s.css" });
    expect(shared.css).toBe(css);
  });
});
