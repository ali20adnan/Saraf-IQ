export type AppService = {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  coverImage: string;
  badgeAr?: string;
  badgeEn?: string;
  actionType?: 'pubg_uc' | 'playstation' | 'steam' | 'xbox' | 'cod' | 'freefire' | 'tiktok_coins' | 'coming_soon';
  comingSoon?: boolean;
  sortOrder: number;
};

const LEGACY_SERVICE_COVERS = {
  pubg: '/services/بوبجي موبايل.png',
  playstation: '/services/بلي.png',
  steam: '/services/ستيم.png',
  xbox: '/services/اكسبوكس.png',
  cod: '/services/كولفديوتي.png',
  freefire: '/services/freefire.png',
};

const DEFAULT_SERVICE_COVERS = {
  ...LEGACY_SERVICE_COVERS,
  pubg: '/services/pubg-mobile.png',
  playstation: '/services/playstation.png',
  steam: '/services/steam.png',
  xbox: '/services/xbox.png',
  cod: '/services/cod.png',
  freefire: '/services/freefire.png',
  tiktok: '/services/tiktok-coins.png',
};

export const APP_SERVICES: AppService[] = [
  {
    id: 'pubg-uc',
    titleAr: 'شحن UC ببجي موبايل',
    titleEn: 'PUBG Mobile UC',
    descriptionAr: 'شحن UC فوري بأفضل الأسعار — أرسل معرّف اللاعب واختر الباقة.',
    descriptionEn: 'Instant UC top-up at competitive rates — enter your Player ID and pick a pack.',
    coverImage: DEFAULT_SERVICE_COVERS.pubg,
    badgeAr: 'الأكثر طلباً',
    badgeEn: 'Popular',
    actionType: 'pubg_uc',
    sortOrder: 1,
  },
  {
    id: 'playstation',
    titleAr: 'بطاقة بلايستيشن',
    titleEn: 'PlayStation Gift Card',
    descriptionAr: 'بطاقات PlayStation Store — عالمي وأمريكي بأفضل الأسعار.',
    descriptionEn: 'PlayStation Store gift cards — Global & US regions at great rates.',
    coverImage: DEFAULT_SERVICE_COVERS.playstation,
    badgeAr: 'جديد',
    badgeEn: 'New',
    actionType: 'playstation',
    sortOrder: 2,
  },
  {
    id: 'steam',
    titleAr: 'بطاقة ستيم',
    titleEn: 'Steam Gift Card',
    descriptionAr: 'بطاقات Steam Wallet — عالمي وأمريكي.',
    descriptionEn: 'Steam Wallet gift cards — Global & US regions.',
    coverImage: DEFAULT_SERVICE_COVERS.steam,
    badgeAr: 'جديد',
    badgeEn: 'New',
    actionType: 'steam',
    sortOrder: 3,
  },
  {
    id: 'xbox',
    titleAr: 'بطاقة إكس بوكس',
    titleEn: 'Xbox Gift Card',
    descriptionAr: 'بطاقات Xbox & Microsoft Store — عالمي وأمريكي.',
    descriptionEn: 'Xbox & Microsoft Store gift cards — Global & US regions.',
    coverImage: DEFAULT_SERVICE_COVERS.xbox,
    badgeAr: 'جديد',
    badgeEn: 'New',
    actionType: 'xbox',
    sortOrder: 4,
  },
  {
    id: 'cod',
    titleAr: 'نقاط كول أوف ديوتي',
    titleEn: 'Call of Duty Points',
    descriptionAr: 'نقاط COD — عالمي وأمريكي لجميع الإصدارات.',
    descriptionEn: 'COD Points — Global & US for all titles.',
    coverImage: DEFAULT_SERVICE_COVERS.cod,
    badgeAr: 'جديد',
    badgeEn: 'New',
    actionType: 'cod',
    sortOrder: 5,
  },
  {
    id: 'freefire',
    titleAr: 'شحن فري فاير',
    titleEn: 'Free Fire Diamonds',
    descriptionAr: 'شحن إلماس فري فاير بأفضل الأسعار — عالمي وأمريكي.',
    descriptionEn: 'Free Fire Diamonds top-up at great rates — Global & US regions.',
    coverImage: DEFAULT_SERVICE_COVERS.freefire,
    badgeAr: 'جديد',
    badgeEn: 'New',
    actionType: 'freefire',
    sortOrder: 6,
  },
  {
    id: 'tiktok-coins',
    titleAr: 'تكتوك كوينز',
    titleEn: 'TikTok Coins',
    descriptionAr: 'شحن كوينز تكتوك — عالمي وأمريكي بأسعار منافسة.',
    descriptionEn: 'TikTok Coins top-up — Global & US at competitive rates.',
    coverImage: DEFAULT_SERVICE_COVERS.tiktok,
    badgeAr: 'جديد',
    badgeEn: 'New',
    actionType: 'tiktok_coins',
    sortOrder: 7,
  },
];

export function listAppServices(): AppService[] {
  return [...APP_SERVICES].sort((a, b) => a.sortOrder - b.sortOrder);
}

