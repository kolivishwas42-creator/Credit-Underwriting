import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import scopeAgentCss from "./scripts/scope-agent-css.js";

// tailwind: only the ITR screen uses it (tailwind.config.js content = src/agents/itr_verification).
// scopeAgentCss: every stylesheet under src/agents/<agent>/ applies only while that agent is open (see the plugin).
export default {
  plugins: [tailwindcss(), scopeAgentCss(), autoprefixer()],
};
