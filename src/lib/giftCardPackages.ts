/** باقات بطاقات الهدايا — الأسعار بالدينار العراقي (IQD) تُضبط لاحقاً */

export type GiftCardRegion = 'global' | 'usa';

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

/** سعر افتراضي تقديري للدولار الواحد بالدينار (مع هامش بطاقات رقمية) */
const USD_TO_IQD = 1700;

/** مساعد لإنشاء باقات دولار بسرعة — السعر افتراضي قابل للتعديل من لوحة الأدمن */
function usd(prefix: string, amounts: number[], region: GiftCardRegion): GiftCardPackage[] {
  return amounts.map((a) => ({
    id: `${prefix}-${region[0]}-${a}`,
    labelEn: `$${a}`,
    labelAr: `${a} دولار`,
    priceIqd: a * USD_TO_IQD,
    region,
  }));
}
function pts(prefix: string, values: { en: string; ar: string; priceIqd: number }[], region: GiftCardRegion): GiftCardPackage[] {
  return values.map((v) => ({
    id: `${prefix}-${region[0]}-${v.en.replace(/\s/g, '')}`,
    labelEn: v.en, labelAr: v.ar, priceIqd: v.priceIqd, region,
  }));
}

/* ── PlayStation ── */
const ps = [
  ...usd('ps', [5, 10, 20, 25, 50, 100], 'global'),
  ...usd('ps', [10, 20, 25, 50, 100], 'usa'),
];

/* ── Steam ── */
const steam = [
  ...usd('st', [5, 10, 20, 50, 100], 'global'),
  ...usd('st', [5, 10, 20, 50, 100], 'usa'),
];

/* ── Xbox ── */
const xbox = [
  ...usd('xb', [5, 10, 15, 25, 50, 100], 'global'),
  ...usd('xb', [10, 15, 25, 50, 100], 'usa'),
];

/* ── Call of Duty ── */
const codTiers = [
  {en:'200 CP',  ar:'200 نقطة',  priceIqd: 3500},
  {en:'500 CP',  ar:'500 نقطة',  priceIqd: 8500},
  {en:'1100 CP', ar:'1100 نقطة', priceIqd: 17500},
  {en:'2400 CP', ar:'2400 نقطة', priceIqd: 36000},
  {en:'5000 CP', ar:'5000 نقطة', priceIqd: 72000},
];
const cod = [
  ...pts('cod', codTiers, 'global'),
  ...pts('cod', codTiers, 'usa'),
];

/* ── Razer Gold ── */
const razer = [
  ...usd('rz', [5, 10, 20, 50, 100], 'global'),
  ...usd('rz', [5, 10, 20, 50, 100], 'usa'),
];

/* ── EA ── */
const ea = [
  ...usd('ea', [10, 25, 50, 100], 'global'),
  ...usd('ea', [10, 25, 50, 100], 'usa'),
];

/* ── League of Legends ── */
const lolTiers = [
  {en:'650 RP',   ar:'650 RP',   priceIqd: 5500},
  {en:'1380 RP',  ar:'1380 RP',  priceIqd: 11500},
  {en:'2800 RP',  ar:'2800 RP',  priceIqd: 23000},
  {en:'5600 RP',  ar:'5600 RP',  priceIqd: 45000},
  {en:'11000 RP', ar:'11000 RP', priceIqd: 88000},
];
const lol = [
  ...pts('lol', lolTiers, 'global'),
  ...pts('lol', lolTiers, 'usa'),
];

/* ── Robux (Roblox) ── */
const robuxTiers = [
  {en:'400 Robux',   ar:'400 روبكس',   priceIqd: 5500},
  {en:'800 Robux',   ar:'800 روبكس',   priceIqd: 10500},
  {en:'1700 Robux',  ar:'1700 روبكس',  priceIqd: 21000},
  {en:'4500 Robux',  ar:'4500 روبكس',  priceIqd: 56000},
  {en:'10000 Robux', ar:'10000 روبكس', priceIqd: 120000},
];
const robux = [
  ...pts('rbx', robuxTiers, 'global'),
  ...pts('rbx', robuxTiers, 'usa'),
];

/* ── Free Fire ── */
const freefireTiers = [
  {en:'100 Diamonds',  ar:'100 ألماسة',  priceIqd: 1500},
  {en:'310 Diamonds',  ar:'310 ألماسة',  priceIqd: 4500},
  {en:'520 Diamonds',  ar:'520 ألماسة',  priceIqd: 7500},
  {en:'1060 Diamonds', ar:'1060 ألماسة', priceIqd: 15000},
  {en:'2180 Diamonds', ar:'2180 ألماسة', priceIqd: 30000},
];
const freefire = [
  ...pts('ff', freefireTiers, 'global'),
  ...pts('ff', freefireTiers, 'usa'),
];

/* ── Ludo ── */
const ludo = [
  ...usd('ld', [5, 10, 20, 50], 'global'),
  ...usd('ld', [5, 10, 20, 50], 'usa'),
];

/* ── Valorant ── */
const valorantTiers = [
  {en:'475 VP',  ar:'475 VP',  priceIqd: 5500},
  {en:'1000 VP', ar:'1000 VP', priceIqd: 11000},
  {en:'2050 VP', ar:'2050 VP', priceIqd: 22000},
  {en:'3650 VP', ar:'3650 VP', priceIqd: 38000},
  {en:'5350 VP', ar:'5350 VP', priceIqd: 56000},
];
const valorant = [
  ...pts('val', valorantTiers, 'global'),
  ...pts('val', valorantTiers, 'usa'),
];

/* ── Delta Force ── */
const deltaforce = [
  ...usd('df', [5, 10, 20, 50, 100], 'global'),
  ...usd('df', [5, 10, 20, 50, 100], 'usa'),
];

/* ── Minecraft ── */
const minecraft = [
  ...usd('mc', [10, 20, 50], 'global'),
  ...usd('mc', [10, 20, 50], 'usa'),
];

/* ── iTunes / Apple Gift Card ── */
const itunes = [
  ...usd('it', [10, 15, 25, 50, 100], 'global'),
  ...usd('it', [10, 15, 25, 50, 100], 'usa'),
];

/* ── Amazon ── */
const amazon = [
  ...usd('amz', [10, 25, 50, 100], 'global'),
  ...usd('amz', [10, 25, 50, 100], 'usa'),
];

/* ── eBay ── */
const ebay = [
  ...usd('eb', [25, 50, 100, 200], 'global'),
  ...usd('eb', [25, 50, 100, 200], 'usa'),
];

/* ── سوق المفتوح ── */
const souq = [
  ...usd('sq', [5, 10, 25, 50, 100], 'global'),
  ...usd('sq', [5, 10, 25, 50, 100], 'usa'),
];

/* ── IPTV ── */
const iptvTiers = [
  {en:'1 Month',   ar:'شهر',     priceIqd: 15000},
  {en:'3 Months',  ar:'3 شهور',  priceIqd: 40000},
  {en:'6 Months',  ar:'6 شهور',  priceIqd: 75000},
  {en:'12 Months', ar:'سنة',     priceIqd: 140000},
];
const iptv = pts('iptv', iptvTiers, 'global');

/* ── ChatGPT Plus ── */
const chatgptTiers = [
  {en:'1 Month',   ar:'شهر',  priceIqd: 30000},
  {en:'3 Months',  ar:'3 شهور', priceIqd: 88000},
  {en:'12 Months', ar:'سنة',   priceIqd: 320000},
];
const chatgpt = pts('cgpt', chatgptTiers, 'global');

/* ── Canva Pro ── */
const canvaTiers = [
  {en:'1 Month',   ar:'شهر', priceIqd: 18000},
  {en:'6 Months',  ar:'6 شهور', priceIqd: 95000},
  {en:'12 Months', ar:'سنة',  priceIqd: 165000},
];
const canva = pts('canva', canvaTiers, 'global');

/* ── Netflix ── */
const netflixTiers = [
  {en:'1 Month',   ar:'شهر',    priceIqd: 12000},
  {en:'3 Months',  ar:'3 شهور', priceIqd: 33000},
  {en:'6 Months',  ar:'6 شهور', priceIqd: 65000},
  {en:'12 Months', ar:'سنة',    priceIqd: 120000},
];
const netflix = pts('nflx', netflixTiers, 'global');

/* ── TikTok Coins ── */
const tiktokTiers = [
  {en:'70 Coins',   ar:'70 كوين',   priceIqd: 1500},
  {en:'350 Coins',  ar:'350 كوين',  priceIqd: 7000},
  {en:'700 Coins',  ar:'700 كوين',  priceIqd: 14000},
  {en:'1400 Coins', ar:'1400 كوين', priceIqd: 28000},
  {en:'3500 Coins', ar:'3500 كوين', priceIqd: 70000},
  {en:'7000 Coins', ar:'7000 كوين', priceIqd: 140000},
];
const tiktok_coins = [
  ...pts('tt', tiktokTiers, 'global'),
  ...pts('tt', tiktokTiers, 'usa'),
];

export const GIFT_CARD_PACKAGES: Record<GiftCardService, GiftCardPackage[]> = {
  playstation: ps, steam, xbox, cod,
  razer, ea, lol, robux, freefire,
  ludo, valorant, deltaforce, minecraft,
  itunes, amazon, ebay, souq, tiktok_coins,
  iptv, chatgpt, canva, netflix,
};

export function getPackages(service: GiftCardService, region: GiftCardRegion): GiftCardPackage[] {
  return (GIFT_CARD_PACKAGES[service] ?? []).filter((p) => p.region === region);
}
