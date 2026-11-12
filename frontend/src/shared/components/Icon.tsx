// Line icons for the sidebar and home cards (24-unit grid, stroke = currentColor).
const PATHS: Record<string, string> = {
  gauge: "M12 14l4-4M4.9 19a9 9 0 1 1 14.2 0M12 14a1.5 1.5 0 1 0 0 .01",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.8M16 4.2a3 3 0 0 1 0 5.6",
  "file-check": "M14 3H6v18h12V7zM14 3v4h4M9 14l2 2 4-4",
  bank: "M3 21h18M3 10h18M5 6l7-3 7 3M6 10v8m4-8v8m4-8v8m4-8v8",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  home: "M3 11l9-7 9 7M5 9.5V20h5v-6h4v6h5V9.5",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  scale: "M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z",
  building: "M4 21V5l8-2v18M12 7l8 3v11M3 21h18M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2",
  key: "M15 7a4 4 0 1 1-3.2 6.4L4 21H3v-3l1-1h2v-2h2l1.6-1.6A4 4 0 0 1 15 7zM16 9h.01",
  alert: "M12 3l10 18H2zM12 10v4M12 17h.01",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  collapse: "M15 6l-6 6 6 6",
  expand: "M9 6l6 6-6 6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M7 7l10 10M17 7L7 17",
  dash: "M7 12h10",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2",
  sparkle: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  send: "M21 3L10 14M21 3l-7 18-4-7-7-4z",
  pause: "M9 5v14M15 5v14",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  chevron: "M6 9l6 6 6-6",
  calc: "M6 3h12v18H6zM9 7h6M9 11h.01M12 11h.01M15 11h.01M9 14h.01M12 14h.01M15 14h.01M9 17h.01M12 17h.01M15 17h.01",
  list: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
};

export function Icon({ name, title }: { name: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? PATHS.grid} />
    </svg>
  );
}
