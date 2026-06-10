/** باقات بطاقات الهدايا — الأسعار بالدينار العراقي (IQD) تُضبط لاحقاً */

export type GiftCardRegion = 'global' | 'usa';

export type GiftCardPackage = {
  id: string;
  labelEn: string;
  labelAr: string;
  priceIqd: number; // 0 = سيُحدد لاحقاً
  region: GiftCardRegion;
};

export type GiftCardService =
  | 'playstation' | 'steam' | 'xbox' | 'cod'
  | 'razer' | 'ea' | 'lol' | 'robux' | 'freefire'
  | 'ludo' | 'valorant' | 'deltaforce' | 'minecraft'
  | 'itunes' | 'amazon' | 'ebay' | 'souq'
  | 'tiktok_coins';

/** مساعد لإنشاء باقات دولار بسرعة */
function usd(prefix: string, amounts: number[], region: GiftCardRegion): GiftCardPackage[] {
  return amounts.map((a) => ({
    id: `${prefix}-${region[0]}-${a}`,
    labelEn: `$${a}`,
    labelAr: `${a} دولار`,
    priceIqd: 0,
    region,
  }));
}
function pts(prefix: string, values: { en: string; ar: string }[], region: GiftCardRegion): GiftCardPackage[] {
  return values.map((v) => ({
    id: `${prefix}-${region[0]}-${v.en.replace(/\s/g, '')}`,
    labelEn: v.en, labelAr: v.ar, priceIqd: 0, region,
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
const cod = [
  ...pts('cod', [
    {en:'200 CP', ar:'200 نقطة'}, {en:'500 CP', ar:'500 نقطة'},
    {en:'1100 CP', ar:'1100 نقطة'}, {en:'2400 CP', ar:'2400 نقطة'}, {en:'5000 CP', ar:'5000 نقطة'},
  ], 'global'),
  ...pts('cod', [
    {en:'200 CP', ar:'200 نقطة'}, {en:'500 CP', ar:'500 نقطة'},
    {en:'1100 CP', ar:'1100 نقطة'}, {en:'2400 CP', ar:'2400 نقطة'}, {en:'5000 CP', ar:'5000 نقطة'},
  ], 'usa'),
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
const lol = [
  ...pts('lol', [
    {en:'650 RP', ar:'650 RP'}, {en:'1380 RP', ar:'1380 RP'},
    {en:'2800 RP', ar:'2800 RP'}, {en:'5600 RP', ar:'5600 RP'}, {en:'11000 RP', ar:'11000 RP'},
  ], 'global'),
  ...pts('lol', [
    {en:'650 RP', ar:'650 RP'}, {en:'1380 RP', ar:'1380 RP'},
    {en:'2800 RP', ar:'2800 RP'}, {en:'5600 RP', ar:'5600 RP'}, {en:'11000 RP', ar:'11000 RP'},
  ], 'usa'),
];

/* ── Robux (Roblox) ── */
const robux = [
  ...pts('rbx', [
    {en:'400 Robux', ar:'400 روبكس'}, {en:'800 Robux', ar:'800 روبكس'},
    {en:'1700 Robux', ar:'1700 روبكس'}, {en:'4500 Robux', ar:'4500 روبكس'}, {en:'10000 Robux', ar:'10000 روبكس'},
  ], 'global'),
  ...pts('rbx', [
    {en:'400 Robux', ar:'400 روبكس'}, {en:'800 Robux', ar:'800 روبكس'},
    {en:'1700 Robux', ar:'1700 روبكس'}, {en:'4500 Robux', ar:'4500 روبكس'}, {en:'10000 Robux', ar:'10000 روبكس'},
  ], 'usa'),
];

/* ── Free Fire ── */
const freefire = [
  ...pts('ff', [
    {en:'100 Diamonds', ar:'100 الماسة'}, {en:'310 Diamonds', ar:'310 الماسة'},
    {en:'520 Diamonds', ar:'520 الماسة'}, {en:'1060 Diamonds', ar:'1060 الماسة'},
    {en:'2180 Diamonds', ar:'2180 الماسة'},
  ], 'global'),
  ...pts('ff', [
    {en:'100 Diamonds', ar:'100 الماسة'}, {en:'310 Diamonds', ar:'310 الماسة'},
    {en:'520 Diamonds', ar:'520 الماسة'}, {en:'1060 Diamonds', ar:'1060 الماسة'},
    {en:'2180 Diamonds', ar:'2180 الماسة'},
  ], 'usa'),
];

/* ── Ludo ── */
const ludo = [
  ...usd('ld', [5, 10, 20, 50], 'global'),
  ...usd('ld', [5, 10, 20, 50], 'usa'),
];

/* ── Valorant ── */
const valorant = [
  ...pts('val', [
    {en:'475 VP', ar:'475 VP'}, {en:'1000 VP', ar:'1000 VP'},
    {en:'2050 VP', ar:'2050 VP'}, {en:'3650 VP', ar:'3650 VP'}, {en:'5350 VP', ar:'5350 VP'},
  ], 'global'),
  ...pts('val', [
    {en:'475 VP', ar:'475 VP'}, {en:'1000 VP', ar:'1000 VP'},
    {en:'2050 VP', ar:'2050 VP'}, {en:'3650 VP', ar:'3650 VP'}, {en:'5350 VP', ar:'5350 VP'},
  ], 'usa'),
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

/* ── iTunes / Apple ── */
const itunes = [
  ...usd('it', [15, 25, 50, 100], 'global'),
  ...usd('it', [15, 25, 50, 100], 'usa'),
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

/* ── TikTok Coins ── */
const tiktok_coins = [
  ...pts('tt', [
    {en:'70 Coins', ar:'70 كوين'}, {en:'350 Coins', ar:'350 كوين'},
    {en:'700 Coins', ar:'700 كوين'}, {en:'1400 Coins', ar:'1400 كوين'},
    {en:'3500 Coins', ar:'3500 كوين'}, {en:'7000 Coins', ar:'7000 كوين'},
  ], 'global'),
  ...pts('tt', [
    {en:'70 Coins', ar:'70 كوين'}, {en:'350 Coins', ar:'350 كوين'},
    {en:'700 Coins', ar:'700 كوين'}, {en:'1400 Coins', ar:'1400 كوين'},
    {en:'3500 Coins', ar:'3500 كوين'}, {en:'7000 Coins', ar:'7000 كوين'},
  ], 'usa'),
];

export const GIFT_CARD_PACKAGES: Record<GiftCardService, GiftCardPackage[]> = {
  playstation: ps, steam, xbox, cod,
  razer, ea, lol, robux, freefire,
  ludo, valorant, deltaforce, minecraft,
  itunes, amazon, ebay, souq, tiktok_coins,
};

export function getPackages(service: GiftCardService, region: GiftCardRegion): GiftCardPackage[] {
  return (GIFT_CARD_PACKAGES[service] ?? []).filter((p) => p.region === region);
}
