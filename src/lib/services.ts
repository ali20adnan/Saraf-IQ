export type AppService = {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  coverImage: string;
  badgeAr?: string;
  badgeEn?: string;
  comingSoon?: boolean;
  sortOrder: number;
};

export const APP_SERVICES: AppService[] = [
  {
    id: 'pubg-uc',
    titleAr: 'بيع UC ببجي موبايل',
    titleEn: 'PUBG Mobile UC',
    descriptionAr: 'شحن UC فوري بأفضل الأسعار — أرسل معرّف اللاعب واختر الباقة.',
    descriptionEn: 'Instant UC top-up at competitive rates — enter your Player ID and pick a pack.',
    coverImage: '/services/pubg-uc-cover.png',
    badgeAr: 'الأكثر طلباً',
    badgeEn: 'Popular',
    sortOrder: 1,
  },
];

export function listAppServices(): AppService[] {
  return [...APP_SERVICES].sort((a, b) => a.sortOrder - b.sortOrder);
}
