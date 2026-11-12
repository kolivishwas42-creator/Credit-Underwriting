// Legal Verification screen (was frontend/legal_verification/src/main.tsx): Mantine, themed to Ink & Ember.
// Mantine's stylesheets are scoped to this agent like its own (scripts/scope-agent-css.js).
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dropzone/styles.css";
import "./styles.css";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import App from "./App";
import { theme } from "./theme";

export default function LegalVerification() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  );
}
