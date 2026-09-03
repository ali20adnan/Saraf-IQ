/** أيقونات UC حسب المستوى — ضع level2 / level3 في public/icons عند توفرها */
export const PUBG_UC_TIER_ICONS: Record<1 | 2 | 3, string> = {
  1: '/icons/level1.cb11b2cd.png',
  2: '/icons/level2.cb11b2cd.png',
  3: '/icons/level3.cb11b2cd.png',
};

export function pubgUcIconSrc(tier: 1 | 2 | 3): string {
  return PUBG_UC_TIER_ICONS[tier] ?? PUBG_UC_TIER_ICONS[1];
}

export type PubgUcPackage = {
  id: string;
  /** نص العرض مثل 25 + 300 */
  label: string;
  totalUc: number;
  priceIqd: number;
  originalPriceIqd?: number;
  isMinimum?: boolean;
  iconTier: 1 | 2 | 3;
};

export const PUBG_UC_PACKAGES: PubgUcPackage[] = [
  { id: 'uc-30', label: '30', totalUc: 30, priceIqd: 590, isMinimum: true, iconTier: 1 },
  { id: 'uc-60', label: '60', totalUc: 60, priceIqd: 1180, isMinimum: true, iconTier: 1 },
  { id: 'uc-120', label: '120', totalUc: 120, priceIqd: 2400, iconTier: 1 },
  { id: 'uc-180', label: '180', totalUc: 180, priceIqd: 3600, iconTier: 1 },
  { id: 'uc-325', label: '25 + 300', totalUc: 325, priceIqd: 5900, iconTier: 2 },
  { id: 'uc-336', label: '26 + 310', totalUc: 336, priceIqd: 6200, iconTier: 2 },
  { id: 'uc-660', label: '60 + 600', totalUc: 660, priceIqd: 11800, iconTier: 2 },
  { id: 'uc-688', label: '63 + 625', totalUc: 688, priceIqd: 12500, iconTier: 2 },
  { id: 'uc-1172', label: '107 + 1065', totalUc: 1172, priceIqd: 21300, iconTier: 2 },
  { id: 'uc-1800', label: '300 + 1500', totalUc: 1800, priceIqd: 29500, iconTier: 3 },
  { id: 'uc-3850', label: '850 + 3000', totalUc: 3850, priceIqd: 59000, iconTier: 3 },
  { id: 'uc-8100', label: '2100 + 6000', totalUc: 8100, priceIqd: 118000, iconTier: 3 },
  { id: 'uc-16200', label: '4200 + 12000', totalUc: 16200, priceIqd: 236000, iconTier: 3 },
  { id: 'uc-24300', label: '6300 + 18000', totalUc: 24300, priceIqd: 354000, iconTier: 3 },
  { id: 'uc-32400', label: '8400 + 24000', totalUc: 32400, priceIqd: 472000, iconTier: 3 },
  { id: 'uc-40500', label: '10500 + 30000', totalUc: 40500, priceIqd: 590000, iconTier: 3 },
  { id: 'uc-48600', label: '12600 + 36000', totalUc: 48600, priceIqd: 708000, iconTier: 3 },
  { id: 'uc-81000', label: '21000 + 60000', totalUc: 81000, priceIqd: 1180000, iconTier: 3 },
];
