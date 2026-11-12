import "@testing-library/jest-dom/vitest";

// jsdom has no scrolling and no media queries
window.scrollTo = () => {};
Element.prototype.scrollIntoView = () => {};
window.matchMedia = window.matchMedia || ((query: string) => ({
  matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
