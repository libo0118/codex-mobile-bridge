// Keep gateway provider switching separate from the four native service tabs.
export const PROVIDER_SWITCHER_SCRIPT: string = `(() => {
  if (window !== top || !document.documentElement.classList.contains('bridge-mobile')) return;
  const key = '__bridgeHarmonyProviderSwitcher';
  if (window[key]) { window[key].sync(); return; }
  let control, picker, badge, dock, navigation, entries = [], signature = '', styled = false, queued = false;
  const active = 'bridge-harmony-provider-active';
  const addClass = (node, name) => { if (!node.classList.contains(name)) node.classList.add(name); };
  const removeClass = (node, name) => { if (node && node.classList.contains(name)) node.classList.remove(name); };
  const label = () => document.documentElement.lang.startsWith('en') ? 'Switch chat application' : '切换聊天应用';
  const deactivate = () => {
    removeClass(document.documentElement, active);
    removeClass(dock, 'bridge-harmony-provider-dock');
    removeClass(navigation, 'bridge-harmony-provider-nav');
    if (badge && badge.getAttribute('aria-hidden') === 'true') badge.removeAttribute('aria-hidden');
    if (control && control.isConnected) control.remove();
  };
  const style = () => {
    if (styled) return true;
    const sheet = Array.from(document.styleSheets).find(s => s.href && new URL(s.href).origin === location.origin);
    if (!sheet) return false;
    try {
      for (const rule of [
        '.bridge-harmony-provider-active .bridge-harmony-provider-dock { display: none !important; }',
        '.bridge-harmony-provider-active .bridge-harmony-provider-nav { padding-bottom: 0 !important; }',
        '.bridge-harmony-provider-active .bridge-harmony-provider-nav .client-functions { display: none !important; }',
        '.bridge-harmony-provider-active .list-heading h2 { min-width: 0; gap: 4px; }',
        '.bridge-harmony-provider-active .client-badge { font-size: 0 !important; gap: 0 !important; }',
        '.bridge-harmony-provider-control { display: inline-flex; flex: none; width: 76px; min-width: 0; }',
        '.bridge-harmony-provider-control select { width: 100%; max-width: 100%; min-width: 0; height: 44px; margin: 0; padding: 2px 0 2px 3px; border: 0; border-radius: 8px; background: transparent; color: var(--text); font: inherit; font-size: 12px; font-weight: 600; }',
        '.bridge-harmony-provider-control select:disabled { opacity: 1; color: var(--text); }',
        '.bridge-harmony-provider-control select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }'
      ]) sheet.insertRule(rule, sheet.cssRules.length);
      styled = true;
    } catch { return false; }
    return true;
  };
  const buttons = source => Array.from(source.children).filter(node => node.tagName === 'BUTTON' && node.textContent.trim());
  const sync = () => {
    queued = false;
    if (!document.documentElement.classList.contains('bridge-mobile')) { deactivate(); return; }
    const source = document.getElementById('client-switch');
    const nextDock = source && source.closest('.client-switch-dock');
    const nextBadge = document.querySelector('.list-heading h2 .client-badge');
    const heading = nextBadge && nextBadge.closest('h2');
    const sourceButtons = source ? buttons(source) : [];
    const names = sourceButtons.map(button => button.textContent.trim());
    if (!nextDock || !heading || !sourceButtons.length || sourceButtons.some(button => typeof button.onclick !== 'function') || new Set(names).size !== names.length || !style()) { deactivate(); return; }
    if (badge && badge !== nextBadge) { deactivate(); signature = ''; }
    badge = nextBadge;
    dock = nextDock;
    navigation = dock.closest('.client-navigation');
    if (!control) {
      control = document.createElement('label'); control.className = 'bridge-harmony-provider-control';
      picker = document.createElement('select'); control.append(picker);
      picker.addEventListener('change', () => {
        const currentSource = document.getElementById('client-switch');
        const current = currentSource ? buttons(currentSource) : [];
        const matches = current.filter(button => button.textContent.trim() === picker.value);
        if (matches.length === 1 && !matches[0].disabled) matches[0].click();
        schedule();
      });
    }
    // A hidden quick-switch preference stays hidden; the current provider remains identifiable.
    entries = sourceButtons.map(button => ({ button, name: button.textContent.trim() }));
    const selected = sourceButtons.findIndex(button => button.getAttribute('aria-pressed') === 'true' || button.classList.contains('selected'));
    const currentName = badge.dataset.name || badge.textContent.trim();
    if (selected < 0 && currentName && !names.includes(currentName)) entries.unshift({ name: currentName });
    const nextSignature = JSON.stringify(entries.map(row => [row.name, !row.button || row.button.disabled]));
    if (signature !== nextSignature) {
      picker.replaceChildren();
      for (const entry of entries) {
        const option = document.createElement('option'); option.value = entry.name;
        option.textContent = entry.name === 'DeepSeek Harness' ? 'DSH' : entry.name;
        option.disabled = !entry.button || entry.button.disabled;
        picker.append(option);
      }
      signature = nextSignature;
    }
    const selectedValue = selected < 0 ? currentName : names[selected];
    if (picker.value !== selectedValue) picker.value = selectedValue;
    const disabled = entries.filter(row => row.button && !row.button.disabled).length < 2 && selected >= 0;
    if (picker.disabled !== disabled) picker.disabled = disabled;
    if (picker.getAttribute('aria-label') !== label()) picker.setAttribute('aria-label', label());
    if (control.parentElement !== heading) heading.append(control);
    if (badge.getAttribute('aria-hidden') !== 'true') badge.setAttribute('aria-hidden', 'true');
    addClass(dock, 'bridge-harmony-provider-dock');
    if (navigation) addClass(navigation, 'bridge-harmony-provider-nav');
    addClass(document.documentElement, active);
  };
  const schedule = () => { if (!queued) { queued = true; queueMicrotask(sync); } };
  window[key] = { sync: schedule };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed', 'data-provider', 'data-name', 'hidden', 'disabled'] });
  document.addEventListener('bridge-language', schedule);
  sync();
})();`;
