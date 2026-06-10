export type AppService = {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  coverImage: string;
  badgeAr?: string;
  badgeEn?: string;
  actionType?: 'pubg_uc' | 'playstation' | 'steam' | 'xbox' | 'cod' | 'coming_soon';
  comingSoon?: boolean;
  sortOrder: number;
};

export const APP_SERVICES: AppService[] = [
  {
    id: 'pubg-uc',
    titleAr: 'شحن UC ببجي موبايل',
    titleEn: 'PUBG Mobile UC',
    descriptionAr: 'شحن UC فوري بأفضل الأسعار — أرسل معرّف اللاعب واختر الباقة.',
    descriptionEn: 'Instant UC top-up at competitive rates — enter your Player ID and pick a pack.',
    coverImage: '/services/pubg-uc-cover.png',
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
    coverImage: '/services/ps-cover.svg',
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
    coverImage: '/services/steam-cover.svg',
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
    coverImage: '/services/xbox-cover.svg',
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
    coverImage: '/services/cod-cover.svg',
    badgeAr: 'جديد',
    badgeEn: 'New',
    actionType: 'cod',
    sortOrder: 5,
  },
];

export function listAppServices(): AppService[] {
  return [...APP_SERVICES].sort((a, b) => a.sortOrder - b.sortOrder);
}

