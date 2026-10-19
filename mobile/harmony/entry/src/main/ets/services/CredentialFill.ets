/** The caller verifies native origin and path scope immediately before running this. */
export function credentialFillScript(username: string, secret: string, current: string): string {
  return `(() => {
    if (window !== top || location.href !== ${JSON.stringify(current)}) return 'changed';
    const visible = input => !input.disabled && !input.readOnly && input.getClientRects().length > 0;
    const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(visible);
    if (passwords.length !== 1) return 'ambiguous';
    const username = ${JSON.stringify(username)}, secret = ${JSON.stringify(secret)};
    const users = Array.from(document.querySelectorAll('input[autocomplete="username"], input[type="email"], input[name="username"], input[name="email"], input[name="user"]')).filter(visible);
    if (username && users.length > 1) return 'ambiguous';
    const fill = (input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (username && users.length === 1) fill(users[0], username);
    fill(passwords[0], secret); return 'filled';
  })()`;
}
