// This module must stay loadable on API 14: the API 26 implementation is lazy-loaded.
export interface SystemGlassAdapter {
  apply(target: RowAttribute, thickness: number): void;
  clear(target: RowAttribute): void;
}

export interface SystemGlassModule {
  createSystemGlass(): SystemGlassAdapter | undefined;
}

export async function detectSystemGlass(apiVersion: number, loader: () => Promise<SystemGlassModule>): Promise<SystemGlassAdapter | undefined> {
  if (!Number.isFinite(apiVersion) || apiVersion < 26) return undefined;
  try { return (await loader()).createSystemGlass(); } catch (_) { return undefined; }
}

export class NavigationMaterial implements AttributeModifier<RowAttribute> {
  private blur: number;
  private system: boolean;
  private thickness: number;
  private adapter?: SystemGlassAdapter;

  constructor(blur: number, system: boolean, thickness: number, adapter?: SystemGlassAdapter) {
    this.blur = Number.isFinite(blur) ? Math.max(0, Math.min(100, blur)) : 100;
    this.system = system;
    this.thickness = thickness;
    this.adapter = adapter;
  }

  applyNormalAttribute(target: RowAttribute): void {
    if (this.system && this.adapter) {
      try {
        target.backgroundBlurStyle(BlurStyle.NONE);
        this.adapter.apply(target, this.thickness);
        return;
      } catch (_) { /* A device-side material error must leave the basic navigation usable. */ }
    }
    if (this.adapter) { try { this.adapter.clear(target); } catch (_) {} }
    target.backgroundBlurStyle(BlurStyle.COMPONENT_REGULAR, { colorMode: ThemeColorMode.LIGHT, scale: this.blur / 100,
      policy: BlurStyleActivePolicy.FOLLOWS_WINDOW_ACTIVE_STATE, inactiveColor: '#F2F5F8' });
    target.border({ width: 1, color: '#E6FFFFFF' });
    target.shadow({ radius: 20, color: '#1A203047', offsetX: 0, offsetY: 7 });
  }
}
