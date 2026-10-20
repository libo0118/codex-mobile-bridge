// Refine the gateway list only in the Harmony host; gateway DOM and handlers stay intact.
export const HARMONY_DISPLAY_STYLE_SCRIPT: string = `(() => {
  if (window !== top || !document.documentElement.classList.contains('bridge-mobile')) return;
  const scope = 'bridge-harmony-display';
  if (document.documentElement.classList.contains(scope)) return;
  const sheet = Array.from(document.styleSheets).find(s => s.href && new URL(s.href).origin === location.origin);
  if (!sheet) return;
  const rules = [
    '.bridge-harmony-display #sidebar, .bridge-harmony-display .ds-list { padding-left: 12px; padding-right: 12px; }',
    '.bridge-harmony-display .list-heading { height: auto; min-height: 56px; gap: 6px; padding: 0 48px 0 0; }',
    '.bridge-harmony-display .list-heading h2 { min-width: 0; flex-wrap: wrap; white-space: normal; font-size: max(1.125rem, 18px); font-weight: 600; gap: 4px; }',
    '.bridge-harmony-display .connected-computer { font-size: max(.75rem, 12px); }',
    '.bridge-harmony-display .list-heading #new-chat, .bridge-harmony-display .list-heading #refresh { min-height: 44px; font-size: max(.875rem, 14px); }',
    '.bridge-harmony-display .chat-list-toolbar { gap: 6px; margin: 4px 0 10px; }',
    '.bridge-harmony-display .chat-list-toolbar > .search { flex: 1 1 6rem; min-width: 5rem; height: 44px; padding: 10px 12px; border: 1px solid var(--line) !important; border-radius: 12px; background: var(--surface) !important; color: var(--text); font-size: max(1rem, 16px) !important; }',
    '.bridge-harmony-display .chat-list-toolbar > .search::placeholder { color: var(--muted); font-size: max(.875rem, 14px); }',
    '.bridge-harmony-display .chat-list-toolbar > .list-filters { gap: 6px; }',
    '.bridge-harmony-display .chat-list-toolbar select, .bridge-harmony-display .ds-list .chat-list-toolbar .ds-surface { height: auto; min-height: 44px; max-width: 100%; padding: 8px 5px; border-radius: 12px; background-color: var(--surface); font-size: max(.8125rem, 13px); }',
    '.bridge-harmony-display .chat-list-toolbar .archive { min-height: 44px; gap: 5px; font-size: max(.8125rem, 13px); }',
    '.bridge-harmony-display .chat-list-toolbar .archive input { width: 16px; height: 16px; }',
    '.bridge-harmony-display .sessions { margin: 0; padding: 2px 0; }',
    '.bridge-harmony-display .session { box-sizing: border-box; min-height: 68px; padding: 10px 12px; margin-bottom: 4px; border: 1px solid transparent; border-radius: 14px; background: transparent; color: var(--text); }',
    '.bridge-harmony-display .session strong { min-width: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; white-space: normal; overflow-wrap: anywhere; font-size: max(1rem, 16px); line-height: 1.45; font-weight: 600; }',
    '.bridge-harmony-display .session small { min-width: 0; margin-top: 4px; gap: 8px; color: var(--muted); font-size: max(.8125rem, 13px); line-height: 1.5; }',
    '.bridge-harmony-display .session small > span { flex: 1; min-width: 0; }',
    '.bridge-harmony-display .session time { flex: none; font-variant-numeric: tabular-nums; }',
    '.bridge-harmony-display .session > .session-source, .bridge-harmony-display .session > .ds-session-type { align-self: start; justify-self: end; padding-top: 2px; font-size: max(.6875rem, 11px); line-height: 1.5; }',
    '.bridge-harmony-display .session.selected { background: var(--surface); border-color: var(--line); }',
    '.bridge-harmony-display .session:active { background: var(--surface); }',
    '.bridge-harmony-display .session:focus-visible, .bridge-harmony-display .list-heading button:focus-visible, .bridge-harmony-display .chat-list-toolbar input:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }',
    '.bridge-harmony-display .session-group > summary, .bridge-harmony-display .ds-session-group > summary { min-height: 44px; padding: 10px 12px; font-size: max(.8125rem, 13px); line-height: 1.5; }',
    '@supports (background: color-mix(in srgb, white, black)) { .bridge-harmony-display .session.selected { background: color-mix(in srgb, var(--accent) 8%, var(--page)); border-color: color-mix(in srgb, var(--accent) 20%, var(--line)); } .bridge-harmony-display .session:active { background: color-mix(in srgb, var(--accent) 12%, var(--page)); } }',
    '@media (hover: hover) and (pointer: fine) { .bridge-harmony-display .session:hover { background: var(--surface); border-color: var(--line); } }',
    '@media (max-width: 350px) { .bridge-harmony-display #sidebar, .bridge-harmony-display .ds-list { padding-left: 10px; padding-right: 10px; } .bridge-harmony-display .list-heading { gap: 4px; } .bridge-harmony-display .chat-list-toolbar > .search { flex-basis: 100%; } }'
  ];
  let start;
  try {
    start = sheet.cssRules.length;
    for (const rule of rules) sheet.insertRule(rule, sheet.cssRules.length);
    document.documentElement.classList.add(scope);
  } catch {
    if (start !== undefined) while (sheet.cssRules.length > start) sheet.deleteRule(start);
  }
})();`;
