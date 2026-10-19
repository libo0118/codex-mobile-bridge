function bounded(value: number, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.round(value))) : fallback;
}

export class NavigationAppearance {
  system: boolean = true;
  blur: number = 100;
  thickness: number = 1;

  constructor(system: boolean = true, blur: number = 100, thickness: number = 1) {
    this.system = typeof system === 'boolean' ? system : true;
    this.blur = bounded(blur, 100, 100);
    this.thickness = bounded(thickness, 1, 4);
  }
}

export function decodeNavigationAppearance(value: string): NavigationAppearance {
  if (value.length > 256) return new NavigationAppearance();
  try {
    const saved = JSON.parse(value) as NavigationAppearance;
    if (!saved || typeof saved !== 'object') return new NavigationAppearance();
    return new NavigationAppearance(saved.system, saved.blur, saved.thickness);
  } catch (_) { return new NavigationAppearance(); }
}
