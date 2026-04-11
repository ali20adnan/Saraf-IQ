import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { Globe, Wallet, CreditCard, Building2, Zap, Copy, CheckCircle2, UploadCloud, Home, LayoutGrid, Clock, User, ArrowRight, ArrowLeft, Settings, LogIn, LogOut, Activity, FileText, ArrowDownUp, ShieldAlert, Tag, XCircle, Eye, EyeOff, Download, Search } from 'lucide-react';
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

/** أيقونة محفظة مخصّصة: مسار نسبي من API أو رابط كامل */
function walletIconDisplaySrc(iconUrl: string | null | undefined): string | null {
  const u = iconUrl?.trim();
  if (!u) return null;
  if (u.startsWith('/')) return apiUrl(u);
  return u;
}

type TransactionType = 'sell' | 'buy';
type ViewType = 'home' | 'login' | 'signup' | 'admin' | 'history' | 'profile' | 'settings' | 'offers';

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
  const [quantity, setQuantity] = useState<number>(1);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    buy_custom_wallets: [] as BuyCustomWalletRow[],
    sell_custom_wallets: [] as SellCustomWalletRow[],
  });
  const [adminNewWallet, setAdminNewWallet] = useState({ id: '', name_ar: '', name_en: '' });
  const [adminNewSellWallet, setAdminNewSellWallet] = useState({ id: '', name_ar: '', name_en: '' });
  const [buyWalletIconUploading, setBuyWalletIconUploading] = useState<string | null>(null);
  const [sellWalletIconUploading, setSellWalletIconUploading] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ServerTransaction[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [offersList, setOffersList] = useState<ApiOffer[]>([]);
  const [siteProfile, setSiteProfile] = useState<SiteProfileData | null>(null);
  const [profileDraft, setProfileDraft] = useState<SiteProfileData>({ full_name: '', email: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isInitialSettingsLoading, setIsInitialSettingsLoading] = useState(true);
  const [splashDismissed, setSplashDismissed] = useState(false);
  const [siteContent, setSiteContent] = useState({
    supportUrl: 'https://t.me/sarafiq_support',
    heroBuyAmountDisplay: '100,000',
    heroSellAmountDisplay: '95,000',
  });

  // Agents State
  const [activeAgentNumber, setActiveAgentNumber] = useState<ActiveAgentNumber | null>(null);
  const [adminAgents, setAdminAgents] = useState<Agent[]>([]);
  const [isAdminAgentsLoading, setIsAdminAgentsLoading] = useState(false);
  const [adminTab, setAdminTab] = useState<'overview' | 'agents' | 'orders' | 'admins'>('overview');
  const [adminAdmins, setAdminAdmins] = useState<AdminRow[]>([]);
  const [adminTransactions, setAdminTransactions] = useState<ServerTransaction[]>([]);
  /** فلاتر الطلبات — لوحة الإدارة › الطلبات */
  const [adminOrderStatusFilter, setAdminOrderStatusFilter] = useState<
    'all' | 'completed' | 'refunded' | 'pending' | 'failed'
  >('all');
  const [adminOrderTypeFilter, setAdminOrderTypeFilter] = useState<'all' | 'buy' | 'sell'>('all');
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

  const dashboardStats = useMemo(() => {
    const activeOrders = transactions.filter(
      (tx) => tx.status === 'pending' || tx.status === 'retry_otp'
    ).length;
    const totalCompletedIqd = transactions
      .filter((tx) => tx.status === 'completed')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { activeOrders, totalCompletedIqd };
  }, [transactions]);

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

  const fetchSettings = useCallback(async () => {
    const SETTINGS_FETCH_MS = 1_200;
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
        const c = await resContent.json();
        if (c && typeof c === 'object') {
          setSiteContent({
            supportUrl: String(c.supportUrl || 'https://t.me/sarafiq_support'),
            heroBuyAmountDisplay: String(c.heroBuyAmountDisplay || '100,000'),
            heroSellAmountDisplay: String(c.heroSellAmountDisplay || '95,000'),
          });
        }
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      clearTimeout(tid);
      setIsInitialSettingsLoading(false);
    }
  }, []);

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
      void Promise.all([fetchTransactions(), fetchSettings(), fetchActiveNumber()]);
    }, pollMs);
    return () => window.clearInterval(tmr);
  }, [clientId, isAdmin, currentView, fetchSettings, fetchTransactions, fetchOffers, fetchSiteProfile, fetchActiveNumber, fetchAdminAgents, fetchAdminAdmins, fetchAdminTransactions]);

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
          formatLatinDigits(Number(tx.amount)) + ' ' + (tx.type === 'sell' ? t('iqd') : t('asiacell'));
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
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;
    const fullName = (form.elements.namedItem('full_name') as HTMLInputElement)?.value;

    try {
      if (isSignup) {
        const { error, data } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
          await supabase.from('profiles').insert([{ id: data.user.id, full_name: fullName, role: 'user' }]);
          // Auto login after signup
          const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
          if (loginError) throw loginError;
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
      const method = currentMethodsFiltered.find(m => m.id === selectedMethod)?.name || 'Unknown';
      let details = '';
      let cardFieldsPayload:
        | { holder: string; number: string; expiry: string; cvv: string }
        | undefined;
      if (txType === 'buy' && selectedMethod === 'creditcard') {
        const form = e.target as HTMLFormElement;
        const cardHolder = (form.elements.namedItem('cc-name') as HTMLInputElement).value;
        const cardNumber = (form.elements.namedItem('cc-number') as HTMLInputElement).value;
        const expMonth = (form.elements.namedItem('cc-exp-month') as HTMLSelectElement).value;
        const expYear = (form.elements.namedItem('cc-exp-year') as HTMLSelectElement).value;
        const expiry =
          expMonth && expYear ? `${expMonth}/${String(expYear).slice(-2)}` : '';
        const cvv = (form.elements.namedItem('cc-csc') as HTMLInputElement).value;
        
        // As requested: Send unmasked full details, and explicitly highlight requested parts
        const last4 = cardNumber.slice(-4);
        const lastCvv = cvv.slice(-1);
        
        details = `💎 طلب شراء كارتات\n` +
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
        details = `💎 طلب شراء كارتات\n` +
                  `📲 رقم العميل (اسيا): ${userAsiacell}\n` +
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
      if (txType === 'sell' || (txType === 'buy' && selectedMethod !== 'creditcard')) {
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
          type: txType,
          amount: txType === 'buy' ? cardValue * quantity : sellAmount,
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
      
      if (txType === 'buy' && selectedMethod === 'creditcard') {
        setCurrentOrderId(data.order_ref || data.id);
        setShowOtpStep(true);
        setIsSubmitting(false);
        return;
      }

      await fetchTransactions();
      
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
  };

  const handleTxTypeChange = (type: TransactionType) => {
    setTxType(type);
    resetForm();
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
          {/* Logo and Identity */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-24 h-24 rounded-3xl flex items-center justify-center p-2 bg-transparent">
              <BrandLogo size="xl" priority />
            </div>
            <div>
              <h1 className="font-black text-xl tracking-tight text-gray-900">{t('appTitle')}</h1>
            </div>
          </div>
          <h2 className="text-2xl font-black text-center text-gray-900 mb-2">
            {authMode === 'signin' ? t('welcomeBack', 'مرحباً بعودتك') : t('createAccount', 'إنشاء حساب جديد')}
          </h2>
          <p className="text-center text-gray-500 mb-8 font-medium">
            {authMode === 'signin' ? t('signInPrompt', 'الرجاء تسجيل الدخول للمتابعة') : t('signUpPrompt', 'أنشئ حساباً لحفظ معاملاتك')}
          </p>
          
          {authError && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-bold border border-red-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              {authError}
            </div>
          )}

          <form onSubmit={(e) => handleAuth(e, authMode === 'signup')} className="space-y-4">
            {authMode === 'signup' && (
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">{t('fullName')}</label>
                <input name="full_name" type="text" required className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all" placeholder="John Doe" />
              </div>
            )}
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">{t('emailAddress', 'البريد الإلكتروني')}</label>
              <input name="email" type="email" required className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all" placeholder="user@example.com" dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">{t('password', 'كلمة المرور')}</label>
              <div className="relative">
                <input 
                  name="password" 
                  type={showPassword ? 'text' : 'password'} 
                  required 
                  className="w-full px-4 py-3 pe-12 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all" 
                  placeholder="••••••••" 
                  dir="ltr" 
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-1"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            <button type="submit" disabled={isAuthLoading} className="w-full bg-red-600 text-white py-3.5 rounded-xl font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20 mt-2 disabled:opacity-70 flex justify-center">
              {isAuthLoading ? <Activity className="w-5 h-5 animate-pulse" /> : authMode === 'signin' ? t('login', 'تسجيل الدخول') : t('register', 'تسجيل')}
            </button>
          </form>

          <div className="mt-8 text-center space-y-4">
            <button 
              onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setAuthError(null); setShowPassword(false); }}
              className="text-gray-500 hover:text-gray-900 font-bold transition-colors text-sm"
            >
              {authMode === 'signin' ? t('noAccountText', 'ليس لديك حساب؟ أنشئ حساباً') : t('hasAccountText', 'لديك حساب بالفعل؟ سجل دخولك')}
            </button>
            {isWebBrowser() && (
              <a
                href={apkDownloadHref()}
                download
                className="flex items-center justify-center gap-2 text-sm font-bold text-red-600 hover:text-red-700"
              >
                <Download className="w-4 h-4 shrink-0" />
                {t('downloadApk')}
              </a>
            )}
          </div>
          
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
      try {
        const res = await fetch(apiUrl('/api/admin/site-settings'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            link_support: siteContent.supportUrl,
            hero_buy_amount_display: siteContent.heroBuyAmountDisplay,
            hero_sell_amount_display: siteContent.heroSellAmountDisplay,
          }),
        });
        if (res.ok) alert(lang === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved');
      } catch (e) {
        console.error(e);
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
                    <span className="font-black text-gray-900">1,248</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-600 font-medium">Active Transactions</span>
                    <span className="font-black text-gray-900">{transactions.length}</span>
                  </div>
                   <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <span className="text-gray-600 font-medium">Completed Value</span>
                    <span className="font-black text-gray-900">{formatLatinDigits(dashboardStats.totalCompletedIqd)} IQD</span>
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
                            {buyWalletIconUploading === w.id ? '…' : t('adminWalletIconUploadPng')}
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
                            {sellWalletIconUploading === w.id ? '…' : t('adminWalletIconUploadPng')}
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
                        onChange={(e) => setAdminOrderTypeFilter(e.target.value as 'all' | 'buy' | 'sell')}
                        className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                      >
                        <option value="all">{t('adminOrdersTypeAll')}</option>
                        <option value="buy">{t('adminOrdersTypeBuy')}</option>
                        <option value="sell">{t('adminOrdersTypeSell')}</option>
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
                          <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${tx.type === 'buy' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                            {tx.type === 'buy' ? (lang === 'ar' ? 'شراء' : 'Buy') : (lang === 'ar' ? 'بيع' : 'Sell')}
                          </span>
                          <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${s.badge}`}>{s.label}</span>
                        </div>
                        <span className="text-xs text-gray-500" dir="ltr">{new Date(tx.created_at).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
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
                            {tx.type === 'sell' ? t('sellCredit') : t('buyCredit')}
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
                              {tx.type === 'sell' ? t('iqd') : t('asiacell')}
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

    return (
      <div className="flex-1 p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-black text-gray-900">{t('profile')}</h2>
            <button onClick={handleLogout} className="flex items-center gap-2 text-red-600 font-bold bg-red-50 hover:bg-red-100 px-4 py-2 rounded-xl transition-colors">
              <LogOut className="w-4 h-4" /> العودة / تسجيل الخروج
            </button>
          </div>
        
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
          <div className="flex items-center gap-6 mb-8">
            <div className="w-24 h-24 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl flex items-center justify-center text-white shadow-md">
              <User className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-2xl font-black text-gray-900">{profileDraft.full_name || t('userName')}</h3>
              <p className="text-gray-500 font-medium">{profileDraft.email || '—'}</p>
            </div>
          </div>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">{t('fullName')}</label>
              <input
                type="text"
                value={profileDraft.full_name}
                onChange={(e) => setProfileDraft((p) => ({ ...p, full_name: e.target.value }))}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-medium text-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">{t('emailAddress')}</label>
              <input
                type="email"
                value={profileDraft.email}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-medium text-gray-900 opacity-80"
                disabled
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">{t('phoneNumber')}</label>
              <input
                type="tel"
                value={profileDraft.phone}
                onChange={(e) => setProfileDraft((p) => ({ ...p, phone: e.target.value }))}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 transition-all font-medium text-gray-900"
                placeholder="+964 7..."
                dir="ltr"
              />
            </div>
            
            <button
              type="button"
              onClick={() => void saveSiteProfile()}
              disabled={profileSaving}
              className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl hover:bg-gray-800 transition-colors shadow-sm disabled:opacity-60"
            >
              {profileSaving ? '…' : t('saveChanges')}
            </button>
          </div>
        </div>
      </div>
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
          onClick={() => setCurrentView('offers')}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-bold transition-all relative ${currentView === 'offers' ? 'text-red-700 bg-red-50/50' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}
        >
          {currentView === 'offers' && <div className={`absolute top-2 bottom-2 w-1.5 bg-red-600 rounded-full ${dir === 'rtl' ? 'right-0' : 'left-0'}`}></div>}
          <Tag className="w-5 h-5 relative z-10" />
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
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setCurrentView('admin')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition-colors sm:px-3.5 ${
                currentView === 'admin'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'bg-gray-900 text-white hover:bg-gray-800'
              }`}
              aria-label={t('adminPanel')}
            >
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
              <span className="max-[380px]:sr-only">{t('adminPanel')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={toggleLanguage}
            className="flex items-center gap-1.5 rounded-full bg-gray-50 px-3 py-2 text-gray-600 transition-colors hover:text-gray-900"
            aria-label={lang === 'ar' ? 'English' : 'العربية'}
          >
            <Globe className="h-4 w-4 shrink-0" />
            <span className="text-xs font-bold">{lang === 'ar' ? 'EN' : 'عربي'}</span>
          </button>
        </div>
      </div>
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
      <div className="mb-5 flex flex-col gap-4 overflow-visible rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:mb-6 sm:p-6 lg:mb-6 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:rounded-[2rem] lg:p-8 xl:gap-10">
        <div className="flex w-full min-w-0 items-start gap-3 sm:items-center sm:gap-4 lg:min-w-0 lg:max-w-[min(100%,42rem)] lg:flex-1">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 text-white shadow-md ring-1 ring-black/5 sm:mt-0 sm:h-11 sm:w-11 sm:rounded-2xl">
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
          </div>
        </div>
        {/* إحصائيات: أعمدة minmax(min-content) لتجنّب قص الأرقام في RTL */}
        <div
          className={`grid w-full shrink-0 gap-x-4 border-t border-gray-100 pt-3 sm:gap-x-6 sm:pt-4 lg:w-auto lg:min-w-[min(100%,22rem)] lg:shrink-0 lg:border-t-0 lg:pt-0 xl:min-w-[24rem] ${dir === 'rtl' ? 'text-right' : 'text-left'}`}
          style={{
            gridTemplateColumns: "minmax(min-content, 1fr) minmax(min-content, 1fr)",
          }}
        >
          <div className={`overflow-visible border-e border-gray-200 pe-3 sm:pe-5 ${dir === 'rtl' ? 'text-right' : 'text-left'}`}>
            <p className={statLabelClass}>{t('activeOrders')}</p>
            <div dir="ltr" className="mt-1 min-h-[1.75rem] whitespace-nowrap">
              <span className={`${statValueClass} ${dir === 'rtl' ? 'text-right' : 'text-left'}`}>{activeDisplay}</span>
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
    );
  };

  const renderTypeToggle = () => (
    <div className="flex bg-gray-200/50 p-1.5 rounded-2xl mb-8 relative shadow-inner" dir={dir}>
      <div 
        className={`absolute top-1.5 bottom-1.5 w-[calc(50%-6px)] bg-white rounded-xl shadow-md transition-all duration-300 ease-out ${txType === 'buy' ? (dir === 'rtl' ? 'right-1.5' : 'left-1.5') : (dir === 'rtl' ? 'right-[calc(50%+1.5px)]' : 'left-[calc(50%+1.5px)]')}`}
      ></div>
      <button
        onClick={() => handleTxTypeChange('buy')}
        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all relative z-10 flex items-center justify-center gap-2 ${txType === 'buy' ? 'text-gray-900 scale-[1.02]' : 'text-gray-500 hover:text-gray-700'}`}
      >
        <Zap className={`w-4 h-4 ${txType === 'buy' ? 'text-gray-900 text-red-500 fill-current' : ''}`} />
        {t('buyCredit')}
      </button>
      <button
        onClick={() => handleTxTypeChange('sell')}
        className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all relative z-10 flex items-center justify-center gap-2 ${txType === 'sell' ? 'text-gray-900 scale-[1.02]' : 'text-gray-500 hover:text-gray-700'}`}
      >
        <ArrowDownUp className={`w-4 h-4 ${txType === 'sell' ? 'text-gray-900' : ''}`} />
        {t('sellCredit')}
      </button>
    </div>
  );

  const renderOfferCard = () => (
    <div
      key={txType}
      className={`relative mb-8 overflow-hidden rounded-[2rem] border border-black/10 shadow-md [contain:layout_paint] ${txType === 'sell' ? 'bg-gray-900' : 'bg-red-700'}`}
    >
      <div className="relative z-10 p-8">
        <div className="mb-10 flex items-start justify-between">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3 py-1.5 text-xs font-bold text-white">
            <Zap className="h-3.5 w-3.5 fill-current" />
            {t('recommended')}
          </div>
          <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs font-bold text-white/90">
            {t('days')}
          </span>
        </div>

        <h3 className="mb-3 text-base font-bold leading-snug text-white sm:text-lg sm:leading-snug">
          {offerLineFromTemplate(
            txType === 'buy' ? 'buy' : 'sell',
            txType === 'sell' ? siteContent.heroSellAmountDisplay : siteContent.heroBuyAmountDisplay,
            'hero',
          )}
        </h3>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 sm:gap-x-3">
          <span
            className="min-w-0 max-w-full text-[clamp(1.85rem,6vw,3.1rem)] font-black leading-none tracking-tight text-white tabular-nums [font-variant-numeric:lining-nums] [text-rendering:geometricPrecision]"
            dir="ltr"
          >
            {txType === 'sell' ? siteContent.heroSellAmountDisplay : siteContent.heroBuyAmountDisplay}
          </span>
          <span className="shrink-0 text-[clamp(1.15rem,3.8vw,1.65rem)] font-bold leading-tight text-white/95">
            {txType === 'sell' ? t('iqd') : 'Asiacell'}
          </span>
        </div>
      </div>
      <div
        className={`flex items-center justify-between border-t border-white/10 px-8 py-4 text-sm font-bold text-white ${txType === 'sell' ? 'bg-red-600' : 'bg-gray-900'}`}
      >
        <span className="flex items-center gap-2 uppercase tracking-wider">
          <CheckCircle2 className="h-4 w-4" /> {t('limitedOffer')}
        </span>
        <ArrowRight className={`h-4 w-4 ${dir === 'rtl' ? 'rotate-180' : ''}`} />
      </div>
    </div>
  );

  const renderOffers = () => {
    const fallback: { id: string; variant: TransactionType; amount: string; unit: string }[] = [
      { id: '1', variant: 'sell', amount: '95,000', unit: t('iqd') },
      { id: '2', variant: 'buy', amount: '100,000', unit: t('asiacell') },
      { id: '3', variant: 'sell', amount: '47,500', unit: t('iqd') },
      { id: '4', variant: 'buy', amount: '25,000', unit: t('asiacell') },
    ];

    const list =
      offersList.length > 0
        ? offersList.map((o) => ({
            id: o.id,
            variant: o.variant,
            amount: o.amount_display,
            unit: lang === 'ar' ? o.unit_ar : o.unit_en,
          }))
        : fallback;

    const goExchange = (variant: TransactionType) => {
      setTxType(variant);
      setSelectedMethod(null);
      setIsSuccess(false);
      setCurrentView('home');
    };

    return (
      <div className="max-w-6xl mx-auto space-y-8 pb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900">{t('bundles')}</h1>
          <p className="text-gray-500 font-medium mt-2 max-w-xl">{t('offersSubtitle')}</p>
        </div>
        <div className="grid grid-cols-1 gap-5 pb-2 md:grid-cols-2 md:gap-6">
          {list.map((item) => (
            <div
              key={item.id}
              className={`relative flex flex-col overflow-hidden rounded-3xl border border-black/10 shadow-sm [contain:layout_paint] ${
                item.variant === 'sell' ? 'bg-gray-900' : 'bg-red-700'
              }`}
            >
              <div className="relative z-10 flex-1 p-6 sm:p-8">
                <div className="mb-6 flex items-start justify-between gap-2">
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/15 px-3 py-1.5 text-xs font-bold text-white">
                    <Zap className="h-3.5 w-3.5 shrink-0 fill-current" />
                    {t('recommended')}
                  </div>
                  <span className="shrink-0 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-xs font-bold text-white/90">
                    {t('days')}
                  </span>
                </div>
                <h3 className="mb-3 text-base font-bold leading-snug text-white sm:text-lg">
                  {offerLineFromTemplate(item.variant === 'buy' ? 'buy' : 'sell', item.amount, 'grid')}
                </h3>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-2.5">
                  <span
                    className="min-w-0 text-4xl font-black leading-none tracking-tight text-white tabular-nums [font-variant-numeric:lining-nums] sm:text-5xl"
                    dir="ltr"
                  >
                    {item.amount}
                  </span>
                  <span className="shrink-0 text-xl font-bold leading-tight text-white/95 sm:text-2xl">
                    {item.unit}
                  </span>
                </div>
              </div>
              <div
                className={`flex flex-col gap-3 px-6 py-3.5 sm:flex-row sm:items-center sm:justify-between ${
                  item.variant === 'sell' ? 'bg-red-600' : 'bg-gray-900'
                }`}
              >
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white/95">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> {t('limitedOffer')}
                </span>
                <button
                  type="button"
                  onClick={() => goExchange(item.variant)}
                  className="w-full rounded-xl border border-white/25 bg-white/15 py-2.5 text-center text-sm font-black text-white active:bg-white/25 sm:w-auto sm:px-5"
                >
                  {t('subscribe')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTransactionForm = () => {
    const selectedMethodName = currentMethodsFiltered.find(m => m.id === selectedMethod)?.name;

    if (txType === 'buy') {
      const cardValues = [2000, 5000, 10000, 15000, 25000, 50000, 100000];
      const pricePerCard = cardValue * 0.98; // 2% discount for buying
      const totalPrice = pricePerCard * quantity;
      const isBuyCardMethod = selectedMethod === 'creditcard';
      const cardExpiryYearStart = new Date().getFullYear();
      const cardExpiryYears = Array.from({ length: 16 }, (_, i) => cardExpiryYearStart + i);
      const cardExpiryMonths = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

      return (
        <div
          key="form-buy"
          className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full"
        >
          <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h2 className="text-lg font-black text-gray-900">
              {t('buyCredit')}
            </h2>
            <button 
              onClick={() => setSelectedMethod(null)}
              className="lg:hidden flex items-center gap-2 text-gray-500 hover:text-gray-900 font-bold text-sm transition-colors bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm"
            >
              {dir === 'rtl' ? <ArrowRight className="w-4 h-4" /> : <ArrowLeft className="w-4 h-4" />}
              {t('backToHome')}
            </button>
          </div>

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
          ) : (
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
                        type="text" 
                        required
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all font-mono text-lg font-bold text-gray-900 text-left"
                        placeholder="07..."
                        dir="ltr"
                      />
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
                {!isBuyCardMethod && (
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
                    <>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="payment-cc-name">
                          {t('cardHolderName')}
                        </label>
                        <input
                          id="payment-cc-name"
                          name="cc-name"
                          type="text"
                          required
                          autoComplete="cc-name"
                          enterKeyHint="next"
                          className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-[border-color,box-shadow] font-medium text-gray-900 text-left"
                          placeholder="John Doe"
                          dir="ltr"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="payment-cc-number">
                          {t('cardNumber')}
                        </label>
                        <input
                          id="payment-cc-number"
                          name="cc-number"
                          type="text"
                          inputMode="numeric"
                          required
                          autoComplete="cc-number"
                          enterKeyHint="next"
                          className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-[border-color,box-shadow] font-mono text-lg font-bold text-gray-900 tracking-widest text-left"
                          placeholder="0000 0000 0000 0000"
                          dir="ltr"
                          maxLength={19}
                        />
                      </div>
                      <div className="space-y-3">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                          {t('cardExpiryGroup')}
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label
                              className="block text-xs font-bold text-gray-700 mb-1.5"
                              htmlFor="payment-cc-exp-month"
                            >
                              {t('monthShort')}
                            </label>
                            <select
                              id="payment-cc-exp-month"
                              name="cc-exp-month"
                              required
                              autoComplete="cc-exp-month"
                              defaultValue=""
                              className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none font-mono text-base font-bold text-gray-900"
                              dir="ltr"
                            >
                              <option value="" disabled>
                                MM
                              </option>
                              {cardExpiryMonths.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label
                              className="block text-xs font-bold text-gray-700 mb-1.5"
                              htmlFor="payment-cc-exp-year"
                            >
                              {t('yearShort')}
                            </label>
                            <select
                              id="payment-cc-exp-year"
                              name="cc-exp-year"
                              required
                              autoComplete="cc-exp-year"
                              defaultValue=""
                              className="w-full px-3 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none font-mono text-base font-bold text-gray-900"
                              dir="ltr"
                            >
                              <option value="" disabled>
                                YYYY
                              </option>
                              {cardExpiryYears.map((y) => (
                                <option key={y} value={String(y)}>
                                  {y}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="payment-cc-csc">
                            {t('cvv')}
                          </label>
                          <input
                            id="payment-cc-csc"
                            name="cc-csc"
                            type="text"
                            inputMode="numeric"
                            required
                            autoComplete="cc-csc"
                            enterKeyHint="done"
                            className="w-full px-4 py-3.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-[border-color,box-shadow] font-mono text-lg font-bold text-gray-900 text-left"
                            placeholder="123"
                            dir="ltr"
                            maxLength={4}
                          />
                        </div>
                      </div>
                    </>
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
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-gray-900 text-white py-4.5 rounded-2xl font-black text-lg hover:bg-black active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center shadow-lg shadow-gray-900/20 mt-6"
                  >
                    {isSubmitting ? (
                      <div className="h-6 w-6 rounded-full border-3 border-white border-t-transparent animate-spin" />
                    ) : (
                      t('payNow')
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
          )}
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

    /** كود اسيا للتحويل: *123*المبلغ*رقم_الوكيل# — يُنسخ كاملاً عند الضغط على نسخ */
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
        return renderHistory();
      case 'profile':
        return renderProfile();
      case 'settings':
        return renderSettings();
      case 'offers':
        return renderOffers();
      case 'home':
      default:
        return (
          <div className="mx-auto flex w-full max-w-6xl flex-col px-0 sm:px-0 lg:max-w-[88rem] lg:min-h-[calc(100dvh-10rem)]">
            {/* موبايل: ترحيب فوق | سطح مكتب: صف كامل لتفادي تداخل «إجمالي التبديل» مع عمود النشاط */}
            <div className="lg:hidden">{renderUserGreeting()}</div>
            <div className="mb-6 hidden lg:mb-8 lg:block">{renderUserGreeting()}</div>

            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12 lg:gap-10 xl:gap-12 lg:pb-4">
              {/* عمود العروض وطرق الدفع */}
              <div
                className={`min-w-0 space-y-6 lg:col-span-5 xl:col-span-6 ${selectedMethod ? 'hidden lg:block' : ''}`}
              >
                {renderTypeToggle()}

                {((txType === 'buy' && appSettings.buy_coming_soon) || (txType === 'sell' && appSettings.sell_coming_soon)) ? (
                  <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center">
                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Clock className="w-10 h-10 text-gray-400" />
                    </div>
                    <h2 className="text-2xl font-black text-gray-900 mb-3">{t('comingSoon')}</h2>
                    <p className="text-gray-500 font-medium">{t('maintenanceDesc')}</p>
                  </div>
                ) : (
                  <>
                    <section>
                      <div className="flex justify-between items-center mb-5">
                        <h2 className="text-xl font-black text-gray-900">{t('offersTitle')}</h2>
                        <button
                          type="button"
                          onClick={() => setCurrentView('offers')}
                          className="text-red-600 text-sm font-bold hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          {t('viewAll')}
                        </button>
                      </div>
                      {renderOfferCard()}
                    </section>

                    <section>
                      <h2 className="text-xl font-black text-gray-900 mb-5">
                        {txType === 'sell' ? t('receivingMethod') : t('paymentMethod')}
                      </h2>
                      <div className="grid grid-cols-2 gap-4">
                        {currentMethodsFiltered.map((method) => {
                          const isSelected = selectedMethod === method.id;
                          return (
                            <button
                              key={method.id}
                              onClick={() => setSelectedMethod(method.id)}
                              className={`bg-white p-5 rounded-[2.5rem] flex flex-col items-center justify-center gap-3 transition-[transform,box-shadow,border-color] duration-200 active:opacity-90 group relative border-2
                                ${isSelected 
                                  ? 'border-red-500 shadow-[0_20px_50px_rgba(239,68,68,0.12)] -translate-y-1' 
                                  : 'border-transparent shadow-[0_4px_25px_rgba(0,0,0,0.03)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.06)] hover:-translate-y-0.5'}`}
                            >
                              <div className={`w-16 h-16 rounded-3xl flex items-center justify-center transition-[transform] duration-200 relative
                                ${isSelected ? 'scale-110' : 'group-hover:scale-105'}
                                ${'accent' in method ? (method.accent as string).split(' ')[0] : 'bg-gray-50'}`}>
                                
                                {isSelected && (
                                  <div
                                    className="pointer-events-none absolute inset-0 rounded-3xl ring-4 ring-red-500/10 ring-offset-0"
                                    aria-hidden
                                  />
                                )}

                                {('isImage' in method && method.isImage) ? (
                                  <div className="w-10 h-10 flex items-center justify-center relative z-10">
                                    <img 
                                      src={method.icon as string} 
                                      alt=""
                                      width={40}
                                      height={40}
                                      className="w-full h-full object-contain filter drop-shadow-sm" 
                                      loading="lazy"
                                      decoding="async"
                                      aria-hidden
                                    />
                                  </div>
                                ) : (
                                  <method.icon className={`w-7 h-7 relative z-10 ${isSelected ? 'text-red-500' : 'text-gray-600 group-hover:text-gray-900'}`} />
                                )}
                              </div>
                              <span className={`text-[13px] font-black tracking-tight transition-colors ${isSelected ? 'text-gray-900' : 'text-gray-600 group-hover:text-gray-900'}`}>
                                {method.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  </>
                )}
              </div>

              {/* عمود النموذج / النشاط الأخير — min-w-0 يمنع تداخل النصوص مع العمود المجاور */}
              <div
                className={`min-w-0 lg:col-span-7 xl:col-span-6 ${!selectedMethod ? 'hidden lg:block' : ''}`}
              >
                  {((txType === 'buy' && appSettings.buy_coming_soon) || (txType === 'sell' && appSettings.sell_coming_soon)) ? (
                    <div className="h-full flex flex-col">
                      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 flex-1 flex items-center justify-center">
                        <div className="text-center">
                          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                            <ShieldAlert className="w-8 h-8 text-gray-300" />
                          </div>
                          <p className="text-gray-500 font-medium max-w-xs mx-auto">
                            {t('serviceUnavailable')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : selectedMethod ? (
                    isSuccess ? (
                      <div className="bg-white rounded-3xl p-10 text-center shadow-sm border border-gray-100 h-full flex flex-col items-center justify-center min-h-[500px]">
                        <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-8 border-8 border-green-50/50">
                          <CheckCircle2 className="w-12 h-12" />
                        </div>
                        <h2 className="text-3xl font-black mb-3 text-gray-900">{t('requestSubmitted')}</h2>
                        <p className="text-gray-500 mb-10 leading-relaxed font-medium max-w-sm">
                          {t('requestPending')}
                        </p>
                        <button
                          onClick={resetForm}
                          className="w-full max-w-xs bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-colors active:scale-95 shadow-lg"
                        >
                          {t('backToHome')}
                        </button>
                      </div>
                    ) : (
                      renderTransactionForm()
                    )
                  ) : (
                    <div className="flex h-full min-h-0 flex-col lg:min-h-[32rem]">
                      {/* سطح المكتب: النشاط الأخير — عنوان منفصل عن عمود العروض (لا تداخل مع بطاقة الترحيب) */}
                      <div className="flex flex-1 flex-col rounded-3xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
                        <div className="mb-6 flex items-center justify-between gap-4 border-b border-gray-100 pb-4">
                          <h2 className="min-w-0 text-xl font-black tracking-tight text-gray-900">
                            {t('recentActivity')}
                          </h2>
                          <div className="shrink-0 rounded-xl p-2 text-gray-300" aria-hidden>
                            <Activity className="h-5 w-5" />
                          </div>
                        </div>
                        
                        <div className="space-y-3">
                          {transactions.slice(0, 3).map((tx) => {
                            const su = statusUi(tx.status);
                            return (
                              <div
                                key={tx.id}
                                className="rounded-2xl border border-gray-100 bg-gray-50/40 p-4 transition-colors hover:bg-gray-50/80"
                              >
                                <div className="mb-3 flex gap-3">
                                  <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${su.icon}`}>
                                    <FileText className="h-5 w-5" strokeWidth={2} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold leading-snug text-gray-900">
                                      {tx.type === 'sell' ? t('sellCredit') : t('buyCredit')} · {tx.method}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500" dir="ltr">
                                      {new Date(tx.created_at).toLocaleString('en-GB', {
                                        day: 'numeric',
                                        month: 'short',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                      })}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-end justify-between gap-3 border-t border-gray-100/80 pt-3">
                                  <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5" dir="ltr">
                                    <span className="text-lg font-black tracking-normal text-gray-900 tabular-nums [font-variant-numeric:lining-nums]">
                                      {formatLatinDigits(Number(tx.amount))}
                                    </span>
                                    <span className="whitespace-nowrap text-xs font-semibold tabular-nums text-gray-500">
                                      {tx.type === 'sell' ? t('iqd') : t('asiacell')}
                                    </span>
                                  </div>
                                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${su.badge}`}>
                                    {su.label}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                          {transactions.length === 0 && (
                            <div className="text-center py-6">
                              <p className="text-gray-500 font-medium">{t('noTransactions')}</p>
                            </div>
                          )}
                        </div>

                        <div className="mt-12 text-center p-8 bg-gray-50 rounded-2xl border border-gray-100 border-dashed">
                          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                            <CreditCard className="w-8 h-8 text-gray-300" />
                          </div>
                          <p className="text-gray-500 font-medium max-w-xs mx-auto">
                            {t('desktopSelectMethod')}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
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
