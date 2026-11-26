// Google Play: the tracks a release can go to, Play's limits on listing text, and the image rules for the store listing.
// Sources: developers.google.com/android-publisher/tracks and Play Console Help answers 9866151, 9859152, 9859348.

export const GOOGLE_PLAY_TRACKS = ["internal", "alpha", "beta", "production"] as const;
export type GooglePlayTrack = typeof GOOGLE_PLAY_TRACKS[number];
export const TRACK_LABELS: Record<GooglePlayTrack, string> = { internal: "Internal testing", alpha: "Closed testing", beta: "Open testing", production: "Production" };
// The Android Publisher API's names for the default tracks; internal testing is "qa".
export const PLAY_TRACK_IDS: Record<GooglePlayTrack, string> = { internal: "qa", alpha: "alpha", beta: "beta", production: "production" };

export const isGooglePlayTrack = (value: unknown): value is GooglePlayTrack => typeof value === "string" && (GOOGLE_PLAY_TRACKS as readonly string[]).includes(value);

export const LISTING_LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 } as const;
export const RELEASE_NOTES_MAX = 500;
// The greatest versionCode Google Play takes (developer.android.com/studio/publish/versioning).
export const MAX_VERSION_CODE = 2_100_000_000;

// An Android application ID: two or more segments, each starting with a letter.
export const isPackageName = (value: unknown): value is string => typeof value === "string" && value.length <= 150 && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value);

export type PlayImageKind = "icon" | "featureGraphic" | "phone" | "tablet";
// The Android Publisher API's AppImageType for each kind.
export const PLAY_IMAGE_TYPES: Record<PlayImageKind, string> = { icon: "icon", featureGraphic: "featureGraphic", phone: "phoneScreenshots", tablet: "tenInchScreenshots" };
export const PLAY_IMAGE_LABELS: Record<PlayImageKind, string> = { icon: "Icon", featureGraphic: "Feature graphic", phone: "Phone screenshot", tablet: "Tablet screenshot" };
export const SCREENSHOT_COUNT = { min: 2, max: 8 } as const;

export interface PlayImage {
  type: "png" | "jpeg";
  width: number;
  height: number;
  alpha: boolean;
  bytes: number;
}

// Why Google Play would refuse this image for its place on the listing, or null when it fits.
export function playImageProblem(kind: PlayImageKind, image: PlayImage): string | null {
  const { width, height } = image;
  if (kind === "icon") {
    if (image.type !== "png") return "is not a PNG, which Google Play takes for the icon";
    if (width !== 512 || height !== 512) return `is ${width} x ${height} pixels; Google Play takes a 512 x 512 icon`;
    if (image.bytes > 1024 * 1024) return "is larger than the 1024 KB Google Play takes for the icon";
    return null;
  }
  if (image.alpha) return "has transparency, which Google Play does not take here; save it without an alpha channel";
  if (kind === "featureGraphic") return width === 1024 && height === 500 ? null : `is ${width} x ${height} pixels; Google Play takes a 1024 x 500 feature graphic`;
  if (image.bytes > 8 * 1024 * 1024) return "is larger than the 8 MB Google Play takes for a screenshot";
  const [low, high] = kind === "phone" ? [320, 3840] : [1080, 7680];
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < low || long > high) return `is ${width} x ${height} pixels; each side must be between ${low} and ${high} pixels`;
  if (long > short * 2.3) return `is ${width} x ${height} pixels; the long side can be at most 2.3 times the short side`;
  return null;
}
