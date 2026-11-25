// Screenshot placement groups for App Store versions, read from Apple's App Asset Library reference data.
import type { AppStorePlatform, ScreenshotGroup } from "@my/store-shared";
import type { AssetReferenceData } from "./apple.js";

const PLATFORMS: Record<string, AppStorePlatform> = { IPHONE_APP_STORE: "ios", IPAD_APP_STORE: "ios", MAC_APP_STORE: "macos", TV_APP_STORE: "tvos" };

function label(platform: string, inches: string[]): string {
  const size = inches.length ? ` ${inches.join(" and ")} inch` : "";
  return platform === "IPHONE_APP_STORE" ? `iPhone${size}` : platform === "IPAD_APP_STORE" ? `iPad${size}` : platform === "MAC_APP_STORE" ? "Mac" : "Apple TV";
}

// Each iPhone, iPad, Mac and Apple TV group the APP_SCREENSHOT placement type maps, with its exact sizes and limit.
export function screenshotGroups(ref: AssetReferenceData): ScreenshotGroup[] {
  const specs = new Map((ref.imageSpecs ?? []).map((s) => [s.specId, s]));
  const mappings = ref.placementTypes?.find((t) => t.placementTypeId === "APP_SCREENSHOT")?.specMappings ?? [];
  const limits = ref.features?.find((f) => f.featureId === "APP_STORE_VERSIONS")?.placementPolicies?.find((p) => p.placementType === "APP_SCREENSHOT")?.groupLimits ?? [];
  const out: ScreenshotGroup[] = [];
  for (const g of ref.placementProfileGroups ?? []) {
    const id = g.placementProfileGroupId;
    const platform = PLATFORMS[g.platform ?? ""];
    if (!id || !platform) continue;
    const sizes = (mappings.find((m) => m.placementGroupId === id)?.specs ?? []).flatMap((specId) => {
      const d = specs.get(specId)?.dimensions;
      if (!d?.minWidth || !d.minHeight || d.minWidth !== d.maxWidth || d.minHeight !== d.maxHeight) return [];
      return [{ width: d.minWidth, height: d.minHeight, alphaAllowed: specs.get(specId)?.alphaAllowed === true }];
    });
    if (sizes.length === 0) continue;
    const inches = ref.displayClasses?.find((c) => c.displayClassId === g.displayClassId)?.screenDimensions ?? [];
    out.push({ id, label: label(g.platform!, inches), platform, displayClass: g.displayClassId ?? "DEFAULT", sizes, turnable: platform === "ios", maxCount: limits.find((l) => l.groupIds?.includes(id))?.maxCount ?? 10 });
  }
  return out;
}
