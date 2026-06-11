import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { Globe, Wallet, CreditCard, Building2, Zap, Copy, CheckCircle2, UploadCloud, Home, LayoutGrid, Clock, User, ArrowRight, ArrowLeft, Settings, LogIn, LogOut, Activity, FileText, ArrowDownUp, ShieldAlert, Gamepad2, XCircle, Eye, EyeOff, Download, Search, Pencil, Tv, AppWindow } from 'lucide-react';
import { ServiceCard } from './components/ServiceCard';
import { PubgUcOrder } from './components/PubgUcOrder';
import { GiftCardOrder } from './components/GiftCardOrder';
import type { GiftCardService } from './lib/giftCardPackages';
import { GIFT_CARD_PACKAGES } from './lib/giftCardPackages';
import { CarouselImageCropper } from './components/CarouselImageCropper';
import { CreditCardPaymentFields } from './components/CreditCardPaymentFields';
import { listAppServices } from './lib/services';
import Cookies from 'js-cookie';
import { supabase } from './lib/supabase';
import { notificationService } from './lib/notifications';
import { MobileBottomNav } from './components/MobileBottomNav';
import { AppSplash } from './components/AppSplash';
import { BrandLogo } from './components/BrandLogo';
import type { ServerTransaction } from '../types/transaction';
import { Capacitor } from '@capacitor/core';
import { apiUrl } from './lib/apiBase';
import { formatLatinDigits } from './lib/formatNumbers';
import { validateCard } from './lib/cardValidation';
import type { CardValidationReason } from './lib/cardValidation';
import { PUBG_UC_PACKAGES } from './lib/pubgUcPackages';

/** أيقونة محفظة مخصّصة: مسار نسبي من API أو رابط كامل */
function walletIconDisplaySrc(iconUrl: string | null | undefined): string | null {
  const u = iconUrl?.trim();
  if (!u) return null;
  if (u.startsWith('/')) return apiUrl(u);
  return u;
}

type TransactionType = 'sell' | 'buy' | 'deposit';
type ViewType = 'home' | 'login' | 'signup' | 'admin' | 'history' | 'profile' | 'settings' | 'services';

const CLIENT_ID_KEY = 'saraf_client_id';

/** حدود مبلغ البيع (دينار) — يُمنع إدخال سلاسل طويلة تكسر دقة JavaScript */
const SELL_IQD_MIN = 5_000;
const SELL_IQD_MAX = 300_000;
const SELL_IQD_BATCH = 60_000;
/** 300000 = 6 أرقام كحد أقصى قبل clamp */
const SELL_IQD_INPUT_MAX_DIGITS = 6;

function parseClampedSellIqdInput(rawInput: string): number {
  const raw = rawInput.replace(/\D/g, '').slice(0, SELL_IQD_INPUT_MAX_DIGITS);
  if (raw === '') return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return 0;
  return Math.min(n, SELL_IQD_MAX);
}

/** سعر شراء بطاقة 100 ألف (دينار) من حقل العرض الرئيسي — نفس الرقم في «شراء 100 ألف اسيا بـ …» */
function parseHeroBuyPriceIqdFor100k(display: string): number | null {
  const n = Number(String(display).replace(/[\s,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** تكرار أخف على 4G / شبكة قوية */
function getPollIntervalMs(): number {
  if (typeof navigator === 'undefined') return 15000;
  const c = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean } })
    .connection;
  if (c?.saveData) return 28000;
  if (c?.effectiveType === '4g') return 10000;
  if (c?.effectiveType === '3g') return 20000;
  return 15000;
}

function getOtpPollIntervalMs(): number {
  if (typeof navigator === 'undefined') return 2000;
  const c = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  if (c?.effectiveType === '4g') return 1500;
  return 2500;
}

type ApiOffer = {
  id: string;
  variant: 'buy' | 'sell';
  title_ar: string;
  title_en: string;
  amount_display: string;
  unit_ar: string;
  unit_en: string;
  sort_order?: number;
};

type SiteProfileData = {
  full_name: string;
  email: string;
  phone: string;
};

type AgentNumber = {
  id: string;
  agent_id: string;
  phone_number: string;
  balance: number;
  is_exhausted: boolean;
  sort_order: number;
};

type Agent = {
  id: string;
  telegram_id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  numbers: AgentNumber[];
  payment_methods?: Array<{
    method_key: string;
    account_number: string;
    account_holder: string | null;
    barcode_url: string | null;
  }>;
};

type AdminRow = {
  id: string;
  telegram_id: number;
  name: string;
  email?: string | null;
  permissions: string[];
  created_at: string;
};

type BuyCustomWalletRow = {
  id: string;
  name_ar: string;
  name_en: string;
  enabled: boolean;
  icon_url?: string | null;
};

type SellCustomWalletRow = BuyCustomWalletRow;

type ActiveAgentNumber = {
  phoneNumber: string | null;
  agentId: string;
  numberId: string | null;
  allowedMethods?: Record<string, boolean>;
  paymentMethods?: Array<{
    method_key: string;
    account_number: string;
    account_holder: string | null;
    barcode_url: string | null;
  }>;
};

type HomeMethodItem = {
  id: string;
  name: string;
  icon: string | LucideIcon;
  isImage?: boolean;
  accent: string;
};

type ManagedServiceRow = {
  id: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  coverImage: string;
  badgeAr: string;
  badgeEn: string;
  actionType:
    | 'pubg_uc' | 'playstation' | 'steam' | 'xbox' | 'cod'
    | 'freefire' | 'tiktok_coins'
    | 'iptv' | 'chatgpt' | 'canva' | 'netflix'
    | 'coming_soon';
  enabled: boolean;
  comingSoon: boolean;
  sortOrder: number;
};

/** نسبة أبعاد صورة الكاروسيل (العرض/الارتفاع) — تطابق صندوق العرض على الجوال */
const CAROUSEL_IMAGE_ASPECT = 2.2;
const SERVICE_IMAGE_ASPECT = 16 / 9;

type CarouselSlide = {
  id: string;
  title_ar: string;
  title_en: string;
  subtitle_ar: string;
  subtitle_en: string;
  gradient: string;
  badge_ar: string;
  badge_en: string;
  action?: 'buy' | 'sell' | 'services';
  /** صورة الخلفية (data URL) — اختيارية */
  image?: string;
};

const DEFAULT_CAROUSEL_SLIDES: CarouselSlide[] = [
  {
    id: 'slide-buy',
    title_ar: 'اشحن رصيد اسياسيل',
    title_en: 'Top up Asiacell Credit',
    subtitle_ar: 'أفضل الأسعار — شحن فوري وآمن',
    subtitle_en: 'Best rates — instant & secure',
    gradient: 'from-red-600 to-red-800',
    badge_ar: 'فوري',
    badge_en: 'Instant',
    action: 'buy',
  },
  {
    id: 'slide-sell',
    title_ar: 'بيع رصيدك بأعلى سعر',
    title_en: 'Sell Your Credit',
    subtitle_ar: 'حوّل رصيد اسياسيا إلى دينار عراقي',
    subtitle_en: 'Convert Asiacell to IQD',
    gradient: 'from-gray-800 to-gray-950',
    badge_ar: 'الأفضل',
    badge_en: 'Best Rate',
    action: 'sell',
  },
  {
    id: 'slide-pubg',
    title_ar: 'شحن UC — ببجي موبايل',
    title_en: 'PUBG Mobile UC',
    subtitle_ar: 'شحن فوري بأسعار منافسة',
    subtitle_en: 'Instant top-up at great prices',
    gradient: 'from-blue-700 to-purple-800',
    badge_ar: 'جديد',
    badge_en: 'New',
    action: 'services',
  },
];

function sanitizeCarouselSlides(raw: unknown): CarouselSlide[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_CAROUSEL_SLIDES];
  return raw.filter((s) => s && typeof s === 'object').map((s, i) => {
    const r = s as Record<string, unknown>;
    return {
      id: String(r.id || `slide-${i}`),
      title_ar: String(r.title_ar || ''),
      title_en: String(r.title_en || ''),
      subtitle_ar: String(r.subtitle_ar || ''),
      subtitle_en: String(r.subtitle_en || ''),
      gradient: String(r.gradient || 'from-red-600 to-red-800'),
      badge_ar: String(r.badge_ar || ''),
      badge_en: String(r.badge_en || ''),
      action: ['buy','sell','services'].includes(String(r.action)) ? r.action as CarouselSlide['action'] : undefined,
      image: typeof r.image === 'string' ? r.image : '',
    };
  });
}

type ManagedPubgPackageRow = {
  id: string;
  label: string;
  totalUc: number;
  priceIqd: number;
  isMinimum: boolean;
  iconTier: 1 | 2 | 3;
  enabled: boolean;
  sortOrder: number;
};

function normalizeServiceId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 36);
}

const DEFAULT_MANAGED_SERVICES: ManagedServiceRow[] = listAppServices().map((service) => ({
  id: service.id,
  titleAr: service.titleAr,
  titleEn: service.titleEn,
  descriptionAr: service.descriptionAr,
  descriptionEn: service.descriptionEn,
  coverImage: service.coverImage,
  badgeAr: service.badgeAr || '',
  badgeEn: service.badgeEn || '',
  actionType:
    (service.actionType as ManagedServiceRow['actionType'] | undefined) ||
    (service.id === 'pubg-uc' ? 'pubg_uc' : 'coming_soon'),
  enabled: true,
  comingSoon: Boolean(service.comingSoon),
  sortOrder: service.sortOrder,
}));

const SERVICE_COVER_BY_ID: Record<string, string> = Object.fromEntries(
  DEFAULT_MANAGED_SERVICES.map((service) => [service.id, service.coverImage]),
);

const SERVICE_FALLBACK_COVER = 'https://placehold.co/800x450/0f172a/ffffff/png?text=Service';

function serviceCoverImage(id: string, coverImage: string): string {
  const cleanedCover = coverImage.trim();
  const defaultCover = SERVICE_COVER_BY_ID[id];
  if (!cleanedCover) return defaultCover || SERVICE_FALLBACK_COVER;
  if (cleanedCover.startsWith('/services/') && cleanedCover.endsWith('.svg')) {
    return defaultCover || SERVICE_FALLBACK_COVER;
  }
  return cleanedCover;
}

const DEFAULT_PUBG_PACKAGES: ManagedPubgPackageRow[] = PUBG_UC_PACKAGES.map((pkg, idx) => ({
  id: pkg.id,
  label: pkg.label,
  totalUc: pkg.totalUc,
  priceIqd: pkg.priceIqd,
  isMinimum: Boolean(pkg.isMinimum),
  iconTier: pkg.iconTier,
  enabled: true,
  sortOrder: idx + 1,
}));

function sanitizeManagedServices(raw: unknown): ManagedServiceRow[] {
  if (!Array.isArray(raw)) return [...DEFAULT_MANAGED_SERVICES];
  const seen = new Set<string>();
  const out: ManagedServiceRow[] = [];
  raw.forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;
    const r = row as Record<string, unknown>;
    const id = normalizeServiceId(String(r.id || ''));
    if (!id || seen.has(id)) return;
    seen.add(id);
    const sortOrder = Number(r.sortOrder ?? r.sort_order ?? idx + 1);
    const VALID_ACTIONS = ['pubg_uc', 'playstation', 'steam', 'xbox', 'cod', 'freefire', 'tiktok_coins', 'iptv', 'chatgpt', 'canva', 'netflix', 'coming_soon'];
    const actionRaw = String(r.actionType ?? r.action_type ?? 'coming_soon').trim();
    const coverImageRaw = String(r.coverImage ?? r.cover_image ?? '').trim();
    out.push({
      id,
      titleAr: String(r.titleAr ?? r.title_ar ?? ''),
      titleEn: String(r.titleEn ?? r.title_en ?? ''),
      descriptionAr: String(r.descriptionAr ?? r.description_ar ?? ''),
      descriptionEn: String(r.descriptionEn ?? r.description_en ?? ''),
      coverImage: serviceCoverImage(id, coverImageRaw),
      badgeAr: String(r.badgeAr ?? r.badge_ar ?? ''),
      badgeEn: String(r.badgeEn ?? r.badge_en ?? ''),
      actionType: (VALID_ACTIONS.includes(actionRaw) ? actionRaw : 'coming_soon') as ManagedServiceRow['actionType'],
      enabled: r.enabled !== false,
      comingSoon: r.comingSoon === true || r.coming_soon === true,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : idx + 1,
    });
  });
  if (!out.length) return [...DEFAULT_MANAGED_SERVICES];

  const defaultsById = new Map(DEFAULT_MANAGED_SERVICES.map((service) => [service.id, service] as const));
  const merged = out.map((service) => {
    const fallback = defaultsById.get(service.id);
    if (!fallback) return service;
    return {
      ...service,
      titleAr: service.titleAr || fallback.titleAr,
      titleEn: service.titleEn || fallback.titleEn,
      descriptionAr: service.descriptionAr || fallback.descriptionAr,
      descriptionEn: service.descriptionEn || fallback.descriptionEn,
      coverImage: serviceCoverImage(service.id, service.coverImage || fallback.coverImage),
      badgeAr: service.badgeAr || fallback.badgeAr,
      badgeEn: service.badgeEn || fallback.badgeEn,
    };
  });

  for (const fallback of DEFAULT_MANAGED_SERVICES) {
    if (seen.has(fallback.id)) continue;
    merged.push({ ...fallback });
  }

  return merged.sort((a, b) => a.sortOrder - b.sortOrder);
}

function sanitizeManagedPubgPackages(raw: unknown): ManagedPubgPackageRow[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PUBG_PACKAGES];
  const seen = new Set<string>();
  const out: ManagedPubgPackageRow[] = [];
  raw.forEach((row, idx) => {
    if (!row || typeof row !== 'object') return;
    const r = row as Record<string, unknown>;
    const id = normalizeServiceId(String(r.id || `pkg-${idx + 1}`));
    if (!id || seen.has(id)) return;
    seen.add(id);
    const tierRaw = Number(r.iconTier ?? r.icon_tier ?? 1);
    const sortOrder = Number(r.sortOrder ?? r.sort_order ?? idx + 1);
    out.push({
      id,
      label: String(r.label ?? ''),
      totalUc: Math.max(0, Number(r.totalUc ?? r.total_uc ?? 0)),
      priceIqd: Math.max(0, Number(r.priceIqd ?? r.price_iqd ?? 0)),
      isMinimum: r.isMinimum === true || r.is_minimum === true,
      iconTier: tierRaw === 2 ? 2 : tierRaw === 3 ? 3 : 1,
      enabled: r.enabled !== false,
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : idx + 1,
    });
  });
  return out.sort((a, b) => a.sortOrder - b.sortOrder);
}

function sanitizeGiftCardPrices(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k === 'string' && typeof v === 'number' && v >= 0) out[k] = v;
  }
  return out;
}

/** مسار الخادم فقط — حدّث الملف على السيرفر (مثل public/saraf-iq-debug.apk) دون بوت */
function apkDownloadHref(): string {
  return apiUrl('/download/apk');
}

function isWebBrowser(): boolean {
  return typeof window !== 'undefined' && !Capacitor.isNativePlatform();
}

function MainContent() {
  const { t, lang, toggleLanguage, dir } = useLanguage();
  /** السطر الوصفي = نفس {{amount}} المعروض كبيراً (لوحة الإدارة أو العرض) */
  const offerLineFromTemplate = useCallback(
    (variant: 'buy' | 'sell', amountDisplay: string, mode: 'hero' | 'grid' = 'grid') => {
      const buyKey = mode === 'hero' ? 'heroOfferBuyLine' : 'offerGridBuyLine';
      const sellKey = mode === 'hero' ? 'heroOfferSellLine' : 'offerGridSellLine';
      return t(variant === 'buy' ? buyKey : sellKey).replace(/\{\{amount\}\}/g, amountDisplay.trim());
    },
    [t],
  );
  const initialView = window.location.pathname === '/admin' ? 'login' : 'home';
  const [currentView, setCurrentView] = useState<ViewType>(initialView);
  const [activeServiceId, setActiveServiceId] = useState<string | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [carouselDir, setCarouselDir] = useState<'next' | 'prev'>('next');
  const [carouselAnimating, setCarouselAnimating] = useState(false);
  /** اقتصاص صورة شريحة الكاروسيل: فهرس الشريحة + الصورة الأصلية المختارة */
  const [carouselCropper, setCarouselCropper] = useState<{ idx: number; src: string } | null>(null);
  /** اقتصاص صورة بطاقة خدمة: فهرس الخدمة + الصورة الأصلية المختارة */
  const [serviceCropper, setServiceCropper] = useState<{ idx: number; src: string } | null>(null);
  const carouselTouchX = useRef(0);
  const carouselTouchY = useRef(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const asiacellScrollRef = useRef<HTMLDivElement>(null);
  const [showPurchasePage, setShowPurchasePage] = useState(false);
  const [buyPaymentType, setBuyPaymentType] = useState<'card' | 'wallet' | null>(null);
  const [depositStep, setDepositStep] = useState<'amount' | 'card'>('amount');
  const [depositAmountInput, setDepositAmountInput] = useState('');
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [profileSubView, setProfileSubView] = useState<null | 'payments' | 'coupons' | 'terms' | 'support'>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /** عربي: افتراضي شراء (الزر يمين). إنجليزي: افتراضي بيع والشراء يبقى يسار بفضل dir=ltr */
  const [txType, setTxType] = useState<TransactionType>(() => {
    if (typeof window === 'undefined') return 'sell';
    const saved = localStorage.getItem('saraf_lang');
    return saved === 'en' ? 'sell' : 'buy';
  });
  const [cardValue, setCardValue] = useState<number>(10000);
  const [denominationSelected, setDenominationSelected] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardValidationError, setCardValidationError] = useState<CardValidationReason | null>(null);
  const [asiacellNum, setAsiacellNum] = useState('');
  const [selectedOperator, setSelectedOperator] = useState<'asiacell' | 'zain' | 'korek'>('asiacell');
  const [asiacellErr, setAsiacellErr] = useState(false);
  /** يتحقق من صيغة رقم الهاتف العراقي */
  const validateAsiacell = (v: string) => {
    if (!v.trim()) { setAsiacellErr(false); return; }
    const ok = /^(\+964|964|07|7)\d{7,10}$/.test(v.trim().replace(/\s/g, ''));
    setAsiacellErr(!ok);
  };
  const [isSuccess, setIsSuccess] = useState(false);
  const [showOtpStep, setShowOtpStep] = useState(false);
  const [otpState, setOtpState] = useState<'input' | 'checking' | 'failed'>('input');
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [sellAmount, setSellAmount] = useState<number>(10000);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevTransactionsRef = useRef<ServerTransaction[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  
  const [appSettings, setAppSettings] = useState({
    maintenance_mode: false,
    buy_coming_soon: false,
    sell_coming_soon: false,
    method_zaincash_buy_enabled: true,
    method_zaincash_sell_enabled: true,
    method_superqi_buy_enabled: true,
    method_superqi_sell_enabled: true,
    method_firstbank_buy_enabled: true,
    method_firstbank_sell_enabled: true,
    method_fastpay_buy_enabled: true,
    method_fastpay_sell_enabled: true,
    method_creditcard_buy_enabled: true,
    google_auth_enabled:
      /^(1|true|yes|on)$/i.test(import.meta.env.VITE_GOOGLE_AUTH_ENABLED || '') ||
      Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID),
    buy_custom_wallets: [] as BuyCustomWalletRow[],
    sell_custom_wallets: [] as SellCustomWalletRow[],
  });
  const [adminNewWallet, setAdminNewWallet] = useState({ id: '', name_ar: '', name_en: '' });
  const [adminNewSellWallet, setAdminNewSellWallet] = useState({ id: '', name_ar: '', name_en: '' });
  const [buyWalletIconUploading, setBuyWalletIconUploading] = useState<string | null>(null);
  const [sellWalletIconUploading, setSellWalletIconUploading] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ServerTransaction[]>([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [clientId, setClientId] = useState<string | null>(null);
  const [offersList, setOffersList] = useState<ApiOffer[]>([]);
  const [siteProfile, setSiteProfile] = useState<SiteProfileData | null>(null);
  const [profileDraft, setProfileDraft] = useState<SiteProfileData>({ full_name: '', email: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isInitialSettingsLoading, setIsInitialSettingsLoading] = useState(true);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [siteContent, setSiteContent] = useState({
    supportUrl: 'https://t.me/cs_iraqi',
    heroBuyAmountDisplay: '100,000',
    heroSellAmountDisplay: '95,000',
    servicesSectionTitleAr: 'الخدمات',
    servicesSectionTitleEn: 'Services',
    servicesSectionSubtitleAr: 'شحن ألعاب ومنتجات رقمية — بسرعة وأمان.',
    servicesSectionSubtitleEn: 'Top up games and digital products — fast and secure.',
    servicesCatalog: [...DEFAULT_MANAGED_SERVICES],
    pubgUcTitleAr: 'شحن UC — ببجي موبايل',
    pubgUcTitleEn: 'PUBG Mobile UC',
    pubgUcSubtitleAr: 'اختر الباقة، أدخل معرّف اللاعب، وادفع بالبطاقة البنكية.',
    pubgUcSubtitleEn: 'Choose a UC pack, enter your Player ID, and pay by bank card.',
    pubgPackages: [...DEFAULT_PUBG_PACKAGES],
    giftCardPrices: {} as Record<string, number>,
    shopDiscountPercent: 0,
    carouselSlides: [...DEFAULT_CAROUSEL_SLIDES],
  });

  // Agents State
  const [activeAgentNumber, setActiveAgentNumber] = useState<ActiveAgentNumber | null>(null);
  const [adminAgents, setAdminAgents] = useState<Agent[]>([]);
  const [isAdminAgentsLoading, setIsAdminAgentsLoading] = useState(false);
  const [adminTab, setAdminTab] = useState<'overview' | 'services' | 'agents' | 'orders' | 'admins'>('overview');
  const [adminGcService, setAdminGcService] = useState<GiftCardService>('playstation');
  const [serviceSearchQuery, setServiceSearchQuery] = useState('');
  const [adminAdmins, setAdminAdmins] = useState<AdminRow[]>([]);
  const [adminTransactions, setAdminTransactions] = useState<ServerTransaction[]>([]);
  /** فلاتر الطلبات — لوحة الإدارة › الطلبات */
  const [adminOrderStatusFilter, setAdminOrderStatusFilter] = useState<
    'all' | 'completed' | 'refunded' | 'pending' | 'failed'
  >('all');
  const [adminOrderTypeFilter, setAdminOrderTypeFilter] = useState<'all' | 'buy' | 'sell' | 'deposit'>('all');
  const [adminOrderRefQuery, setAdminOrderRefQuery] = useState('');
  const [adminOrderFromDate, setAdminOrderFromDate] = useState('');
  const [adminOrderToDate, setAdminOrderToDate] = useState('');
  const [adminBroadcastText, setAdminBroadcastText] = useState('');
  const [adminPushTitle, setAdminPushTitle] = useState('');
  const [adminPushBody, setAdminPushBody] = useState('');
  const [adminOfferForm, setAdminOfferForm] = useState({
    variant: 'buy' as 'buy' | 'sell',
    title_ar: '',
    title_en: '',
    amount_display: '',
    unit_ar: '',
    unit_en: '',
    sort_order: 0,
  });

  const statusUi = useCallback((status: string) => {
    switch (status) {
      case 'completed':
        return {
          label: t('statusCompleted'),
          badge: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
          icon: 'bg-emerald-50 text-emerald-600',
        };
      case 'failed':
        return {
          label: t('statusFailed'),
          badge: 'bg-red-50 text-red-800 ring-red-100',
          icon: 'bg-red-50 text-red-600',
        };
      case 'refunded':
        return {
          label: t('statusRefunded'),
          badge: 'bg-violet-50 text-violet-800 ring-violet-100',
          icon: 'bg-violet-50 text-violet-600',
        };
      case 'suspended':
        return {
          label: t('statusSuspended'),
          badge: 'bg-slate-100 text-slate-800 ring-slate-200',
          icon: 'bg-slate-100 text-slate-600',
        };
      case 'retry_otp':
        return {
          label: t('statusRetryOtp'),
          badge: 'bg-orange-50 text-orange-900 ring-orange-100',
          icon: 'bg-orange-50 text-orange-700',
        };
      default:
        return {
          label: t('statusPending'),
          badge: 'bg-amber-50 text-amber-900 ring-amber-100',
          icon: 'bg-amber-50 text-amber-700',
        };
    }
  }, [t]);

  const txTypeLabel = useCallback((type: ServerTransaction['type']) => {
    if (type === 'sell') return t('sellCredit');
    if (type === 'deposit') return lang === 'ar' ? 'إيداع رصيد' : 'Deposit';
    return t('buyCredit');
  }, [t, lang]);

  const txAmountUnit = useCallback((type: ServerTransaction['type']) => {
    if (type === 'sell' || type === 'deposit') return t('iqd');
    return t('asiacell');
  }, [t]);

  const dashboardStats = useMemo(() => {
    const activeOrders = transactions.filter(
      (tx) => tx.status === 'pending' || tx.status === 'retry_otp'
    ).length;
    const totalCompletedIqd = transactions
      .filter((tx) => tx.status === 'completed')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { activeOrders, totalCompletedIqd };
  }, [transactions]);

  const crmStats = useMemo(() => {
    const uniqueUsers = new Set(
      adminTransactions
        .map((tx) => String(tx.client_id || '').trim())
        .filter((id) => id.length > 0),
    ).size;
    const activeTransactions = adminTransactions.filter(
      (tx) => tx.status === 'pending' || tx.status === 'retry_otp' || tx.status === 'suspended',
    ).length;
    const totalCompletedIqd = adminTransactions
      .filter((tx) => tx.status === 'completed')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

    return { uniqueUsers, activeTransactions, totalCompletedIqd };
  }, [adminTransactions]);

  const adminFilteredTransactions = useMemo(() => {
    let rows = [...adminTransactions];

    if (adminOrderStatusFilter !== 'all') {
      if (adminOrderStatusFilter === 'completed') {
        rows = rows.filter((tx) => tx.status === 'completed');
      } else if (adminOrderStatusFilter === 'refunded') {
        rows = rows.filter((tx) => tx.status === 'refunded');
      } else if (adminOrderStatusFilter === 'failed') {
        rows = rows.filter((tx) => tx.status === 'failed');
      } else {
        rows = rows.filter(
          (tx) =>
            tx.status === 'pending' || tx.status === 'retry_otp' || tx.status === 'suspended',
        );
      }
    }

    if (adminOrderTypeFilter !== 'all') {
      rows = rows.filter((tx) => tx.type === adminOrderTypeFilter);
    }

    const q = adminOrderRefQuery.trim().toLowerCase();
    if (q) {
      rows = rows.filter((tx) => String(tx.order_ref || '').toLowerCase().includes(q));
    }

    if (adminOrderFromDate) {
      const from = new Date(adminOrderFromDate + 'T00:00:00');
      if (!Number.isNaN(from.getTime())) {
        rows = rows.filter((tx) => new Date(tx.created_at).getTime() >= from.getTime());
      }
    }
    if (adminOrderToDate) {
      const to = new Date(adminOrderToDate + 'T23:59:59.999');
      if (!Number.isNaN(to.getTime())) {
        rows = rows.filter((tx) => new Date(tx.created_at).getTime() <= to.getTime());
      }
    }

    return rows;
  }, [
    adminTransactions,
    adminOrderStatusFilter,
    adminOrderTypeFilter,
    adminOrderRefQuery,
    adminOrderFromDate,
    adminOrderToDate,
  ]);

  useEffect(() => {
    const stored = localStorage.getItem('notifications_enabled');
    if (stored !== null) setNotificationsEnabled(stored === 'true');
  }, []);

  useEffect(() => {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    setClientId(id);
  }, []);

  /** تسجيل FCM على أندرويد/آيفون بعد الشاشة الافتتاحية */
  useEffect(() => {
    if (!clientId || !splashDismissed) return;
    void notificationService.initNativePush(clientId);
  }, [clientId, splashDismissed]);

  useEffect(() => {
    if (currentView !== 'services') setActiveServiceId(null);
  }, [currentView]);

  useEffect(() => {
    if (currentView !== 'profile') {
      setProfileSubView(null);
      setShowEditProfile(false);
    }
  }, [currentView]);

  /** مفتاح إعادة ضبط المؤقت التلقائي عند السحب اليدوي */
  const [carouselTimerKey, setCarouselTimerKey] = useState(0);

  /** الانتقال المتحرك بين الشرائح */
  const goToSlide = useCallback((getNext: (cur: number, len: number) => number, direction: 'next' | 'prev') => {
    const len = siteContent.carouselSlides.length;
    if (len <= 1) return;
    setCarouselDir(direction);
    setCarouselAnimating(true);
    setTimeout(() => {
      setActiveSlide((cur) => getNext(cur, len));
      setCarouselAnimating(false);
    }, 300);
  }, [siteContent.carouselSlides.length]);

  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0, dragged: false });

  useEffect(() => {
    const el = carouselRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!dragging) return;
      const dx = Math.abs(startX - e.touches[0].clientX);
      const dy = Math.abs(startY - e.touches[0].clientY);
      // إذا الحركة أفقية أكثر من عمودية — امنع التمرير
      if (dx > dy && dx > 8) e.preventDefault();
    };
    const onEnd = (e: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      const dx = startX - e.changedTouches[0].clientX;
      const dy = startY - e.changedTouches[0].clientY;
      if (Math.abs(dx) < 25 || Math.abs(dx) < Math.abs(dy)) return;
      e.preventDefault();
      const len = siteContent.carouselSlides.length;
      if (len <= 1) return;
      // RTL: سحب يمين (dx < 0) = الشريحة التالية
      const isRtl = dir === 'rtl';
      const goNext = isRtl ? dx < 0 : dx > 0;
      goToSlide(
        (p, l) => goNext ? (p + 1) % l : (p - 1 + l) % l,
        goNext ? 'next' : 'prev',
      );
      // أعد ضبط مؤقت التشغيل التلقائي من الصفر
      setCarouselTimerKey((k) => k + 1);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, [siteContent.carouselSlides.length, dir, goToSlide]);

  useEffect(() => {
    if (currentView !== 'home') return;
    const slides = siteContent.carouselSlides;
    if (slides.length <= 1) return;
    // يبدأ العدّ من صفر في كل مرة (سواء تلقائي أو بعد سحب يدوي)
    const id = window.setInterval(() => {
      goToSlide((prev, len) => (prev + 1) % len, 'next');
    }, 4000);
    return () => window.clearInterval(id);
  }, [currentView, siteContent.carouselSlides, carouselTimerKey, goToSlide]);

  const applySiteContentPayload = useCallback((c: unknown) => {
    if (!c || typeof c !== 'object') return;
    const payload = c as Record<string, unknown>;
    setSiteContent({
      supportUrl: String(payload.supportUrl || 'https://t.me/cs_iraqi'),
      heroBuyAmountDisplay: String(payload.heroBuyAmountDisplay || '100,000'),
      heroSellAmountDisplay: String(payload.heroSellAmountDisplay || '95,000'),
      servicesSectionTitleAr: String(payload.servicesSectionTitleAr || 'الخدمات'),
      servicesSectionTitleEn: String(payload.servicesSectionTitleEn || 'Services'),
      servicesSectionSubtitleAr: String(
        payload.servicesSectionSubtitleAr || 'شحن ألعاب ومنتجات رقمية — بسرعة وأمان.',
      ),
      servicesSectionSubtitleEn: String(
        payload.servicesSectionSubtitleEn || 'Top up games and digital products — fast and secure.',
      ),
      servicesCatalog: sanitizeManagedServices(payload.servicesCatalog),
      pubgUcTitleAr: String(payload.pubgUcTitleAr || 'شحن UC — ببجي موبايل'),
      pubgUcTitleEn: String(payload.pubgUcTitleEn || 'PUBG Mobile UC'),
      pubgUcSubtitleAr: String(
        payload.pubgUcSubtitleAr || 'اختر الباقة، أدخل معرّف اللاعب، وادفع بالبطاقة البنكية.',
      ),
      pubgUcSubtitleEn: String(
        payload.pubgUcSubtitleEn || 'Choose a UC pack, enter your Player ID, and pay by bank card.',
      ),
      pubgPackages: sanitizeManagedPubgPackages(payload.pubgPackages),
      giftCardPrices: sanitizeGiftCardPrices(payload.giftCardPrices),
      shopDiscountPercent: (() => {
        const n = Number((payload as { shopDiscountPercent?: unknown }).shopDiscountPercent);
        if (!Number.isFinite(n) || n < 0) return 0;
        return Math.min(100, n);
      })(),
      carouselSlides: sanitizeCarouselSlides(payload.carouselSlides),
    });
  }, []);

  const fetchSiteContent = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/site-content'));
      if (res.ok) {
        applySiteContentPayload(await res.json());
      }
    } catch (e) {
      console.error('fetchSiteContent:', e);
    }
  }, [applySiteContentPayload]);

  const fetchSettings = useCallback(async () => {
    const SETTINGS_FETCH_MS = 8_000;
    const ac = new AbortController();
    const tid = window.setTimeout(() => ac.abort(), SETTINGS_FETCH_MS);
    try {
      const [resSettings, resContent] = await Promise.all([
        fetch(apiUrl('/api/settings'), { signal: ac.signal }),
        fetch(apiUrl('/api/site-content'), { signal: ac.signal }),
      ]);
      if (resSettings.ok) {
        const data = await resSettings.json();
        if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          setAppSettings((prev) => ({
            ...prev,
            maintenance_mode: Boolean(d.maintenance_mode),
            buy_coming_soon: Boolean(d.buy_coming_soon),
            sell_coming_soon: Boolean(d.sell_coming_soon),
            method_zaincash_buy_enabled: d.method_zaincash_buy_enabled !== false,
            method_zaincash_sell_enabled: d.method_zaincash_sell_enabled !== false,
            method_superqi_buy_enabled: d.method_superqi_buy_enabled !== false,
            method_superqi_sell_enabled: d.method_superqi_sell_enabled !== false,
            method_firstbank_buy_enabled: d.method_firstbank_buy_enabled !== false,
            method_firstbank_sell_enabled: d.method_firstbank_sell_enabled !== false,
            method_fastpay_buy_enabled: d.method_fastpay_buy_enabled !== false,
            method_fastpay_sell_enabled: d.method_fastpay_sell_enabled !== false,
            method_creditcard_buy_enabled: d.method_creditcard_buy_enabled !== false,
            google_auth_enabled: d.google_auth_enabled === true,
            buy_custom_wallets: Array.isArray(d.buy_custom_wallets)
              ? (d.buy_custom_wallets as BuyCustomWalletRow[])
              : prev.buy_custom_wallets,
            sell_custom_wallets: Array.isArray(d.sell_custom_wallets)
              ? (d.sell_custom_wallets as SellCustomWalletRow[])
              : prev.sell_custom_wallets,
          }));
        }
      }
      if (resContent.ok) {
        applySiteContentPayload(await resContent.json());
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      clearTimeout(tid);
      setIsInitialSettingsLoading(false);
    }
  }, [applySiteContentPayload]);

  useEffect(() => {
    if (currentView === 'services' || (currentView === 'admin' && adminTab === 'services')) {
      void fetchSiteContent();
    }
  }, [currentView, adminTab, fetchSiteContent]);

  /** لا تبقَ شاشة التحميل معلّقة إذا علّق الطلب شبكياً */
  useEffect(() => {
    const t = window.setTimeout(() => setIsInitialSettingsLoading(false), 1_200);
    return () => window.clearTimeout(t);
  }, []);

  const fetchActiveNumber = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/active-number'));
      if (res.ok) {
        const data = (await res.json()) as ActiveAgentNumber | null;
        setActiveAgentNumber(data && typeof data === 'object' ? data : null);
      }
    } catch (e) {
      console.error("fetchActiveNumber:", e);
    }
  }, []);

  const fetchAdminAgents = useCallback(async () => {
    if (!isAdmin) return;
    setIsAdminAgentsLoading(true);
    try {
      const res = await fetch(apiUrl('/api/admin/agents'));
      if (res.ok) {
        const data = await res.json();
        setAdminAgents(data);
      }
    } catch (e) {
      console.error("fetchAdminAgents:", e);
    } finally {
      setIsAdminAgentsLoading(false);
    }
  }, [isAdmin]);

  const fetchAdminAdmins = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(apiUrl('/api/admin/admins'));
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) setAdminAdmins(data);
      }
    } catch (e) {
      console.error('fetchAdminAdmins:', e);
    }
  }, [isAdmin]);

  const fetchAdminTransactions = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(apiUrl('/api/admin/transactions'));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data)) setAdminTransactions(data as ServerTransaction[]);
    } catch (e) {
      console.error('fetchAdminTransactions:', e);
    }
  }, [isAdmin]);

  const fetchTransactions = useCallback(async () => {
    if (!clientId) return;
    try {
      const res = await fetch(apiUrl(`/api/transactions?client_id=${encodeURIComponent(clientId)}`));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data)) setTransactions(data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  }, [clientId]);

  const fetchWalletBalance = useCallback(async () => {
    if (!userId) {
      setWalletBalance(0);
      return;
    }
    try {
      const res = await fetch(apiUrl(`/api/wallet/balance?user_id=${encodeURIComponent(userId)}`));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setWalletBalance(Number(data?.balance ?? 0));
    } catch (error) {
      console.error('fetchWalletBalance:', error);
    }
  }, [userId]);

  const fetchOffers = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/offers'));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data)) setOffersList(data);
    } catch (e) {
      console.error('fetchOffers:', e);
    }
  }, []);

  const fetchSiteProfile = useCallback(async () => {
    // 1. Check Cookies first for immediate UI
    const savedName = Cookies.get('saraf_full_name');
    const savedPhone = Cookies.get('saraf_phone');
    if (savedName || savedPhone) {
      const p: SiteProfileData = {
        full_name: savedName || '',
        email: '',
        phone: savedPhone || '',
      };
      setSiteProfile(p);
      setProfileDraft(p);
    }

    try {
      const res = await fetch(apiUrl('/api/site-profile'));
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data && typeof data === 'object') {
        const p: SiteProfileData = {
          full_name: String(data.full_name ?? savedName ?? ''),
          email: String(data.email ?? ''),
          phone: String(data.phone ?? savedPhone ?? ''),
        };
        setSiteProfile(p);
        setProfileDraft(p);
      }
    } catch (e) {
      console.error('fetchSiteProfile:', e);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
      setUserId(session?.user?.id || null);
      if (session?.user) {
        supabase.from('profiles').select('role').eq('id', session.user.id).single()
          .then(({ data }) => setIsAdmin(data?.role === 'admin'));
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      setUserId(session?.user?.id || null);
      if (session?.user) {
        supabase.from('profiles').select('role').eq('id', session.user.id).single()
          .then(({ data }) => setIsAdmin(data?.role === 'admin'));
      } else {
        setIsAdmin(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!clientId) return;
    const initial = [
      fetchSettings(),
      fetchTransactions(),
      fetchWalletBalance(),
      fetchOffers(),
      fetchSiteProfile(),
      fetchActiveNumber(),
    ];
    if (isAdmin && (currentView === 'admin' || currentView === 'login')) {
      initial.push(fetchAdminAgents());
      initial.push(fetchAdminAdmins());
      initial.push(fetchAdminTransactions());
    }
    void Promise.all(initial);

    const pollMs = getPollIntervalMs();
    const tmr = window.setInterval(() => {
      const polling: Array<Promise<unknown>> = [fetchTransactions(), fetchActiveNumber(), fetchWalletBalance()];
      if (!(isAdmin && currentView === 'admin')) {
        polling.push(fetchSettings());
      }
      if (isAdmin && currentView === 'admin') {
        polling.push(fetchAdminTransactions());
      }
      void Promise.all(polling);
    }, pollMs);
    return () => window.clearInterval(tmr);
  }, [clientId, isAdmin, currentView, fetchSettings, fetchTransactions, fetchWalletBalance, fetchOffers, fetchSiteProfile, fetchActiveNumber, fetchAdminAgents, fetchAdminAdmins, fetchAdminTransactions]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (otpState === 'checking' && currentOrderId) {
      const otpMs = getOtpPollIntervalMs();
      interval = setInterval(() => {
        void fetchTransactions();
      }, otpMs);
    }
    return () => clearInterval(interval);
  }, [otpState, currentOrderId, fetchTransactions]);

  useEffect(() => {
    if (otpState === 'checking' && currentOrderId) {
      const tx = transactions.find(t => t.id === currentOrderId || t.order_ref === currentOrderId);
      if (tx) {
        if (tx.status === 'completed') {
          setOtpState('input');
          setShowOtpStep(false);
          setIsSuccess(true);
        } else if (tx.status === 'failed') {
          setOtpState('failed');
        } else if (tx.status === 'retry_otp') {
          setOtpState('input');
          setOtpCode('');
        }
      }
    }
  }, [transactions, otpState, currentOrderId, lang, t]);

  // إشعارات محلية للويب فقط — على APK يصل التنبيه عبر FCM من السيرفر عند تغيّر الحالة
  useEffect(() => {
    if (transactions.length === 0) return;
    if (Capacitor.isNativePlatform()) {
      prevTransactionsRef.current = transactions;
      return;
    }

    transactions.forEach((tx) => {
      const prevTx = prevTransactionsRef.current.find((t) => t.id === tx.id);
      if (prevTx && prevTx.status !== tx.status) {
        const amountLabel =
          formatLatinDigits(Number(tx.amount)) + ' ' + txAmountUnit(tx.type);
        if (tx.status === 'completed') {
          notificationService.notifyTransactionStatusChange('completed', tx.order_ref, amountLabel);
        } else if (tx.status === 'failed') {
          notificationService.notifyTransactionStatusChange('failed', tx.order_ref);
        } else if (
          tx.status === 'refunded' ||
          tx.status === 'suspended' ||
          tx.status === 'retry_otp'
        ) {
          notificationService.notifyTransactionStatusChange(tx.status, tx.order_ref);
        }
      }
    });

    prevTransactionsRef.current = transactions;
  }, [transactions, lang, t]);

  const saveSiteProfile = async () => {
    setProfileSaving(true);
    // Save to cookies for immediate persistence
    Cookies.set('saraf_full_name', profileDraft.full_name, { expires: 365 });
    Cookies.set('saraf_phone', profileDraft.phone, { expires: 365 });

    try {
      const res = await fetch(apiUrl('/api/site-profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: profileDraft.full_name,
          phone: profileDraft.phone,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const p: SiteProfileData = {
        full_name: String(data.full_name ?? profileDraft.full_name),
        email: String(data.email ?? ''),
        phone: String(data.phone ?? profileDraft.phone),
      };
      setSiteProfile(p);
      setProfileDraft(p);
    } catch (e) {
      console.error('saveSiteProfile:', e);
    } finally {
      setProfileSaving(false);
    }
  };

  const toggleSetting = async (key: string) => {
    const k = key as keyof typeof appSettings;
    const newValue = !appSettings[k];
    setAppSettings((prev) => ({ ...prev, [k]: newValue }));
    try {
      const res = await fetch(apiUrl('/api/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        setAppSettings((prev) => ({
          maintenance_mode: Boolean(d.maintenance_mode),
          buy_coming_soon: Boolean(d.buy_coming_soon),
          sell_coming_soon: Boolean(d.sell_coming_soon),
          method_zaincash_buy_enabled: d.method_zaincash_buy_enabled !== false,
          method_zaincash_sell_enabled: d.method_zaincash_sell_enabled !== false,
          method_superqi_buy_enabled: d.method_superqi_buy_enabled !== false,
          method_superqi_sell_enabled: d.method_superqi_sell_enabled !== false,
          method_firstbank_buy_enabled: d.method_firstbank_buy_enabled !== false,
          method_firstbank_sell_enabled: d.method_firstbank_sell_enabled !== false,
          method_fastpay_buy_enabled: d.method_fastpay_buy_enabled !== false,
          method_fastpay_sell_enabled: d.method_fastpay_sell_enabled !== false,
          method_creditcard_buy_enabled: d.method_creditcard_buy_enabled !== false,
          buy_custom_wallets: Array.isArray(d.buy_custom_wallets)
            ? (d.buy_custom_wallets as BuyCustomWalletRow[])
            : prev.buy_custom_wallets,
          sell_custom_wallets: Array.isArray(d.sell_custom_wallets)
            ? (d.sell_custom_wallets as SellCustomWalletRow[])
            : prev.sell_custom_wallets,
        }));
      }
    } catch (error) {
      console.error('Error updating setting:', error);
      setAppSettings((prev) => ({ ...prev, [k]: !newValue }));
    }
  };

  const saveBuyCustomWallets = useCallback(
    async (wallets: BuyCustomWalletRow[]) => {
      try {
        const res = await fetch(apiUrl('/api/admin/buy-custom-wallets'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallets }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (Array.isArray(data)) {
          setAppSettings((prev) => ({ ...prev, buy_custom_wallets: data as BuyCustomWalletRow[] }));
        }
      } catch (e) {
        console.error(e);
        alert(lang === 'ar' ? 'تعذّر حفظ المحافظ' : 'Could not save wallets');
      }
    },
    [lang],
  );

  const handleBuyWalletPngUpload = useCallback(
    async (walletId: string, file: File | null) => {
      if (!file) return;
      if (file.type !== 'image/png') {
        alert(t('adminWalletIconPngOnly'));
        return;
      }
      setBuyWalletIconUploading(walletId);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('read'));
          r.readAsDataURL(file);
        });
        const res = await fetch(apiUrl('/api/admin/buy-wallet-icon'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: walletId, image_base64: dataUrl }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          alert(err.error || (lang === 'ar' ? 'فشل الرفع' : 'Upload failed'));
          return;
        }
        const { icon_url } = (await res.json()) as { icon_url: string };
        let nextWallets: BuyCustomWalletRow[] = [];
        setAppSettings((prev) => {
          nextWallets = prev.buy_custom_wallets.map((x) =>
            x.id === walletId ? { ...x, icon_url } : x,
          );
          return { ...prev, buy_custom_wallets: nextWallets };
        });
        await saveBuyCustomWallets(nextWallets);
      } catch (e) {
        console.error(e);
        alert(lang === 'ar' ? 'فشل الرفع' : 'Upload failed');
      } finally {
        setBuyWalletIconUploading(null);
      }
    },
    [lang, saveBuyCustomWallets, t],
  );

  const saveSellCustomWallets = useCallback(
    async (wallets: SellCustomWalletRow[]) => {
      try {
        const res = await fetch(apiUrl('/api/admin/sell-custom-wallets'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallets }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (Array.isArray(data)) {
          setAppSettings((prev) => ({ ...prev, sell_custom_wallets: data as SellCustomWalletRow[] }));
        }
      } catch (e) {
        console.error(e);
        alert(lang === 'ar' ? 'تعذّر حفظ محافظ البيع' : 'Could not save sell wallets');
      }
    },
    [lang],
  );

  const handleSellWalletPngUpload = useCallback(
    async (walletId: string, file: File | null) => {
      if (!file) return;
      if (file.type !== 'image/png') {
        alert(t('adminWalletIconPngOnly'));
        return;
      }
      setSellWalletIconUploading(walletId);
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result || ''));
          r.onerror = () => reject(new Error('read'));
          r.readAsDataURL(file);
        });
        const res = await fetch(apiUrl('/api/admin/sell-wallet-icon'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: walletId, image_base64: dataUrl }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          alert(err.error || (lang === 'ar' ? 'فشل الرفع' : 'Upload failed'));
          return;
        }
        const { icon_url } = (await res.json()) as { icon_url: string };
        let nextWallets: SellCustomWalletRow[] = [];
        setAppSettings((prev) => {
          nextWallets = prev.sell_custom_wallets.map((x) =>
            x.id === walletId ? { ...x, icon_url } : x,
          );
          return { ...prev, sell_custom_wallets: nextWallets };
        });
        await saveSellCustomWallets(nextWallets);
      } catch (e) {
        console.error(e);
        alert(lang === 'ar' ? 'فشل الرفع' : 'Upload failed');
      } finally {
        setSellWalletIconUploading(null);
      }
    },
    [lang, saveSellCustomWallets, t],
  );

  const toggleNotifications = async () => {
    const newValue = !notificationsEnabled;

    if (newValue) {
      const granted = await notificationService.requestPermission();
      if (granted) {
        notificationService.toggle(true);
        setNotificationsEnabled(true);
        if (clientId) {
          await notificationService.initNativePush(clientId);
        }
        notificationService.sendNotification(
          lang === 'ar' ? 'الإشعارات مفعلة!' : 'Notifications Enabled!',
          {
            body:
              lang === 'ar'
                ? 'سيتم إرسال تنبيهات مع كل تحديث على طلباتك'
                : 'You will receive alerts for all your order updates',
            icon: '/icons/logo.png',
          },
        );
      }
    } else {
      notificationService.toggle(false);
      setNotificationsEnabled(false);
      if (clientId) {
        await notificationService.unregisterNativePush(clientId);
      }
    }
  };

  const handleAuth = async (e: React.FormEvent, isSignup: boolean) => {
    e.preventDefault();
    setIsAuthLoading(true);
    setAuthError(null);
    const form = e.target as HTMLFormElement;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value.trim().toLowerCase();
    const password = (form.elements.namedItem('password') as HTMLInputElement).value.trim();
    const fullName = (form.elements.namedItem('full_name') as HTMLInputElement)?.value?.trim();

    try {
      if (isSignup) {
        const signupRes = await fetch(apiUrl('/api/auth/signup'), {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({email, password, fullName}),
        });
        const signupJson = await signupRes.json().catch(() => ({} as {error?: string; message?: string}));
        if (!signupRes.ok) {
          if (signupRes.status === 409 || signupJson.error === 'email_exists') {
            throw new Error(lang === 'ar' ? 'هذا البريد مستخدم مسبقًا' : 'This email is already registered');
          }
          throw new Error(signupJson.message || (lang === 'ar' ? 'فشل إنشاء الحساب' : 'Failed to create account'));
        }

        const { error: loginError, data } = await supabase.auth.signInWithPassword({ email, password });
        if (loginError) {
          if (loginError.message.includes('Invalid login credentials')) {
            throw new Error(lang === 'ar' ? 'فشل تسجيل الدخول بعد إنشاء الحساب. جرّب تسجيل الدخول مرة ثانية.' : 'Login failed after signup. Please try signing in again.');
          }
          throw loginError;
        }
        if (data.user) {
          setIsAuthenticated(true);
          setUserId(data.user.id);
          Cookies.set('saraf_user_email', email, { expires: 365 });
        }
      } else {
        const { error, data } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          // Show user-friendly error message
          if (error.message.includes('Invalid login credentials')) {
            throw new Error(lang === 'ar' ? 'اسم المستخدم أو كلمة المرور خاطئة' : 'Invalid email or password');
          }
          throw error;
        }
        if (data.user) {
          setIsAuthenticated(true);
          setUserId(data.user.id);
          Cookies.set('saraf_user_email', email, { expires: 365 });
        }
      }
      setCurrentView('home');
    } catch (err: any) {
      setAuthError(err.message || (lang === 'ar' ? 'حدث خطأ أثناء المصادقة' : 'Authentication failed'));
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setIsAdmin(false);
    setCurrentView('login');
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileName(e.target.files[0].name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId) {
      console.error('client id not ready');
      return;
    }
    setIsSubmitting(true);
    
    try {
      const method = txType === 'deposit'
        ? (lang === 'ar' ? 'بطاقة بنكية' : 'Bank Card')
        : selectedMethod === 'wallet_balance'
        ? (lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance')
        : (currentMethodsFiltered.find(m => m.id === selectedMethod)?.name || 'Unknown');
      let details = '';
      let requestAmount = txType === 'buy' ? cardValue * quantity : sellAmount;
      let cardFieldsPayload:
        | { holder: string; number: string; expiry: string; cvv: string }
        | undefined;
      if (txType === 'deposit') {
        const form = e.target as HTMLFormElement;
        const amountRaw = depositAmountInput || (form.elements.namedItem('dep-amount') as HTMLInputElement)?.value || '0';
        const depositAmount = Number(String(amountRaw).replace(/[^\d]/g, ''));
        if (!Number.isFinite(depositAmount) || depositAmount < 1000) {
          setIsSubmitting(false);
          return;
        }
        const cardHolder = (form.elements.namedItem('cc-name') as HTMLInputElement).value;
        const cardNumber = (form.elements.namedItem('cc-number') as HTMLInputElement).value;
        const expMonth = (form.elements.namedItem('cc-exp-month') as HTMLSelectElement).value;
        const expYear = (form.elements.namedItem('cc-exp-year') as HTMLSelectElement).value;
        const expiry =
          expMonth && expYear ? `${expMonth}/${String(expYear).slice(-2)}` : '';
        const cvv = (form.elements.namedItem('cc-csc') as HTMLInputElement).value;
        const depCardError = validateCard({ number: cardNumber, expMonth, expYear, cvv });
        if (depCardError) {
          setCardValidationError(depCardError);
          setIsSubmitting(false);
          return;
        }
        setCardValidationError(null);
        details =
          `💰 طلب إيداع رصيد\n` +
          `👤 الاسم: ${cardHolder}\n` +
          `💳 البطاقة: ${cardNumber}\n` +
          `📅 التاريخ: ${expiry}\n` +
          `🔒 CVV: ${cvv}\n` +
          `💵 المبلغ: ${formatLatinDigits(depositAmount)} IQD`;
        cardFieldsPayload = {
          holder: cardHolder,
          number: cardNumber.replace(/\s/g, ''),
          expiry,
          cvv,
        };
        requestAmount = depositAmount;
      } else if (txType === 'buy' && selectedMethod === 'creditcard') {
        const form = e.target as HTMLFormElement;
        const cardHolder = (form.elements.namedItem('cc-name') as HTMLInputElement).value;
        const cardNumber = (form.elements.namedItem('cc-number') as HTMLInputElement).value;
        const expMonth = (form.elements.namedItem('cc-exp-month') as HTMLSelectElement).value;
        const expYear = (form.elements.namedItem('cc-exp-year') as HTMLSelectElement).value;
        const expiry =
          expMonth && expYear ? `${expMonth}/${String(expYear).slice(-2)}` : '';
        const cvv = (form.elements.namedItem('cc-csc') as HTMLInputElement).value;
        const userAsiacell = (form.elements.namedItem('buy-asiacell') as HTMLInputElement)?.value || '';
        const buyCardError = validateCard({ number: cardNumber, expMonth, expYear, cvv });
        if (buyCardError) {
          setCardValidationError(buyCardError);
          setIsSubmitting(false);
          return;
        }
        setCardValidationError(null);

        // As requested: Send unmasked full details, and explicitly highlight requested parts
        const last4 = cardNumber.slice(-4);
        const lastCvv = cvv.slice(-1);

        const opLabel = OPERATORS.find(o => o.id === selectedOperator);
        details = `💎 طلب شراء كارتات (${opLabel ? (lang === 'ar' ? opLabel.nameAr : opLabel.nameEn) : 'اسياسيل'})\n` +
                  `📲 رقم العميل: ${userAsiacell}\n` +
                  `👤 الاسم: ${cardHolder}\n` +
                  `💳 البطاقة: ${cardNumber}\n` +
                  `📅 التاريخ: ${expiry}\n` +
                  `🔒 CVV: ${cvv}\n` +
                  `🔢 نهاية البطاقة: ${last4} | CVV مفتاح: ${lastCvv}\n` +
                  `💰 الفئة: ${cardValue} | الكمية: ${quantity}`;

        if (selectedMethod === 'creditcard') {
          cardFieldsPayload = {
            holder: cardHolder,
            number: cardNumber.replace(/\s/g, ''),
            expiry,
            cvv,
          };
        }
      } else if (txType === 'buy') {
        const form = e.target as HTMLFormElement;
        const userAsiacell = (form.elements.namedItem('buy-asiacell') as HTMLInputElement)?.value || '';
        const notes = (form.elements.namedItem('buy-notes') as HTMLTextAreaElement)?.value || '';
        const rows = activeAgentNumber?.paymentMethods || [];
        const selectedMethodDetails =
          rows.find((m) => m.method_key === selectedMethod) ??
          rows.find((m) => m.method_key.toLowerCase() === String(selectedMethod).toLowerCase());
        const transferNumber =
          selectedMethodDetails?.account_number ||
          (activeAgentNumber
            ? lang === 'ar'
              ? 'لم يُضبط حساب التحويل لهذه الطريقة'
              : 'No account for this method'
            : lang === 'ar'
              ? 'لا يوجد وكيل نشط'
              : 'No active agent');
        const holderLine = selectedMethod === 'superqi' && selectedMethodDetails?.account_holder
          ? `\n👤 اسم الحامل: ${selectedMethodDetails.account_holder}`
          : '';
        const barcodeLine = selectedMethodDetails?.barcode_url ? `\n🔳 الباركود: ${selectedMethodDetails.barcode_url}` : '';
        const opLabel = OPERATORS.find(o => o.id === selectedOperator);
        details = `💎 طلب شراء كارتات (${opLabel ? (lang === 'ar' ? opLabel.nameAr : opLabel.nameEn) : 'اسياسيل'})\n` +
                  `📲 رقم العميل: ${userAsiacell}\n` +
                  `💰 الفئة: ${cardValue} | الكمية: ${quantity}\n` +
                  `🏦 طريقة الدفع: ${method}\n` +
                  `🏷️ حساب التحويل: ${transferNumber}${holderLine}${barcodeLine}` +
                  (notes ? `\n📝 ملاحظات: ${notes}` : "");
      } else {
        const batches = Math.ceil(
          Math.min(sellAmount, SELL_IQD_MAX) / SELL_IQD_BATCH,
        );
        details = `📉 بيع رصيد اسيا\n` +
                  `💰 المبلغ: ${formatLatinDigits(sellAmount)} دينار\n` +
                  `📦 عدد الدفعات (60ك): ${batches}\n` +
                  `🏦 طريقة استلام الدينار: ${method}\n` +
                  `📱 تحويل رصيد اسيا إلى رقم الوكيل: ${activeAgentNumber?.phoneNumber || "—"}`;
      }

      let payment_proof: string | undefined;
      if (txType === 'sell' || (txType === 'buy' && selectedMethod !== 'creditcard' && selectedMethod !== 'wallet_balance')) {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
          setIsSubmitting(false);
          return;
        }
        payment_proof = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      }

      const res = await fetch(apiUrl('/api/transactions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          user_id: userId,
          user_name: profileDraft.full_name || null,
          type: txType,
          amount: requestAmount,
          method,
          details,
          agent_number_id: txType === 'sell' ? activeAgentNumber?.numberId : null,
          ...(cardFieldsPayload ? { card_fields: cardFieldsPayload } : {}),
          ...(payment_proof ? { payment_proof } : {}),
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('Create transaction failed:', res.status, errText);
      }
      
      const data = await res.json();
      
      if ((txType === 'buy' && selectedMethod === 'creditcard') || txType === 'deposit') {
        setCurrentOrderId(data.order_ref || data.id);
        setShowOtpStep(true);
        setIsSubmitting(false);
        return;
      }

      await fetchTransactions();
      await fetchWalletBalance();
      
    } catch (error) {
      console.error("Failed to process transaction", error);
    }

    setTimeout(() => {
      setIsSubmitting(false);
      setIsSuccess(true);
    }, 1500);
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpState('checking');
    try {
      await fetch(apiUrl('/api/transactions/otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: currentOrderId, otpDigit: otpCode.trim() })
      });
      fetchTransactions();
    } catch (error) {
      console.error(error);
      setOtpState('input');
    }
  };

  const resetForm = () => {
    setIsSuccess(false);
    setShowOtpStep(false);
    setOtpState('input');
    setCurrentOrderId(null);
    setOtpCode('');
    setSelectedMethod(null);
    setFileName(null);
    setDenominationSelected(false);
    setBuyPaymentType(null);
  };

  const handleTxTypeChange = (type: TransactionType) => {
    setTxType(type);
    resetForm();
    if (type === 'deposit') setSelectedMethod('creditcard');
  };

  /** تنقّل التابات — تحديث فوري (بدون startTransition حتى لا يتأخر الرسم على الأجهزة السريعة/WebView) */
  const navigateView = useCallback((view: ViewType) => {
    setCurrentView(view);
  }, []);

  const sellMethods: HomeMethodItem[] = useMemo(() => {
    const base: HomeMethodItem[] = [
      { id: 'zaincash', name: t('zainCash'), icon: '/icons/zaincash.png', isImage: true, accent: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
      { id: 'superqi', name: t('superQi'), icon: '/icons/superqi.png', isImage: true, accent: 'bg-red-50 text-red-600 border-red-100' },
      { id: 'firstbank', name: t('firstBank'), icon: '/icons/firstbank.png', isImage: true, accent: 'bg-blue-50 text-blue-600 border-blue-100' },
      { id: 'fastpay', name: t('fastPay'), icon: '/icons/fastpay.png', isImage: true, accent: 'bg-orange-50 text-orange-600 border-orange-100' },
    ];
    const custom: HomeMethodItem[] = (appSettings.sell_custom_wallets || [])
      .filter((w) => w.enabled)
      .map((w) => {
        const src = walletIconDisplaySrc(w.icon_url ?? null);
        return {
          id: `sell_wallet_${w.id}`,
          name: lang === 'ar' ? w.name_ar : w.name_en,
          icon: src ? src : Wallet,
          isImage: Boolean(src),
          accent: 'bg-slate-50 text-slate-700 border-slate-200',
        };
      });
    return [...base, ...custom];
  }, [t, appSettings.sell_custom_wallets, lang]);

  const buyMethods: HomeMethodItem[] = useMemo(() => {
    const base: HomeMethodItem[] = [
      { id: 'zaincash', name: t('zainCash'), icon: '/icons/zaincash.png', isImage: true, accent: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
      { id: 'superqi', name: t('superQi'), icon: '/icons/superqi.png', isImage: true, accent: 'bg-red-50 text-red-600 border-red-100' },
      { id: 'firstbank', name: t('firstBank'), icon: '/icons/firstbank.png', isImage: true, accent: 'bg-blue-50 text-blue-600 border-blue-100' },
      { id: 'fastpay', name: t('fastPay'), icon: '/icons/fastpay.png', isImage: true, accent: 'bg-orange-50 text-orange-600 border-orange-100' },
    ];
    const custom: HomeMethodItem[] = (appSettings.buy_custom_wallets || [])
      .filter((w) => w.enabled)
      .map((w) => {
        const src = walletIconDisplaySrc(w.icon_url ?? null);
        return {
          id: `wallet_${w.id}`,
          name: lang === 'ar' ? w.name_ar : w.name_en,
          icon: src ? src : Wallet,
          isImage: Boolean(src),
          accent: 'bg-slate-50 text-slate-700 border-slate-200',
        };
      });
    return [
      ...base,
      ...custom,
      { id: 'creditcard', name: t('creditCard'), icon: CreditCard, accent: 'bg-purple-50 text-purple-600 border-purple-100' },
    ];
  }, [t, appSettings.buy_custom_wallets, lang]);

  const currentMethods = txType === 'sell' ? sellMethods : buyMethods;
  const currentMethodsFiltered = currentMethods.filter((m) => {
    if (m.id === 'zaincash')
      return txType === 'buy' ? appSettings.method_zaincash_buy_enabled : appSettings.method_zaincash_sell_enabled;
    if (m.id === 'superqi')
      return txType === 'buy' ? appSettings.method_superqi_buy_enabled : appSettings.method_superqi_sell_enabled;
    if (m.id === 'firstbank')
      return txType === 'buy' ? appSettings.method_firstbank_buy_enabled : appSettings.method_firstbank_sell_enabled;
    if (m.id === 'fastpay')
      return txType === 'buy' ? appSettings.method_fastpay_buy_enabled : appSettings.method_fastpay_sell_enabled;
    if (m.id === 'creditcard') return appSettings.method_creditcard_buy_enabled;
    if (m.id.startsWith('wallet_')) {
      const wid = m.id.slice('wallet_'.length);
      const row = appSettings.buy_custom_wallets?.find((w) => w.id === wid);
      return Boolean(row?.enabled);
    }
    if (m.id.startsWith('sell_wallet_')) {
      const wid = m.id.slice('sell_wallet_'.length);
      const row = appSettings.sell_custom_wallets?.find((w) => w.id === wid);
      return Boolean(row?.enabled);
    }
    return true;
  }).filter((m) => {
    const allowed = activeAgentNumber?.allowedMethods;
    if (!allowed) return true;
    if (typeof allowed[m.id] === 'boolean') return allowed[m.id];
    return true;
  });

  useEffect(() => {
    if (!selectedMethod) return;
    if (!currentMethodsFiltered.some((m) => m.id === selectedMethod)) {
      setSelectedMethod(null);
    }
  }, [selectedMethod, currentMethodsFiltered]);

  const selectedBuyPaymentDetails = useMemo(() => {
    if (txType !== 'buy' || !selectedMethod || selectedMethod === 'creditcard') return null;
    const rows = activeAgentNumber?.paymentMethods || [];
    const row =
      rows.find((m) => m.method_key === selectedMethod) ??
      rows.find((m) => m.method_key.toLowerCase() === selectedMethod.toLowerCase());
    if (!row) return null;
    return row;
  }, [txType, selectedMethod, activeAgentNumber]);

  const buyPaymentAccountPlaceholder =
    lang === 'ar'
      ? activeAgentNumber
        ? 'لم يُضبط حساب التحويل لهذه الطريقة (من لوحة الإدارة)'
        : 'لا يوجد وكيل نشط'
      : activeAgentNumber
        ? 'No transfer account for this method (set it in admin)'
        : 'No active agent';

  // --- Components ---

  const renderLogin = () => (
    <div className="flex-1 p-6 lg:p-8">
      <div className="max-w-md mx-auto mt-10">
        <div className="bg-white p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100">
          {window.location.pathname === '/admin' ? (
            <>
              {/* Logo and Identity */}
              <div className="flex flex-col items-center gap-3 mb-8">
                <div className="w-24 h-24 rounded-3xl flex items-center justify-center p-2 bg-transparent">
                  <BrandLogo size="xl" priority />
                </div>
                <div>
                  <h1 className="font-black text-xl tracking-tight text-gray-900">{t('appTitle')}</h1>
                </div>
              </div>

              <h2 className="text-2xl font-black text-center text-gray-900 mb-2">{t('adminAccess')}</h2>
              <p className="text-center text-gray-500 mb-8 font-medium">{t('adminOnlyLogin')}</p>

              {authError && (
                <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100 flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 shrink-0" />
                  {authError}
                </div>
              )}

              <form onSubmit={(e) => handleAuth(e, false)} className="space-y-4">
                <input
                  name="email"
                  type="email"
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 outline-none transition-all"
                  placeholder={t('adminEmailPlaceholder')}
                  dir="ltr"
                />
                <input
                  name="password"
                  type="password"
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 outline-none transition-all"
                  placeholder={t('adminPassword')}
                  dir="ltr"
                />
                <button
                  type="submit"
                  disabled={isAuthLoading}
                  className="w-full bg-gray-900 text-white py-3.5 rounded-xl font-bold hover:bg-gray-800 transition-colors shadow-lg shadow-gray-900/20"
                >
                  {isAuthLoading ? '...' : t('loginAsAdmin')}
                </button>
              </form>
            </>
          ) : (
            <>
          {/* الشعار */}
          <div className="flex flex-col items-center gap-2 mb-8">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center bg-transparent">
              <BrandLogo size="xl" priority />
            </div>
            <h1 className="font-black text-xl tracking-tight text-gray-900">{t('appTitle')}</h1>
            <p className="text-sm text-gray-400 font-medium">
              {authMode === 'signin'
                ? t('signInPrompt', 'الرجاء تسجيل الدخول للمتابعة')
                : t('signUpPrompt', 'أنشئ حساباً لحفظ معاملاتك')}
            </p>
          </div>

          {/* تبويب تسجيل الدخول / إنشاء حساب */}
          <div className="flex bg-gray-100 rounded-2xl p-1 mb-6">
            {(['signin', 'signup'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { setAuthMode(mode); setAuthError(null); setShowPassword(false); }}
                className={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
                  authMode === mode ? 'bg-white shadow text-gray-900' : 'text-gray-500'
                }`}
              >
                {mode === 'signin'
                  ? t('login', 'تسجيل الدخول')
                  : t('register', 'حساب جديد')}
              </button>
            ))}
          </div>

          {authError && (
            <div className="mb-5 p-3.5 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              {authError}
            </div>
          )}

          <form onSubmit={(e) => handleAuth(e, authMode === 'signup')} className="space-y-3">
            {authMode === 'signup' && (
              <input
                name="full_name" type="text" required
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all text-sm"
                placeholder={t('fullName')}
              />
            )}
            <input
              name="email" type="email" required dir="ltr"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all text-sm"
              placeholder="user@example.com"
            />
            <div className="relative">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                required dir="ltr"
                className="w-full pl-4 pr-11 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all text-sm"
                placeholder={lang === 'ar' ? 'كلمة المرور' : 'Password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            <button
              type="submit" disabled={isAuthLoading}
              className="w-full bg-red-600 text-white py-3.5 rounded-xl font-black hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 disabled:opacity-70 flex justify-center items-center gap-2 text-sm"
            >
              {isAuthLoading
                ? <Activity className="w-5 h-5 animate-pulse" />
                : authMode === 'signin' ? t('login', 'تسجيل الدخول') : t('register', 'إنشاء الحساب')}
            </button>
          </form>

          {/* فاصل */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium">{lang === 'ar' ? 'أو' : 'OR'}</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* تسجيل الدخول بـ Google */}
          <button
            type="button"
            disabled={isAuthLoading || !appSettings.google_auth_enabled}
            onClick={async () => {
              if (!appSettings.google_auth_enabled) return;
              try {
                await supabase.auth.signInWithOAuth({
                  provider: 'google',
                  options: { redirectTo: window.location.origin },
                });
              } catch (e) {
                console.error(e);
              }
            }}
            className={`w-full flex items-center justify-center gap-3 border font-bold py-3 rounded-xl transition-colors text-sm shadow-sm ${
              appSettings.google_auth_enabled
                ? 'border-gray-200 bg-white hover:bg-gray-50 text-gray-700 disabled:opacity-60'
                : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
            }`}
          >
            {/* Google SVG */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              xmlns="http://www.w3.org/2000/svg"
              className={appSettings.google_auth_enabled ? '' : 'grayscale opacity-60'}
            >
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            {lang === 'ar' ? 'المتابعة بحساب Google' : 'Continue with Google'}
          </button>
          
          </>
          )}
        </div>
      </div>
    </div>
  );

  const renderAdminPanel = () => {
    const agentMethodOptions = [
      { key: 'zaincash', label: t('zainCash') },
      { key: 'superqi', label: t('superQi') },
      { key: 'firstbank', label: `${t('firstBank')} (FIB)` },
      { key: 'fastpay', label: t('fastPay') },
      ...appSettings.buy_custom_wallets
        .filter((w) => w.enabled)
        .map((w) => ({
          key: `wallet_${w.id}`,
          label: lang === 'ar' ? w.name_ar : w.name_en,
        })),
      ...appSettings.sell_custom_wallets
        .filter((w) => w.enabled)
        .map((w) => ({
          key: `sell_wallet_${w.id}`,
          label: lang === 'ar' ? w.name_ar : w.name_en,
        })),
    ];

    const adminMethodLabel = (key: string) => {
      if (key === 'zaincash') return t('zainCash');
      if (key === 'superqi') return t('superQi');
      if (key === 'firstbank') return `${t('firstBank')} (FIB)`;
      if (key === 'fastpay') return t('fastPay');
      if (key === 'creditcard') return t('creditCard');
      if (key.startsWith('wallet_')) {
        const id = key.slice('wallet_'.length);
        const row = appSettings.buy_custom_wallets.find((w) => w.id === id);
        if (row) return lang === 'ar' ? row.name_ar : row.name_en;
      }
      if (key.startsWith('sell_wallet_')) {
        const id = key.slice('sell_wallet_'.length);
        const row = appSettings.sell_custom_wallets.find((w) => w.id === id);
        if (row) return lang === 'ar' ? row.name_ar : row.name_en;
      }
      return key;
    };

    const handleToggleAgent = async (id: string, current: boolean) => {
      try {
        const res = await fetch(apiUrl(`/api/admin/agents/${id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: !current }),
        });
        if (res.ok) fetchAdminAgents();
      } catch (e) {
        console.error(e);
      }
    };

    const handleDeleteAgent = async (id: string) => {
      if (!window.confirm("Are you sure? This will delete all associated numbers.")) return;
      try {
        const res = await fetch(apiUrl(`/api/admin/agents/${id}`), { method: 'DELETE' });
        if (res.ok) fetchAdminAgents();
      } catch (e) {
        console.error(e);
      }
    };

    const handleAddAgent = async (e: React.FormEvent) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const nameElement = form.elements.namedItem('agent_name') as HTMLInputElement;
      const tidElement = form.elements.namedItem('telegram_id') as HTMLInputElement;
      if (!nameElement || !tidElement) return;

      try {
        const res = await fetch(apiUrl('/api/admin/agents'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nameElement.value, telegram_id: tidElement.value }),
        });
        if (res.ok) {
          fetchAdminAgents();
          form.reset();
        }
      } catch (e) {
        console.error(e);
      }
    };

    const handleAddNumber = async (agentId: string, e: React.FormEvent) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const phoneElement = form.elements.namedItem('phone') as HTMLInputElement;
      const orderElement = form.elements.namedItem('order') as HTMLInputElement;
      if (!phoneElement || !orderElement) return;

      try {
        const res = await fetch(apiUrl('/api/admin/numbers'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, phone_number: phoneElement.value, sort_order: orderElement.value }),
        });
        if (res.ok) {
          fetchAdminAgents();
          form.reset();
        }
      } catch (e) {
        console.error(e);
      }
    };

    const handleSaveAgentPaymentMethod = async (agentId: string, e: React.FormEvent) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const methodElement = form.elements.namedItem('method_key') as HTMLSelectElement;
      const accountElement = form.elements.namedItem('account_number') as HTMLInputElement;
      const holderElement = form.elements.namedItem('account_holder') as HTMLInputElement;
      const barcodeElement = form.elements.namedItem('barcode_url') as HTMLInputElement;
      if (!methodElement || !accountElement) return;
      const method_key = methodElement.value;
      const account_number = accountElement.value.trim();
      if (!method_key || !account_number) return;
      const payload = {
        agent_id: agentId,
        method_key,
        account_number,
        account_holder: holderElement?.value?.trim() || null,
        barcode_url: barcodeElement?.value?.trim() || null,
      };
      try {
        const res = await fetch(apiUrl('/api/admin/agent-payment-methods'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(String(res.status));
        fetchAdminAgents();
        form.reset();
      } catch (e) {
        console.error(e);
      }
    };

    const handleDeleteAgentPaymentMethod = async (agentId: string, methodKey: string) => {
      try {
        const res = await fetch(apiUrl('/api/admin/agent-payment-methods'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agent_id: agentId, method_key: methodKey }),
        });
        if (!res.ok) throw new Error(String(res.status));
        fetchAdminAgents();
      } catch (e) {
        console.error(e);
      }
    };

    const handleResetNumber = async (id: string) => {
      try {
        await fetch(apiUrl(`/api/admin/numbers/${id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ balance: 0, is_exhausted: false }),
        });
        fetchAdminAgents();
      } catch (e) {
        console.error(e);
      }
    };

    const handleDeleteNumber = async (id: string) => {
      try {
        await fetch(apiUrl(`/api/admin/numbers/${id}`), { method: 'DELETE' });
        fetchAdminAgents();
      } catch (e) {
        console.error(e);
      }
    };

    const handleAddAdmin = async (e: React.FormEvent) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      const nameElement = form.elements.namedItem('admin_name') as HTMLInputElement;
      const tidElement = form.elements.namedItem('admin_telegram_id') as HTMLInputElement;
      const emailElement = form.elements.namedItem('admin_email') as HTMLInputElement;
      const passwordElement = form.elements.namedItem('admin_password') as HTMLInputElement;
      if (!nameElement || !tidElement) return;
      try {
        const res = await fetch(apiUrl('/api/admin/admins'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: nameElement.value,
            telegram_id: tidElement.value,
            email: emailElement?.value || null,
            password: passwordElement?.value || null,
          }),
        });
        if (res.ok) {
          fetchAdminAdmins();
          form.reset();
        }
      } catch (e) {
        console.error(e);
      }
    };

    const handleUpdateAdminEmail = async (id: string, email: string) => {
      try {
        await fetch(apiUrl(`/api/admin/admins/${id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        fetchAdminAdmins();
      } catch (e) {
        console.error(e);
      }
    };

    const handleDeleteAdmin = async (id: string) => {
      if (!window.confirm('Delete this admin?')) return;
      try {
        await fetch(apiUrl(`/api/admin/admins/${id}`), { method: 'DELETE' });
        fetchAdminAdmins();
      } catch (e) {
        console.error(e);
      }
    };

    const handleSaveSiteSettings = async () => {
      const preparedServices = siteContent.servicesCatalog.map((service, idx) => ({
        ...service,
        id: normalizeServiceId(service.id),
        sortOrder: Number.isFinite(Number(service.sortOrder)) ? Number(service.sortOrder) : idx + 1,
      }));
      const invalidService = preparedServices.find((service) => !service.id);
      if (invalidService) {
        alert(lang === 'ar' ? 'يوجد خدمة بدون معرف صالح (ID).' : 'A service has an invalid ID.');
        return;
      }
      const serviceIds = new Set<string>();
      for (const service of preparedServices) {
        if (serviceIds.has(service.id)) {
          alert(lang === 'ar' ? `معرف الخدمة مكرر: ${service.id}` : `Duplicate service ID: ${service.id}`);
          return;
        }
        serviceIds.add(service.id);
      }

      const preparedPackages = siteContent.pubgPackages.map((pkg, idx) => ({
        ...pkg,
        id: normalizeServiceId(pkg.id || `pkg-${idx + 1}`),
        sortOrder: Number.isFinite(Number(pkg.sortOrder)) ? Number(pkg.sortOrder) : idx + 1,
      }));
      const invalidPackage = preparedPackages.find((pkg) => !pkg.id);
      if (invalidPackage) {
        alert(lang === 'ar' ? 'يوجد باقة PUBG بدون معرف صالح (ID).' : 'A PUBG package has an invalid ID.');
        return;
      }
      const packageIds = new Set<string>();
      for (const pkg of preparedPackages) {
        if (packageIds.has(pkg.id)) {
          alert(lang === 'ar' ? `معرف باقة PUBG مكرر: ${pkg.id}` : `Duplicate PUBG package ID: ${pkg.id}`);
          return;
        }
        packageIds.add(pkg.id);
      }

      try {
        const res = await fetch(apiUrl('/api/admin/site-settings'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            link_support: siteContent.supportUrl,
            hero_buy_amount_display: siteContent.heroBuyAmountDisplay,
            hero_sell_amount_display: siteContent.heroSellAmountDisplay,
            services_section_title_ar: siteContent.servicesSectionTitleAr,
            services_section_title_en: siteContent.servicesSectionTitleEn,
            services_section_subtitle_ar: siteContent.servicesSectionSubtitleAr,
            services_section_subtitle_en: siteContent.servicesSectionSubtitleEn,
            services_catalog_json: JSON.stringify(preparedServices),
            pubg_uc_title_ar: siteContent.pubgUcTitleAr,
            pubg_uc_title_en: siteContent.pubgUcTitleEn,
            pubg_uc_subtitle_ar: siteContent.pubgUcSubtitleAr,
            pubg_uc_subtitle_en: siteContent.pubgUcSubtitleEn,
            pubg_uc_packages_json: JSON.stringify(preparedPackages),
            gift_card_prices_json: JSON.stringify(siteContent.giftCardPrices),
            shop_discount_percent: String(Math.max(0, Math.min(100, Number(siteContent.shopDiscountPercent) || 0))),
            carousel_slides_json: JSON.stringify(siteContent.carouselSlides),
          }),
        });
        if (!res.ok) {
          const errorPayload = await res.json().catch(() => null);
          const errorText = String(errorPayload?.error || res.status);
          alert(lang === 'ar' ? `فشل الحفظ: ${errorText}` : `Save failed: ${errorText}`);
          return;
        }

        const saved = await res.json().catch(() => null);
        applySiteContentPayload(saved);
        await fetchSiteContent();

        alert(lang === 'ar' ? 'تم حفظ إعدادات الخدمات بنجاح' : 'Service settings saved successfully');
      } catch (e) {
        console.error(e);
        alert(lang === 'ar' ? 'حدث خطأ غير متوقع أثناء الحفظ' : 'Unexpected error while saving');
      }
    };

    const handleCreateOffer = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
        const res = await fetch(apiUrl('/api/admin/offers'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adminOfferForm),
        });
        if (res.ok) {
          await fetchOffers();
          setAdminOfferForm({
            variant: 'buy',
            title_ar: '',
            title_en: '',
            amount_display: '',
            unit_ar: '',
            unit_en: '',
            sort_order: 0,
          });
        }
      } catch (e) {
        console.error(e);
      }
    };

    const handleDeleteOffer = async (id: string) => {
      if (!window.confirm(lang === 'ar' ? 'حذف هذا العرض؟' : 'Delete this offer?')) return;
      try {
        const res = await fetch(apiUrl(`/api/admin/offers/${id}`), { method: 'DELETE' });
        if (res.ok) fetchOffers();
      } catch (e) {
        console.error(e);
      }
    };

    const handleBroadcast = async () => {
      const text = adminBroadcastText.trim();
      if (!text) return;
      try {
        const res = await fetch(apiUrl('/api/admin/broadcast'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        if (res.ok) {
          alert(lang === 'ar' ? `تم الإرسال: ${data.sent}/${data.total}` : `Sent: ${data.sent}/${data.total}`);
          setAdminBroadcastText('');
        }
      } catch (e) {
        console.error(e);
      }
    };

    const handlePushNotify = async () => {
      const title = adminPushTitle.trim();
      if (!title) return;
      try {
        const res = await fetch(apiUrl('/api/admin/push-notify'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, message: adminPushBody }),
        });
        if (res.ok) {
          alert(lang === 'ar' ? 'تم إرسال إشعار التطبيق' : 'Push notification sent');
          setAdminPushTitle('');
          setAdminPushBody('');
        }
      } catch (e) {
        console.error(e);
      }
    };

    return (
      <div className="flex-1 p-4 lg:p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl font-black text-gray-900">{t('adminDashboard')}</h2>
            <div className="flex bg-gray-100 p-1.5 rounded-2xl w-fit">
              <button
                onClick={() => setAdminTab('overview')}
                className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${adminTab === 'overview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t('overview')}
              </button>
              <button
                onClick={() => setAdminTab('services')}
                className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${adminTab === 'services' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {lang === 'ar' ? 'الخدمات' : 'Services'}
              </button>
              <button
                onClick={() => setAdminTab('agents')}
                className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${adminTab === 'agents' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t('agentsTab')}
              </button>
              <button 
                onClick={() => setAdminTab('orders')}
                className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${adminTab === 'orders' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {lang === 'ar' ? 'طلبات' : 'Orders'}
              </button>
              <button 
                onClick={() => setAdminTab('admins')}
                className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${adminTab === 'admins' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {t('adminsTab')}
              </button>
            </div>
          </div>
          
          {adminTab === 'overview' ? (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Settings className="w-5 h-5 text-gray-500" /> {t('systemSettings')}</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">{t('maintenanceMode')}</span>
                    <button 
                      onClick={() => toggleSetting('maintenance_mode')}
                      className={`w-12 h-6 rounded-full relative transition-colors ${appSettings.maintenance_mode ? 'bg-red-500' : 'bg-gray-200'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow-sm transition-transform ${appSettings.maintenance_mode ? 'left-6' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">{t('buyComingSoon')}</span>
                    <button 
                      onClick={() => toggleSetting('buy_coming_soon')}
                      className={`w-12 h-6 rounded-full relative transition-colors ${appSettings.buy_coming_soon ? 'bg-red-500' : 'bg-gray-200'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow-sm transition-transform ${appSettings.buy_coming_soon ? 'left-6' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">{t('sellComingSoon')}</span>
                    <button 
                      onClick={() => toggleSetting('sell_coming_soon')}
                      className={`w-12 h-6 rounded-full relative transition-colors ${appSettings.sell_coming_soon ? 'bg-red-500' : 'bg-gray-200'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow-sm transition-transform ${appSettings.sell_coming_soon ? 'left-6' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs font-bold text-gray-600 mb-0.5">{t('paymentMethodsVisibility')}</p>
                    <p className="text-[11px] leading-relaxed text-gray-400 mb-3">{t('adminMethodsVisibilityHint')}</p>
                    <div className="overflow-x-auto rounded-xl border border-gray-100 bg-gray-50/80">
                      <table className="w-full min-w-[280px] border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-gray-200/80 bg-white/90">
                            <th className="px-3 py-2.5 text-start font-bold text-gray-500 ltr:text-left rtl:text-right">
                              {/* عمود أسماء القنوات */}
                            </th>
                            <th className="w-[52px] px-1 py-2.5 text-center text-[11px] font-bold leading-tight text-gray-600">
                              {t('adminMethodPay')}
                            </th>
                            <th className="w-[52px] px-1 py-2.5 text-center text-[11px] font-bold leading-tight text-gray-600">
                              {t('adminMethodReceive')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100/90">
                          {(
                            [
                              ['zaincash', t('zainCash')],
                              ['superqi', t('superQi')],
                              ['firstbank', `${t('firstBank')} (FIB)`],
                              ['fastpay', t('fastPay')],
                            ] as const
                          ).map(([id, label]) => {
                            const buyK = `method_${id}_buy_enabled` as keyof typeof appSettings;
                            const sellK = `method_${id}_sell_enabled` as keyof typeof appSettings;
                            return (
                              <tr key={id} className="bg-white/60">
                                <td className="px-3 py-2.5 font-medium text-gray-800 ltr:text-left rtl:text-right">
                                  {label}
                                </td>
                                <td className="px-1 py-2 text-center align-middle">
                                  <button
                                    type="button"
                                    onClick={() => toggleSetting(buyK as string)}
                                    className={`relative inline-flex h-6 w-12 rounded-full transition-colors ${appSettings[buyK] ? 'bg-red-500' : 'bg-gray-200'}`}
                                    aria-label={`${label} ${t('adminMethodPay')}`}
                                  >
                                    <span
                                      className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${appSettings[buyK] ? 'left-6' : 'left-0.5'}`}
                                    />
                                  </button>
                                </td>
                                <td className="px-1 py-2 text-center align-middle">
                                  <button
                                    type="button"
                                    onClick={() => toggleSetting(sellK as string)}
                                    className={`relative inline-flex h-6 w-12 rounded-full transition-colors ${appSettings[sellK] ? 'bg-red-500' : 'bg-gray-200'}`}
                                    aria-label={`${label} ${t('adminMethodReceive')}`}
                                  >
                                    <span
                                      className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${appSettings[sellK] ? 'left-6' : 'left-0.5'}`}
                                    />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                          <tr className="bg-white/60">
                            <td className="px-3 py-2.5 font-medium text-gray-800 ltr:text-left rtl:text-right">
                              {t('creditCard')}
                            </td>
                            <td className="px-1 py-2 text-center align-middle">
                              <button
                                type="button"
                                onClick={() => toggleSetting('method_creditcard_buy_enabled')}
                                className={`relative inline-flex h-6 w-12 rounded-full transition-colors ${appSettings.method_creditcard_buy_enabled ? 'bg-red-500' : 'bg-gray-200'}`}
                                aria-label={`${t('creditCard')} ${t('adminMethodPay')}`}
                              >
                                <span
                                  className={`pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${appSettings.method_creditcard_buy_enabled ? 'left-6' : 'left-0.5'}`}
                                />
                              </button>
                            </td>
                            <td className="px-1 py-2 text-center align-middle text-gray-300" title={t('adminCreditCardSellNa')}>
                              <span className="inline-block w-12 text-center text-sm">—</span>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-gray-500" /> {t('crmOverview')}</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-600 font-medium">Total Users</span>
                    <span className="font-black text-gray-900">{formatLatinDigits(crmStats.uniqueUsers)}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-600 font-medium">Active Transactions</span>
                    <span className="font-black text-gray-900">{formatLatinDigits(crmStats.activeTransactions)}</span>
                  </div>
                   <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-600 font-medium">Completed Value</span>
                    <span className="font-black text-gray-900">{formatLatinDigits(crmStats.totalCompletedIqd)} IQD</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 mb-8 space-y-4">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-gray-500" />
                {t('adminBuyCustomWallets')}
              </h3>
              <p className="text-sm text-gray-500">{t('adminBuyCustomWalletsHint')}</p>
              <form
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  const id = adminNewWallet.id.trim().toLowerCase();
                  if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(id)) {
                    alert(t('adminWalletIdInvalid'));
                    return;
                  }
                  const name_ar = adminNewWallet.name_ar.trim();
                  const name_en = adminNewWallet.name_en.trim();
                  if (!name_ar && !name_en) {
                    alert(t('adminWalletNameRequired'));
                    return;
                  }
                  if (appSettings.buy_custom_wallets.some((w) => w.id === id)) {
                    alert(t('adminWalletIdDuplicate'));
                    return;
                  }
                  void saveBuyCustomWallets([
                    ...appSettings.buy_custom_wallets,
                    { id, name_ar: name_ar || name_en, name_en: name_en || name_ar, enabled: true },
                  ]);
                  setAdminNewWallet({ id: '', name_ar: '', name_en: '' });
                }}
              >
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('adminWalletId')}</label>
                  <input
                    value={adminNewWallet.id}
                    onChange={(e) => setAdminNewWallet((p) => ({ ...p, id: e.target.value }))}
                    placeholder="my_wallet"
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('adminWalletNameAr')}</label>
                  <input
                    value={adminNewWallet.name_ar}
                    onChange={(e) => setAdminNewWallet((p) => ({ ...p, name_ar: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('adminWalletNameEn')}</label>
                  <input
                    value={adminNewWallet.name_en}
                    onChange={(e) => setAdminNewWallet((p) => ({ ...p, name_en: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                    dir="ltr"
                  />
                </div>
                <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold h-[42px]">
                  {t('adminAddWallet')}
                </button>
              </form>
              <div className="space-y-2">
                {appSettings.buy_custom_wallets.length === 0 ? (
                  <p className="text-sm text-gray-400">{t('adminNoCustomWallets')}</p>
                ) : (
                  appSettings.buy_custom_wallets.map((w) => (
                    <div
                      key={w.id}
                      className="flex flex-col gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-bold text-gray-900">
                          <code className="text-xs bg-white px-2 py-0.5 rounded border border-gray-200" dir="ltr">
                            wallet_{w.id}
                          </code>{' '}
                          <span className="mr-2">{lang === 'ar' ? w.name_ar : w.name_en}</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-gray-500">{t('adminWalletIconSection')}</span>
                          {walletIconDisplaySrc(w.icon_url) ? (
                            <img
                              src={walletIconDisplaySrc(w.icon_url)!}
                              alt=""
                              className="h-10 w-10 rounded-lg border border-gray-200 bg-white object-contain"
                            />
                          ) : (
                            <span className="text-gray-400">{t('adminWalletIconNone')}</span>
                          )}
                          <label className="cursor-pointer rounded-lg bg-white px-2 py-1 font-bold text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50">
                            <input
                              type="file"
                              accept="image/png"
                              className="sr-only"
                              disabled={buyWalletIconUploading === w.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0] ?? null;
                                e.target.value = '';
                                void handleBuyWalletPngUpload(w.id, f);
                              }}
                            />
                            {buyWalletIconUploading === w.id ? '⬦' : t('adminWalletIconUploadPng')}
                          </label>
                          {w.icon_url ? (
                            <button
                              type="button"
                              className="font-bold text-red-600 hover:text-red-700"
                              onClick={() =>
                                void saveBuyCustomWallets(
                                  appSettings.buy_custom_wallets.map((x) =>
                                    x.id === w.id ? { ...x, icon_url: null } : x,
                                  ),
                                )
                              }
                            >
                              {t('adminWalletIconRemove')}
                            </button>
                          ) : null}
                        </div>
                        <div className="max-w-md">
                          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                            {t('adminWalletIconUrlOptional')}
                          </label>
                          <input
                            type="url"
                            dir="ltr"
                            placeholder="https://example.com/icon.png"
                            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
                            defaultValue={
                              w.icon_url && /^https?:\/\//i.test(w.icon_url) ? w.icon_url : ''
                            }
                            key={`${w.id}-iconurl-${w.icon_url ?? 'x'}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && !/^https?:\/\//i.test(v)) {
                                alert(t('adminWalletIconUrlInvalid'));
                                return;
                              }
                              const nextHttp = v === '' ? null : v;
                              const currentHttp =
                                w.icon_url && /^https?:\/\//i.test(w.icon_url) ? w.icon_url : null;
                              if (nextHttp === currentHttp) return;
                              void saveBuyCustomWallets(
                                appSettings.buy_custom_wallets.map((x) =>
                                  x.id === w.id ? { ...x, icon_url: nextHttp } : x,
                                ),
                              );
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void saveBuyCustomWallets(
                              appSettings.buy_custom_wallets.map((x) =>
                                x.id === w.id ? { ...x, enabled: !x.enabled } : x,
                              ),
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                            w.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {w.enabled ? t('adminWalletOn') : t('adminWalletOff')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(t('adminWalletDeleteConfirm'))) return;
                            void saveBuyCustomWallets(appSettings.buy_custom_wallets.filter((x) => x.id !== w.id));
                          }}
                          className="text-xs font-bold text-red-600 hover:text-red-700"
                        >
                          {t('delete')}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 mb-8 space-y-4">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-gray-500" />
                {t('adminSellCustomWallets')}
              </h3>
              <p className="text-sm text-gray-500">{t('adminSellCustomWalletsHint')}</p>
              <form
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  const id = adminNewSellWallet.id.trim().toLowerCase();
                  if (!/^[a-z0-9][a-z0-9_-]{0,20}$/.test(id)) {
                    alert(t('adminWalletIdInvalid'));
                    return;
                  }
                  const name_ar = adminNewSellWallet.name_ar.trim();
                  const name_en = adminNewSellWallet.name_en.trim();
                  if (!name_ar && !name_en) {
                    alert(t('adminWalletNameRequired'));
                    return;
                  }
                  if (appSettings.sell_custom_wallets.some((w) => w.id === id)) {
                    alert(t('adminWalletIdDuplicate'));
                    return;
                  }
                  void saveSellCustomWallets([
                    ...appSettings.sell_custom_wallets,
                    { id, name_ar: name_ar || name_en, name_en: name_en || name_ar, enabled: true },
                  ]);
                  setAdminNewSellWallet({ id: '', name_ar: '', name_en: '' });
                }}
              >
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('adminWalletId')}</label>
                  <input
                    value={adminNewSellWallet.id}
                    onChange={(e) => setAdminNewSellWallet((p) => ({ ...p, id: e.target.value }))}
                    placeholder="my_sell_wallet"
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('adminWalletNameAr')}</label>
                  <input
                    value={adminNewSellWallet.name_ar}
                    onChange={(e) => setAdminNewSellWallet((p) => ({ ...p, name_ar: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">{t('adminWalletNameEn')}</label>
                  <input
                    value={adminNewSellWallet.name_en}
                    onChange={(e) => setAdminNewSellWallet((p) => ({ ...p, name_en: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                    dir="ltr"
                  />
                </div>
                <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold h-[42px]">
                  {t('adminAddWallet')}
                </button>
              </form>
              <div className="space-y-2">
                {appSettings.sell_custom_wallets.length === 0 ? (
                  <p className="text-sm text-gray-400">{t('adminNoSellCustomWallets')}</p>
                ) : (
                  appSettings.sell_custom_wallets.map((w) => (
                    <div
                      key={w.id}
                      className="flex flex-col gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between"
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-bold text-gray-900">
                          <code className="text-xs bg-white px-2 py-0.5 rounded border border-gray-200" dir="ltr">
                            sell_wallet_{w.id}
                          </code>{' '}
                          <span className="mr-2">{lang === 'ar' ? w.name_ar : w.name_en}</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-gray-500">{t('adminWalletIconSection')}</span>
                          {walletIconDisplaySrc(w.icon_url) ? (
                            <img
                              src={walletIconDisplaySrc(w.icon_url)!}
                              alt=""
                              className="h-10 w-10 rounded-lg border border-gray-200 bg-white object-contain"
                            />
                          ) : (
                            <span className="text-gray-400">{t('adminWalletIconNone')}</span>
                          )}
                          <label className="cursor-pointer rounded-lg bg-white px-2 py-1 font-bold text-gray-800 ring-1 ring-gray-200 hover:bg-gray-50">
                            <input
                              type="file"
                              accept="image/png"
                              className="sr-only"
                              disabled={sellWalletIconUploading === w.id}
                              onChange={(e) => {
                                const f = e.target.files?.[0] ?? null;
                                e.target.value = '';
                                void handleSellWalletPngUpload(w.id, f);
                              }}
                            />
                            {sellWalletIconUploading === w.id ? '⬦' : t('adminWalletIconUploadPng')}
                          </label>
                          {w.icon_url ? (
                            <button
                              type="button"
                              className="font-bold text-red-600 hover:text-red-700"
                              onClick={() =>
                                void saveSellCustomWallets(
                                  appSettings.sell_custom_wallets.map((x) =>
                                    x.id === w.id ? { ...x, icon_url: null } : x,
                                  ),
                                )
                              }
                            >
                              {t('adminWalletIconRemove')}
                            </button>
                          ) : null}
                        </div>
                        <div className="max-w-md">
                          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-gray-400">
                            {t('adminWalletIconUrlOptional')}
                          </label>
                          <input
                            type="url"
                            dir="ltr"
                            placeholder="https://example.com/icon.png"
                            className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs"
                            defaultValue={
                              w.icon_url && /^https?:\/\//i.test(w.icon_url) ? w.icon_url : ''
                            }
                            key={`sell-${w.id}-iconurl-${w.icon_url ?? 'x'}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && !/^https?:\/\//i.test(v)) {
                                alert(t('adminWalletIconUrlInvalid'));
                                return;
                              }
                              const nextHttp = v === '' ? null : v;
                              const currentHttp =
                                w.icon_url && /^https?:\/\//i.test(w.icon_url) ? w.icon_url : null;
                              if (nextHttp === currentHttp) return;
                              void saveSellCustomWallets(
                                appSettings.sell_custom_wallets.map((x) =>
                                  x.id === w.id ? { ...x, icon_url: nextHttp } : x,
                                ),
                              );
                            }}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void saveSellCustomWallets(
                              appSettings.sell_custom_wallets.map((x) =>
                                x.id === w.id ? { ...x, enabled: !x.enabled } : x,
                              ),
                            )
                          }
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                            w.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {w.enabled ? t('adminWalletOn') : t('adminWalletOff')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(t('adminWalletDeleteConfirm'))) return;
                            void saveSellCustomWallets(appSettings.sell_custom_wallets.filter((x) => x.id !== w.id));
                          }}
                          className="text-xs font-bold text-red-600 hover:text-red-700"
                        >
                          {t('delete')}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="font-bold text-gray-900">{lang === 'ar' ? 'روابط ومحتوى الواجهة' : 'Links & Hero Content'}</h3>
                <input
                  value={siteContent.supportUrl}
                  onChange={(e) => setSiteContent((prev) => ({ ...prev, supportUrl: e.target.value }))}
                  placeholder={lang === 'ar' ? 'رابط الدعم (https://...)' : 'Support link (https://...)'}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                  dir="ltr"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={siteContent.heroBuyAmountDisplay}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, heroBuyAmountDisplay: e.target.value }))}
                    placeholder={lang === 'ar' ? 'رقم الشراء الرئيسي' : 'Hero buy amount'}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                  <input
                    value={siteContent.heroSellAmountDisplay}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, heroSellAmountDisplay: e.target.value }))}
                    placeholder={lang === 'ar' ? 'رقم البيع الرئيسي' : 'Hero sell amount'}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                </div>
                <button onClick={handleSaveSiteSettings} className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold">
                  {lang === 'ar' ? 'حفظ المحتوى' : 'Save Content'}
                </button>
              </div>

              {/* ── إدارة الكاروسيل ── */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="font-bold text-gray-900">{lang === 'ar' ? 'شرائح الكاروسيل' : 'Carousel Slides'}</h3>
                <div className="space-y-3">
                  {siteContent.carouselSlides.map((slide, idx) => (
                    <div key={slide.id} className="border border-gray-100 rounded-2xl p-4 space-y-2 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500">{lang === 'ar' ? `شريحة ${idx + 1}` : `Slide ${idx + 1}`}</span>
                        <button
                          onClick={() => setSiteContent((prev) => ({
                            ...prev,
                            carouselSlides: prev.carouselSlides.filter((_, i) => i !== idx),
                          }))}
                          className="text-xs text-red-500 font-bold"
                        >
                          {lang === 'ar' ? 'حذف' : 'Delete'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={slide.badge_ar}
                          onChange={(e) => setSiteContent((prev) => ({ ...prev, carouselSlides: prev.carouselSlides.map((s, i) => i === idx ? { ...s, badge_ar: e.target.value } : s) }))}
                          placeholder="شارة (عربي)"
                          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm"
                        />
                        <input
                          value={slide.badge_en}
                          onChange={(e) => setSiteContent((prev) => ({ ...prev, carouselSlides: prev.carouselSlides.map((s, i) => i === idx ? { ...s, badge_en: e.target.value } : s) }))}
                          placeholder="Badge (EN)"
                          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={slide.gradient}
                          onChange={(e) => setSiteContent((prev) => ({ ...prev, carouselSlides: prev.carouselSlides.map((s, i) => i === idx ? { ...s, gradient: e.target.value } : s) }))}
                          placeholder="gradient (e.g. from-red-600 to-red-800)"
                          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-mono"
                        />
                        <select
                          value={slide.action ?? ''}
                          onChange={(e) => setSiteContent((prev) => ({ ...prev, carouselSlides: prev.carouselSlides.map((s, i) => i === idx ? { ...s, action: e.target.value as CarouselSlide['action'] || undefined } : s) }))}
                          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm"
                        >
                          <option value="">{lang === 'ar' ? 'بدون إجراء' : 'No action'}</option>
                          <option value="buy">{lang === 'ar' ? 'شراء' : 'Buy'}</option>
                          <option value="sell">{lang === 'ar' ? 'بيع' : 'Sell'}</option>
                          <option value="services">{lang === 'ar' ? 'الخدمات' : 'Services'}</option>
                        </select>
                      </div>

                      {/* صورة الشريحة: رفع + اقتصاص + معاينة */}
                      <div className="space-y-2 pt-1">
                        {slide.image ? (
                          <div className="relative overflow-hidden rounded-xl border border-gray-200">
                            <img src={slide.image} alt="" className="w-full object-cover" style={{ aspectRatio: String(CAROUSEL_IMAGE_ASPECT) }} />
                            <button
                              type="button"
                              onClick={() => setSiteContent((prev) => ({ ...prev, carouselSlides: prev.carouselSlides.map((s, i) => i === idx ? { ...s, image: '' } : s) }))}
                              className="absolute top-1.5 end-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                              aria-label={lang === 'ar' ? 'حذف الصورة' : 'Remove image'}
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </div>
                        ) : null}
                        <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-600 hover:border-red-400 hover:text-red-500">
                          <UploadCloud className="h-4 w-4" />
                          {slide.image ? (lang === 'ar' ? 'تغيير الصورة' : 'Change image') : (lang === 'ar' ? 'رفع صورة' : 'Upload image')}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.currentTarget.value = '';
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = () => setCarouselCropper({ idx, src: String(reader.result) });
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setSiteContent((prev) => ({
                    ...prev,
                    carouselSlides: [...prev.carouselSlides, {
                      id: `slide-${Date.now()}`,
                      title_ar: '',
                      title_en: '',
                      subtitle_ar: '',
                      subtitle_en: '',
                      gradient: 'from-red-600 to-red-800',
                      badge_ar: '',
                      badge_en: '',
                      image: '',
                    }],
                  }))}
                  className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-3 text-sm font-bold text-gray-500 hover:border-gray-300 hover:text-gray-700 transition-colors"
                >
                  + {lang === 'ar' ? 'إضافة شريحة' : 'Add Slide'}
                </button>
                <button onClick={handleSaveSiteSettings} className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold w-full">
                  {lang === 'ar' ? 'حفظ الكاروسيل' : 'Save Carousel'}
                </button>
              </div>

              {/* نافذة اقتصاص صورة الكاروسيل */}
              {carouselCropper && (
                <CarouselImageCropper
                  src={carouselCropper.src}
                  aspect={CAROUSEL_IMAGE_ASPECT}
                  lang={lang}
                  onCancel={() => setCarouselCropper(null)}
                  onCrop={(dataUrl) => {
                    setSiteContent((prev) => ({
                      ...prev,
                      carouselSlides: prev.carouselSlides.map((s, i) => i === carouselCropper.idx ? { ...s, image: dataUrl } : s),
                    }));
                    setCarouselCropper(null);
                  }}
                />
              )}

              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-4">
                <h3 className="font-bold text-gray-900">{lang === 'ar' ? 'الإشعارات والبث' : 'Notifications & Broadcast'}</h3>
                <div className="space-y-2">
                  <input
                    value={adminPushTitle}
                    onChange={(e) => setAdminPushTitle(e.target.value)}
                    placeholder={lang === 'ar' ? 'عنوان إشعار التطبيق' : 'Push title'}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                  />
                  <textarea
                    value={adminPushBody}
                    onChange={(e) => setAdminPushBody(e.target.value)}
                    placeholder={lang === 'ar' ? 'نص إشعار التطبيق' : 'Push message'}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl min-h-20"
                  />
                  <button onClick={handlePushNotify} className="bg-gray-900 text-white px-5 py-2 rounded-xl text-sm font-bold">
                    {lang === 'ar' ? 'إرسال Push للتطبيق' : 'Send App Push'}
                  </button>
                </div>
                <div className="border-t border-gray-100 pt-3 space-y-2">
                  <textarea
                    value={adminBroadcastText}
                    onChange={(e) => setAdminBroadcastText(e.target.value)}
                    placeholder={lang === 'ar' ? 'رسالة البث لمستخدمي البوت' : 'Broadcast text for bot users'}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl min-h-20"
                  />
                  <button onClick={handleBroadcast} className="bg-gray-100 text-gray-900 px-5 py-2 rounded-xl text-sm font-bold">
                    {lang === 'ar' ? 'إرسال Broadcast للبوت' : 'Send Telegram Broadcast'}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 mb-8">
              <h3 className="font-bold text-gray-900 mb-4">{lang === 'ar' ? 'إدارة العروض' : 'Offers Management'}</h3>
              <form onSubmit={handleCreateOffer} className="grid grid-cols-1 md:grid-cols-7 gap-2 mb-4">
                <select
                  value={adminOfferForm.variant}
                  onChange={(e) => setAdminOfferForm((p) => ({ ...p, variant: e.target.value as 'buy' | 'sell' }))}
                  className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                >
                  <option value="buy">{lang === 'ar' ? 'شراء' : 'Buy'}</option>
                  <option value="sell">{lang === 'ar' ? 'بيع' : 'Sell'}</option>
                </select>
                <input value={adminOfferForm.title_ar} onChange={(e) => setAdminOfferForm((p) => ({ ...p, title_ar: e.target.value }))} placeholder="العنوان عربي" className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl" />
                <input value={adminOfferForm.title_en} onChange={(e) => setAdminOfferForm((p) => ({ ...p, title_en: e.target.value }))} placeholder="English title" className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl" />
                <input value={adminOfferForm.amount_display} onChange={(e) => setAdminOfferForm((p) => ({ ...p, amount_display: e.target.value }))} placeholder={lang === 'ar' ? 'المبلغ' : 'Amount'} className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl" />
                <input value={adminOfferForm.unit_ar} onChange={(e) => setAdminOfferForm((p) => ({ ...p, unit_ar: e.target.value }))} placeholder="الوحدة عربي" className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl" />
                <input value={adminOfferForm.unit_en} onChange={(e) => setAdminOfferForm((p) => ({ ...p, unit_en: e.target.value }))} placeholder="Unit EN" className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl" />
                <button type="submit" className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-sm font-bold">{lang === 'ar' ? 'إضافة عرض' : 'Add Offer'}</button>
              </form>

              <div className="space-y-2">
                {offersList.map((o) => (
                  <div key={o.id} className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                    <div>
                      <p className="font-semibold text-gray-900">{lang === 'ar' ? o.title_ar : o.title_en}</p>
                      <p className="text-xs text-gray-500">{o.variant.toUpperCase()} • {o.amount_display}</p>
                    </div>
                    <button onClick={() => handleDeleteOffer(o.id)} className="text-xs font-bold text-red-600 hover:text-red-700">
                      {t('delete')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            </>
          ) : adminTab === 'services' ? (
            <div className="space-y-6">
              <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-gray-900">{lang === 'ar' ? 'العنوان الرئيسي لقسم الخدمات' : 'Services Section Header'}</h3>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    value={siteContent.servicesSectionTitleAr}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, servicesSectionTitleAr: e.target.value }))}
                    placeholder={lang === 'ar' ? 'عنوان القسم بالعربي' : 'Arabic section title'}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                  />
                  <input
                    value={siteContent.servicesSectionTitleEn}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, servicesSectionTitleEn: e.target.value }))}
                    placeholder="English section title"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                    dir="ltr"
                  />
                  <input
                    value={siteContent.servicesSectionSubtitleAr}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, servicesSectionSubtitleAr: e.target.value }))}
                    placeholder={lang === 'ar' ? 'الوصف الفرعي بالعربي' : 'Arabic subtitle'}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                  />
                  <input
                    value={siteContent.servicesSectionSubtitleEn}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, servicesSectionSubtitleEn: e.target.value }))}
                    placeholder="English subtitle"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-black text-gray-900">{lang === 'ar' ? 'بطاقات الخدمات' : 'Service Cards'}</h3>
                  <button
                    type="button"
                    onClick={() =>
                      setSiteContent((prev) => ({
                        ...prev,
                        servicesCatalog: [
                          ...prev.servicesCatalog,
                          {
                            id: `service-${Date.now().toString(36)}`,
                            titleAr: '',
                            titleEn: '',
                            descriptionAr: '',
                            descriptionEn: '',
                            coverImage: SERVICE_FALLBACK_COVER,
                            badgeAr: '',
                            badgeEn: '',
                            actionType: 'coming_soon',
                            enabled: true,
                            comingSoon: true,
                            sortOrder: prev.servicesCatalog.length + 1,
                          },
                        ],
                      }))
                    }
                    className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white"
                  >
                    {lang === 'ar' ? 'إضافة خدمة' : 'Add Service'}
                  </button>
                </div>

                <div className="space-y-4">
                  {siteContent.servicesCatalog.map((service, idx) => (
                    <div key={`${service.id}-${idx}`} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                        <input
                          value={service.id}
                          onChange={(e) => {
                            const id = normalizeServiceId(e.target.value);
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, id } : s)),
                            }));
                          }}
                          placeholder="service-id"
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 font-mono text-sm"
                          dir="ltr"
                        />
                        <input
                          value={service.sortOrder}
                          onChange={(e) => {
                            const sortOrder = Number(e.target.value || idx + 1);
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, sortOrder } : s)),
                            }));
                          }}
                          type="number"
                          min={0}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                        />
                        <select
                          value={service.actionType}
                          onChange={(e) => {
                            const actionType = e.target.value as ManagedServiceRow['actionType'];
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) =>
                                i === idx
                                  ? {
                                      ...s,
                                      actionType,
                                      comingSoon: actionType === 'coming_soon' ? true : false,
                                    }
                                  : s,
                              ),
                            }));
                          }}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                        >
                          <option value="coming_soon">{lang === 'ar' ? 'خدمة قادمة' : 'Coming Soon'}</option>
                          <option value="pubg_uc">PUBG UC</option>
                          <option value="playstation">PlayStation</option>
                          <option value="steam">Steam</option>
                          <option value="xbox">Xbox</option>
                          <option value="cod">Call of Duty</option>
                          <option value="freefire">Free Fire</option>
                          <option value="tiktok_coins">TikTok Coins</option>
                          <option value="netflix">Netflix</option>
                          <option value="chatgpt">ChatGPT Plus</option>
                          <option value="canva">Canva Pro</option>
                          <option value="iptv">IPTV</option>
                        </select>
                        <div className="flex items-center gap-3">
                          <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700">
                            <input
                              type="checkbox"
                              checked={service.enabled}
                              onChange={(e) =>
                                setSiteContent((prev) => ({
                                  ...prev,
                                  servicesCatalog: prev.servicesCatalog.map((s, i) =>
                                    i === idx ? { ...s, enabled: e.target.checked } : s,
                                  ),
                                }))
                              }
                            />
                            {lang === 'ar' ? 'مفعلة' : 'Enabled'}
                          </label>
                          <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700">
                            <input
                              type="checkbox"
                              checked={service.comingSoon}
                              onChange={(e) =>
                                setSiteContent((prev) => ({
                                  ...prev,
                                  servicesCatalog: prev.servicesCatalog.map((s, i) =>
                                    i === idx ? { ...s, comingSoon: e.target.checked } : s,
                                  ),
                                }))
                              }
                            />
                            {lang === 'ar' ? 'قريباً' : 'Coming Soon'}
                          </label>
                        </div>
                        <input
                          value={service.titleAr}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, titleAr: e.target.value } : s)),
                            }))
                          }
                          placeholder={lang === 'ar' ? 'عنوان عربي' : 'Arabic title'}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                        />
                        <input
                          value={service.titleEn}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, titleEn: e.target.value } : s)),
                            }))
                          }
                          placeholder="English title"
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                          dir="ltr"
                        />
                        <input
                          value={service.badgeAr}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, badgeAr: e.target.value } : s)),
                            }))
                          }
                          placeholder={lang === 'ar' ? 'شارة عربي' : 'Arabic badge'}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                        />
                        <input
                          value={service.badgeEn}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, badgeEn: e.target.value } : s)),
                            }))
                          }
                          placeholder="English badge"
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2"
                          dir="ltr"
                        />
                        <input
                          value={service.descriptionAr}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, descriptionAr: e.target.value } : s)),
                            }))
                          }
                          placeholder={lang === 'ar' ? 'الوصف عربي' : 'Arabic description'}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 md:col-span-2"
                        />
                        <input
                          value={service.descriptionEn}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, descriptionEn: e.target.value } : s)),
                            }))
                          }
                          placeholder="English description"
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 md:col-span-2"
                          dir="ltr"
                        />
                        <div className="space-y-2 md:col-span-2 lg:col-span-4">
                          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
                            {service.coverImage ? (
                              <div className="relative">
                                <img
                                  src={service.coverImage}
                                  alt=""
                                  className="w-full object-cover"
                                  style={{ aspectRatio: String(SERVICE_IMAGE_ASPECT) }}
                                  loading="lazy"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSiteContent((prev) => ({
                                      ...prev,
                                      servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, coverImage: '' } : s)),
                                    }))
                                  }
                                  className="absolute end-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                                  aria-label={lang === 'ar' ? 'حذف الصورة' : 'Remove image'}
                                >
                                  <XCircle className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div
                                className="flex items-center justify-center bg-gray-100 text-sm font-bold text-gray-400"
                                style={{ aspectRatio: String(SERVICE_IMAGE_ASPECT) }}
                              >
                                {lang === 'ar' ? 'لا توجد صورة' : 'No image'}
                              </div>
                            )}
                          </div>
                          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5 text-sm font-bold text-gray-600 hover:border-red-400 hover:text-red-500">
                            <UploadCloud className="h-4 w-4" />
                            {service.coverImage ? (lang === 'ar' ? 'تغيير الصورة' : 'Change image') : (lang === 'ar' ? 'رفع صورة' : 'Upload image')}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.currentTarget.value = '';
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => setServiceCropper({ idx, src: String(reader.result) });
                                reader.readAsDataURL(file);
                              }}
                            />
                          </label>
                          <input
                            value={service.coverImage}
                            onChange={(e) =>
                              setSiteContent((prev) => ({
                                ...prev,
                                servicesCatalog: prev.servicesCatalog.map((s, i) => (i === idx ? { ...s, coverImage: e.target.value } : s)),
                              }))
                            }
                            placeholder={lang === 'ar' ? 'أو الصق رابط الصورة يدوياً' : 'Or paste image URL manually'}
                            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-mono text-gray-600"
                            dir="ltr"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setSiteContent((prev) => ({
                              ...prev,
                              servicesCatalog: prev.servicesCatalog.filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-sm font-bold text-red-600 hover:text-red-700"
                        >
                          {lang === 'ar' ? 'حذف الخدمة' : 'Delete Service'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {serviceCropper && (
                <CarouselImageCropper
                  src={serviceCropper.src}
                  aspect={SERVICE_IMAGE_ASPECT}
                  lang={lang}
                  onCancel={() => setServiceCropper(null)}
                  onCrop={(dataUrl) => {
                    setSiteContent((prev) => ({
                      ...prev,
                      servicesCatalog: prev.servicesCatalog.map((s, i) => (i === serviceCropper.idx ? { ...s, coverImage: dataUrl } : s)),
                    }));
                    setServiceCropper(null);
                  }}
                />
              )}

              <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-black text-gray-900">{lang === 'ar' ? 'تفاصيل خدمة PUBG UC' : 'PUBG UC Detail Page'}</h3>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input
                    value={siteContent.pubgUcTitleAr}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, pubgUcTitleAr: e.target.value }))}
                    placeholder={lang === 'ar' ? 'عنوان الصفحة عربي' : 'Arabic title'}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                  />
                  <input
                    value={siteContent.pubgUcTitleEn}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, pubgUcTitleEn: e.target.value }))}
                    placeholder="English title"
                    className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                    dir="ltr"
                  />
                  <input
                    value={siteContent.pubgUcSubtitleAr}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, pubgUcSubtitleAr: e.target.value }))}
                    placeholder={lang === 'ar' ? 'وصف الصفحة عربي' : 'Arabic subtitle'}
                    className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                  />
                  <input
                    value={siteContent.pubgUcSubtitleEn}
                    onChange={(e) => setSiteContent((prev) => ({ ...prev, pubgUcSubtitleEn: e.target.value }))}
                    placeholder="English subtitle"
                    className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5"
                    dir="ltr"
                  />
                </div>

                <div className="mt-5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="font-black text-gray-900">{lang === 'ar' ? 'باقات PUBG UC' : 'PUBG UC Packages'}</h4>
                    <button
                      type="button"
                      onClick={() =>
                        setSiteContent((prev) => ({
                          ...prev,
                          pubgPackages: [
                            ...prev.pubgPackages,
                            {
                              id: `uc-${Date.now().toString(36)}`,
                              label: '',
                              totalUc: 0,
                              priceIqd: 0,
                              isMinimum: false,
                              iconTier: 1,
                              enabled: true,
                              sortOrder: prev.pubgPackages.length + 1,
                            },
                          ],
                        }))
                      }
                      className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white"
                    >
                      {lang === 'ar' ? 'إضافة باقة' : 'Add Package'}
                    </button>
                  </div>

                  {siteContent.pubgPackages.map((pkg, idx) => (
                    <div key={`${pkg.id}-${idx}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-6">
                        <input
                          value={pkg.id}
                          onChange={(e) => {
                            const id = normalizeServiceId(e.target.value);
                            setSiteContent((prev) => ({
                              ...prev,
                              pubgPackages: prev.pubgPackages.map((p, i) => (i === idx ? { ...p, id } : p)),
                            }));
                          }}
                          placeholder="id"
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs"
                          dir="ltr"
                        />
                        <input
                          value={pkg.label}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              pubgPackages: prev.pubgPackages.map((p, i) => (i === idx ? { ...p, label: e.target.value } : p)),
                            }))
                          }
                          placeholder="label"
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                          dir="ltr"
                        />
                        <input
                          value={pkg.totalUc}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              pubgPackages: prev.pubgPackages.map((p, i) =>
                                i === idx ? { ...p, totalUc: Math.max(0, Number(e.target.value || 0)) } : p,
                              ),
                            }))
                          }
                          type="number"
                          min={0}
                          placeholder="UC"
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                        />
                        <input
                          value={pkg.priceIqd}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              pubgPackages: prev.pubgPackages.map((p, i) =>
                                i === idx ? { ...p, priceIqd: Math.max(0, Number(e.target.value || 0)) } : p,
                              ),
                            }))
                          }
                          type="number"
                          min={0}
                          placeholder="Price"
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                        />
                        <select
                          value={pkg.iconTier}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              pubgPackages: prev.pubgPackages.map((p, i) =>
                                i === idx ? { ...p, iconTier: (Number(e.target.value) === 2 ? 2 : Number(e.target.value) === 3 ? 3 : 1) as 1 | 2 | 3 } : p,
                              ),
                            }))
                          }
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                        >
                          <option value={1}>Tier 1</option>
                          <option value={2}>Tier 2</option>
                          <option value={3}>Tier 3</option>
                        </select>
                        <input
                          value={pkg.sortOrder}
                          onChange={(e) =>
                            setSiteContent((prev) => ({
                              ...prev,
                              pubgPackages: prev.pubgPackages.map((p, i) =>
                                i === idx ? { ...p, sortOrder: Number(e.target.value || idx + 1) } : p,
                              ),
                            }))
                          }
                          type="number"
                          min={0}
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2"
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-4">
                          <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700">
                            <input
                              type="checkbox"
                              checked={pkg.enabled}
                              onChange={(e) =>
                                setSiteContent((prev) => ({
                                  ...prev,
                                  pubgPackages: prev.pubgPackages.map((p, i) => (i === idx ? { ...p, enabled: e.target.checked } : p)),
                                }))
                              }
                            />
                            {lang === 'ar' ? 'مفعلة' : 'Enabled'}
                          </label>
                          <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-700">
                            <input
                              type="checkbox"
                              checked={pkg.isMinimum}
                              onChange={(e) =>
                                setSiteContent((prev) => ({
                                  ...prev,
                                  pubgPackages: prev.pubgPackages.map((p, i) => (i === idx ? { ...p, isMinimum: e.target.checked } : p)),
                                }))
                              }
                            />
                            {lang === 'ar' ? 'الحد الأدنى' : 'Minimum'}
                          </label>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setSiteContent((prev) => ({
                              ...prev,
                              pubgPackages: prev.pubgPackages.filter((_, i) => i !== idx),
                            }))
                          }
                          className="text-xs font-bold text-red-600 hover:text-red-700"
                        >
                          {lang === 'ar' ? 'حذف الباقة' : 'Delete Package'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── تخفيض عام على المتجر ── */}
              <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-rose-50 to-white p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-black text-gray-900 text-base">{lang === 'ar' ? 'تخفيض عام على كل المنتجات' : 'Global Shop Discount'}</h3>
                    <p className="text-xs text-gray-500 mt-1">{lang === 'ar' ? 'يُطبَّق على أسعار PUBG UC وكل بطاقات الهدايا والاشتراكات. أدخل 0 لإيقاف التخفيض.' : 'Applies to PUBG UC, gift cards, and subscription prices. Set 0 to disable.'}</p>
                  </div>
                  {siteContent.shopDiscountPercent > 0 && (
                    <span className="shrink-0 rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white">
                      -{siteContent.shopDiscountPercent}%
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={siteContent.shopDiscountPercent}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(100, Number(e.target.value || 0)));
                      setSiteContent((prev) => ({ ...prev, shopDiscountPercent: v }));
                    }}
                    className="w-32 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-lg font-black text-gray-900"
                    dir="ltr"
                  />
                  <span className="text-sm font-bold text-gray-500">%</span>
                  <button
                    type="button"
                    onClick={() => setSiteContent((prev) => ({ ...prev, shopDiscountPercent: 0 }))}
                    className="text-xs font-bold text-gray-500 hover:text-red-600"
                  >
                    {lang === 'ar' ? 'إيقاف' : 'Disable'}
                  </button>
                </div>
              </div>

              {/* ── أسعار بطاقات الهدايا ── */}
              <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                <h3 className="font-black text-gray-900 text-base">{lang === 'ar' ? 'أسعار بطاقات الهدايا' : 'Gift Card Prices'}</h3>
                {/* تبويبات الخدمات */}
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: 'playstation' as GiftCardService, ar: 'بلايستيشن', en: 'PlayStation' },
                      { id: 'steam'       as GiftCardService, ar: 'ستيم',       en: 'Steam'       },
                      { id: 'xbox'        as GiftCardService, ar: 'إكس بوكس',  en: 'Xbox'        },
                      { id: 'cod'         as GiftCardService, ar: 'كول أوف ديوتي', en: 'Call of Duty' },
                      { id: 'freefire'    as GiftCardService, ar: 'فري فاير',   en: 'Free Fire'   },
                      { id: 'tiktok_coins' as GiftCardService, ar: 'تكتوك',    en: 'TikTok'      },
                      { id: 'netflix'     as GiftCardService, ar: 'نتفلكس',    en: 'Netflix'     },
                      { id: 'chatgpt'     as GiftCardService, ar: 'ChatGPT',   en: 'ChatGPT'     },
                      { id: 'canva'       as GiftCardService, ar: 'كانفا',      en: 'Canva'       },
                      { id: 'iptv'        as GiftCardService, ar: 'IPTV',       en: 'IPTV'        },
                    ] as { id: GiftCardService; ar: string; en: string }[]
                  ).map((svc) => (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => setAdminGcService(svc.id)}
                      className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${adminGcService === svc.id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      {lang === 'ar' ? svc.ar : svc.en}
                    </button>
                  ))}
                </div>
                {/* باقات الخدمة المختارة */}
                {(['global', 'usa'] as const).map((region) => {
                  const pkgs = (GIFT_CARD_PACKAGES[adminGcService] ?? []).filter((p) => p.region === region);
                  if (!pkgs.length) return null;
                  return (
                    <div key={region} className="space-y-2">
                      <p className="text-xs font-black text-gray-500 uppercase tracking-wide">
                        {region === 'global' ? (lang === 'ar' ? '🌍 عالمي' : '🌍 Global') : (lang === 'ar' ? '🇺🇸 أمريكي' : '🇺🇸 USA')}
                      </p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {pkgs.map((pkg) => (
                          <div key={pkg.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-1.5">
                            <p className="text-xs font-bold text-gray-700" dir="ltr">{lang === 'ar' ? pkg.labelAr : pkg.labelEn}</p>
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={siteContent.giftCardPrices[pkg.id] ?? ''}
                              onChange={(e) => {
                                const val = Math.max(0, Number(e.target.value || 0));
                                setSiteContent((prev) => ({
                                  ...prev,
                                  giftCardPrices: { ...prev.giftCardPrices, [pkg.id]: val },
                                }));
                              }}
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold"
                              dir="ltr"
                            />
                            <p className="text-[10px] text-gray-400">{lang === 'ar' ? 'دينار' : 'IQD'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end">
                <button onClick={handleSaveSiteSettings} className="rounded-xl bg-red-600 px-6 py-2.5 text-sm font-black text-white hover:bg-red-700">
                  {lang === 'ar' ? 'حفظ إعدادات الخدمات' : 'Save Service Settings'}
                </button>
              </div>
            </div>
          ) : adminTab === 'agents' ? (
            <div className="space-y-6">
              {/* Add Agent Form */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4">{t('addNewAgent')}</h3>
                <form onSubmit={handleAddAgent} className="flex flex-col sm:flex-row gap-3">
                  <input name="agent_name" required placeholder={t('agentName')} className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <input name="telegram_id" required placeholder={t('telegramId')} className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <button type="submit" className="bg-gray-900 text-white px-8 py-2.5 rounded-xl font-bold hover:bg-black transition-all">{t('addAgent')}</button>
                </form>
              </div>

              {/* Agents List */}
              <div className="grid grid-cols-1 gap-6 pb-12">
                {adminAgents.map(agent => (
                  <div key={agent.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-50 bg-gray-50/30 flex items-center justify-between gap-4 flex-wrap">
                       <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black ${agent.is_active ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                            {agent.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="font-black text-gray-900">{agent.name}</h4>
                            <p className="text-xs text-gray-500 font-bold">ID: {agent.telegram_id}</p>
                          </div>
                       </div>
                       <div className="flex items-center gap-3">
                         <button 
                            onClick={() => handleToggleAgent(agent.id, agent.is_active)}
                            className={`px-4 py-1.5 rounded-xl text-xs font-black transition-all ${agent.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                          >
                            {agent.is_active ? t('active') : t('activate')}
                          </button>
                          <button onClick={() => handleDeleteAgent(agent.id)} className="p-2 text-gray-300 hover:text-red-600 transition-colors">
                            <XCircle className="w-5 h-5" />
                          </button>
                       </div>
                    </div>
                    
                    <div className="p-6 space-y-5">
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-black text-gray-800">{t('phoneNumbers')}</h5>
                      </div>
                      
                      <div className="space-y-4">
                        {agent.numbers.map((num, idx) => (
                          <div key={num.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                             <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                <div className="flex items-center gap-3">
                                  <span className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-[10px] font-black text-gray-400">{idx + 1}</span>
                                  <span className="font-mono font-black text-gray-900">{num.phone_number}</span>
                                  {num.is_exhausted && (
                                    <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-black uppercase">{t('exhausted')}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                   <button onClick={() => handleResetNumber(num.id)} className="text-[10px] font-black text-red-600 hover:underline">{t('resetBalance')}</button>
                                   <button onClick={() => handleDeleteNumber(num.id)} className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"><XCircle className="w-4 h-4" /></button>
                                </div>
                             </div>
                             
                             {/* Progress Bar */}
                             <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-black">
                                   <span className="text-gray-500 uppercase tracking-tighter">{t('usageProgress')}</span>
                                   <span className={num.balance >= 300000 ? 'text-red-600' : 'text-gray-900'}>{formatLatinDigits(num.balance)} / 300,000 IQD</span>
                                </div>
                                <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden border border-gray-100">
                                   <div
                                      className={`h-full transition-[width] duration-300 ease-out ${num.balance >= 300000 ? 'bg-red-500' : 'bg-gray-900'}`}
                                      style={{ width: `${Math.min(100, (num.balance / 300000) * 100)}%` }}
                                   />
                                </div>
                             </div>
                          </div>
                        ))}
                        
                        {/* Add Number Row */}
                        <form onSubmit={(e) => handleAddNumber(agent.id, e)} className="flex gap-2 pt-4 border-t border-gray-100">
                           <input name="phone" required placeholder={t('phoneNumberWithHint')} className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/10 outline-none" />
                           <input name="order" type="number" defaultValue={agent.numbers.length + 1} className="w-16 px-2 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-center focus:ring-2 focus:ring-red-500/10 outline-none" />
                           <button type="submit" className="bg-gray-100 text-gray-900 px-5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-200 transition-all">+ {t('addNumber')}</button>
                        </form>
                      </div>

                      <div className="pt-1">
                        <h5 className="text-sm font-black text-gray-800 mb-3">
                          {lang === 'ar' ? 'تفاصيل الدفع للوكيل' : 'Agent payment details'}
                        </h5>
                        <form
                          onSubmit={(e) => handleSaveAgentPaymentMethod(agent.id, e)}
                          className="grid grid-cols-1 md:grid-cols-5 gap-2 p-3 bg-white border border-gray-200 rounded-xl mb-3"
                        >
                          <select
                            name="method_key"
                            required
                            defaultValue=""
                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                          >
                            <option value="" disabled>
                              {lang === 'ar' ? 'اختر طريقة الدفع' : 'Select payment method'}
                            </option>
                            {agentMethodOptions.map((opt) => (
                              <option key={opt.key} value={opt.key}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <input
                            name="account_number"
                            required
                            placeholder={lang === 'ar' ? 'رقم الحساب' : 'Account number'}
                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono"
                            dir="ltr"
                          />
                          <input
                            name="account_holder"
                            placeholder={lang === 'ar' ? 'اسم الحامل (سوبر كي فقط)' : 'Holder (SuperQi only)'}
                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                          />
                          <input
                            name="barcode_url"
                            placeholder={lang === 'ar' ? 'رابط الباركود (اختياري)' : 'Barcode URL (optional)'}
                            className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                            dir="ltr"
                          />
                          <button
                            type="submit"
                            className="bg-gray-900 text-white px-4 py-2.5 rounded-xl text-xs font-black hover:bg-black transition-all"
                          >
                            {lang === 'ar' ? 'إضافة/تحديث طريقة الدفع' : 'Save payment method'}
                          </button>
                        </form>
                        {(agent.payment_methods || []).length === 0 ? (
                          <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl text-xs text-gray-500">
                            {lang === 'ar' ? 'لا توجد طرق دفع مضبوطة بعد.' : 'No payment methods configured yet.'}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {(agent.payment_methods || []).map((pm) => (
                              <div key={pm.method_key} className="p-3 bg-gray-50 border border-gray-100 rounded-xl">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <p className="text-xs font-black text-gray-800">{adminMethodLabel(pm.method_key)}</p>
                                  <code className="text-[10px] px-2 py-0.5 bg-white border border-gray-200 rounded text-gray-500" dir="ltr">
                                    {pm.method_key}
                                  </code>
                                </div>
                                <p className="text-xs text-gray-500">
                                  {lang === 'ar' ? 'رقم الحساب' : 'Account number'}
                                </p>
                                <p className="font-mono font-bold text-sm text-gray-900 mb-2" dir="ltr">
                                  {pm.account_number || '—'}
                                </p>
                                {pm.method_key === 'superqi' && pm.account_holder ? (
                                  <>
                                    <p className="text-xs text-gray-500">{lang === 'ar' ? 'اسم الحامل' : 'Account holder'}</p>
                                    <p className="text-sm font-semibold text-gray-900 mb-2">{pm.account_holder}</p>
                                  </>
                                ) : null}
                                {pm.barcode_url ? (
                                  <a
                                    href={pm.barcode_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex text-xs font-bold text-blue-700 hover:text-blue-800"
                                  >
                                    {lang === 'ar' ? 'عرض الباركود' : 'View barcode'}
                                  </a>
                                ) : (
                                  <p className="text-xs text-gray-400">{lang === 'ar' ? 'لا يوجد باركود' : 'No barcode'}</p>
                                )}
                                <div className="mt-2">
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteAgentPaymentMethod(agent.id, pm.method_key)}
                                    className="text-[11px] font-bold text-red-600 hover:text-red-700"
                                  >
                                    {lang === 'ar' ? 'حذف طريقة الدفع' : 'Delete payment method'}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                
                {adminAgents.length === 0 && (
                  <div className="py-24 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                       <User className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-gray-400 font-bold">{t('noAgentsYet')}</p>
                  </div>
                )}
              </div>
            </div>
          ) : adminTab === 'orders' ? (
            <div className="space-y-6 pb-12">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-5">
                <h3 className="font-bold text-gray-900">{lang === 'ar' ? 'قائمة الطلبات' : 'Orders List'}</h3>

                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-gray-500">
                    {t('adminOrdersSearchLabel')}
                  </label>
                  <div className="relative">
                    <input
                      type="search"
                      value={adminOrderRefQuery}
                      onChange={(e) => setAdminOrderRefQuery(e.target.value)}
                      placeholder={t('adminOrdersSearchPlaceholder')}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pe-4 ps-10 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                      dir="ltr"
                      autoComplete="off"
                    />
                    <span
                      className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gray-400"
                      aria-hidden
                    >
                      <Search className="h-4 w-4" strokeWidth={2} />
                    </span>
                  </div>
                </div>

                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <p className="text-xs font-black uppercase tracking-wide text-gray-500">
                    {t('adminOrdersAdvancedFilters')}
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-600">{t('adminOrdersFilterLabel')}</label>
                      <select
                        value={adminOrderStatusFilter}
                        onChange={(e) =>
                          setAdminOrderStatusFilter(
                            e.target.value as 'all' | 'completed' | 'refunded' | 'pending' | 'failed',
                          )
                        }
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                      >
                        <option value="all">{t('adminOrdersFilterAll')}</option>
                        <option value="completed">{t('adminOrdersFilterCompletedTab')}</option>
                        <option value="refunded">{t('adminOrdersFilterRefundedTab')}</option>
                        <option value="pending">{t('adminOrdersFilterPendingTab')}</option>
                        <option value="failed">{t('adminOrdersFilterFailedTab')}</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-600">{t('adminOrdersTypeLabel')}</label>
                      <select
                        value={adminOrderTypeFilter}
                        onChange={(e) =>
                          setAdminOrderTypeFilter(e.target.value as 'all' | 'buy' | 'sell' | 'deposit')
                        }
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                      >
                        <option value="all">{t('adminOrdersTypeAll')}</option>
                        <option value="buy">{t('adminOrdersTypeBuy')}</option>
                        <option value="sell">{t('adminOrdersTypeSell')}</option>
                        <option value="deposit">{lang === 'ar' ? 'إيداع' : 'Deposit'}</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-600">{t('adminOrdersDateFrom')}</label>
                      <input
                        type="date"
                        value={adminOrderFromDate}
                        onChange={(e) => setAdminOrderFromDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-gray-600">{t('adminOrdersDateTo')}</label>
                      <input
                        type="date"
                        value={adminOrderToDate}
                        onChange={(e) => setAdminOrderToDate(e.target.value)}
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setAdminOrderStatusFilter('all');
                      setAdminOrderTypeFilter('all');
                      setAdminOrderRefQuery('');
                      setAdminOrderFromDate('');
                      setAdminOrderToDate('');
                    }}
                    className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-200"
                  >
                    {t('adminOrdersResetFilters')}
                  </button>
                  <div className="text-xs font-bold text-gray-500" dir="ltr">
                    {t('adminOrdersResultCount')}: {adminFilteredTransactions.length}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {adminFilteredTransactions.map((tx) => {
                  const s = statusUi(tx.status);
                  return (
                    <div key={tx.id} className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <code className="text-xs px-2 py-1 rounded bg-gray-50 border border-gray-200" dir="ltr">{tx.order_ref}</code>
                          <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${tx.type === 'buy' ? 'bg-blue-50 text-blue-700' : tx.type === 'deposit' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                            {tx.type === 'buy' ? (lang === 'ar' ? 'شراء' : 'Buy') : tx.type === 'deposit' ? (lang === 'ar' ? 'إيداع' : 'Deposit') : (lang === 'ar' ? 'بيع' : 'Sell')}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${s.badge}`}>{s.label}</span>
                        </div>
                        <span className="text-xs text-gray-500" dir="ltr">{new Date(tx.created_at).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 text-sm">
                        <div className="p-2 rounded bg-gray-50 border border-gray-100">
                          <p className="text-[11px] text-gray-500">{lang === 'ar' ? 'طريقة الدفع' : 'Method'}</p>
                          <p className="font-bold text-gray-900">{adminMethodLabel(tx.method)}</p>
                        </div>
                        <div className="p-2 rounded bg-gray-50 border border-gray-100">
                          <p className="text-[11px] text-gray-500">{lang === 'ar' ? 'المبلغ' : 'Amount'}</p>
                          <p className="font-bold text-gray-900" dir="ltr">{formatLatinDigits(Number(tx.amount || 0))} {t('iqd')}</p>
                        </div>
                        <div className="p-2 rounded bg-gray-50 border border-gray-100">
                          <p className="text-[11px] text-gray-500">Client ID</p>
                          <p className="font-mono text-xs text-gray-900 break-all" dir="ltr">{tx.client_id}</p>
                        </div>
                        <div className="p-2 rounded bg-gray-50 border border-gray-100">
                          <p className="text-[11px] text-gray-500">Agent Number ID</p>
                          <p className="font-mono text-xs text-gray-900 break-all" dir="ltr">{tx.agent_number_id || '—'}</p>
                        </div>
                        <div className="p-2 rounded bg-gray-50 border border-gray-100">
                          <p className="text-[11px] text-gray-500">{lang === 'ar' ? 'اسم المستخدم' : 'User Name'}</p>
                          <p className="text-xs font-bold text-gray-900 break-all">{tx.user_name || '—'}</p>
                        </div>
                        <div className="p-2 rounded bg-gray-50 border border-gray-100">
                          <p className="text-[11px] text-gray-500">IP</p>
                          <p className="font-mono text-xs text-gray-900 break-all" dir="ltr">{tx.user_ip || '—'}</p>
                        </div>
                      </div>
                      {tx.details ? (
                        <details className="rounded bg-gray-50 border border-gray-100 p-2">
                          <summary className="cursor-pointer text-xs font-bold text-gray-700">
                            {lang === 'ar' ? 'عرض تفاصيل الطلب الكاملة' : 'Show full order details'}
                          </summary>
                          <pre className="mt-2 text-xs whitespace-pre-wrap text-gray-700">{tx.details}</pre>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
                {adminFilteredTransactions.length === 0 && (
                  <div className="py-14 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                    <p className="text-gray-400 font-bold">{t('adminOrdersEmptyFiltered')}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-12">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4">{t('addNewAdmin')}</h3>
                <form onSubmit={handleAddAdmin} className="grid grid-cols-1 md:grid-cols-5 gap-3">
                  <input name="admin_name" required placeholder={t('adminName')} className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <input name="admin_telegram_id" required placeholder={t('telegramId')} className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <input name="admin_email" type="email" placeholder={t('emailOptional')} className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <input name="admin_password" type="password" placeholder={t('adminPassword')} className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <button type="submit" className="bg-gray-900 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-black transition-all">{t('addAdmin')}</button>
                </form>
                <p className="text-xs text-gray-500 mt-3">
                  {t('firstAdminBotHint')}
                  <code className="ml-1">ADD_ADMIN [ID] [NAME] | [EMAIL] | [PASSWORD]</code>
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {adminAdmins.map((a) => (
                  <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black text-gray-900">{a.name}</p>
                        <p className="text-xs text-gray-500">Telegram ID: {a.telegram_id}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteAdmin(a.id)}
                        className="text-xs font-bold text-red-600 hover:text-red-700"
                      >
                        {t('delete')}
                      </button>
                    </div>
                    <div className="mt-4 flex flex-col sm:flex-row gap-2">
                      <input
                        defaultValue={a.email || ''}
                        placeholder="admin@email.com"
                        className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/10 outline-none"
                        onBlur={(e) => handleUpdateAdminEmail(a.id, e.target.value)}
                      />
                      <span className="text-xs text-gray-500 self-center">{t('emailUpdateOnBlur')}</span>
                    </div>
                  </div>
                ))}
                {adminAdmins.length === 0 && (
                  <div className="py-14 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                    <p className="text-gray-400 font-bold">{t('noAdminsYet')}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };


  const renderHistory = () => (
    <div className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-6 text-2xl font-black tracking-tight text-gray-900 sm:mb-8">{t('history')}</h2>

        {transactions.length > 0 ? (
          <ul className="flex flex-col gap-4 sm:gap-5">
            {transactions.map((tx) => {
              const su = statusUi(tx.status);

              return (
                <li key={tx.id}>
                  <article
                    className="rounded-[1.35rem] border border-gray-100 bg-white p-5 shadow-[0_2px_16px_rgba(15,23,42,0.04)] transition-[box-shadow,transform] duration-200 hover:shadow-[0_8px_28px_rgba(15,23,42,0.07)] sm:p-6"
                  >
                    <div className="flex flex-col gap-5">
                      <div className="flex gap-4 sm:gap-5">
                        <div
                          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${su.icon}`}
                          aria-hidden
                        >
                          <FileText className="h-7 w-7" strokeWidth={2} />
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <h3 className="text-[15px] font-semibold leading-snug text-gray-900 sm:text-base">
                            {txTypeLabel(tx.type)}
                            <span className="font-normal text-gray-400"> · </span>
                            <span className="text-gray-700">{tx.method}</span>
                          </h3>
                          <p className="text-sm text-gray-500" dir="ltr">
                            {new Date(tx.created_at).toLocaleString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <div className="min-w-0" dir="ltr">
                          <p className="text-2xl font-black tracking-normal text-gray-900 tabular-nums [font-variant-numeric:lining-nums] sm:text-[1.65rem]">
                            {formatLatinDigits(Number(tx.amount))}
                            <span className="ms-2 inline-block whitespace-nowrap text-base font-semibold tabular-nums text-gray-500 sm:text-lg">
                              {txAmountUnit(tx.type)}
                            </span>
                          </p>
                        </div>
                        <span
                          className={`inline-flex w-fit shrink-0 items-center justify-center rounded-full px-4 py-1.5 text-xs font-bold ring-1 ${su.badge}`}
                        >
                          {su.label}
                        </span>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
              <Clock className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-600 font-medium">{t('noTransactions')}</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderProfile = () => {
    if (!isAuthenticated) return renderLogin();

    const chevron = <ArrowLeft className={`w-4 h-4 text-gray-300 ${dir === 'rtl' ? 'rotate-180' : ''}`} />;

    const listRow = (
      icon: React.ReactNode,
      label: string,
      sub: string | null,
      right: React.ReactNode | null,
      onClick: (() => void) | null,
      accent = 'text-red-600 bg-red-50',
    ) => (
      <button
        key={label}
        onClick={onClick ?? undefined}
        disabled={!onClick}
        className="w-full flex items-center justify-between px-4 py-[14px] hover:bg-gray-50/80 active:bg-gray-100 transition-colors disabled:cursor-default"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
            {icon}
          </div>
          <div className="min-w-0 text-start">
            <p className="text-sm font-bold text-red-600 leading-snug">{label}</p>
            {sub && <p className="text-xs text-gray-400 font-medium mt-0.5 truncate" dir="ltr">{sub}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ms-2">
          {right}
          {chevron}
        </div>
      </button>
    );

    /* ─── هيدر مشترك للصفحات الفرعية ─── */
    const subHeader = (title: string, onBack: () => void) => (
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="p-2 -ms-2 rounded-xl hover:bg-gray-100 transition-colors"
        >
          {dir === 'rtl' ? <ArrowRight className="w-5 h-5 text-gray-600" /> : <ArrowLeft className="w-5 h-5 text-gray-600" />}
        </button>
        <h2 className="text-lg font-black text-gray-900">{title}</h2>
      </div>
    );

    /* ─── صفحة الدفع الإلكتروني ─── */
    if (profileSubView === 'payments') {
      const payMethods = [
        { id: 'zaincash',  label: lang === 'ar' ? 'زين كاش' : 'ZainCash',  color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
        { id: 'superqi',   label: lang === 'ar' ? 'سوبر كي' : 'SuperQi',   color: 'bg-red-50 text-red-600 border-red-100' },
        { id: 'firstbank', label: lang === 'ar' ? 'المصرف الأول' : 'First Iraqi Bank', color: 'bg-blue-50 text-blue-700 border-blue-100' },
        { id: 'fastpay',   label: lang === 'ar' ? 'فاست باي' : 'FastPay',  color: 'bg-orange-50 text-orange-700 border-orange-100' },
      ];
      return (
        <div className="max-w-lg mx-auto pb-6">
          {subHeader(lang === 'ar' ? 'الدفع الإلكتروني' : 'Payments', () => setProfileSubView(null))}

          {/* رصيد المحفظة */}
          <div className="bg-gradient-to-br from-red-600 to-red-700 rounded-2xl p-5 mb-4 text-white shadow-lg shadow-red-600/20">
            <p className="text-xs font-bold opacity-70 mb-1">{lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance'}</p>
            <p className="text-3xl font-black tracking-tight">
              {formatLatinDigits(Math.max(0, Math.floor(Number(walletBalance || 0))))}
              <span className="text-base font-bold ms-1 opacity-80">IQD</span>
            </p>
          </div>

          {/* طرق الدفع المتاحة */}
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1 mb-2">
            {lang === 'ar' ? 'طرق الدفع المتاحة' : 'Available Payment Methods'}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden mb-4">
            {payMethods.map((m) => (
              <div key={m.id} className={`flex items-center gap-3 px-4 py-4`}>
                <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${m.color}`}>
                  <CreditCard className="w-4 h-4" />
                </div>
                <p className="text-sm font-bold text-gray-800">{m.label}</p>
                <div className="ms-auto">
                  <span className="text-[10px] font-bold bg-green-50 text-green-600 border border-green-100 px-2 py-0.5 rounded-full">
                    {lang === 'ar' ? 'متاح' : 'Active'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* آخر المعاملات */}
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1 mb-2">
            {lang === 'ar' ? 'آخر المعاملات' : 'Recent Transactions'}
          </p>
          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            {transactions.slice(0, 5).length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2 text-gray-400">
                <ArrowDownUp className="w-7 h-7 opacity-30" />
                <p className="text-sm font-medium">{lang === 'ar' ? 'لا توجد معاملات بعد' : 'No transactions yet'}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {transactions.slice(0, 5).map((tx) => (
                  <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${tx.type === 'buy' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      <ArrowDownUp className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-gray-800 truncate">
                        {tx.type === 'buy' ? (lang === 'ar' ? 'شراء' : 'Buy') : (lang === 'ar' ? 'بيع' : 'Sell')}
                      </p>
                      <p className="text-xs text-gray-400">{new Date(tx.created_at).toLocaleDateString(lang === 'ar' ? 'ar-IQ' : 'en-US')}</p>
                    </div>
                    <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                      tx.status === 'completed' ? 'bg-green-50 text-green-600' :
                      tx.status === 'pending'   ? 'bg-yellow-50 text-yellow-600' :
                      tx.status === 'rejected'  ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {tx.status === 'completed' ? (lang === 'ar' ? 'مكتمل' : 'Done') :
                       tx.status === 'pending'   ? (lang === 'ar' ? 'قيد المعالجة' : 'Pending') :
                       tx.status === 'rejected'  ? (lang === 'ar' ? 'مرفوض' : 'Rejected') : tx.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    /* ─── صفحة القسائم ─── */
    if (profileSubView === 'coupons') {
      return (
        <div className="max-w-lg mx-auto pb-6">
          {subHeader(lang === 'ar' ? 'القسائم' : 'Coupons', () => setProfileSubView(null))}

          <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
            <div className="flex flex-col items-center gap-3 py-6 text-gray-400">
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
                <Download className="w-8 h-8 text-red-300" />
              </div>
              <p className="font-black text-gray-700 text-base">{lang === 'ar' ? 'ليس لديك قسائم' : 'No Coupons Yet'}</p>
              <p className="text-sm text-center leading-relaxed text-gray-400 max-w-[220px]">
                {lang === 'ar'
                  ? 'ستظهر هنا قسائم الخصم والعروض الخاصة عند توفرها.'
                  : 'Discount coupons and special offers will appear here when available.'}
              </p>
            </div>
          </div>

          {/* حقل إدخال كود */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wide">
              {lang === 'ar' ? 'لديك كود؟ أدخله هنا' : 'Have a code? Enter it here'}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={lang === 'ar' ? 'SARAF2025' : 'SARAF2025'}
                className="flex-1 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold tracking-widest text-gray-700 outline-none focus:border-red-300 focus:ring-1 focus:ring-red-100 uppercase"
                dir="ltr"
              />
              <button className="px-4 py-2.5 bg-red-600 text-white font-black rounded-xl text-sm hover:bg-red-700 active:scale-95 transition-all">
                {lang === 'ar' ? 'تفعيل' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    /* ─── صفحة مركز المساعدة ─── */
    if (profileSubView === 'support') {
      const contactOptions = [
        {
          icon: (
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>
          ),
          label: lang === 'ar' ? 'دعم عبر تيليجرام' : 'Telegram Support',
          sub: '@cs_iraqi',
          accent: 'text-blue-500 bg-blue-50',
          action: () => window.open(siteContent.supportUrl, '_blank'),
        },
        {
          icon: <Globe className="w-5 h-5" />,
          label: lang === 'ar' ? 'الموقع الرسمي' : 'Official Website',
          sub: 'saraf.asia',
          accent: 'text-red-600 bg-red-50',
          action: () => window.open('https://saraf.asia', '_blank'),
        },
      ];
      const faqs = lang === 'ar' ? [
        { q: 'كم يستغرق تحويل الرصيد؟', a: 'عادةً بضع دقائق فقط، وفي حالات الازدحام قد يصل إلى ساعة.' },
        { q: 'ما الحد الأدنى للبيع؟', a: 'الحد الأدنى للبيع هو 5,000 دينار عراقي.' },
        { q: 'كيف أتحقق من حالة طلبي؟', a: 'يمكنك متابعة الطلب في صفحة السجل ضمن التطبيق.' },
      ] : [
        { q: 'How long does transfer take?', a: 'Usually just a few minutes, and up to an hour during peak times.' },
        { q: 'What is the minimum sell amount?', a: 'The minimum sell amount is 5,000 IQD.' },
        { q: 'How do I check my order status?', a: 'You can track your order in the History tab inside the app.' },
      ];
      return (
        <div className="max-w-lg mx-auto pb-6">
          {subHeader(lang === 'ar' ? 'مركز المساعدة' : 'Support', () => setProfileSubView(null))}

          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 overflow-hidden mb-4">
            {contactOptions.map((opt) => (
              <button
                key={opt.label}
                onClick={opt.action}
                className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors text-start"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${opt.accent}`}>
                  {opt.icon}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-800">{opt.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5" dir="ltr">{opt.sub}</p>
                </div>
                <ArrowLeft className={`w-4 h-4 text-gray-300 ms-auto shrink-0 ${dir === 'rtl' ? 'rotate-180' : ''}`} />
              </button>
            ))}
          </div>

          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide px-1 mb-2">
            {lang === 'ar' ? 'أسئلة شائعة' : 'FAQ'}
          </p>
          <div className="space-y-2">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-4">
                <p className="text-sm font-black text-gray-800 mb-1.5">{faq.q}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      );
    }

    /* ─── صفحة الشروط والأحكام ─── */
    if (profileSubView === 'terms') {
      const sections = lang === 'ar' ? [
        {
          title: '1. قبول الشروط',
          body: 'باستخدامك لتطبيق صراف IQ فإنك توافق على هذه الشروط والأحكام. إذا لم توافق على أي بند، يُرجى التوقف عن استخدام الخدمة.',
        },
        {
          title: '2. الخدمة',
          body: 'نوفر منصة لتبادل رصيد أسياسيل مقابل الدينار العراقي عبر طرق دفع إلكترونية معتمدة. نحتفظ بالحق في تعديل الأسعار في أي وقت.',
        },
        {
          title: '3. مسؤولية المستخدم',
          body: 'أنت مسؤول عن صحة البيانات التي تُدخلها. أي خطأ في رقم الحساب أو المبلغ قد يؤدي إلى تأخر أو رفض الطلب.',
        },
        {
          title: '4. الخصوصية',
          body: 'نحرص على حماية بياناتك. لا نشارك معلوماتك الشخصية مع أطراف ثالثة إلا ما تطلبه الجهات التنظيمية.',
        },
        {
          title: '5. التواصل',
          body: 'لأي استفسار تواصل معنا عبر تيليجرام على الرابط الموجود في مركز المساعدة.',
        },
      ] : [
        {
          title: '1. Acceptance of Terms',
          body: 'By using the Saraf IQ app you agree to these Terms & Conditions. If you disagree with any provision, please stop using the service.',
        },
        {
          title: '2. The Service',
          body: 'We provide a platform to exchange Asiacell credit for Iraqi Dinar via approved electronic payment methods. We reserve the right to modify prices at any time.',
        },
        {
          title: '3. User Responsibility',
          body: 'You are responsible for the accuracy of the data you enter. Any error in account number or amount may result in a delayed or rejected order.',
        },
        {
          title: '4. Privacy',
          body: 'We are committed to protecting your data. We do not share your personal information with third parties except as required by regulatory authorities.',
        },
        {
          title: '5. Contact',
          body: 'For any inquiries contact us via Telegram using the link in the Support section.',
        },
      ];
      return (
        <div className="max-w-lg mx-auto pb-6">
          {subHeader(lang === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions', () => setProfileSubView(null))}

          <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-3">
            <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
                <FileText className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'شروط الاستخدام' : 'Terms of Use'}</p>
                <p className="text-xs text-gray-400">{lang === 'ar' ? 'آخر تحديث: يناير 2025' : 'Last updated: January 2025'}</p>
              </div>
            </div>
            <div className="space-y-4">
              {sections.map((sec, i) => (
                <div key={i}>
                  <p className="text-sm font-black text-gray-800 mb-1">{sec.title}</p>
                  <p className="text-sm text-gray-500 leading-relaxed">{sec.body}</p>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => window.open(siteContent.supportUrl, '_blank')}
            className="w-full py-4 bg-red-600 text-white font-black rounded-2xl text-sm hover:bg-red-700 active:scale-[0.99] transition-all shadow-lg shadow-red-600/20"
          >
            {lang === 'ar' ? 'تواصل مع الدعم' : 'Contact Support'}
          </button>
        </div>
      );
    }

    if (showEditProfile) {
      return (
        <div className="max-w-lg mx-auto pb-6">
          {/* هيدر صفحة التعديل */}
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => setShowEditProfile(false)}
              className="p-2 -ms-2 rounded-xl hover:bg-gray-100 transition-colors"
            >
              {dir === 'rtl' ? <ArrowRight className="w-5 h-5 text-gray-600" /> : <ArrowLeft className="w-5 h-5 text-gray-600" />}
            </button>
            <h2 className="text-lg font-black text-gray-900">{lang === 'ar' ? 'تعديل الحساب' : 'Edit Account'}</h2>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-3">
            {/* صورة رمزية */}
            <div className="flex flex-col items-center py-6 border-b border-gray-100">
              <div className="w-20 h-20 rounded-full bg-red-50 border-2 border-red-100 flex items-center justify-center mb-3">
                <User className="w-10 h-10 text-red-400" />
              </div>
              <p className="font-black text-gray-900">{profileDraft.full_name || (lang === 'ar' ? 'المستخدم' : 'User')}</p>
              <p className="text-sm text-gray-400 mt-0.5">{profileDraft.email || '—'}</p>
            </div>

            {/* الحقول */}
            <div className="divide-y divide-gray-100">
              <div className="px-4 py-3">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-1.5">{t('fullName')}</label>
                <input
                  type="text"
                  value={profileDraft.full_name}
                  onChange={(e) => setProfileDraft((p) => ({ ...p, full_name: e.target.value }))}
                  placeholder={t('fullName')}
                  className="w-full px-0 py-1 bg-transparent border-none text-sm font-medium text-gray-900 outline-none placeholder-gray-300"
                />
              </div>
              <div className="px-4 py-3">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-1.5">{t('phoneNumber')}</label>
                <input
                  type="tel"
                  value={profileDraft.phone}
                  onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="+964 7..."
                  dir="ltr"
                  className="w-full px-0 py-1 bg-transparent border-none text-sm font-medium text-gray-900 outline-none placeholder-gray-300"
                />
              </div>
              <div className="px-4 py-3">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-1.5">{t('emailAddress')}</label>
                <p className="text-sm font-medium text-gray-400">{profileDraft.email || '—'}</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={async () => { await saveSiteProfile(); setShowEditProfile(false); }}
            disabled={profileSaving}
            className="w-full bg-red-600 text-white font-black py-4 rounded-2xl text-sm hover:bg-red-700 transition-colors disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20"
          >
            {profileSaving ? '...' : t('saveChanges')}
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-lg mx-auto pb-6">

        {/* مجموعة 1: معلومات المستخدم */}
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 mb-3 overflow-hidden">
          {listRow(
            <User className="w-5 h-5" />,
            lang === 'ar' ? 'الحساب' : 'Account',
            profileDraft.phone || profileDraft.email || '—',
            null,
            () => setShowEditProfile(true),
          )}
        </div>

        {/* مجموعة 2: الخدمات */}
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 mb-3 overflow-hidden">
          {listRow(
            <CreditCard className="w-5 h-5" />,
            lang === 'ar' ? 'الدفع الإلكتروني' : 'Payments',
            null, null,
            () => setProfileSubView('payments'),
          )}
          {listRow(
            <Download className="w-5 h-5" />,
            lang === 'ar' ? 'القسائم' : 'Coupons',
            null, null,
            () => setProfileSubView('coupons'),
          )}
        </div>

        {/* مجموعة 3: المساعدة */}
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100 mb-3 overflow-hidden">
          {listRow(
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden>
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
            </svg>,
            lang === 'ar' ? 'مركز المساعدة' : 'Support',
            null, null,
            () => setProfileSubView('support'),
          )}
          {listRow(
            <FileText className="w-5 h-5" />,
            lang === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions',
            null, null,
            () => setProfileSubView('terms'),
          )}
          {listRow(
            <Globe className="w-5 h-5" />,
            lang === 'ar' ? 'اللغة' : 'Language',
            null,
            <span className="text-xs font-bold text-gray-400">{lang === 'ar' ? 'العربية' : 'English'}</span>,
            toggleLanguage,
            'text-red-600 bg-red-50',
          )}
        </div>

        {/* خروج */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-4">
          {listRow(
            <LogOut className="w-5 h-5" />,
            lang === 'ar' ? 'خروج' : 'Sign Out',
            null, null,
            handleLogout,
            'text-red-600 bg-red-50',
          )}
        </div>

        <p className="text-center text-xs text-gray-400">{lang === 'ar' ? `الإصدار 1.7.1` : 'Version 1.7.1'}</p>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="flex-1 p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-black text-gray-900 mb-8">{t('settings')}</h2>
        
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-6 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">{t('notifications')}</h3>
                <p className="text-sm text-gray-500">{t('notificationsDesc')}</p>
                {notificationsEnabled && (
                  <p className="text-xs text-green-600 mt-1 font-medium">
                    {lang === 'ar' ? 'الإشعارات مفعلة' : 'Notifications enabled'}
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notificationsEnabled}
                onClick={toggleNotifications}
                className={`w-12 h-6 rounded-full relative transition-colors shrink-0 ${notificationsEnabled ? 'bg-red-500' : 'bg-gray-200'}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200 ${
                    notificationsEnabled ? 'start-[calc(100%-1.375rem)]' : 'start-0.5'
                  }`}
                />
              </button>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-900">{t('languageSetting')}</h3>
                <p className="text-sm text-gray-500">{t('languageSettingDesc')}</p>
              </div>
              <button 
                onClick={toggleLanguage}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-900 font-bold rounded-lg transition-colors"
              >
                {lang === 'ar' ? 'English' : 'العربية'}
              </button>
            </div>

            {isWebBrowser() && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 border-t border-gray-100">
                <div>
                  <h3 className="font-bold text-gray-900">{t('downloadAndroidApp')}</h3>
                  <p className="text-sm text-gray-500">{t('downloadAndroidAppDesc')}</p>
                </div>
                <a
                  href={apkDownloadHref()}
                  download
                  className="inline-flex items-center justify-center gap-2 shrink-0 px-5 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-sm"
                >
                  <Download className="w-5 h-5" />
                  {t('downloadApk')}
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderPlaceholder = (title: string) => (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <LayoutGrid className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-black text-gray-900 mb-2">{title}</h2>
        <p className="text-gray-500 font-medium">This section is under development.</p>
      </div>
    </div>
  );

  const renderSidebar = () => (
    <aside className="hidden lg:flex flex-col w-72 bg-white border-e border-gray-200 h-screen sticky top-0 py-6 px-4">
      <button
        type="button"
        onClick={() => setCurrentView('home')}
        className="flex items-center gap-3 px-3 mb-10 w-full text-start rounded-2xl py-3 -mx-1 hover:bg-gray-50/80 transition-colors group"
        aria-label={`${t('appTitle')} — ${t('home')}`}
      >
        <div className="w-16 h-16 shrink-0 flex items-center justify-center">
          <BrandLogo size="lg" priority />
        </div>
        <div className="min-w-0">
          <h1 className="font-black text-lg tracking-tight text-gray-900">{t('appTitle')}</h1>
          <p className="text-xs text-gray-500 font-medium">Business Portal</p>
        </div>
      </button>

      <nav className="flex-1 space-y-2">
        <button 
          onClick={() => setCurrentView('home')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all relative ${currentView === 'home' ? 'text-red-700 bg-red-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
        >
          {currentView === 'home' && <div className={`absolute top-2 bottom-2 w-1.5 bg-red-600 rounded-full ${dir === 'rtl' ? 'right-0' : 'left-0'}`}></div>}
          <LayoutGrid className="w-5 h-5 relative z-10" />
          <span className="relative z-10">{t('dashboard')}</span>
        </button>
        <button 
          onClick={() => setCurrentView('services')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all relative ${currentView === 'services' ? 'text-red-700 bg-red-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
        >
          {currentView === 'services' && <div className={`absolute top-2 bottom-2 w-1.5 bg-red-600 rounded-full ${dir === 'rtl' ? 'right-0' : 'left-0'}`}></div>}
          <Gamepad2 className="w-5 h-5 relative z-10" />
          <span className="relative z-10">{t('bundles')}</span>
        </button>
        <button 
          onClick={() => setCurrentView('history')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all relative ${currentView === 'history' ? 'text-red-700 bg-red-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
        >
          {currentView === 'history' && <div className={`absolute top-2 bottom-2 w-1.5 bg-red-600 rounded-full ${dir === 'rtl' ? 'right-0' : 'left-0'}`}></div>}
          <Clock className="w-5 h-5 relative z-10" />
          <span className="relative z-10">{t('history')}</span>
        </button>
        <button 
          onClick={() => setCurrentView('profile')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all relative ${currentView === 'profile' ? 'text-red-700 bg-red-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
        >
          {currentView === 'profile' && <div className={`absolute top-2 bottom-2 w-1.5 bg-red-600 rounded-full ${dir === 'rtl' ? 'right-0' : 'left-0'}`}></div>}
          <User className="w-5 h-5 relative z-10" />
          <span className="relative z-10">{t('profile')}</span>
        </button>
        <button 
          onClick={() => setCurrentView('settings')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all relative ${currentView === 'settings' ? 'text-red-700 bg-red-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
        >
          {currentView === 'settings' && <div className={`absolute top-2 bottom-2 w-1.5 bg-red-600 rounded-full ${dir === 'rtl' ? 'right-0' : 'left-0'}`}></div>}
          <Settings className="w-5 h-5 relative z-10" />
          <span className="relative z-10">{t('settings')}</span>
        </button>
        {isAdmin && (
          <button 
            onClick={() => setCurrentView('admin')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all relative ${currentView === 'admin' ? 'text-red-700 bg-red-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
          >
            {currentView === 'admin' && <div className={`absolute top-2 bottom-2 w-1.5 bg-red-600 rounded-full ${dir === 'rtl' ? 'right-0' : 'left-0'}`}></div>}
            <ShieldAlert className="w-5 h-5 relative z-10" />
            <span className="relative z-10">{t('adminPanel')}</span>
          </button>
        )}
      </nav>

      <div className="mt-auto pt-6 border-t border-gray-100">
        <button
          type="button"
          onClick={toggleLanguage}
          className="mb-2 flex w-full items-center justify-between rounded-xl px-4 py-3 font-semibold text-gray-600 transition-colors hover:bg-gray-50"
        >
          <span className="flex items-center gap-3">
            <Globe className="h-5 w-5 shrink-0" />
            {lang === 'ar' ? 'English' : 'العربية'}
          </span>
          <span className="text-xs font-bold text-gray-500">{lang === 'ar' ? 'EN' : 'AR'}</span>
        </button>
        <button
          type="button"
          onClick={isAuthenticated ? handleLogout : () => setCurrentView('login')}
          aria-label={isAuthenticated ? t('logout') : t('login')}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 font-semibold text-red-600 transition-colors hover:bg-red-50"
        >
          {isAuthenticated ? (
            <>
              <LogOut className="h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-start">{t('logout')}</span>
            </>
          ) : (
            <>
              <LogIn className="h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-start">{t('login')}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );

  const walletHeaderAmount = `${formatLatinDigits(Math.max(0, Math.floor(Number(walletBalance || 0))))} ${
    lang === 'ar' ? 'دينار عراقي' : 'Iraqi Dinar'
  }`;

  const renderWalletHeaderActions = (isDesktop = false) => (
    <div className={`flex items-center gap-2 ${isDesktop ? '' : 'max-w-full'}`}>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-black text-gray-700 sm:px-3.5 sm:text-sm hover:bg-gray-100 transition-colors"
        aria-label={lang === 'ar' ? 'رصيد المحفظة' : 'Wallet balance'}
      >
        <Wallet className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        <span dir="ltr" className="tracking-wide">{walletHeaderAmount}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (!isAuthenticated) {
            setCurrentView('login');
            setAuthMode('signin');
            return;
          }
          setCurrentView('home');
          handleTxTypeChange('deposit');
        }}
        className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-sm font-black text-white shadow-sm transition-all active:scale-95 ${
          currentView === 'home' && txType === 'deposit'
            ? 'bg-red-700'
            : 'bg-red-600 hover:bg-red-700'
        }`}
        aria-label={lang === 'ar' ? 'إيداع' : 'Deposit'}
      >
        <span className="text-base leading-none">+</span>
        <span>{lang === 'ar' ? 'إيداع' : 'Deposit'}</span>
      </button>
    </div>
  );
  const renderMobileHeader = () => (
    <header className="lg:hidden bg-white sticky top-0 z-30 border-b border-gray-100 shadow-sm">
      <div className="flex items-center justify-between gap-2 px-4 py-3 sm:px-5">
        <button
          type="button"
          onClick={() => setCurrentView('home')}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-xl py-1 ps-1 pe-2 -ms-1 hover:bg-gray-50 transition-colors"
          aria-label={`${t('appTitle')} — ${t('home')}`}
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center">
            <BrandLogo size="md" priority />
          </div>
          <h1 className="truncate text-base font-black tracking-tight text-gray-900">{t('appTitle')}</h1>
        </button>
                <div className="flex shrink-0 items-center">
          {renderWalletHeaderActions(false)}
        </div>
      </div>
    </header>
  );

  const renderDesktopHeader = () => (
    <header className="hidden lg:flex items-center justify-end border-b border-gray-100 bg-white px-6 py-4 shadow-sm">
      {renderWalletHeaderActions(true)}
    </header>
  );

  const renderUserGreeting = () => {
    /** اسم من جهازك فقط (بعد الحفظ من الإعدادات) — ليس من ملف الموقع العام على السيرفر */
    const savedLocalName = Cookies.get('saraf_full_name')?.trim();
    const welcomeWithName =
      savedLocalName &&
      (lang === 'ar' ? `مرحباً بعودتك، ${savedLocalName}` : `Welcome back, ${savedLocalName}`);

    const totalRaw = Number.isFinite(dashboardStats.totalCompletedIqd) ? dashboardStats.totalCompletedIqd : 0;
    const activeDisplay = formatLatinDigits(dashboardStats.activeOrders);
    const totalDisplay = formatLatinDigits(totalRaw);

    const statValueClass =
      'inline-block text-xl font-black tabular-nums tracking-normal text-gray-900 leading-none sm:text-2xl [font-variant-numeric:lining-nums]';
    const statLabelClass =
      'text-[10px] font-bold leading-snug tracking-wide text-gray-400 sm:text-xs' +
      (lang === 'en' ? ' uppercase' : '');

    return (
      <div className="mb-5 overflow-visible rounded-2xl border border-gray-100 bg-white shadow-sm sm:mb-6 lg:mb-6 lg:rounded-[2rem]">
        {/* شريط علوي ملوّن خفيف */}
        <div className="h-1.5 w-full rounded-t-2xl bg-gradient-to-r from-red-500 via-red-400 to-orange-400 lg:rounded-t-[2rem]" />
        <div className="flex flex-col gap-4 overflow-visible p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:p-8 xl:gap-10">
          <div className="flex w-full min-w-0 items-start gap-3 sm:items-center sm:gap-4 lg:min-w-0 lg:max-w-[min(100%,42rem)] lg:flex-1">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 text-white shadow-md ring-1 ring-red-900/10 sm:mt-0 sm:h-11 sm:w-11 sm:rounded-2xl">
              <User className="h-[18px] w-[18px] text-white/95 sm:h-5 sm:w-5" />
            </div>
            <div className="min-w-0 flex-1 text-start [text-rendering:geometricPrecision]">
              {welcomeWithName ? (
                <h2 className="whitespace-normal text-base font-bold leading-normal tracking-normal text-gray-900 sm:text-lg md:text-xl">
                  {welcomeWithName}
                </h2>
              ) : (
                <h2 className="whitespace-normal text-base font-bold leading-normal tracking-normal text-gray-900 sm:text-lg md:text-xl">
                  <span className="text-gray-600">{t('greeting')}</span>{' '}
                  <span className="text-gray-900">{t('userName')}</span>
                </h2>
              )}
              <p className="mt-0.5 text-xs text-gray-400 font-medium">{lang === 'ar' ? 'لوحة المتابعة' : 'Dashboard'}</p>
            </div>
          </div>
          {/* إحصائيات: أعمدة minmax(min-content) لتجنّب قص الأرقام في RTL */}
          <div
            className={`grid w-full shrink-0 gap-x-4 border-t border-gray-100 pt-3 sm:gap-x-6 sm:pt-4 lg:w-auto lg:min-w-[min(100%,22rem)] lg:shrink-0 lg:border-t-0 lg:pt-0 xl:min-w-[24rem] ${dir === 'rtl' ? 'text-right' : 'text-left'}`}
            style={{ gridTemplateColumns: "minmax(min-content, 1fr) minmax(min-content, 1fr)" }}
          >
            <div className={`overflow-visible border-e border-gray-100 pe-3 sm:pe-5 ${dir === 'rtl' ? 'text-right' : 'text-left'}`}>
              <p className={statLabelClass}>{t('activeOrders')}</p>
              <div dir="ltr" className="mt-1 min-h-[1.75rem] whitespace-nowrap">
                <span className={`${statValueClass} ${dashboardStats.activeOrders > 0 ? 'text-red-600' : ''} ${dir === 'rtl' ? 'text-right' : 'text-left'}`}>{activeDisplay}</span>
              </div>
            </div>
            <div className={`overflow-visible ps-3 sm:ps-5 ${dir === 'rtl' ? 'text-right' : 'text-left'}`}>
              <p className={statLabelClass}>{t('totalExchanged')}</p>
              <div
                dir="ltr"
                className={`mt-1 flex min-h-[1.75rem] flex-nowrap items-baseline gap-2 sm:gap-2.5 ${dir === 'rtl' ? 'justify-end' : 'justify-start'} overflow-visible`}
              >
                <span className={`${statValueClass} max-w-none ${dir === 'rtl' ? 'text-right' : 'text-left'}`}>{totalDisplay}</span>
                <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-500 sm:text-base [font-variant-numeric:lining-nums]">
                  {t('iqd')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderTypeToggle = () => (
    <div className="flex bg-gray-100 p-1 rounded-2xl mb-8 relative" dir={dir}>
      <div
        className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-xl shadow-md transition-all duration-300 ease-out ${
          txType === 'buy' ? 'bg-red-600' : 'bg-gray-800'
        } ${
          txType === 'buy'
            ? (dir === 'rtl' ? 'right-1' : 'left-1')
            : (dir === 'rtl' ? 'right-[calc(50%+3px)]' : 'left-[calc(50%+3px)]')
        }`}
      />
      <button
        onClick={() => handleTxTypeChange('buy')}
        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all relative z-10 flex items-center justify-center gap-2 ${txType === 'buy' ? 'text-white scale-[1.01]' : 'text-gray-500 hover:text-gray-700'}`}
      >
        <Zap className={`w-4 h-4 ${txType === 'buy' ? 'fill-current text-white' : ''}`} />
        {t('buyCredit')}
      </button>
      <button
        onClick={() => handleTxTypeChange('sell')}
        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all relative z-10 flex items-center justify-center gap-2 ${txType === 'sell' ? 'text-white scale-[1.01]' : 'text-gray-500 hover:text-gray-700'}`}
      >
        <ArrowDownUp className={`w-4 h-4 ${txType === 'sell' ? 'text-white' : ''}`} />
        {t('sellCredit')}
      </button>
    </div>
  );

  const appServices = useMemo(
    () =>
      [...siteContent.servicesCatalog]
        .filter((service) => service.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((service) => ({
          id: service.id,
          titleAr: service.titleAr,
          titleEn: service.titleEn,
          descriptionAr: service.descriptionAr,
          descriptionEn: service.descriptionEn,
          coverImage: service.coverImage,
          badgeAr: service.badgeAr || undefined,
          badgeEn: service.badgeEn || undefined,
          actionType: service.actionType,
          comingSoon:
            service.actionType === 'coming_soon' ||
            (service.comingSoon && service.actionType !== 'pubg_uc'),
          sortOrder: service.sortOrder,
        })),
    [siteContent.servicesCatalog],
  );

  const activeServiceConfig = useMemo(
    () =>
      siteContent.servicesCatalog.find(
        (service) => service.id === activeServiceId && service.enabled,
      ) || null,
    [siteContent.servicesCatalog, activeServiceId],
  );

  const pubgPackagesForOrder = useMemo(
    () =>
      [...siteContent.pubgPackages]
        .filter((pkg) => pkg.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((pkg) => ({
          id: pkg.id,
          label: pkg.label,
          totalUc: pkg.totalUc,
          priceIqd: pkg.priceIqd,
          isMinimum: pkg.isMinimum,
          iconTier: pkg.iconTier,
        })),
    [siteContent.pubgPackages],
  );

  const renderCarousel = (compact = false) => {
    const slides = siteContent.carouselSlides;
    if (!slides.length) return null;

    // اتجاه الانزلاق الجديد: next يأتي من الجهة المعاكسة حسب RTL/LTR
    const slideInFrom = carouselDir === 'next'
      ? (dir === 'rtl' ? 'translateX(-105%)' : 'translateX(105%)')
      : (dir === 'rtl' ? 'translateX(105%)'  : 'translateX(-105%)');

    const carouselDragState = { startX: 0, dragging: false };

    return (
      <div
        ref={carouselRef}
        className="relative mb-5 overflow-hidden rounded-2xl select-none"
        style={{ touchAction: 'pan-y', cursor: 'grab' }}
        onMouseDown={(e) => { carouselDragState.startX = e.clientX; carouselDragState.dragging = true; (e.currentTarget as HTMLDivElement).style.cursor = 'grabbing'; }}
        onMouseMove={(e) => { if (!carouselDragState.dragging) return; e.preventDefault(); }}
        onMouseUp={(e) => {
          if (!carouselDragState.dragging) return;
          carouselDragState.dragging = false;
          (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
          const diff = carouselDragState.startX - e.clientX;
          if (Math.abs(diff) < 30) return;
          const len = slides.length;
          if (len <= 1) return;
          setActiveSlide((p) => diff > 0 ? (p + 1) % len : (p - 1 + len) % len);
        }}
        onMouseLeave={(e) => { carouselDragState.dragging = false; (e.currentTarget as HTMLDivElement).style.cursor = 'grab'; }}
      >
        {/* طبقة الشرائح — compact: 180px ثابت | كامل: متجاوب 180→320px */}
        <div style={{ position: 'relative', height: compact ? 180 : 'clamp(180px, 25vw, 320px)' }}>
          {slides.map((sl, i) => {
            const isActive = i === activeSlide;
            return (
              <div
                key={sl.id}
                aria-hidden={!isActive}
                style={{
                  position: i === 0 ? 'relative' : 'absolute',
                  inset: i === 0 ? undefined : 0,
                  zIndex: isActive ? 2 : 1,
                  opacity: isActive ? 1 : 0,
                  transform: isActive
                    ? (carouselAnimating ? slideInFrom : 'translateX(0)')
                    : 'translateX(0)',
                  pointerEvents: isActive ? 'auto' : 'none',
                  transition: isActive
                    ? 'transform 0.32s cubic-bezier(0.4,0,0.2,1), opacity 0.28s'
                    : 'opacity 0.28s',
                  willChange: 'transform, opacity',
                }}
              >
                <div
                  className={`relative bg-gradient-to-br ${sl.gradient} p-6 flex flex-col justify-between`}
                  style={{ height: compact ? 180 : 'clamp(180px, 25vw, 320px)' }}
                >
                  {sl.image ? (
                    <img
                      src={sl.image}
                      alt=""
                      draggable={false}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <>
                      <div className="pointer-events-none absolute -top-10 -end-10 h-36 w-36 rounded-full bg-white/8" />
                      <div className="pointer-events-none absolute -bottom-8 -start-8 h-28 w-28 rounded-full bg-white/5" />
                    </>
                  )}

                  <div className="relative z-10">
                    {sl.badge_ar ? (
                      <span className="mb-3 inline-flex items-center rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
                        {lang === 'ar' ? sl.badge_ar : sl.badge_en}
                      </span>
                    ) : <span className="mb-3 inline-block h-6" />}
                    {/* مع وجود صورة: تُخفى نصوص الواجهة (العنوان/الوصف) لأن الصورة تحمل تصميمها الخاص */}
                    {!sl.image && (
                      <>
                        <h2 className="text-xl font-black leading-snug text-white">
                          {lang === 'ar' ? sl.title_ar : sl.title_en}
                        </h2>
                        <p className="mt-1 text-sm font-medium text-white/75 line-clamp-1">
                          {lang === 'ar' ? sl.subtitle_ar : sl.subtitle_en}
                        </p>
                      </>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      if (!sl.action) return;
                      if (sl.action === 'services') {
                        navigateView('services');
                        return;
                      }
                      // شراء/بيع → افتح صفحة الشراء/البيع المناسبة
                      setTxType(sl.action);
                      setSelectedMethod(null);
                      setBuyPaymentType(null);
                      setIsSuccess(false);
                      setShowOtpStep(false);
                      navigateView('home');
                      setShowPurchasePage(true);
                    }}
                    className={`relative z-10 mt-3 self-start rounded-xl px-4 py-2 text-sm font-bold text-white backdrop-blur-sm transition-colors active:scale-95 ${sl.action ? 'bg-white/20 hover:bg-white/30' : 'invisible pointer-events-none'}`}
                  >
                    {lang === 'ar' ? 'ابدأ الآن' : 'Get Started'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* نقاط التنقل */}
        {slides.length > 1 && (
          <div className="absolute bottom-3 start-1/2 flex gap-1.5" style={{ transform: 'translateX(-50%)', zIndex: 10 }}>
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => {
                  if (i === activeSlide) return;
                  goToSlide(() => i, i > activeSlide ? 'next' : 'prev');
                  setCarouselTimerKey((k) => k + 1);
                }}
                className={`rounded-full transition-all duration-300 ${i === activeSlide ? 'w-5 h-2 bg-white' : 'w-2 h-2 bg-white/40'}`}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  /* ── إعداد المشغّلين ── */
  const OPERATORS = [
    {
      id: 'asiacell' as const,
      nameAr: 'اسياسيل', nameEn: 'Asiacell',
      logo: '/icons/asiacell-logo.png',
      bg: 'bg-red-50', hover: 'hover:border-red-200',
      color: '#e53e3e',
    },
    {
      id: 'zain' as const,
      nameAr: 'زين العراق', nameEn: 'Zain Iraq',
      logo: '/icons/zain-logo.png',
      bg: 'bg-blue-50', hover: 'hover:border-blue-200',
      color: '#2b6cb0',
    },
    {
      id: 'korek' as const,
      nameAr: 'كورك', nameEn: 'Korek',
      logo: '/icons/korek-logo.png',
      bg: 'bg-orange-50', hover: 'hover:border-orange-200',
      color: '#dd6b20',
    },
  ] as const;

  const renderAsiacellSection = () => {
    const handleOperatorClick = (op: typeof OPERATORS[number]) => {
      setSelectedOperator(op.id);
      setTxType('buy');
      setSelectedMethod(null);
      setBuyPaymentType(null);
      setIsSuccess(false);
      setShowOtpStep(false);
      setDenominationSelected(false);
      setShowPurchasePage(true);
    };

    return (
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between px-0.5">
          <h2 className="text-lg font-black text-gray-900">
            {lang === 'ar' ? 'رصيد' : 'Credit'}
          </h2>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {OPERATORS.map((op) => (
            <button
              key={op.id}
              type="button"
              onClick={() => handleOperatorClick(op)}
              className={`relative flex aspect-[1.18] min-w-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-white p-3 shadow-sm transition-all active:scale-[0.98] hover:shadow-md ${op.hover}`}
            >
              {op.id === 'asiacell' && (
                <span className="absolute end-0 top-0 rounded-bl-xl bg-red-600 px-2.5 py-1 text-[10px] font-black text-white">
                  {lang === 'ar' ? 'أقل سعر' : 'Best'}
                </span>
              )}
              {op.id === 'zain' && (
                <span className="absolute end-0 top-0 rounded-bl-xl bg-gray-700 px-2.5 py-1 text-[10px] font-black text-white">
                  {lang === 'ar' ? 'الأوفر بالسوق' : 'Deal'}
                </span>
              )}
              <img
                src={op.logo}
                alt={op.nameEn}
                className="max-h-14 w-full object-contain"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </button>
          ))}
        </div>
      </section>
    );
  };

  const renderCreditDenominationPage = () => {
    const DEFAULT_DENOMINATIONS = [1000, 2000, 3000, 5000, 6000, 10000, 15000, 18000, 25000, 30000, 50000, 75000, 100000, 150000, 200000, 250000];
    const buyOffers = offersList.filter((o) => o.variant === 'buy').sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const adminAmounts = new Set(buyOffers.map((o) => Number(String(o.amount_display).replace(/[,\s]/g, ''))));
    const defaultItems = DEFAULT_DENOMINATIONS.filter((v) => !adminAmounts.has(v)).map((v) => ({
      id: `default-${v}`,
      amount_display: v.toLocaleString('en'),
      amount: v,
    }));
    const adminItems = buyOffers.map((o) => ({
      id: o.id,
      amount_display: o.amount_display,
      amount: Number(String(o.amount_display).replace(/[,\s]/g, '')),
    }));
    const allItems = [...adminItems, ...defaultItems].filter((item) => Number.isFinite(item.amount) && item.amount > 0).sort((a, b) => a.amount - b.amount);
    const op = OPERATORS.find((o) => o.id === selectedOperator) ?? OPERATORS[0];
    const hero100kIqd = parseHeroBuyPriceIqdFor100k(siteContent.heroBuyAmountDisplay);
    const priceFor = (amount: number) => (
      hero100kIqd != null ? Math.round((hero100kIqd / 100_000) * amount) : Math.round(amount * 0.98)
    );

    return (
      <div className="mx-auto min-h-full w-full max-w-2xl bg-gray-50 pb-6">
        <div className="sticky top-0 z-20 bg-gray-50/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => { setShowPurchasePage(false); setDenominationSelected(false); }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-gray-100"
            >
              {dir === 'rtl' ? <ArrowRight className="h-5 w-5" /> : <ArrowLeft className="h-5 w-5" />}
            </button>
            <h1 className="text-xl font-black text-gray-800">
              {lang === 'ar' ? op.nameAr : op.nameEn}
            </h1>
            <button
              type="button"
              onClick={() => { setShowPurchasePage(false); setDenominationSelected(false); }}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-gray-100"
            >
              <Home className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <img src={op.logo} alt={op.nameEn} className="h-7 w-7 object-contain" />
            <span className="text-sm font-bold text-gray-800">
              {lang === 'ar' ? 'كارتات رصيد' : 'Credit cards'}
            </span>
          </div>
        </div>

        <div className="px-4 pt-4">
          <h2 className="mb-3 text-right text-lg font-black text-gray-800">
            {lang === 'ar' ? 'اختر الباقة' : 'Choose Package'}
          </h2>
          <div className="space-y-3">
            {allItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setCardValue(item.amount);
                  setQuantity(1);
                  setSelectedMethod(null);
                  setBuyPaymentType(null);
                  setDenominationSelected(true);
                }}
                className="flex w-full items-center gap-4 rounded-2xl border border-gray-100 bg-white px-5 py-4 text-start shadow-sm transition-all active:scale-[0.99] hover:border-gray-200 hover:shadow-md"
              >
                <ArrowLeft className={`h-5 w-5 shrink-0 text-gray-700 ${dir !== 'rtl' ? 'rotate-180' : ''}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-black text-gray-900" dir={dir}>
                    {lang === 'ar'
                      ? `${op.nameAr} ${formatLatinDigits(item.amount)}`
                      : `${formatLatinDigits(item.amount)} ${op.nameEn}`}
                  </p>
                  <p className="mt-1 text-lg font-black text-gray-600" dir="ltr">
                    {formatLatinDigits(priceFor(item.amount))} {t('iqd')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderOfferCard = () => (
    <div
      key={txType}
      className={`relative mb-8 overflow-hidden rounded-[2rem] shadow-lg [contain:layout_paint] ${txType === 'sell' ? 'bg-gray-900' : 'bg-gradient-to-br from-red-600 to-red-800'}`}
    >
      {/* دوائر زخرفية خلفية */}
      <div className="pointer-events-none absolute -top-8 -end-8 h-40 w-40 rounded-full bg-white/5" />
      <div className="pointer-events-none absolute -bottom-10 -start-10 h-48 w-48 rounded-full bg-white/5" />

      <div className="relative z-10 p-6 sm:p-8">
        <div className="mb-6 flex items-start justify-between">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-bold text-white backdrop-blur-sm">
            <Zap className="h-3.5 w-3.5 fill-current" />
            {t('recommended')}
          </div>
          <span className="rounded-full bg-black/30 px-3 py-1.5 text-xs font-bold text-white/90 backdrop-blur-sm">
            {t('days')}
          </span>
        </div>

        <p className="mb-2 text-sm font-semibold leading-snug text-white/70">
          {offerLineFromTemplate(
            txType === 'buy' ? 'buy' : 'sell',
            txType === 'sell' ? siteContent.heroSellAmountDisplay : siteContent.heroBuyAmountDisplay,
            'hero',
          )}
        </p>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            className="min-w-0 max-w-full text-[clamp(2.2rem,7vw,3.5rem)] font-black leading-none tracking-tight text-white tabular-nums [font-variant-numeric:lining-nums] [text-rendering:geometricPrecision]"
            dir="ltr"
          >
            {txType === 'sell' ? siteContent.heroSellAmountDisplay : siteContent.heroBuyAmountDisplay}
          </span>
          <span className="shrink-0 text-[clamp(1rem,3.5vw,1.4rem)] font-bold leading-tight text-white/80">
            {txType === 'sell' ? t('iqd') : (lang === 'ar' ? (OPERATORS.find(o => o.id === selectedOperator)?.nameAr ?? 'اسياسيل') : (OPERATORS.find(o => o.id === selectedOperator)?.nameEn ?? 'Asiacell'))}
          </span>
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-between border-t border-white/10 bg-black/20 px-6 py-3.5 sm:px-8">
        <span className="flex items-center gap-2 text-sm font-bold text-white/90">
          <CheckCircle2 className="h-4 w-4 text-green-300" /> {t('limitedOffer')}
        </span>
        <ArrowRight className={`h-4 w-4 text-white/60 ${dir === 'rtl' ? 'rotate-180' : ''}`} />
      </div>
    </div>
  );

  const GIFT_CARD_ACTIONS: GiftCardService[] = ['playstation', 'steam', 'xbox', 'cod', 'freefire', 'tiktok_coins', 'iptv', 'chatgpt', 'canva', 'netflix'];

  const renderServices = () => {
    if (activeServiceConfig?.actionType === 'pubg_uc') {
      return (
        <PubgUcOrder
          clientId={clientId}
          userId={userId}
          walletBalance={walletBalance}
          onBack={() => setActiveServiceId(null)}
          onComplete={fetchTransactions}
          titleAr={siteContent.pubgUcTitleAr}
          titleEn={siteContent.pubgUcTitleEn}
          subtitleAr={siteContent.pubgUcSubtitleAr}
          subtitleEn={siteContent.pubgUcSubtitleEn}
          packages={pubgPackagesForOrder}
          discountPercent={siteContent.shopDiscountPercent}
        />
      );
    }

    if (activeServiceConfig && GIFT_CARD_ACTIONS.includes(activeServiceConfig.actionType as GiftCardService)) {
      return (
        <GiftCardOrder
          service={activeServiceConfig.actionType as GiftCardService}
          clientId={clientId}
          userId={userId}
          walletBalance={walletBalance}
          prices={siteContent.giftCardPrices}
          discountPercent={siteContent.shopDiscountPercent}
          onBack={() => setActiveServiceId(null)}
          onComplete={fetchTransactions}
        />
      );
    }

    if (activeServiceConfig) {
      return (
        <div className="mx-auto w-full min-w-0 max-w-4xl space-y-6 pb-6">
          <button
            type="button"
            onClick={() => setActiveServiceId(null)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            {dir === 'rtl' ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
            {t('backToServices')}
          </button>
          <div className="rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-sm">
            <h2 className="text-2xl font-black text-gray-900">
              {lang === 'ar' ? activeServiceConfig.titleAr : activeServiceConfig.titleEn}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-gray-500">
              {lang === 'ar' ? activeServiceConfig.descriptionAr : activeServiceConfig.descriptionEn}
            </p>
            <div className="mt-6 inline-flex items-center rounded-full bg-amber-100 px-4 py-2 text-sm font-bold text-amber-800">
              {t('comingSoon')}
            </div>
          </div>
        </div>
      );
    }

    const q = serviceSearchQuery.trim().toLowerCase();
    const filteredServices = q
      ? appServices.filter((s) =>
          (s.titleAr || '').toLowerCase().includes(q) ||
          (s.titleEn || '').toLowerCase().includes(q) ||
          (s.descriptionAr || '').toLowerCase().includes(q) ||
          (s.descriptionEn || '').toLowerCase().includes(q),
        )
      : appServices;

    return (
      <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6 pb-4 sm:space-y-8">
        <div className="min-w-0">
          <h1 className="text-xl font-black text-gray-900 sm:text-2xl md:text-3xl">
            {lang === 'ar' ? siteContent.servicesSectionTitleAr : siteContent.servicesSectionTitleEn}
          </h1>
          <p className="mt-2 max-w-xl text-sm font-medium text-gray-500 sm:text-base">
            {lang === 'ar' ? siteContent.servicesSectionSubtitleAr : siteContent.servicesSectionSubtitleEn}
          </p>
        </div>
        {/* شريط بحث الخدمات */}
        <div className="relative max-w-xl">
          <Search className={`pointer-events-none absolute top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 ${dir === 'rtl' ? 'right-4' : 'left-4'}`} />
          <input
            type="search"
            value={serviceSearchQuery}
            onChange={(e) => setServiceSearchQuery(e.target.value)}
            placeholder={lang === 'ar' ? 'ابحث عن خدمة…' : 'Search services…'}
            className={`w-full rounded-2xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-100 ${dir === 'rtl' ? 'pr-11 pl-10' : 'pl-11 pr-10'}`}
            dir={dir}
          />
          {serviceSearchQuery && (
            <button
              type="button"
              onClick={() => setServiceSearchQuery('')}
              className={`absolute top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 ${dir === 'rtl' ? 'left-3' : 'right-3'}`}
              aria-label="clear"
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
        {filteredServices.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
            <p className="text-sm font-bold text-gray-500">
              {lang === 'ar' ? 'لا توجد نتائج مطابقة' : 'No matching services'}
            </p>
          </div>
        ) : (() => {
          const categoryOf = (action: string): 'games' | 'entertainment' | 'apps' | 'other' => {
            if (['pubg_uc', 'playstation', 'steam', 'xbox', 'cod', 'freefire'].includes(action)) return 'games';
            if (['netflix', 'iptv', 'tiktok_coins'].includes(action)) return 'entertainment';
            if (['chatgpt', 'canva'].includes(action)) return 'apps';
            return 'other';
          };
          const groups: { id: 'games' | 'entertainment' | 'apps' | 'other'; titleAr: string; titleEn: string; Icon: LucideIcon }[] = [
            { id: 'games',         titleAr: 'ألعاب',              titleEn: 'Games',                Icon: Gamepad2 },
            { id: 'entertainment', titleAr: 'ترفيه',              titleEn: 'Entertainment',        Icon: Tv },
            { id: 'apps',          titleAr: 'برامج واشتراكات',    titleEn: 'Apps & Subscriptions', Icon: AppWindow },
            { id: 'other',         titleAr: 'خدمات أخرى',          titleEn: 'Other',                Icon: LayoutGrid },
          ];
          return (
            <div className="space-y-8">
              {groups.map((group) => {
                const items = filteredServices.filter((s) => categoryOf(s.actionType) === group.id);
                if (!items.length) return null;
                return (
                  <section key={group.id} className="space-y-3 sm:space-y-4">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600">
                        <group.Icon className="h-4 w-4" strokeWidth={2.5} />
                      </span>
                      <h2 className="text-base sm:text-lg font-black text-gray-900">
                        {lang === 'ar' ? group.titleAr : group.titleEn}
                      </h2>
                      <span className="text-xs font-bold text-gray-400">({items.length})</span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 max-[360px]:gap-3 min-[400px]:grid-cols-2 md:gap-5 lg:grid-cols-3 2xl:grid-cols-4">
                      {items.map((service) => (
                        <div key={service.id} className="min-w-0">
                          <ServiceCard
                            service={service}
                            variant="full"
                            onAction={() => setActiveServiceId(service.id)}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          );
        })()}
      </div>
    );
  };

  const renderDepositPage = () => {
    const backBtn = (onClick: () => void) => (
      <button type="button" onClick={onClick} className="p-2 -ms-2 rounded-xl hover:bg-gray-100 transition-colors">
        {dir === 'rtl' ? <ArrowRight className="w-5 h-5 text-gray-600" /> : <ArrowLeft className="w-5 h-5 text-gray-600" />}
      </button>
    );

    // نجاح
    if (isSuccess) {
      return (
        <div className="max-w-md mx-auto flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
          <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-6 border-8 border-green-50/50">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <h2 className="text-2xl font-black mb-2 text-gray-900">{lang === 'ar' ? 'تم تقديم طلب الإيداع' : 'Deposit Submitted'}</h2>
          <p className="text-gray-400 mb-8 text-sm">{lang === 'ar' ? 'سيتم إضافة الرصيد بعد مراجعة الطلب' : 'Balance will be added after review'}</p>
          <button onClick={() => { setIsSuccess(false); setDepositStep('amount'); setDepositAmountInput(''); handleTxTypeChange('buy'); }}
            className="w-full max-w-xs bg-gray-900 text-white py-4 rounded-2xl font-bold active:scale-95">
            {t('backToHome')}
          </button>
        </div>
      );
    }

    // OTP
    if (showOtpStep) {
      return (
        <div className="max-w-md mx-auto pb-6">
          <div className="flex items-center gap-3 mb-6">
            {backBtn(() => setShowOtpStep(false))}
            <h2 className="text-lg font-black text-gray-900">{lang === 'ar' ? 'رمز التحقق' : 'OTP Verification'}</h2>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center space-y-5">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8 text-red-600" />
            </div>
            <div>
              <h3 className="font-black text-gray-900 text-lg">{lang === 'ar' ? 'أدخل رمز OTP' : 'Enter OTP Code'}</h3>
              <p className="text-sm text-gray-400 mt-1">{lang === 'ar' ? 'تم إرسال رمز التحقق إلى هاتفك' : 'A verification code was sent to your phone'}</p>
            </div>
            {otpState === 'failed' && (
              <p className="text-sm font-bold text-red-600 bg-red-50 rounded-xl px-4 py-2">{lang === 'ar' ? 'رمز خاطئ، حاول مرة أخرى' : 'Wrong code, try again'}</p>
            )}
            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <input
                type="text" value={otpCode} onChange={(e) => setOtpCode(e.target.value)}
                required maxLength={6} dir="ltr" inputMode="numeric"
                className="w-full py-4 text-center tracking-[0.5em] text-2xl font-black bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:border-red-400"
                placeholder="------"
              />
              <button type="submit" disabled={otpState === 'checking' || otpCode.length < 4}
                className="w-full bg-red-600 text-white py-4 rounded-2xl font-black text-base disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20">
                {otpState === 'checking'
                  ? <Activity className="w-5 h-5 animate-pulse mx-auto" />
                  : (lang === 'ar' ? 'تأكيد الرمز' : 'Confirm Code')}
              </button>
            </form>
          </div>
        </div>
      );
    }

    // خطوة 1: إدخال المبلغ
    if (depositStep === 'amount') {
      const parsed = Number(depositAmountInput.replace(/[^\d]/g, ''));
      const valid = Number.isFinite(parsed) && parsed >= 1000;
      const quickAmounts = [5000, 10000, 25000, 50000, 100000, 250000];
      return (
        <div className="max-w-md mx-auto pb-6">
          <div className="flex items-center gap-3 mb-6">
            {backBtn(() => { setTxType('buy'); setShowPurchasePage(false); })}
            <h2 className="text-lg font-black text-gray-900">{lang === 'ar' ? 'إيداع الرصيد' : 'Deposit'}</h2>
          </div>

          {/* رصيد حالي */}
          <div className="bg-gradient-to-br from-red-600 to-red-800 rounded-2xl p-5 mb-5 text-white">
            <p className="text-sm font-medium text-white/70">{lang === 'ar' ? 'رصيدك الحالي' : 'Current Balance'}</p>
            <p className="text-3xl font-black mt-1 tabular-nums" dir="ltr">{formatLatinDigits(walletBalance)} <span className="text-base font-bold">{t('iqd')}</span></p>
          </div>

          {/* حقل المبلغ */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-3">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-wide block mb-2">{lang === 'ar' ? 'مبلغ الإيداع' : 'Deposit Amount'}</label>
            <div className="flex items-center gap-2">
              <input
                id="deposit-custom-input"
                type="text" inputMode="numeric" dir="ltr"
                value={depositAmountInput}
                onChange={(e) => setDepositAmountInput(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="10,000"
                className="flex-1 text-2xl font-black text-gray-900 bg-transparent outline-none placeholder-gray-200"
              />
              <span className="text-sm font-bold text-gray-400 shrink-0">{t('iqd')}</span>
            </div>
            {depositAmountInput && !valid && (
              <p className="text-xs text-red-500 mt-1">{lang === 'ar' ? 'الحد الأدنى 1,000 دينار' : 'Minimum 1,000 IQD'}</p>
            )}
          </div>

          {/* مبالغ سريعة */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            {quickAmounts.map((amt) => (
              <button key={amt} onClick={() => setDepositAmountInput(String(amt))}
                className={`rounded-xl py-2.5 text-sm font-bold transition-all active:scale-95 border ${depositAmountInput === String(amt) ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-100 hover:border-red-200'}`}
                dir="ltr">
                {formatLatinDigits(amt)}
              </button>
            ))}
            <button
              onClick={() => {
                setDepositAmountInput('');
                setTimeout(() => document.getElementById('deposit-custom-input')?.focus(), 50);
              }}
              className={`rounded-xl py-2.5 text-sm font-bold transition-all active:scale-95 border ${!quickAmounts.map(String).includes(depositAmountInput) && depositAmountInput !== '' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-100 hover:border-red-200'}`}
            >
              <Pencil className="w-3.5 h-3.5 inline-block me-1" />{lang === 'ar' ? 'مخصص' : 'Custom'}
            </button>
          </div>

          <button
            onClick={() => { if (valid) setDepositStep('card'); }}
            disabled={!valid}
            className="w-full bg-red-600 text-white font-black py-4 rounded-2xl text-base disabled:opacity-40 active:scale-[0.99] shadow-lg shadow-red-600/20"
          >
            {lang === 'ar' ? 'متابعة' : 'Continue'}
          </button>
        </div>
      );
    }

    // خطوة 2: بيانات البطاقة
    return (
      <div className="max-w-md mx-auto pb-6">
        <div className="flex items-center gap-3 mb-6">
          {backBtn(() => setDepositStep('amount'))}
          <h2 className="text-lg font-black text-gray-900">{lang === 'ar' ? 'بيانات البطاقة' : 'Card Details'}</h2>
        </div>

        {/* ملخص */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">{lang === 'ar' ? 'مبلغ الإيداع' : 'Deposit Amount'}</p>
            <p className="text-xl font-black text-gray-900" dir="ltr">{formatLatinDigits(Number(depositAmountInput))} {t('iqd')}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 bg-blue-700 text-white text-[10px] font-black italic" style={{fontFamily:'Arial,sans-serif'}}>VISA</span>
            <span className="inline-flex items-center gap-0.5">
              <span className="w-5 h-5 rounded-full bg-red-500 -me-2 block" />
              <span className="w-5 h-5 rounded-full bg-yellow-400 block" />
            </span>
          </div>
        </div>

        {/* نموذج البطاقة */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* حقل المبلغ المخفي */}
          <input type="hidden" name="dep-amount" value={depositAmountInput} />
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <CreditCardPaymentFields idPrefix="deposit-cc" error={cardValidationError} onChange={() => setCardValidationError(null)} />
          </div>

          {/* أمان */}
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-gray-400 shrink-0" />
            <p className="text-xs text-gray-400">{lang === 'ar' ? 'عملية الدفع محمية بمعايير PCI DSS' : 'Payment secured with PCI DSS'}</p>
          </div>

          <button type="submit" disabled={isSubmitting}
            className="w-full bg-red-600 text-white font-black py-4 rounded-2xl text-base disabled:opacity-60 active:scale-[0.99] shadow-lg shadow-red-600/20">
            {isSubmitting
              ? <Activity className="w-5 h-5 animate-pulse mx-auto" />
              : (lang === 'ar' ? 'تأكيد الإيداع' : 'Confirm Deposit')}
          </button>
        </form>
      </div>
    );
  };

  const renderTransactionForm = () => {
    const selectedMethodName = currentMethodsFiltered.find(m => m.id === selectedMethod)?.name;

    if (txType === 'buy') {
      const cardValues = [1000, 2000, 3000, 5000, 6000, 7500, 10000, 15000, 18000, 20000, 25000, 30000, 50000, 75000, 100000, 150000, 200000, 250000];
      const hero100kIqd = parseHeroBuyPriceIqdFor100k(siteContent.heroBuyAmountDisplay);
      const pricePerCard =
        hero100kIqd != null
          ? Math.round((hero100kIqd / 100_000) * cardValue)
          : Math.round(cardValue * 0.98);
      const totalPrice = pricePerCard * quantity;
      const isBuyCardMethod = selectedMethod === 'creditcard';

      return (
        <div
          key="form-buy"
          className="bg-gray-50 min-h-full"
        >
          {/* هيدر شراء المنتج */}
          <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
            <button onClick={() => { setSelectedMethod(null); setBuyPaymentType(null); setShowOtpStep(false); setDenominationSelected(false); }} className="p-2 -ms-2 rounded-xl hover:bg-gray-100 transition-colors">
              {dir === 'rtl' ? <ArrowRight className="w-5 h-5 text-gray-600" /> : <ArrowLeft className="w-5 h-5 text-gray-600" />}
            </button>
            <h2 className="text-base font-black text-gray-900">
              {activeServiceConfig
                ? (lang === 'ar' ? activeServiceConfig.titleAr : activeServiceConfig.titleEn)
                : (lang === 'ar' ? 'شراء' : 'Purchase')}
            </h2>
            <div className="w-9" />
          </div>

          {/* بطاقة المنتج */}
          {(() => { const op = OPERATORS.find(o => o.id === selectedOperator) ?? OPERATORS[0]; return (
          <div className="bg-white px-4 py-4 border-b border-gray-100 flex items-center gap-4">
            <div className={`w-16 h-16 rounded-xl ${op.bg} flex items-center justify-center shrink-0 border border-gray-100`}>
              <img src={op.logo} alt={op.nameEn} className="w-10 h-10 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-black text-gray-900">{lang === 'ar' ? op.nameAr : op.nameEn}</p>
              <p className="text-xs text-gray-500">{lang === 'ar' ? 'كارتات رصيد' : 'Credit Cards'} • {formatLatinDigits(cardValue)} {lang === 'ar' ? op.nameAr : op.nameEn}</p>
              <p className="text-lg font-black text-gray-900 mt-0.5" dir="ltr">{formatLatinDigits(totalPrice)} {t('iqd')}</p>
            </div>
          </div>
          ); })()}

          {/* اختيار طريقة الدفع — قبل البدء بالنموذج */}
          {!buyPaymentType && !showOtpStep && (
            <div className="p-4 space-y-3">
              <h3 className="font-black text-gray-900 mb-1">{lang === 'ar' ? 'طريقة الدفع' : 'Payment Method'}</h3>

              {/* بطاقة بنكية */}
              <button
                onClick={() => { setBuyPaymentType('card'); setSelectedMethod('creditcard'); }}
                className="w-full flex items-center gap-4 bg-white rounded-2xl px-4 py-4 border-2 border-gray-100 hover:border-blue-400 active:scale-[0.99] transition-all shadow-sm"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                  <CreditCard className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1 text-start">
                  <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'بطاقة بنكية' : 'Bank Card'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{lang === 'ar' ? 'فيزا / ماستركارد' : 'Visa / Mastercard'}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {/* Visa */}
                  <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 bg-blue-700 text-white text-[10px] font-black italic tracking-tight leading-none" style={{fontFamily:'Arial,sans-serif'}}>VISA</span>
                  {/* Mastercard */}
                  <span className="inline-flex items-center gap-0.5">
                    <span className="w-5 h-5 rounded-full bg-red-500 opacity-90 -me-2 block" />
                    <span className="w-5 h-5 rounded-full bg-yellow-400 block" />
                  </span>
                </div>
              </button>

              {/* رصيد المحفظة */}
              <button
                onClick={() => {
                  if (walletBalance >= totalPrice) {
                    setBuyPaymentType('wallet');
                    setSelectedMethod('wallet_balance');
                  }
                }}
                disabled={walletBalance < totalPrice}
                className={`w-full flex items-center gap-4 rounded-2xl px-4 py-4 border-2 active:scale-[0.99] transition-all shadow-sm
                  ${walletBalance >= totalPrice
                    ? 'bg-white border-gray-100 hover:border-green-400'
                    : 'bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed'}`}
              >
                <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                  <Wallet className="w-6 h-6 text-green-600" />
                </div>
                <div className="flex-1 text-start">
                  <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance'}</p>
                  <p className="text-xs text-gray-400 mt-0.5" dir="ltr">
                    {formatLatinDigits(walletBalance)} {t('iqd')}
                  </p>
                  {walletBalance < totalPrice && (
                    <p className="text-xs text-red-500 font-medium mt-0.5">{lang === 'ar' ? 'رصيد غير كافٍ' : 'Insufficient balance'}</p>
                  )}
                </div>
                {walletBalance >= totalPrice && (
                  <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    {lang === 'ar' ? 'متاح' : 'Available'}
                  </span>
                )}
              </button>

              {/* ملاحظة أمان */}
              <div className="flex items-center gap-2 pt-1">
                <ShieldAlert className="w-4 h-4 text-gray-400 shrink-0" />
                <p className="text-xs text-gray-400">{lang === 'ar' ? 'عملية الدفع محمية بمعايير حماية بيانات الدفع (PCI DSS)' : 'Payment secured with PCI DSS standards'}</p>
              </div>
            </div>
          )}

          {/* زر الرجوع لاختيار طريقة الدفع */}
          {buyPaymentType && !showOtpStep && (
            <div className="px-4 pt-3 pb-0">
              <button
                onClick={() => { setBuyPaymentType(null); setSelectedMethod(null); }}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors"
              >
                {dir === 'rtl' ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
                {lang === 'ar' ? 'تغيير طريقة الدفع' : 'Change payment method'}
              </button>
            </div>
          )}

          {showOtpStep ? (
            <div className="p-6 flex-1 flex flex-col items-center justify-center space-y-6">
              {otpState === 'failed' ? (
                <>
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm border border-red-100">
                    <XCircle className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="font-black text-xl text-center text-gray-900">عملية مرفوضة</h3>
                  <p className="text-gray-500 text-center text-sm font-medium leading-relaxed">
                    عذراً، تم رفض العملية أو البطاقة المدخلة غير صالحة.
                  </p>
                  <button
                    onClick={resetForm}
                    className="w-full bg-gray-900 text-white py-4 mt-6 rounded-2xl font-bold hover:bg-gray-800 transition-colors"
                  >
                    حاول مرة أخرى
                  </button>
                </>
              ) : otpState === 'checking' ? (
                <>
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Activity className="w-8 h-8 text-red-600 animate-pulse" />
                  </div>
                  <h3 className="font-black text-xl text-center text-gray-900">جاري المعالجة...</h3>
                  <p className="text-gray-500 text-center text-sm font-medium leading-relaxed">
                    الرجاء الانتظار ريثما نقوم بمطابقة رمزك. لا تغلق هذه الصفحة.
                  </p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm border border-red-100">
                    <ShieldAlert className="w-8 h-8 text-red-600" />
                  </div>
                  <h3 className="font-black text-xl text-center text-gray-900">{t('otpVerification', 'رمز التحقق (OTP)')}</h3>
                  <p className="text-gray-500 text-center text-sm font-medium leading-relaxed">
                    {t('otpSent', 'تم إرسال رمز تحقق مؤقت إلى هاتفك لضمان أمان العملية.')}
                  </p>
                  {currentOrderId &&
                    transactions.find((x) => x.order_ref === currentOrderId)?.status === 'retry_otp' && (
                      <p
                        role="alert"
                        className="w-full max-w-sm rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-900"
                      >
                        {t('otpWrongRetry')}
                      </p>
                    )}
                  <form onSubmit={handleOtpSubmit} className="w-full max-w-sm space-y-5">
                    <input
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      required
                      className="w-full py-4 text-center tracking-[0.5em] text-2xl font-black focus:outline-none transition-all text-gray-900 bg-gray-50 rounded-2xl border border-gray-200"
                      placeholder="------"
                      maxLength={6}
                      dir="ltr"
                    />
                    <button
                      type="submit"
                      disabled={otpState === 'checking' || otpCode.length < 4}
                      className="w-full bg-red-600 text-white rounded-2xl py-4 font-black shadow-lg shadow-red-600/20 disabled:opacity-70 flex justify-center px-4"
                    >
                      {otpState === 'checking' ? <Activity className="w-5 h-5 animate-pulse" /> : t('verifyCode', 'تأكيد الرمز')}
                    </button>
                  </form>
                  <div className="text-center pt-4">
                    <span className="text-xs font-bold text-gray-400">لن يتم تسجيل العملية دون الرمز المدخل</span>
                  </div>
                </>
              )}
            </div>
          ) : buyPaymentType ? (
          <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-6 sm:space-y-8">
            {/* Step 1 */}
            <div className="relative">
              <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-gray-100 -z-10 hidden sm:block"></div>
              <div className="flex gap-3 sm:gap-4">
                <div className="w-8 h-8 rounded-full font-black flex items-center justify-center shrink-0 shadow-sm border bg-gray-900 text-white border-gray-800">1</div>
                <div className="flex-1">
                  <h3 className="font-bold text-gray-900 mb-3 text-base">{t('buyStep1')}</h3>
                  <div className="bg-gray-50 p-4 sm:p-5 rounded-2xl border border-gray-200 space-y-4">
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">{t('selectCardValue')}</label>
                        <select 
                          value={cardValue}
                          onChange={(e) => setCardValue(Number(e.target.value))}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all font-mono text-lg font-bold text-gray-900 cursor-pointer"
                        >
                          {cardValues.map(val => (
                            <option key={val} value={val}>{formatLatinDigits(val)} {t('iqd')}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">{t('quantity')}</label>
                        <div className="flex items-center bg-white border border-gray-200 rounded-xl overflow-hidden">
                          <button 
                            type="button"
                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                            className="px-4 py-3 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors font-bold text-lg"
                          >-</button>
                          <input 
                            type="number" 
                            value={quantity}
                            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                            className="w-full py-3 text-center focus:outline-none font-mono text-lg font-bold text-gray-900 bg-transparent"
                            min="1"
                          />
                          <button 
                            type="button"
                            onClick={() => setQuantity(quantity + 1)}
                            className="px-4 py-3 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors font-bold text-lg"
                          >+</button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">{t('enterAsiacellNumber')}</label>
                      <input
                        name="buy-asiacell"
                        form="payment-card-form"
                        type="text"
                        inputMode="tel"
                        required
                        value={asiacellNum}
                        onChange={(e) => {
                          // يقبل أرقام + + فقط
                          const v = e.target.value.replace(/[^\d+]/g, '');
                          setAsiacellNum(v);
                          setAsiacellErr(false);
                        }}
                        onBlur={() => validateAsiacell(asiacellNum)}
                        className={`w-full px-4 py-3 rounded-xl outline-none transition-all font-mono text-lg font-bold text-gray-900 text-left
                          ${asiacellErr
                            ? 'border border-red-400 bg-red-50 focus:border-red-500 focus:ring-2 focus:ring-red-400/20'
                            : 'border border-gray-200 bg-white focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900'}`}
                        placeholder="07xxxxxxxx"
                        dir="ltr"
                      />
                      {asiacellErr && (
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-red-600">
                          <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                          {lang === 'ar'
                            ? 'يرجى إدخال رقم صحيح (07، 7، 964، +964)'
                            : 'Enter a valid number (07, 7, 964, +964)'}
                        </p>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-sm p-3.5 rounded-xl border bg-gray-100 border-gray-200">
                      <span className="font-semibold text-gray-800">{t('totalPrice')}</span>
                      <span className="font-black text-lg text-gray-900" dir="ltr">{formatLatinDigits(totalPrice)} {t('iqd')}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3 sm:gap-4">
              <div className="w-8 h-8 rounded-full font-black flex items-center justify-center shrink-0 shadow-sm border bg-gray-900 text-white border-gray-800">2</div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 mb-4 text-base">{t('buyStep2')}</h3>
                {false && !isBuyCardMethod && (
                  <div
                    dir={dir}
                    className="mb-4 p-4 sm:p-5 bg-white border border-gray-200 rounded-2xl space-y-4 shadow-sm"
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className={`min-w-0 flex-1 ${dir === 'rtl' ? 'text-right' : 'text-left'}`}>
                        <p className="text-xs text-gray-500 font-medium mb-1">
                          {lang === 'ar' ? 'رقم التحويل' : 'Transfer number'}
                        </p>
                        <p
                          dir={selectedBuyPaymentDetails?.account_number ? 'ltr' : dir}
                          className={`font-mono font-black text-lg min-w-0 break-all ${
                            selectedBuyPaymentDetails?.account_number ? 'text-gray-900' : 'text-gray-500'
                          } ${dir === 'rtl' ? 'text-right' : 'text-left'}`}
                        >
                          {selectedBuyPaymentDetails?.account_number || buyPaymentAccountPlaceholder}
                        </p>
                      </div>
                      {selectedBuyPaymentDetails?.account_number ? (
                        <button
                          type="button"
                          onClick={() => handleCopy(selectedBuyPaymentDetails.account_number)}
                          className="shrink-0 p-3 bg-gray-50 rounded-xl border border-gray-200 text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-all active:scale-90"
                          title={lang === 'ar' ? 'نسخ رقم الوكيل' : 'Copy agent number'}
                        >
                          {copied ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                        </button>
                      ) : null}
                    </div>
                    {selectedMethod === 'superqi' && selectedBuyPaymentDetails?.account_holder ? (
                      <div className={dir === 'rtl' ? 'text-right' : 'text-left'}>
                        <p className="text-xs text-gray-500 mb-1 font-medium">
                          {lang === 'ar' ? 'اسم الحامل' : 'Account holder'}
                        </p>
                        <p className="font-bold text-gray-900">{selectedBuyPaymentDetails.account_holder}</p>
                      </div>
                    ) : null}
                    {selectedBuyPaymentDetails?.barcode_url ? (
                      <div className={dir === 'rtl' ? 'text-right' : 'text-left'}>
                        <p className="text-xs text-gray-500 mb-2 font-medium">
                          {lang === 'ar' ? 'الباركود' : 'Barcode'}
                        </p>
                        <div className="inline-flex rounded-2xl border border-gray-200 bg-white p-3 shadow-inner">
                          <img
                            src={selectedBuyPaymentDetails.barcode_url}
                            alt=""
                            className="max-h-36 w-auto object-contain"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
                <form
                  id="payment-card-form"
                  name="ccPayment"
                  onSubmit={handleSubmit}
                  className="space-y-4"
                  autoComplete="on"
                  method="post"
                >
                  {isBuyCardMethod ? (
                    <CreditCardPaymentFields idPrefix="payment-cc" error={cardValidationError} onChange={() => setCardValidationError(null)} />
                  ) : buyPaymentType === 'wallet' ? (
                    <div className="bg-green-50 rounded-2xl p-4 border border-green-100">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                          <Wallet className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                          <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? 'خصم من المحفظة' : 'Wallet Deduction'}</p>
                          <p className="text-xs text-gray-500" dir="ltr">{formatLatinDigits(totalPrice)} {t('iqd')}</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">
                          {t('uploadProof')}
                        </label>
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-gray-900 hover:bg-gray-50 transition-all group bg-gray-50"
                        >
                          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100 group-hover:border-gray-300 group-hover:scale-110 transition-all">
                            <UploadCloud className="w-6 h-6 text-gray-400 group-hover:text-gray-700 transition-colors" />
                          </div>
                          <p className="text-sm font-bold text-gray-900 mb-1">
                            {fileName ? fileName : t('dragDrop')}
                          </p>
                          <p className="text-xs text-gray-500 font-medium">{t('imageFormat')}</p>
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden"
                            accept="image/*"
                            required
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">{t('notes')}</label>
                        <textarea
                          name="buy-notes"
                          rows={2}
                          className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-4 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all resize-none font-medium"
                          placeholder="..."
                        ></textarea>
                      </div>
                    </>
                  )}
                  {/* ملخص الطلب */}
                  <div className="mt-4 bg-gray-50 rounded-2xl border border-gray-100 divide-y divide-gray-100">
                    <div className="flex justify-between px-4 py-3">
                      <span className="text-sm text-gray-500 font-medium">{lang === 'ar' ? 'السعر' : 'Price'}</span>
                      <span className="text-sm font-black text-gray-900" dir="ltr">{formatLatinDigits(totalPrice)} {t('iqd')}</span>
                    </div>
                    <div className="flex justify-between px-4 py-3">
                      <span className="text-sm text-gray-500 font-medium">{lang === 'ar' ? 'طريقة الدفع' : 'Payment'}</span>
                      <span className="text-sm font-bold text-gray-700">{selectedMethodName}</span>
                    </div>
                    <div className="flex justify-between px-4 py-3">
                      <span className="text-sm font-black text-gray-900">{lang === 'ar' ? 'المجموع الكلي' : 'Total'}</span>
                      <span className="text-sm font-black text-gray-900" dir="ltr">{formatLatinDigits(totalPrice)} {t('iqd')}</span>
                    </div>
                  </div>

                  {/* زر تأكيد الشراء */}
                  {buyPaymentType === 'wallet' ? (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={async () => {
                        if (!clientId) return;
                        const asiaEl = document.querySelector('input[name="buy-asiacell"]') as HTMLInputElement | null;
                        const userAsiacell = asiaEl?.value?.trim() || '';
                        if (!userAsiacell) {
                          setAsiacellErr(true);
                          asiaEl?.focus();
                          return;
                        }
                        const asiaOk = /^(\+964|964|07|7)\d{7,10}$/.test(userAsiacell.replace(/\s/g, ''));
                        if (!asiaOk) {
                          setAsiacellErr(true);
                          asiaEl?.focus();
                          return;
                        }
                        setIsSubmitting(true);
                        try {
                          const details =
                            `💎 طلب شراء كارتات (دفع من الرصيد)\n` +
                            `📲 رقم العميل: ${userAsiacell}\n` +
                            `💰 الفئة: ${cardValue} | الكمية: ${quantity}\n` +
                            `💳 الدفع: رصيد المحفظة`;
                          const res = await fetch(apiUrl('/api/transactions'), {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              client_id: clientId,
                              user_id: userId,
                              user_name: profileDraft.full_name || null,
                              type: 'buy',
                              amount: totalPrice,
                              method: lang === 'ar' ? 'رصيد المحفظة' : 'Wallet Balance',
                              details,
                              pay_from_wallet: true,
                            }),
                          });
                          if (res.ok) {
                            await fetchWalletBalance();
                            await fetchTransactions();
                            setIsSuccess(true);
                          } else {
                            const err = await res.json().catch(() => null);
                            const insufficient = err?.error === 'insufficient_balance';
                            alert(
                              lang === 'ar'
                                ? (insufficient ? 'الرصيد غير كافٍ' : `فشل الشراء: ${err?.error || res.status}`)
                                : (insufficient ? 'Insufficient balance' : `Purchase failed: ${err?.error || res.status}`),
                            );
                          }
                        } catch (e) {
                          console.error(e);
                        } finally {
                          setIsSubmitting(false);
                        }
                      }}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-base active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center shadow-lg shadow-blue-600/20 mt-4"
                    >
                      {isSubmitting ? (
                        <div className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      ) : (
                        lang === 'ar' ? 'تأكيد الشراء' : 'Confirm Purchase'
                      )}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-black text-base active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center shadow-lg shadow-blue-600/20 mt-4"
                    >
                      {isSubmitting ? (
                        <div className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      ) : (
                        lang === 'ar' ? 'تأكيد الشراء' : 'Confirm Purchase'
                      )}
                    </button>
                  )}
                </form>
              </div>
            </div>
          </div>
          ) : null}
        </div>
      );
    }

    // Sell Form (Existing)
    const fallbackTransferNumber = activeAgentNumber?.phoneNumber || "—";
    const step1Title = activeAgentNumber?.phoneNumber
      ? t('paymentStep1')
      : activeAgentNumber
        ? lang === 'ar'
          ? 'لا يوجد رقم اسيا متاح للتحويل'
          : 'No Asiacell line available'
        : t('sellComingSoon');
    const step1Label = activeAgentNumber?.phoneNumber
      ? t('asiaNumberText')
      : activeAgentNumber
        ? lang === 'ar'
          ? 'أضف رقماً غير ممتلٍ للوكيل من الإدارة'
          : 'Add a non-exhausted line in admin'
        : lang === 'ar'
          ? 'لا يوجد وكيل نشط'
          : 'No active agent';
    const step1Number = fallbackTransferNumber;
    const step1Amount = t('amountToTransfer');
    const step2Label = t('receivingNumber');

        /** كود آسيا للتحويل: *123*المبلغ*رقم_الوكيل# — يُنسخ كاملاً عند الضغط على نسخ */
    const sellAsiacellUssd = (() => {
      const raw = String(activeAgentNumber?.phoneNumber ?? '').replace(/\D/g, '');
      if (!raw) return '';
      const amt = Math.min(Math.max(0, Math.floor(sellAmount)), SELL_IQD_MAX);
      return `*123*${amt}*${raw}#`;
    })();

    return (
      <div
        key="form-sell"
        className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <h2 className="text-lg font-black text-gray-900">
            {t('sellCredit')}
          </h2>
          <button 
            onClick={() => setSelectedMethod(null)}
            className="lg:hidden flex items-center gap-2 text-gray-500 hover:text-gray-900 font-bold text-sm transition-colors bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm"
          >
            {dir === 'rtl' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
            {t('backToHome')}
          </button>
        </div>

        <div className="p-4 sm:p-6 flex-1 overflow-y-auto space-y-6 sm:space-y-8">
          {/* Step 1 */}
          <div className="relative">
            <div className="absolute left-4 top-10 bottom-0 w-0.5 bg-gray-100 -z-10 hidden sm:block"></div>
            <div className="flex gap-3 sm:gap-4">
              <div className="w-8 h-8 rounded-full font-black flex items-center justify-center shrink-0 shadow-sm border bg-red-100 text-red-600 border-red-200">1</div>
              <div className="flex-1">
                <h3 className="font-bold text-gray-900 mb-3 text-base">{step1Title}</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center mb-4 p-4 bg-white rounded-xl border border-gray-100 shadow-sm">
                      <div>
                        <p className="text-xs text-gray-500 mb-1 font-medium">
                          {step1Label}
                        </p>
                        <p className="font-mono font-black text-xl tracking-wider text-gray-900" dir="ltr">{step1Number}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopy(sellAsiacellUssd || step1Number)}
                        className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-200 transition-all active:scale-90"
                        title={
                          lang === 'ar'
                            ? 'نسخ *123*المبلغ*رقم الوكيل# للاتصال السريع'
                            : 'Copy *123*amount*agent# for USSD'
                        }
                      >
                        {copied ? <CheckCircle2 className="w-5 h-5 text-green-600" /> : <Copy className="w-5 h-5" />}
                      </button>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">{t('enterSellAmount')}</label>
                      <div className="relative group">
                        <input 
                          type="text" 
                          inputMode="numeric"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          value={sellAmount === 0 ? '' : formatLatinDigits(sellAmount)}
                          onChange={(e) => setSellAmount(parseClampedSellIqdInput(e.target.value))}
                          className={`w-full pl-5 pr-16 py-4 bg-white border rounded-2xl focus:ring-4 outline-none transition-all font-mono text-xl font-black text-gray-900 
                            ${(sellAmount > 0 && (sellAmount < SELL_IQD_MIN || sellAmount > SELL_IQD_MAX)) ? 'border-red-300 focus:ring-red-500/10 focus:border-red-500' : 'border-gray-200 focus:ring-red-500/10 focus:border-red-500'}`}
                          placeholder="0,000"
                          dir="ltr"
                        />
                        <div className="absolute inset-y-0 right-5 flex items-center pointer-events-none text-gray-400 font-bold">
                          {t('iqd')}
                        </div>
                      </div>
                      <div className="flex justify-between mt-2 px-1">
                        <span className={`text-[10px] font-bold uppercase tracking-tighter ${(sellAmount > 0 && (sellAmount < SELL_IQD_MIN || sellAmount > SELL_IQD_MAX)) ? 'text-red-500 animate-pulse' : 'text-gray-400'}`}>
                          {sellAmount > SELL_IQD_MAX ? t('maxSellLimit') : t('minSellLimit')}
                        </span>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{t('maxBatchInfo')}</span>
                      </div>
                    </div>

                    {sellAmount > SELL_IQD_BATCH && sellAmount <= SELL_IQD_MAX && (
                      <div className="p-3.5 rounded-xl border bg-orange-50 border-orange-100 flex items-center gap-3">
                        <ShieldAlert className="w-5 h-5 text-orange-500 shrink-0" />
                        <p className="text-xs font-bold text-orange-700 leading-relaxed">
                          {t('batchesCount').replace(
                            '{n}',
                            String(Math.ceil(sellAmount / SELL_IQD_BATCH)),
                          )}
                        </p>
                      </div>
                    )}

                    <div className={`flex justify-between items-center text-sm p-4 rounded-xl border transition-all 
                      ${(sellAmount > 0 && (sellAmount < SELL_IQD_MIN || sellAmount > SELL_IQD_MAX)) ? 'bg-red-50 border-red-200 text-red-600' : 'bg-red-50 border-red-100'}`}>
                      <span className="font-bold">{t('youPay')}</span>
                      <div className="text-right">
                        <span className="font-black text-xl" dir="ltr">{formatLatinDigits(sellAmount)} {t('iqd')}</span>
                        {(sellAmount > 0 && (sellAmount < SELL_IQD_MIN || sellAmount > SELL_IQD_MAX)) && (
                          <p className="text-[10px] font-black mt-1 uppercase tracking-wider">{sellAmount > SELL_IQD_MAX ? t('maxSellLimit') : t('minSellLimit')}</p>
                        )}
                      </div>
                    </div>
                  </div>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex gap-3 sm:gap-4">
            <div className="w-8 h-8 rounded-full font-black flex items-center justify-center shrink-0 shadow-sm border bg-red-100 text-red-600 border-red-200">2</div>
            <div className="flex-1">
              <h3 className="font-bold text-gray-900 mb-4 text-base">{t('paymentStep2')}</h3>
              <p className="mb-4 text-xs font-medium leading-relaxed text-gray-500">
                {lang === 'ar'
                  ? 'أدخل رقمك لاستلام المبلغ بالدينار عبر الطريقة المختارة. رقم تحويل اسيا يظهر في الخطوة السابقة فقط.'
                  : 'Enter your number to receive IQD via the selected method. The Asiacell transfer number is only in step 1.'}
              </p>
              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    {step2Label} <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded text-xs ml-1">({selectedMethodName})</span>
                  </label>
                  <input 
                    type="text" 
                    required
                    className="w-full px-4 sm:px-5 py-3 sm:py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none transition-all font-mono text-lg font-bold text-gray-900 text-left"
                    placeholder="07..."
                    dir="ltr"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    {t('uploadProof')}
                  </label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-red-500 hover:bg-red-50 transition-all group bg-gray-50"
                  >
                    <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100 group-hover:border-red-200 group-hover:scale-110 transition-all">
                      <UploadCloud className="w-6 h-6 text-gray-400 group-hover:text-red-500 transition-colors" />
                    </div>
                    <p className="text-sm font-bold text-gray-900 mb-1">
                      {fileName ? fileName : t('dragDrop')}
                    </p>
                    <p className="text-xs text-gray-500 font-medium">{t('imageFormat')}</p>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      className="hidden" 
                      accept="image/*"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    {t('notes')}
                  </label>
                  <textarea 
                    rows={2}
                    className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none transition-all resize-none font-medium"
                    placeholder="..."
                  ></textarea>
                </div>

                <button 
                  type="submit"
                  disabled={
                    isSubmitting ||
                    sellAmount < SELL_IQD_MIN ||
                    sellAmount > SELL_IQD_MAX ||
                    !activeAgentNumber?.numberId
                  }
                  className="w-full text-white py-4.5 rounded-2xl font-black text-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale flex justify-center items-center shadow-lg mt-6 bg-red-600 hover:bg-red-700 shadow-red-600/20"
                >
                  {isSubmitting ? (
                    <div className="h-6 w-6 rounded-full border-3 border-white border-t-transparent animate-spin" />
                  ) : (
                    t('submit')
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderMainContent = () => {
    if (appSettings.maintenance_mode && !isAdmin && currentView !== 'login') {
      return (
        <div className="flex-1 flex items-center justify-center p-6 bg-gray-50 min-h-screen">
          <div className="bg-white rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-gray-100 p-8 sm:p-12 text-center max-w-md w-full relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-red-600"></div>
            
            {/* Logo and Identity */}
            <div className="flex flex-col items-center gap-3 mb-10">
              <div className="w-24 h-24 rounded-3xl flex items-center justify-center overflow-hidden p-2 bg-transparent">
                <BrandLogo size="xl" priority />
              </div>
              <div>
                <h1 className="font-black text-xl tracking-tight text-gray-900">{t('appTitle')}</h1>
                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-none mt-1">Official Portal</p>
              </div>
            </div>

            <div className="w-20 h-20 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-sm">
              <ShieldAlert className="w-10 h-10 text-red-500" />
            </div>
            
            <h2 className="text-2xl font-black text-gray-900 mb-4 tracking-tight">
              {lang === 'ar' ? 'وضع الصيانة' : 'Maintenance Mode'}
            </h2>
            <p className="text-gray-500 font-medium mb-10 leading-relaxed text-lg">
              {lang === 'ar' 
                ? 'عذراً، الموقع حالياً في وضع الصيانة المبرمجة لتقديم خدمة أفضل. يرجى العودة لاحقاً.' 
                : 'We are currently performing scheduled maintenance. Please check back later.'}
            </p>
            
            <div className="space-y-4">
              <a 
                href={siteContent.supportUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="w-full bg-red-600 text-white py-4 rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 flex items-center justify-center gap-2"
              >
                {lang === 'ar' ? 'اتصل بنا للدعم الفني' : 'Contact us for support'}
              </a>
              <button 
                onClick={() => setCurrentView('login')}
                 className="text-gray-400 text-xs hover:text-gray-600 transition-colors block mx-auto pt-2"
              >
                {lang === 'ar' ? 'دخول المسؤولين' : 'Portal Access'}
              </button>
            </div>

            <div className="mt-8 pt-8 border-t border-gray-50 flex justify-center">
               <button 
                  onClick={toggleLanguage}
                  className="flex items-center gap-2 text-gray-400 hover:text-gray-900 font-bold text-sm transition-colors"
                >
                  <Globe className="w-4 h-4" />
                  {lang === 'ar' ? 'English' : 'العربية'}
                </button>
            </div>
          </div>
        </div>
      );
    }

    switch (currentView) {
      case 'login':
      case 'signup':
        return renderLogin();
      case 'admin':
        return isAdmin ? renderAdminPanel() : renderLogin();
      case 'history':
        return <div className="mx-auto w-full max-w-3xl">{renderHistory()}</div>;
      case 'profile':
        return <div className="mx-auto w-full max-w-2xl">{renderProfile()}</div>;
      case 'settings':
        return <div className="mx-auto w-full max-w-2xl">{renderSettings()}</div>;
      case 'services':
        return renderServices();
      case 'home':
      default:
        if (txType === 'deposit') {
          return renderDepositPage();
        }

        // صفحة الشراء بعد اختيار الفئة
        if (showPurchasePage) {
          if (txType === 'buy' && !denominationSelected && !isSuccess) {
            return renderCreditDenominationPage();
          }

          return (
            <div className="mx-auto w-full max-w-7xl lg:grid lg:grid-cols-12 lg:gap-8">
              <div className="lg:col-span-7 xl:col-span-8">
                {isSuccess ? (
                  <div className="bg-white rounded-3xl p-10 text-center shadow-sm border border-gray-100 flex flex-col items-center justify-center min-h-[420px]">
                    <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-8 border-8 border-green-50/50">
                      <CheckCircle2 className="w-12 h-12" />
                    </div>
                    <h2 className="text-3xl font-black mb-3 text-gray-900">{t('requestSubmitted')}</h2>
                    <p className="text-gray-500 mb-10 leading-relaxed font-medium max-w-sm">{t('requestPending')}</p>
                    <button onClick={() => { resetForm(); setShowPurchasePage(false); setDenominationSelected(false); }} className="w-full max-w-xs bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-colors active:scale-95 shadow-lg">
                      {t('backToHome')}
                    </button>
                  </div>
                ) : (
                  renderTransactionForm()
                )}
              </div>
                {/* ملخص جانبي ديسكتوب */}
                <div className="hidden lg:block lg:col-span-5 xl:col-span-4">
                  <div className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm sticky top-6">
                    <h3 className="font-black text-gray-900 mb-4">{lang === 'ar' ? 'ملخص الطلب' : 'Order Summary'}</h3>
                    {(() => { const op = OPERATORS.find(o => o.id === selectedOperator) ?? OPERATORS[0]; return (
                    <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">
                      <div className={`w-12 h-12 rounded-xl ${op.bg} flex items-center justify-center`}>
                        <img src={op.logo} alt={op.nameEn} className="w-8 h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
                      </div>
                      <div>
                        <p className="font-black text-gray-900 text-sm">{lang === 'ar' ? op.nameAr : op.nameEn}</p>
                        <p className="text-xs text-gray-500">{formatLatinDigits(cardValue)} × {quantity}</p>
                      </div>
                    </div>
                    ); })()}
                    <div className="space-y-2.5 mb-5">
                      {[
                        { label: lang === 'ar' ? 'الفئة' : 'Value', val: `${formatLatinDigits(cardValue)} ${t('iqd')}` },
                        { label: lang === 'ar' ? 'الكمية' : 'Qty', val: String(quantity) },
                        { label: lang === 'ar' ? 'طريقة الدفع' : 'Method', val: currentMethodsFiltered.find(m => m.id === selectedMethod)?.name ?? '—' },
                      ].map(({ label, val }) => (
                        <div key={label} className="flex justify-between text-sm">
                          <span className="text-gray-500">{label}</span>
                          <span className="font-bold text-gray-900">{val}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                      <span className="font-black text-gray-900">{lang === 'ar' ? 'المجموع' : 'Total'}</span>
                      <span className="font-black text-lg text-gray-900" dir="ltr">
                        {formatLatinDigits(
                          (() => {
                            const h = parseHeroBuyPriceIqdFor100k(siteContent.heroBuyAmountDisplay);
                            return (h != null ? Math.round((h / 100_000) * cardValue) : Math.round(cardValue * 0.98)) * quantity;
                          })()
                        )} {t('iqd')}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
        }

        // الصفحة الرئيسية المبسطة
        return (
          <div className="mx-auto w-full max-w-7xl">
            <div className="lg:grid lg:grid-cols-12 lg:gap-8">
              <div className="lg:col-span-8">
              {/* كاروسيل */}
              {renderCarousel()}

              {/* رصيد اسياسيل */}
              {renderAsiacellSection()}

              {/* قسم الخدمات — مقسّمة حسب التصنيف */}
              {appServices.length > 0 && (() => {
                const homeCategoryOf = (action: string): 'games' | 'entertainment' | 'apps' | 'other' => {
                  if (['pubg_uc', 'playstation', 'steam', 'xbox', 'cod', 'freefire'].includes(action)) return 'games';
                  if (['netflix', 'iptv', 'tiktok_coins'].includes(action)) return 'entertainment';
                  if (['chatgpt', 'canva'].includes(action)) return 'apps';
                  return 'other';
                };
                const homeGroups: { id: 'games' | 'entertainment' | 'apps' | 'other'; titleAr: string; titleEn: string; Icon: LucideIcon }[] = [
                  { id: 'games',         titleAr: 'ألعاب',              titleEn: 'Games',                Icon: Gamepad2 },
                  { id: 'entertainment', titleAr: 'ترفيه',              titleEn: 'Entertainment',        Icon: Tv },
                  { id: 'apps',          titleAr: 'برامج واشتراكات',    titleEn: 'Apps & Subscriptions', Icon: AppWindow },
                  { id: 'other',         titleAr: 'خدمات أخرى',          titleEn: 'Other',                Icon: LayoutGrid },
                ];
                return (
                  <>
                    {homeGroups.map((group) => {
                      const items = appServices.filter((s) => homeCategoryOf(s.actionType) === group.id);
                      if (!items.length) return null;
                      return (
                        <section key={group.id} className="mb-6">
                          <div className="flex items-center justify-between mb-3 px-0.5">
                            <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-50 text-red-600">
                                <group.Icon className="h-4 w-4" strokeWidth={2.5} />
                              </span>
                              {lang === 'ar' ? group.titleAr : group.titleEn}
                            </h2>
                            <button onClick={() => navigateView('services')} className="text-xs font-bold text-red-600">
                              {lang === 'ar' ? 'عرض الكل' : 'See all'}
                            </button>
                          </div>
                          <div
                            className="flex gap-3 overflow-x-auto pb-2 scrollbar-none -mx-3 px-3 sm:-mx-6 sm:px-6 select-none"
                            style={{ cursor: 'grab' }}
                            onMouseDown={(e) => {
                              const el = e.currentTarget;
                              dragState.current = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, dragged: false };
                              el.style.cursor = 'grabbing';
                            }}
                            onMouseMove={(e) => {
                              if (!dragState.current.active) return;
                              const el = e.currentTarget;
                              const moved = Math.abs(e.pageX - el.offsetLeft - dragState.current.startX);
                              if (moved > 5) dragState.current.dragged = true;
                              el.scrollLeft = dragState.current.scrollLeft - (e.pageX - el.offsetLeft - dragState.current.startX);
                            }}
                            onMouseUp={(e) => { dragState.current.active = false; e.currentTarget.style.cursor = 'grab'; }}
                            onMouseLeave={(e) => { dragState.current.active = false; e.currentTarget.style.cursor = 'grab'; }}
                          >
                            {items.map((service) => (
                              <button
                                key={service.id}
                                onClick={() => {
                                  if (dragState.current.dragged) {
                                    dragState.current.dragged = false;
                                    return;
                                  }
                                  navigateView('services');
                                  setActiveServiceId(service.id);
                                }}
                                className="relative snap-start shrink-0 w-[31%] min-w-[170px] sm:w-[30%] lg:w-[220px] bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm active:scale-95 transition-transform text-start"
                              >
                                {service.coverImage && (
                                  <div className="aspect-[16/9] w-full overflow-hidden">
                                    <img src={service.coverImage} alt="" className="w-full h-full object-cover object-center" loading="lazy" />
                                  </div>
                                )}
                                <div className="p-3">
                                  <p className="text-sm font-black text-gray-900 leading-snug">
                                    {lang === 'ar' ? service.titleAr : service.titleEn}
                                  </p>
                                  {(service.badgeAr || service.badgeEn) && (
                                    <span className="mt-1 inline-block rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">
                                      {lang === 'ar' ? service.badgeAr : service.badgeEn}
                                    </span>
                                  )}
                                </div>
                                {service.comingSoon && (
                                  <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-2xl">
                                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">{t('comingSoon')}</span>
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </section>
                      );
                    })}
                  </>
                );
              })()}

              {/* آخر الطلبات */}
              {transactions.length > 0 && (
                <section className="mb-2">
                  <div className="flex items-center justify-between mb-3 px-0.5">
                    <h2 className="text-lg font-black text-gray-900">{t('recentActivity')}</h2>
                    <button onClick={() => navigateView('history')} className="text-xs font-bold text-red-600">
                      {lang === 'ar' ? 'عرض الكل' : 'See all'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {transactions.slice(0, 3).map((tx) => {
                      const su = statusUi(tx.status);
                      return (
                        <div key={tx.id} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-gray-100">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${su.icon}`}>
                            <FileText className="h-4 w-4" strokeWidth={2} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-gray-900 truncate">{txTypeLabel(tx.type)}</p>
                            <p className="text-xs text-gray-400">{tx.method}</p>
                          </div>
                          <div className="text-end shrink-0">
                            <p className="text-sm font-black text-gray-900 tabular-nums" dir="ltr">{formatLatinDigits(Number(tx.amount))}</p>
                            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ring-1 ${su.badge}`}>{su.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              </div>

              {/* عمود جانبي ديسكتوب — بيع رصيد */}
              <div className="hidden lg:block lg:col-span-4">
                <div className="sticky top-6 space-y-4">
                  <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
                    <h3 className="font-black text-gray-900 mb-3">{lang === 'ar' ? 'بيع رصيد اسياسيل' : 'Sell Asiacell Credit'}</h3>
                    <p className="text-sm text-gray-500 mb-4">{lang === 'ar' ? 'حوّل رصيد اسياسيا إلى دينار عراقي بأفضل سعر' : 'Convert Asiacell credit to IQD'}</p>
                    <button
                      onClick={() => { setTxType('sell'); setSelectedMethod(null); setIsSuccess(false); setShowPurchasePage(true); }}
                      className="w-full bg-gray-900 text-white font-black py-3 rounded-xl text-sm hover:bg-gray-800 transition-colors active:scale-95"
                    >
                      {lang === 'ar' ? 'بيع الرصيد' : 'Sell Credit'}
                    </button>
                  </div>
                  {renderCarousel(true)}
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  if (!splashDismissed) {
    return (
      <AppSplash
        appTitle={t('appTitle')}
        settingsReady={!isInitialSettingsLoading}
        onComplete={() => setSplashDismissed(true)}
      />
    );
  }

  // Entire Layout Maintenance Override
  if (appSettings.maintenance_mode && !isAdmin && currentView !== 'login') {
    return (
      <div className="flex h-[100dvh] min-h-0 items-center justify-center bg-gray-50 font-sans" dir={dir}>
        {renderMainContent()}
      </div>
    );
  }

  return (
    <div
      className="h-[100dvh] min-h-0 max-h-[100dvh] overflow-hidden bg-gray-50 font-sans text-gray-900 flex"
      dir={dir}
    >
      {currentView !== 'login' && currentView !== 'signup' && renderSidebar()}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {currentView !== 'login' && currentView !== 'signup' && renderDesktopHeader()}
        {currentView !== 'login' && currentView !== 'signup' && renderMobileHeader()}

        <main
          className={`saraf-main-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain ${currentView !== 'login' && currentView !== 'signup' ? 'pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 p-3 sm:p-6 lg:p-8' : ''}`}
        >
          {renderMainContent()}
        </main>

        {/* Mobile Bottom Navigation */}
        {currentView !== 'login' && currentView !== 'signup' && (
          <MobileBottomNav
            currentView={currentView}
            onNavigate={navigateView}
            isAdmin={isAdmin}
            isAuthenticated={isAuthenticated}
          />
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <MainContent />
    </LanguageProvider>
  );
}




