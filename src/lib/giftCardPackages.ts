/** باقات بطاقات الهدايا — الأسعار بالدينار العراقي (IQD) تُضبط لاحقاً */

/** مناطق / دول المنتج */
export type GiftCardRegion = 'global' | 'usa' | 'uae' | 'turkey';

export const GIFT_CARD_REGIONS: {
  id: GiftCardRegion;
  ar: string;
  en: string;
  flag: string;
}[] = [
  { id: 'global', ar: 'عالمي', en: 'Global', flag: '🌍' },
  { id: 'usa', ar: 'أمريكي', en: 'USA', flag: '🇺🇸' },
  { id: 'uae', ar: 'إماراتي', en: 'UAE', flag: '🇦🇪' },
  { id: 'turkey', ar: 'تركي', en: 'Turkey', flag: '🇹🇷' },
];

/** كل المناطق لبناء الباقات */
export const ALL_GIFT_CARD_REGIONS: GiftCardRegion[] = ['global', 'usa', 'uae', 'turkey'];

export type GiftCardPackage = {
  id: string;
  labelEn: string;
  labelAr: string;
  priceIqd: number; // 0 = سيُحدد لاحقاً
  region: GiftCardRegion;
  originalPriceIqd?: number;
};

export type GiftCardService =
  | 'playstation' | 'steam' | 'xbox' | 'cod'
  | 'razer' | 'ea' | 'lol' | 'robux' | 'freefire'
  | 'ludo' | 'valorant' | 'deltaforce' | 'minecraft'
  | 'itunes' | 'amazon' | 'ebay' | 'souq'
  | 'tiktok_coins'
  | 'iptv' | 'chatgpt' | 'canva' | 'netflix';

/** رمز قصير فريد لكل ريجن (لتفادي تعارض uae/usa) */
function regionCode(region: GiftCardRegion): string {
  switch (region) {
    case 'global':
      return 'g';
    case 'usa':
      return 'us';
    case 'uae':
      return 'ae';
    case 'turkey':
      return 'tr';
  }
}

/** سعر افتراضي تقديري للدولار الواحد بالدينار (مع هامش بطاقات رقمية) */
const USD_TO_IQD = 1700;

/** مساعد لإنشاء باقات دولار بسرعة — السعر افتراضي قابل للتعديل من لوحة الأدمن */
function usd(prefix: string, amounts: number[], region: GiftCardRegion): GiftCardPackage[] {
  const rc = regionCode(region);
  return amounts.map((a) => ({
    id: `${prefix}-${rc}-${a}`,
    labelEn: `$${a}`,
    labelAr: `${a} دولار`,
    priceIqd: a * USD_TO_IQD,
    region,
  }));
}

function pts(
  prefix: string,
  values: { en: string; ar: string; priceIqd: number }[],
  region: GiftCardRegion,
): GiftCardPackage[] {
  const rc = regionCode(region);
  return values.map((v) => ({
    id: `${prefix}-${rc}-${v.en.replace(/\s/g, '')}`,
    labelEn: v.en,
    labelAr: v.ar,
    priceIqd: v.priceIqd,
    region,
  }));
}

/** يكرّر الباقات على كل المناطق (عالمي / أمريكي / إماراتي / تركي) */
function forRegions(
  build: (region: GiftCardRegion) => GiftCardPackage[],
): GiftCardPackage[] {
  return ALL_GIFT_CARD_REGIONS.flatMap(build);
}

/* ── PlayStation ── */
const ps = forRegions((r) =>
  r === 'usa'
    ? usd('ps', [10, 20, 25, 50, 100], r)
    : usd('ps', [5, 10, 20, 25, 50, 100], r),
);

/* ── Steam ── */
const steam = forRegions((r) => usd('st', [5, 10, 20, 50, 100], r));

/* ── Xbox ── */
const xbox = forRegions((r) =>
  r === 'usa'
    ? usd('xb', [10, 15, 25, 50, 100], r)
    : usd('xb', [5, 10, 15, 25, 50, 100], r),
);

/* ── Call of Duty ── */
const codTiers = [
  { en: '200 CP', ar: '200 نقطة', priceIqd: 3500 },
  { en: '500 CP', ar: '500 نقطة', priceIqd: 8500 },
  { en: '1100 CP', ar: '1100 نقطة', priceIqd: 17500 },
  { en: '2400 CP', ar: '2400 نقطة', priceIqd: 36000 },
  { en: '5000 CP', ar: '5000 نقطة', priceIqd: 72000 },
];
const cod = forRegions((r) => pts('cod', codTiers, r));

/* ── Razer Gold ── */
const razer = forRegions((r) => usd('rz', [5, 10, 20, 50, 100], r));

/* ── EA ── */
const ea = forRegions((r) => usd('ea', [10, 25, 50, 100], r));

/* ── League of Legends ── */
const lolTiers = [
  { en: '650 RP', ar: '650 RP', priceIqd: 5500 },
  { en: '1380 RP', ar: '1380 RP', priceIqd: 11500 },
  { en: '2800 RP', ar: '2800 RP', priceIqd: 23000 },
  { en: '5600 RP', ar: '5600 RP', priceIqd: 45000 },
  { en: '11000 RP', ar: '11000 RP', priceIqd: 88000 },
];
const lol = forRegions((r) => pts('lol', lolTiers, r));

/* ── Robux (Roblox) ── */
const robuxTiers = [
  { en: '400 Robux', ar: '400 روبكس', priceIqd: 5500 },
  { en: '800 Robux', ar: '800 روبكس', priceIqd: 10500 },
  { en: '1700 Robux', ar: '1700 روبكس', priceIqd: 21000 },
  { en: '4500 Robux', ar: '4500 روبكس', priceIqd: 56000 },
  { en: '10000 Robux', ar: '10000 روبكس', priceIqd: 120000 },
];
const robux = forRegions((r) => pts('rbx', robuxTiers, r));

/* ── Free Fire ── */
const freefireTiers = [
  { en: '100 Diamonds', ar: '100 ألماسة', priceIqd: 1500 },
  { en: '310 Diamonds', ar: '310 ألماسة', priceIqd: 4500 },
  { en: '520 Diamonds', ar: '520 ألماسة', priceIqd: 7500 },
  { en: '1060 Diamonds', ar: '1060 ألماسة', priceIqd: 15000 },
  { en: '2180 Diamonds', ar: '2180 ألماسة', priceIqd: 30000 },
];
const freefire = forRegions((r) => pts('ff', freefireTiers, r));

/* ── Ludo ── */
const ludo = forRegions((r) => usd('ld', [5, 10, 20, 50], r));

/* ── Valorant ── */
const valorantTiers = [
  { en: '475 VP', ar: '475 VP', priceIqd: 5500 },
  { en: '1000 VP', ar: '1000 VP', priceIqd: 11000 },
  { en: '2050 VP', ar: '2050 VP', priceIqd: 22000 },
  { en: '3650 VP', ar: '3650 VP', priceIqd: 38000 },
  { en: '5350 VP', ar: '5350 VP', priceIqd: 56000 },
];
const valorant = forRegions((r) => pts('val', valorantTiers, r));

/* ── Delta Force ── */
const deltaforce = forRegions((r) => usd('df', [5, 10, 20, 50, 100], r));

/* ── Minecraft ── */
const minecraft = forRegions((r) => usd('mc', [10, 20, 50], r));

/* ── iTunes / Apple Gift Card ── */
const itunes = forRegions((r) => usd('it', [10, 15, 25, 50, 100], r));

/* ── Amazon ── */
const amazon = forRegions((r) => usd('amz', [10, 25, 50, 100], r));

/* ── eBay ── */
const ebay = forRegions((r) => usd('eb', [25, 50, 100, 200], r));

/* ── سوق المفتوح ── */
const souq = forRegions((r) => usd('sq', [5, 10, 25, 50, 100], r));

/* ── IPTV ── */
const iptvTiers = [
  { en: '1 Month', ar: 'شهر', priceIqd: 15000 },
  { en: '3 Months', ar: '3 شهور', priceIqd: 40000 },
  { en: '6 Months', ar: '6 شهور', priceIqd: 75000 },
  { en: '12 Months', ar: 'سنة', priceIqd: 140000 },
];
const iptv = forRegions((r) => pts('iptv', iptvTiers, r));

/* ── ChatGPT Plus ── */
const chatgptTiers = [
  { en: '1 Month', ar: 'شهر', priceIqd: 30000 },
  { en: '3 Months', ar: '3 شهور', priceIqd: 88000 },
  { en: '12 Months', ar: 'سنة', priceIqd: 320000 },
];
const chatgpt = forRegions((r) => pts('cgpt', chatgptTiers, r));

/* ── Canva Pro ── */
const canvaTiers = [
  { en: '1 Month', ar: 'شهر', priceIqd: 18000 },
  { en: '6 Months', ar: '6 شهور', priceIqd: 95000 },
  { en: '12 Months', ar: 'سنة', priceIqd: 165000 },
];
const canva = forRegions((r) => pts('canva', canvaTiers, r));

/* ── Netflix ── */
const netflixTiers = [
  { en: '1 Month', ar: 'شهر', priceIqd: 12000 },
  { en: '3 Months', ar: '3 شهور', priceIqd: 33000 },
  { en: '6 Months', ar: '6 شهور', priceIqd: 65000 },
  { en: '12 Months', ar: 'سنة', priceIqd: 120000 },
];
const netflix = forRegions((r) => pts('nflx', netflixTiers, r));

/* ── TikTok Coins ── */
const tiktokTiers = [
  { en: '70 Coins', ar: '70 كوين', priceIqd: 1500 },
  { en: '350 Coins', ar: '350 كوين', priceIqd: 7000 },
  { en: '700 Coins', ar: '700 كوين', priceIqd: 14000 },
  { en: '1400 Coins', ar: '1400 كوين', priceIqd: 28000 },
  { en: '3500 Coins', ar: '3500 كوين', priceIqd: 70000 },
  { en: '7000 Coins', ar: '7000 كوين', priceIqd: 140000 },
];
const tiktok_coins = forRegions((r) => pts('tt', tiktokTiers, r));

export const GIFT_CARD_PACKAGES: Record<GiftCardService, GiftCardPackage[]> = {
  playstation: ps,
  steam,
  xbox,
  cod,
  razer,
  ea,
  lol,
  robux,
  freefire,
  ludo,
  valorant,
  deltaforce,
  minecraft,
  itunes,
  amazon,
  ebay,
  souq,
  tiktok_coins,
  iptv,
  chatgpt,
  canva,
  netflix,
};

export function getPackages(service: GiftCardService, region: GiftCardRegion): GiftCardPackage[] {
  return (GIFT_CARD_PACKAGES[service] ?? []).filter((p) => p.region === region);
}

export function regionLabel(region: GiftCardRegion, lang: 'ar' | 'en'): string {
  const row = GIFT_CARD_REGIONS.find((r) => r.id === region);
  if (!row) return region;
  return lang === 'ar' ? `${row.flag} ${row.ar}` : `${row.flag} ${row.en}`;
}
