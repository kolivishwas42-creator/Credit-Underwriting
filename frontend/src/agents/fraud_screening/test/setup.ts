import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has no scrolling
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
afterEach(() => cleanup());
