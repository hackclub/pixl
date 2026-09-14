export const SHOP_REGIONS = [
  "US",
  "ASIA",
  "NORTH_AMERICA",
  "SOUTH_AMERICA",
  "EUROPE",
  "INDIA",
  "AFRICA",
  "BANGLADESH",
] as const;
export type ShopRegion = (typeof SHOP_REGIONS)[number];
export const SHOP_REGION_LABELS: Record<ShopRegion, string> = {
  US: "US",
  ASIA: "Asia",
  NORTH_AMERICA: "North America",
  SOUTH_AMERICA: "South America",
  EUROPE: "Europe",
  INDIA: "India",
  AFRICA: "Africa",
  BANGLADESH: "Bangladesh",
};
