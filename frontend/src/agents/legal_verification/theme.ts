import { createTheme, type MantineColorsTuple } from "@mantine/core";

// THE PALETTE -- "Ink & Ember" (DESIGN.md): ink creates (primary actions), ember marks (selection / what needs you),
// indigo informs (links, info chips). Neutrals are pure grey; red / yellow / green only for meaning.
const ink: MantineColorsTuple = ["#f7f7f8", "#f4f4f5", "#ebebed", "#d4d4d8", "#a1a1aa", "#71717a", "#3f3f46",
                                 "#1E3A8A", "#172554", "#0F172A"];
const ember: MantineColorsTuple = ["#DBEAFE", "#DBEAFE", "#BFDBFE", "#93C5FD", "#60A5FA", "#1E40AF", "#1E3A8A",
                                   "#172554", "#1E3A8A", "#172554"];
// kept under its old name so existing color="sapphire" badges now read as the indigo "informs" colour
const sapphire: MantineColorsTuple = ["#eef0fc", "#dfe2f8", "#c3c8f0", "#a5acf0", "#8b94e8", "#6f79d8", "#4f5ac7",
                                      "#4148a8", "#3f49ab", "#2f3787"];

const FONT_BODY = "Lexend, Inter, -apple-system, Segoe UI, Roboto, sans-serif";
const FONT_DISPLAY = "Space Grotesk, Inter, -apple-system, Segoe UI, sans-serif";

export const theme = createTheme({
  primaryColor: "ink",
  colors: { ink, ember, sapphire },
  primaryShade: { light: 8, dark: 0 },
  autoContrast: true,
  black: "#18181b",
  fontFamily: FONT_BODY,
  fontFamilyMonospace: "ui-monospace, Cascadia Code, Consolas, monospace",
  headings: { fontFamily: FONT_DISPLAY, fontWeight: "700" },
  radius: { xs: "6px", sm: "8px", md: "8px", lg: "16px", xl: "20px" },
  defaultRadius: "md",
  defaultGradient: { from: "ink.8", to: "ink.8", deg: 0 },   // navy (owner 2026-11-11)
  components: {
    Button: { defaultProps: { radius: "md" } },
    Paper: { defaultProps: { radius: "lg" } },
    Badge: { defaultProps: { radius: "xs", variant: "light" } },
    TextInput: { defaultProps: { radius: "md", size: "sm" } },
    // every dropdown: a bordered card under the field, roomy options, a check on the chosen one
    Select: {
      defaultProps: {
        radius: "md", size: "sm", checkIconPosition: "right", maxDropdownHeight: 280, withScrollArea: true,
        comboboxProps: { shadow: "lg", radius: "lg", offset: 6, transitionProps: { transition: "pop-top-left", duration: 120 } },
      },
      // theme classNames merge with a field's own (defaultProps classNames would be replaced by them)
      classNames: { dropdown: "dd-card", option: "dd-option", section: "dd-chevron", empty: "dd-empty" },
    },
    Textarea: { defaultProps: { radius: "md", autosize: true, minRows: 2 } },
  },
});
