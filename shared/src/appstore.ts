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

// Apple's screenshot display types ourapps fills, with the pixel sizes Apple takes for each (portrait; landscape is the same turned).
export interface DisplayType {
  id: string;
  label: string;
  platform: AppStorePlatform;
  sizes: [number, number][];
  // Upright sizes only, as for Mac and Apple TV.
  fixed?: boolean;
}

export const DISPLAY_TYPES: DisplayType[] = [
  { id: "APP_IPHONE_67", label: "iPhone 6.9 inch", platform: "ios", sizes: [[1320, 2868], [1290, 2796], [1260, 2736]] },
  { id: "APP_IPHONE_65", label: "iPhone 6.5 inch", platform: "ios", sizes: [[1284, 2778], [1242, 2688]] },
  { id: "APP_IPAD_PRO_3GEN_129", label: "iPad 13 inch", platform: "ios", sizes: [[2064, 2752], [2048, 2732]] },
  { id: "APP_DESKTOP", label: "Mac", platform: "macos", sizes: [[2880, 1800], [2560, 1600], [1440, 900], [1280, 800]], fixed: true },
  { id: "APP_APPLE_TV", label: "Apple TV", platform: "tvos", sizes: [[3840, 2160], [1920, 1080]], fixed: true },
];

export const sizeText = (t: DisplayType) => t.sizes.map(([w, h]) => `${w} x ${h}`).join(", ");

// The display type a screenshot of these pixel sizes belongs to on this platform, or null when Apple takes no such size.
export function displayTypeFor(platform: AppStorePlatform, width: number, height: number): DisplayType | null {
  return DISPLAY_TYPES.find((t) => t.platform === platform && t.sizes.some(([w, h]) => (w === width && h === height) || (!t.fixed && w === height && h === width))) ?? null;
}

// Each entry is satisfied by a screenshot in any of its display types. iPhone takes 6.9 inch, or 6.5 inch in its place.
export function requiredDisplayTypes(platform: AppStorePlatform, runsOnIpad: boolean): { label: string; types: string[] }[] {
  if (platform === "macos") return [{ label: "Mac", types: ["APP_DESKTOP"] }];
  if (platform === "tvos") return [{ label: "Apple TV", types: ["APP_APPLE_TV"] }];
  return [{ label: "iPhone 6.9 inch", types: ["APP_IPHONE_67", "APP_IPHONE_65"] }, ...(runsOnIpad ? [{ label: "iPad 13 inch", types: ["APP_IPAD_PRO_3GEN_129"] }] : [])];
}
