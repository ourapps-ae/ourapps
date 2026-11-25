// App Store review: the answers Apple asks for once per app, and the screenshot sizes it takes per platform.

export type AppStorePlatform = "ios" | "macos" | "tvos";

// Top-level App Store categories (Apple's appCategories ids) that apply to iPhone, Mac and Apple TV.
export const APP_STORE_CATEGORIES: Record<string, string> = {
  BUSINESS: "Business",
  EDUCATION: "Education",
  ENTERTAINMENT: "Entertainment",
  FINANCE: "Finance",
  FOOD_AND_DRINK: "Food and drink",
  GAMES: "Games",
  HEALTH_AND_FITNESS: "Health and fitness",
  LIFESTYLE: "Lifestyle",
  MEDICAL: "Medical",
  MUSIC: "Music",
  NAVIGATION: "Navigation",
  NEWS: "News",
  PHOTO_AND_VIDEO: "Photo and video",
  PRODUCTIVITY: "Productivity",
  REFERENCE: "Reference",
  SHOPPING: "Shopping",
  SOCIAL_NETWORKING: "Social networking",
  SPORTS: "Sports",
  TRAVEL: "Travel",
  UTILITIES: "Utilities",
  WEATHER: "Weather",
  BOOKS: "Books",
  DEVELOPER_TOOLS: "Developer tools",
  GRAPHICS_AND_DESIGN: "Graphics and design",
  MAGAZINES_AND_NEWSPAPERS: "Magazines and newspapers",
};

// Age rating questions answered with how often the app shows it (Apple's ageRatingDeclarations).
export const AGE_RATING_LEVELS = ["NONE", "INFREQUENT", "FREQUENT"] as const;
export type AgeRatingLevel = typeof AGE_RATING_LEVELS[number];
export const AGE_RATING_LEVEL_LABELS: Record<AgeRatingLevel, string> = { NONE: "None", INFREQUENT: "Now and then", FREQUENT: "Often" };

export const AGE_RATING_FREQUENCY: Record<string, string> = {
  violenceCartoonOrFantasy: "Cartoon or fantasy violence",
  violenceRealistic: "Realistic violence",
  violenceRealisticProlongedGraphicOrSadistic: "Prolonged, graphic or sadistic realistic violence",
  gunsOrOtherWeapons: "Guns or other weapons",
  profanityOrCrudeHumor: "Swearing or crude humour",
  matureOrSuggestiveThemes: "Mature or suggestive themes",
  horrorOrFearThemes: "Horror or fear themes",
  sexualContentOrNudity: "Sexual content or nudity",
  sexualContentGraphicAndNudity: "Graphic sexual content and nudity",
  alcoholTobaccoOrDrugUseOrReferences: "Alcohol, tobacco or drug use or references",
  medicalOrTreatmentInformation: "Medical or treatment information",
  gamblingSimulated: "Simulated gambling",
  contests: "Contests",
};

// Age rating questions answered yes or no.
export const AGE_RATING_YES_NO: Record<string, string> = {
  gambling: "Gambling with real money",
  lootBox: "Loot boxes or other random paid items",
  advertising: "Advertising",
  messagingAndChat: "Messaging or chat between people",
  userGeneratedContent: "Content people create and share with others",
  socialMedia: "Social media features",
  sharedLocation: "Sharing a person's location with others",
  datingAndRelationships: "Dating or relationships",
  unrestrictedWebAccess: "Unrestricted web access, such as a built-in browser",
  healthOrWellnessTopics: "Health or wellness topics",
  parentalControls: "Parental controls",
  ageAssurance: "Checks of a person's age",
};

export type AgeRatingAnswers = Record<string, AgeRatingLevel | boolean>;

// Every question answered: None or No unless the developer said otherwise.
export function ageRatingAnswers(input: Partial<AgeRatingAnswers> = {}): AgeRatingAnswers {
  const out: AgeRatingAnswers = {};
  for (const key of Object.keys(AGE_RATING_FREQUENCY)) out[key] = AGE_RATING_LEVELS.includes(input[key] as AgeRatingLevel) ? input[key] as AgeRatingLevel : "NONE";
  for (const key of Object.keys(AGE_RATING_YES_NO)) out[key] = input[key] === true;
  return out;
}

// What a default privacy policy says the app collects, and where it is kept.
export const POLICY_COLLECTS: Record<string, string> = {
  nothing: "Nothing",
  names: "Names people type into the app",
  content: "Content people create in the app",
  calls: "The camera and microphone, during calls",
};
export const POLICY_STORAGE: Record<string, string> = {
  device: "On the person's own device",
  servers: "On the developer's own servers",
};

// A placement group App Store screenshots go in: Apple's identifier for a family of devices, and the pixel sizes it takes.
// Apple's reference data supplies them at run time; the fallback table is used only when it cannot be read.
export interface ScreenshotGroup {
  id: string;
  label: string;
  platform: AppStorePlatform;
  displayClass: string;
  sizes: { width: number; height: number; alphaAllowed: boolean }[];
  // iPhone and iPad sizes count either way up; Mac and Apple TV sizes only as given.
  turnable: boolean;
  maxCount: number;
}

const size = (width: number, height: number, alphaAllowed = false) => ({ width, height, alphaAllowed });

export const FALLBACK_SCREENSHOT_GROUPS: ScreenshotGroup[] = [
  { id: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", label: "iPhone 6.9 inch", platform: "ios", displayClass: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY", sizes: [size(1320, 2868), size(1290, 2796), size(1260, 2736)], turnable: true, maxCount: 10 },
  { id: "IPHONE_FACE_ID_LARGE_PROFILE", label: "iPhone 6.5 inch", platform: "ios", displayClass: "IPHONE_FACE_ID_LARGE_DISPLAY", sizes: [size(1284, 2778), size(1242, 2688)], turnable: true, maxCount: 10 },
  { id: "IPAD_13_PROFILE", label: "iPad 13 inch", platform: "ios", displayClass: "IPAD_13_DISPLAY", sizes: [size(2064, 2752), size(2048, 2732)], turnable: true, maxCount: 10 },
  { id: "MAC_PROFILE", label: "Mac", platform: "macos", displayClass: "DEFAULT", sizes: [size(2880, 1800, true), size(2560, 1600, true), size(1440, 900, true), size(1280, 800, true)], turnable: false, maxCount: 10 },
  { id: "APPLE_TV_PROFILE", label: "Apple TV", platform: "tvos", displayClass: "DEFAULT", sizes: [size(3840, 2160, true), size(1920, 1080, true)], turnable: false, maxCount: 10 },
];

export const sizeText = (g: ScreenshotGroup) => g.sizes.map((s) => `${s.width} x ${s.height}`).join(", ");

// The group a screenshot of these pixel sizes belongs to on this platform, or null when Apple takes no such size.
export function groupFor(groups: ScreenshotGroup[], platform: AppStorePlatform, width: number, height: number): { group: ScreenshotGroup; alphaAllowed: boolean } | null {
  for (const group of groups) {
    if (group.platform !== platform) continue;
    const found = group.sizes.find((s) => (s.width === width && s.height === height) || (group.turnable && s.width === height && s.height === width));
    if (found) return { group, alphaAllowed: found.alphaAllowed };
  }
  return null;
}

// Apple's required screenshots: iPhone 6.9 inch (6.5 inch in its place), iPad 13 inch when the app runs on iPad, Mac, Apple TV.
// Each entry is met by a screenshot in any of its groups.
export function requiredScreenshots(groups: ScreenshotGroup[], platform: AppStorePlatform, runsOnIpad: boolean): { label: string; groups: string[] }[] {
  const of = (test: (g: ScreenshotGroup) => boolean) => groups.filter((g) => g.platform === platform && test(g)).map((g) => g.id);
  if (platform === "macos") return [{ label: "Mac", groups: of(() => true) }];
  if (platform === "tvos") return [{ label: "Apple TV", groups: of(() => true) }];
  const iphone = ["IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY", "IPHONE_FACE_ID_LARGE_DISPLAY"];
  return [
    { label: "iPhone 6.9 inch", groups: of((g) => iphone.includes(g.displayClass)).sort((a, b) => iphone.indexOf(groups.find((g) => g.id === a)!.displayClass) - iphone.indexOf(groups.find((g) => g.id === b)!.displayClass)) },
    ...(runsOnIpad ? [{ label: "iPad 13 inch", groups: of((g) => g.displayClass === "IPAD_13_DISPLAY") }] : []),
  ];
}
