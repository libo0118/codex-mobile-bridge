import { uiMaterial } from '@kit.ArkUI';
import { SystemGlassAdapter } from './NavigationMaterial';

// Imported only after the OS API version check; importing this eagerly breaks older systems.
class ImmersiveGlass implements SystemGlassAdapter {
  apply(target: RowAttribute, thickness: number): void {
    let style: uiMaterial.ImmersiveStyle = uiMaterial.ImmersiveStyle.THIN;
    if (thickness === 0) style = uiMaterial.ImmersiveStyle.ULTRA_THIN;
    else if (thickness === 2) style = uiMaterial.ImmersiveStyle.REGULAR;
    else if (thickness === 3) style = uiMaterial.ImmersiveStyle.THICK;
    else if (thickness === 4) style = uiMaterial.ImmersiveStyle.ULTRA_THICK;
    target.systemMaterial(new uiMaterial.ImmersiveMaterial({ style: style, applyShadow: false }));
  }

  clear(target: RowAttribute): void { target.systemMaterial(uiMaterial.Material.empty); }
}

export function createSystemGlass(): SystemGlassAdapter | undefined {
  return uiMaterial.isImmersiveMaterialSupported() ? new ImmersiveGlass() : undefined;
}
