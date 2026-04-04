import React, { useState, useRef, useEffect, useMemo, useCallback, startTransition } from 'react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { Globe, Wallet, CreditCard, Building2, Zap, Copy, CheckCircle2, UploadCloud, Home, LayoutGrid, Clock, User, ArrowRight, ArrowLeft, Settings, LogOut, Activity, FileText, ArrowDownUp, ShieldAlert, Tag, XCircle, Eye, EyeOff, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Cookies from 'js-cookie';
import { supabase } from './lib/supabase';
import { notificationService } from './lib/notifications';
import { MobileBottomNav } from './components/MobileBottomNav';
import { AppSplash } from './components/AppSplash';
import { BrandLogo } from './components/BrandLogo';
import type { ServerTransaction } from '../types/transaction';

type TransactionType = 'sell' | 'buy';
type ViewType = 'home' | 'login' | 'signup' | 'admin' | 'history' | 'profile' | 'settings' | 'offers';

const CLIENT_ID_KEY = 'saraf_client_id';

type ApiOffer = {
  id: string;
  variant: 'buy' | 'sell';
  title_ar: string;
  title_en: string;
  amount_display: string;
  unit_ar: string;
  unit_en: string;
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
};

type ActiveAgentNumber = {
  phoneNumber: string;
  agentId: string;
  numberId: string;
};

/** نفس النطاق: السيرفر يوجّه أو يخدم الملف — يفضّل /download/apk */
const APK_DOWNLOAD_HREF =
  (import.meta.env.VITE_APK_URL && String(import.meta.env.VITE_APK_URL).trim()) || '/download/apk';

function MainContent() {
  const { t, lang, toggleLanguage, dir } = useLanguage();
  const initialView = window.location.pathname === '/admin' ? 'login' : 'home';
  const [currentView, setCurrentView] = useState<ViewType>(initialView);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [txType, setTxType] = useState<TransactionType>('sell');
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
    sell_coming_soon: false
  });
  const [transactions, setTransactions] = useState<ServerTransaction[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [offersList, setOffersList] = useState<ApiOffer[]>([]);
  const [siteProfile, setSiteProfile] = useState<SiteProfileData | null>(null);
  const [profileDraft, setProfileDraft] = useState<SiteProfileData>({ full_name: '', email: '', phone: '' });
  const [profileSaving, setProfileSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [isInitialSettingsLoading, setIsInitialSettingsLoading] = useState(true);
  const [splashDismissed, setSplashDismissed] = useState(false);
  
  // Agents State
  const [activeAgentNumber, setActiveAgentNumber] = useState<ActiveAgentNumber | null>(null);
  const [adminAgents, setAdminAgents] = useState<Agent[]>([]);
  const [isAdminAgentsLoading, setIsAdminAgentsLoading] = useState(false);
  const [adminTab, setAdminTab] = useState<'overview' | 'agents'>('overview');

  const dashboardStats = useMemo(() => {
    const activeOrders = transactions.filter((tx) => tx.status === 'pending').length;
    const totalCompletedIqd = transactions
      .filter((tx) => tx.status === 'completed')
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    return { activeOrders, totalCompletedIqd };
  }, [transactions]);

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

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data && typeof data === 'object') {
        setAppSettings((prev) => ({
          ...prev,
          maintenance_mode: Boolean(data.maintenance_mode),
          buy_coming_soon: Boolean(data.buy_coming_soon),
          sell_coming_soon: Boolean(data.sell_coming_soon),
        }));
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setIsInitialSettingsLoading(false);
    }
  }, []);

  const fetchActiveNumber = useCallback(async () => {
    try {
      const res = await fetch('/api/active-number');
      if (res.ok) {
        const data = await res.json();
        setActiveAgentNumber(data);
      }
    } catch (e) {
      console.error("fetchActiveNumber:", e);
    }
  }, []);

  const fetchAdminAgents = useCallback(async () => {
    if (!isAdmin) return;
    setIsAdminAgentsLoading(true);
    try {
      const res = await fetch('/api/admin/agents');
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

  const fetchTransactions = useCallback(async () => {
    if (!clientId) return;
    try {
      const res = await fetch(`/api/transactions?client_id=${encodeURIComponent(clientId)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (Array.isArray(data)) setTransactions(data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  }, [clientId]);

  const fetchOffers = useCallback(async () => {
    try {
      const res = await fetch('/api/offers');
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
      const res = await fetch('/api/site-profile');
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
    fetchSettings();
    fetchTransactions();
    fetchOffers();
    fetchSiteProfile();
    fetchActiveNumber();
    if (isAdmin && (currentView === 'admin' || currentView === 'login')) {
      fetchAdminAgents();
    }
    const tmr = window.setInterval(() => {
      fetchTransactions();
      fetchSettings();
      fetchActiveNumber();
    }, 25000);
    return () => window.clearInterval(tmr);
  }, [clientId, isAdmin, currentView, fetchSettings, fetchTransactions, fetchOffers, fetchSiteProfile, fetchActiveNumber, fetchAdminAgents]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (otpState === 'checking' && currentOrderId) {
      interval = setInterval(() => {
        fetchTransactions();
      }, 2500);
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
          // Send notification
          notificationService.notifyTransactionComplete(
            tx.order_ref,
            Number(tx.amount).toLocaleString() + ' ' + (tx.type === 'sell' ? t('iqd') : t('asiacell'))
          );
        } else if (tx.status === 'failed') {
          setOtpState('failed');
          // Send notification
          notificationService.notifyTransactionFailed(tx.order_ref);
        } else if (tx.status === 'retry_otp') {
          setOtpState('input');
          setOtpCode('');
        }
      }
    }
  }, [transactions, otpState, currentOrderId, lang, t]);

  // Monitor transaction status changes for notifications
  useEffect(() => {
    if (transactions.length === 0) return;
    
    // Check for newly completed or failed transactions
    transactions.forEach(tx => {
      const prevTx = prevTransactionsRef.current.find(t => t.id === tx.id);
      if (prevTx && prevTx.status !== tx.status) {
        // Status changed
        if (tx.status === 'completed') {
          notificationService.notifyTransactionComplete(
            tx.order_ref,
            Number(tx.amount).toLocaleString() + ' ' + (tx.type === 'sell' ? t('iqd') : t('asiacell'))
          );
        } else if (tx.status === 'failed') {
          notificationService.notifyTransactionFailed(tx.order_ref);
        }
      }
    });
    
    // Store current transactions for next comparison
    prevTransactionsRef.current = transactions;
  }, [transactions, lang, t]);

  const saveSiteProfile = async () => {
    setProfileSaving(true);
    // Save to cookies for immediate persistence
    Cookies.set('saraf_full_name', profileDraft.full_name, { expires: 365 });
    Cookies.set('saraf_phone', profileDraft.phone, { expires: 365 });

    try {
      const res = await fetch('/api/site-profile', {
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
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (data && typeof data === 'object') {
        setAppSettings({
          maintenance_mode: Boolean(data.maintenance_mode),
          buy_coming_soon: Boolean(data.buy_coming_soon),
          sell_coming_soon: Boolean(data.sell_coming_soon),
        });
      }
    } catch (error) {
      console.error('Error updating setting:', error);
      setAppSettings((prev) => ({ ...prev, [k]: !newValue }));
    }
  };

  const toggleNotifications = async () => {
    const newValue = !notificationsEnabled;
    
    if (newValue) {
      const granted = await notificationService.requestPermission();
      if (granted) {
        setNotificationsEnabled(true);
        notificationService.sendNotification(
          lang === 'ar' ? 'الإشعارات مفعلة!' : 'Notifications Enabled!',
          {
            body: lang === 'ar' 
              ? 'سيتم إرسال تنبيهات مع كل تحديث على طلباتك'
              : 'You will receive alerts for all your order updates',
            icon: '/icons/logo.png',
          }
        );
      }
    } else {
      notificationService.toggle(false);
      setNotificationsEnabled(false);
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
      const method = currentMethods.find(m => m.id === selectedMethod)?.name || 'Unknown';
      let details = '';
      if (txType === 'buy') {
        const form = e.target as HTMLFormElement;
        const cardHolder = (form.elements.namedItem('cardholder') as HTMLInputElement).value;
        const cardNumber = (form.elements.namedItem('cardnumber') as HTMLInputElement).value;
        const expiry = (form.elements.namedItem('expiry') as HTMLInputElement).value;
        const cvv = (form.elements.namedItem('cvv') as HTMLInputElement).value;
        
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
      } else {
        const batches = Math.ceil(sellAmount / 60000);
        details = `📉 بيع رصيد اسيا\n` +
                  `💰 المبلغ: ${sellAmount.toLocaleString()} دينار\n` +
                  `📦 عدد الدفعات (60ك): ${batches}`;
      }

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          user_id: userId,
          type: txType,
          amount: txType === 'buy' ? cardValue * quantity : sellAmount,
          method,
          details,
          agent_number_id: txType === 'sell' ? activeAgentNumber?.numberId : null
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('Create transaction failed:', res.status, errText);
      }
      
      const data = await res.json();
      
      if (txType === 'buy') {
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
      await fetch('/api/transactions/otp', {
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

  /** تنقّل التابات السفلية — يخفّف التقطيع عند استبدال شاشة كبيرة (React 18 concurrent) */
  const navigateView = useCallback((view: ViewType) => {
    startTransition(() => setCurrentView(view));
  }, []);

  const sellMethods = [
    { id: 'zaincash', name: t('zainCash'), icon: '/icons/zaincash.png', isImage: true, accent: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
    { id: 'superqi', name: t('superQi'), icon: '/icons/superqi.png', isImage: true, accent: 'bg-red-50 text-red-600 border-red-100' },
    { id: 'firstbank', name: t('firstBank'), icon: '/icons/firstbank.png', isImage: true, accent: 'bg-blue-50 text-blue-600 border-blue-100' },
    { id: 'fastpay', name: t('fastPay'), icon: '/icons/fastpay.png', isImage: true, accent: 'bg-orange-50 text-orange-600 border-orange-100' },
  ];

  const buyMethods = [
    { id: 'creditcard', name: t('creditCard'), icon: CreditCard, accent: 'bg-purple-50 text-purple-600 border-purple-100' }
  ];

  const currentMethods = txType === 'sell' ? sellMethods : buyMethods;

  // --- Components ---

  const renderLogin = () => (
    <div className="flex-1 p-6 lg:p-8">
      <div className="max-w-md mx-auto mt-10">
        <div className="bg-white p-8 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100">
          {/* Logo and Identity */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-md border border-red-100/50 p-2">
              <BrandLogo alt={t('appTitle')} size="xl" priority />
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
            <a
              href={APK_DOWNLOAD_HREF}
              download
              className="flex items-center justify-center gap-2 text-sm font-bold text-red-600 hover:text-red-700"
            >
              <Download className="w-4 h-4 shrink-0" />
              {t('downloadApk')}
            </a>
          </div>
          
          {window.location.pathname === '/admin' && (
            <div className="mt-6 pt-6 border-t border-gray-100 text-center">
              <p className="text-sm text-gray-500 mb-4">Admin Access</p>
              <form onSubmit={(e) => handleAuth(e, false)} className="space-y-4">
                <input name="email" type="email" required className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl hidden" value="admin@sarafiq.com" readOnly />
                <input name="password" type="password" required className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/20 focus:border-gray-900 outline-none transition-all" placeholder="Admin Password" dir="ltr" />
                <button type="submit" disabled={isAuthLoading} className="w-full bg-gray-900 text-white py-3.5 rounded-xl font-bold hover:bg-gray-800 transition-colors shadow-lg shadow-gray-900/20">
                  {isAuthLoading ? '...' : 'Login as Admin'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderAdminPanel = () => {
    const handleToggleAgent = async (id: string, current: boolean) => {
      try {
        const res = await fetch(`/api/admin/agents/${id}`, {
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
        const res = await fetch(`/api/admin/agents/${id}`, { method: 'DELETE' });
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
        const res = await fetch('/api/admin/agents', {
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
        const res = await fetch('/api/admin/numbers', {
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

    const handleResetNumber = async (id: string) => {
      try {
        await fetch(`/api/admin/numbers/${id}`, {
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
        await fetch(`/api/admin/numbers/${id}`, { method: 'DELETE' });
        fetchAdminAgents();
      } catch (e) {
        console.error(e);
      }
    };

    return (
      <div className="flex-1 p-4 lg:p-8 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <h2 className="text-2xl font-black text-gray-900">Admin Dashboard</h2>
            <div className="flex bg-gray-100 p-1.5 rounded-2xl w-fit">
              <button 
                onClick={() => setAdminTab('overview')}
                className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${adminTab === 'overview' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Overview
              </button>
              <button 
                onClick={() => setAdminTab('agents')}
                className={`px-6 py-2 rounded-xl text-sm font-black transition-all ${adminTab === 'agents' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Agents (الوكلاء)
              </button>
            </div>
          </div>
          
          {adminTab === 'overview' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Settings className="w-5 h-5 text-gray-500" /> System Settings</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">Maintenance Mode</span>
                    <button 
                      onClick={() => toggleSetting('maintenance_mode')}
                      className={`w-12 h-6 rounded-full relative transition-colors ${appSettings.maintenance_mode ? 'bg-red-500' : 'bg-gray-200'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow-sm transition-transform ${appSettings.maintenance_mode ? 'left-6' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">Buy Section (Coming Soon)</span>
                    <button 
                      onClick={() => toggleSetting('buy_coming_soon')}
                      className={`w-12 h-6 rounded-full relative transition-colors ${appSettings.buy_coming_soon ? 'bg-red-500' : 'bg-gray-200'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow-sm transition-transform ${appSettings.buy_coming_soon ? 'left-6' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">Sell Section (Coming Soon)</span>
                    <button 
                      onClick={() => toggleSetting('sell_coming_soon')}
                      className={`w-12 h-6 rounded-full relative transition-colors ${appSettings.sell_coming_soon ? 'bg-red-500' : 'bg-gray-200'}`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 shadow-sm transition-transform ${appSettings.sell_coming_soon ? 'left-6' : 'left-0.5'}`}></div>
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-gray-500" /> CRM Overview</h3>
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
                    <span className="font-black text-gray-900">{dashboardStats.totalCompletedIqd.toLocaleString()} IQD</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Add Agent Form */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4">Add New Agent (وكيل)</h3>
                <form onSubmit={handleAddAgent} className="flex flex-col sm:flex-row gap-3">
                  <input name="agent_name" required placeholder="Agent Name" className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <input name="telegram_id" required placeholder="Telegram ID" className="flex-1 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/10 outline-none transition-all" />
                  <button type="submit" className="bg-gray-900 text-white px-8 py-2.5 rounded-xl font-bold hover:bg-black transition-all">Add Agent</button>
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
                            {agent.is_active ? 'Active' : 'Activate'}
                          </button>
                          <button onClick={() => handleDeleteAgent(agent.id)} className="p-2 text-gray-300 hover:text-red-600 transition-colors">
                            <XCircle className="w-5 h-5" />
                          </button>
                       </div>
                    </div>
                    
                    <div className="p-6 space-y-5">
                      <div className="flex items-center justify-between">
                        <h5 className="text-sm font-black text-gray-800">Phone Numbers (أرقام الجوال)</h5>
                      </div>
                      
                      <div className="space-y-4">
                        {agent.numbers.map((num, idx) => (
                          <div key={num.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                             <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                                <div className="flex items-center gap-3">
                                  <span className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-[10px] font-black text-gray-400">{idx + 1}</span>
                                  <span className="font-mono font-black text-gray-900">{num.phone_number}</span>
                                  {num.is_exhausted && (
                                    <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full text-[10px] font-black uppercase">Exhausted</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                   <button onClick={() => handleResetNumber(num.id)} className="text-[10px] font-black text-red-600 hover:underline">Reset Balance</button>
                                   <button onClick={() => handleDeleteNumber(num.id)} className="p-1.5 text-gray-300 hover:text-red-500 transition-colors"><XCircle className="w-4 h-4" /></button>
                                </div>
                             </div>
                             
                             {/* Progress Bar */}
                             <div className="space-y-2">
                                <div className="flex justify-between text-[10px] font-black">
                                   <span className="text-gray-500 uppercase tracking-tighter">Usage Progress</span>
                                   <span className={num.balance >= 300000 ? 'text-red-600' : 'text-gray-900'}>{num.balance.toLocaleString()} / 300,000 IQD</span>
                                </div>
                                <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden border border-gray-100">
                                   <motion.div 
                                      initial={{ width: 0 }}
                                      animate={{ width: `${Math.min(100, (num.balance / 300000) * 100)}%` }}
                                      className={`h-full ${num.balance >= 300000 ? 'bg-red-500' : 'bg-gray-900'}`}
                                   />
                                </div>
                             </div>
                          </div>
                        ))}
                        
                        {/* Add Number Row */}
                        <form onSubmit={(e) => handleAddNumber(agent.id, e)} className="flex gap-2 pt-4 border-t border-gray-100">
                           <input name="phone" required placeholder="Phone Number (077...)" className="flex-1 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500/10 outline-none" />
                           <input name="order" type="number" defaultValue={agent.numbers.length + 1} className="w-16 px-2 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-center focus:ring-2 focus:ring-red-500/10 outline-none" />
                           <button type="submit" className="bg-gray-100 text-gray-900 px-5 py-2.5 rounded-xl text-xs font-black hover:bg-gray-200 transition-all">+ Add Number</button>
                        </form>
                      </div>
                    </div>
                  </div>
                ))}
                
                {adminAgents.length === 0 && (
                  <div className="py-24 text-center bg-white rounded-3xl border border-dashed border-gray-200">
                    <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                       <User className="w-8 h-8 text-gray-300" />
                    </div>
                    <p className="text-gray-400 font-bold">No agents added yet.</p>
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
    <div className="flex-1 p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-black text-gray-900 mb-8">{t('history')}</h2>
        
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
          <div className="space-y-4">
            {transactions.length > 0 ? transactions.map(tx => (
              <div key={tx.id} className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:bg-gray-50 transition-colors cursor-default">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                    tx.status === 'completed' ? 'bg-green-50 text-green-600' : tx.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'
                  }`}>
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">
                      {tx.type === 'sell' ? t('sellCredit') : t('buyCredit')} - {tx.method}
                    </p>
                    <p className="text-xs text-gray-500 font-medium">{new Date(tx.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-black text-gray-900">{Number(tx.amount).toLocaleString()} <span className="text-xs text-gray-500 font-bold">{tx.type === 'sell' ? t('iqd') : t('asiacell')}</span></p>
                  <p className={`text-xs font-bold mt-0.5 ${
                    tx.status === 'completed' ? 'text-green-600' : tx.status === 'failed' ? 'text-red-600' : 'text-orange-600'
                  }`}>
                    {tx.status === 'completed' ? t('statusCompleted') : tx.status === 'failed' ? t('statusFailed') : t('statusPending')}
                  </p>
                </div>
              </div>
            )) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-500 font-medium">{t('noTransactions')}</p>
              </div>
            )}
          </div>
        </div>
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

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 border-t border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">{t('downloadAndroidApp')}</h3>
                <p className="text-sm text-gray-500">{t('downloadAndroidAppDesc')}</p>
                <p className="text-xs text-gray-400 mt-2 font-mono break-all" dir="ltr">
                  {typeof window !== 'undefined' ? `${window.location.origin}/download/apk` : '/download/apk'}
                </p>
              </div>
              <a
                href={APK_DOWNLOAD_HREF}
                download
                className="inline-flex items-center justify-center gap-2 shrink-0 px-5 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-colors shadow-sm"
              >
                <Download className="w-5 h-5" />
                {t('downloadApk')}
              </a>
            </div>
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
          <BrandLogo alt={t('appTitle')} size="lg" priority />
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
            <span className="relative z-10">Admin Panel</span>
          </button>
        )}
      </nav>

      <div className="mt-auto pt-6 border-t border-gray-100">
        <button onClick={toggleLanguage} className="w-full flex items-center justify-between px-4 py-3 text-gray-600 hover:bg-gray-50 rounded-xl font-semibold transition-colors mb-2">
          <div className="flex items-center gap-3">
            <Globe className="w-5 h-5" />
            {t('language')}
          </div>
          <span className="text-xs bg-gray-100 px-2 py-1 rounded-md font-bold">{lang === 'ar' ? 'EN' : 'AR'}</span>
        </button>
        <button 
          onClick={isAuthenticated ? handleLogout : () => setCurrentView('login')}
          className="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 rounded-xl font-semibold transition-colors"
        >
          <LogOut className="w-5 h-5" />
          {isAuthenticated ? t('logout') : 'Login'}
        </button>
      </div>
    </aside>
  );

  const renderMobileHeader = () => (
    <header className="lg:hidden bg-white sticky top-0 z-30 px-5 py-3 flex justify-between items-center border-b border-gray-100 shadow-sm">
      <button
        type="button"
        onClick={() => setCurrentView('home')}
        className="flex items-center gap-2 min-w-0 rounded-xl py-1 ps-1 pe-2 hover:bg-gray-50 transition-colors -ms-1"
        aria-label={`${t('appTitle')} — ${t('home')}`}
      >
        <div className="w-14 h-14 shrink-0 flex items-center justify-center">
          <BrandLogo alt={t('appTitle')} size="md" priority />
        </div>
        <h1 className="text-base font-black tracking-tight text-gray-900 truncate">{t('appTitle')}</h1>
      </button>
      <button onClick={toggleLanguage} className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 bg-gray-50 px-3 py-1.5 rounded-full transition-colors">
        <Globe className="w-4 h-4" />
        <span className="text-xs font-bold">{lang === 'ar' ? 'EN' : 'عربي'}</span>
      </button>
    </header>
  );

  const renderUserGreeting = () => (
    <div className="bg-white/80 p-6 sm:p-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white backdrop-blur-xl mb-6 flex items-center justify-between">
      <div className="flex items-center gap-5">
        <div className="w-14 h-14 bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-gray-900/20 ring-1 ring-white/10 inset-0">
          <User className="w-6 h-6 text-white/90" />
        </div>
        <div>
          <p className="text-sm text-gray-500 font-medium mb-0.5">{t('greeting')}</p>
          <h2 className="text-xl font-black text-gray-900 tracking-tight">{siteProfile?.full_name?.trim() || t('userName')}</h2>
        </div>
      </div>
      <div className={`hidden sm:flex gap-8 ${dir === 'rtl' ? 'text-left' : 'text-right'}`}>
        <div>
          <p className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-wider">{t('activeOrders')}</p>
          <p className="text-2xl font-black text-gray-900">{dashboardStats.activeOrders}</p>
        </div>
        <div className="w-px bg-gradient-to-b from-gray-100 via-gray-200 to-gray-100" aria-hidden />
        <div>
          <p className="text-xs text-gray-400 font-bold mb-1 uppercase tracking-wider">{t('totalExchanged')}</p>
          <p className="text-2xl font-black text-gray-900 tabular-nums flex items-baseline gap-1" dir="ltr">
            {Number.isFinite(dashboardStats.totalCompletedIqd) && dashboardStats.totalCompletedIqd > 0
              ? dashboardStats.totalCompletedIqd.toLocaleString(lang === 'ar' ? 'ar-IQ' : 'en-US')
              : '0'}
            <span className="text-sm text-gray-400 font-bold ml-1">{t('iqd')}</span>
          </p>
        </div>
      </div>
    </div>
  );

  const renderTypeToggle = () => (
    <div className="flex bg-gray-200/50 p-1.5 rounded-2xl mb-8 relative shadow-inner">
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
    <motion.div 
      key={txType}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={`rounded-[2rem] shadow-2xl overflow-hidden relative mb-8 group ${txType === 'sell' ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900' : 'bg-gradient-to-br from-red-600 via-red-700 to-rose-900'}`}
    >
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-20 -mt-20 transition-transform group-hover:scale-110 duration-700"></div>
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10 mix-blend-overlay pointer-events-none"></div>
      
      <div className="p-8 relative z-10">
        <div className="flex justify-between items-start mb-10">
          <div className="inline-flex items-center gap-1.5 bg-white/10 text-white border border-white/20 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-md shadow-sm">
            <Zap className="w-3.5 h-3.5 fill-current" />
            {t('recommended')}
          </div>
          <span className="text-xs font-bold text-white/80 bg-black/20 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
            {t('days')}
          </span>
        </div>
        
        <h3 className="font-medium text-white/60 mb-1 text-sm tracking-wide uppercase">
          {txType === 'sell' ? t('offerTitle') : t('buyOfferTitle')}
        </h3>
        <div className="flex items-baseline gap-2">
          <span className="text-5xl font-black tracking-tighter text-white drop-shadow-md">
            {txType === 'sell' ? '95,000' : '100,000'}
          </span>
          <span className="text-lg text-white/80 font-bold ml-1">
            {txType === 'sell' ? t('iqd') : 'Asiacell'}
          </span>
        </div>
      </div>
      <div className={`py-4 px-8 text-sm font-bold flex items-center justify-between border-t border-white/10 ${txType === 'sell' ? 'bg-red-600/90 text-white backdrop-blur-md' : 'bg-gray-900/90 text-white backdrop-blur-md'}`}>
        <span className="flex items-center gap-2 uppercase tracking-wider">
          <CheckCircle2 className="w-4 h-4" /> {t('limitedOffer')}
        </span>
        <ArrowRight className={`w-4 h-4 transition-transform group-hover:translate-x-1 ${dir === 'rtl' ? 'rotate-180 group-hover:-translate-x-1' : ''}`} />
      </div>
    </motion.div>
  );

  const renderOffers = () => {
    const fallback: { id: string; variant: TransactionType; title: string; amount: string; unit: string }[] = [
      { id: '1', variant: 'sell', title: t('offerTitle'), amount: '95,000', unit: t('iqd') },
      { id: '2', variant: 'buy', title: t('buyOfferTitle'), amount: '100,000', unit: t('asiacell') },
      { id: '3', variant: 'sell', title: t('offerSell50'), amount: '47,500', unit: t('iqd') },
      { id: '4', variant: 'buy', title: t('offerBuy25'), amount: '25,000', unit: t('asiacell') },
    ];

    const list =
      offersList.length > 0
        ? offersList.map((o) => ({
            id: o.id,
            variant: o.variant,
            title: lang === 'ar' ? o.title_ar : o.title_en,
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {list.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
              className={`rounded-3xl shadow-xl overflow-hidden relative flex flex-col ${item.variant === 'sell' ? 'bg-gradient-to-br from-gray-900 to-gray-800' : 'bg-gradient-to-br from-red-700 to-red-900'}`}
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full blur-3xl -mr-20 -mt-20" />
              <div className="p-6 sm:p-8 relative z-10 flex-1">
                <div className="flex justify-between items-start mb-6">
                  <div className="inline-flex items-center gap-1.5 bg-white/10 text-white border border-white/20 px-3 py-1.5 rounded-full text-xs font-bold backdrop-blur-sm">
                    <Zap className="w-3.5 h-3.5 fill-current" />
                    {t('recommended')}
                  </div>
                  <span className="text-xs font-bold text-white/80 bg-black/20 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-sm">
                    {t('days')}
                  </span>
                </div>
                <h3 className="font-medium text-white/90 mb-2 text-sm leading-relaxed">{item.title}</h3>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-4xl sm:text-5xl font-black tracking-tight text-white">{item.amount}</span>
                  <span className="text-base text-white/80 font-bold">{item.unit}</span>
                </div>
              </div>
              <div className={`py-3.5 px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${item.variant === 'sell' ? 'bg-red-600' : 'bg-gray-900'}`}>
                <span className="text-xs font-bold text-white/90 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" /> {t('limitedOffer')}
                </span>
                <button
                  type="button"
                  onClick={() => goExchange(item.variant)}
                  className="w-full sm:w-auto text-center bg-white/15 hover:bg-white/25 text-white text-sm font-black py-2.5 px-5 rounded-xl border border-white/20 transition-colors"
                >
                  {t('subscribe')}
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  };

  const renderTransactionForm = () => {
    const selectedMethodName = currentMethods.find(m => m.id === selectedMethod)?.name;

    if (txType === 'buy') {
      const cardValues = [2000, 5000, 10000, 15000, 25000, 50000, 100000];
      const pricePerCard = cardValue * 0.98; // 2% discount for buying
      const totalPrice = pricePerCard * quantity;

      return (
        <motion.div
          key="form-buy"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
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
                            <option key={val} value={val}>{val.toLocaleString()} {t('iqd')}</option>
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
                        type="text" 
                        required
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all font-mono text-lg font-bold text-gray-900 text-left"
                        placeholder="07..."
                        dir="ltr"
                      />
                    </div>
                    <div className="flex justify-between items-center text-sm p-3.5 rounded-xl border bg-gray-100 border-gray-200">
                      <span className="font-semibold text-gray-800">{t('totalPrice')}</span>
                      <span className="font-black text-lg text-gray-900" dir="ltr">{totalPrice.toLocaleString()} {t('iqd')}</span>
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
                <form onSubmit={handleSubmit} className="space-y-4" autoComplete="on">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2" htmlFor="payment-cc-name">
                      {t('cardHolderName')}
                    </label>
                    <input 
                      id="payment-cc-name"
                      name="cardholder"
                      type="text" 
                      required
                      autoComplete="cc-name"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all font-medium text-gray-900 text-left"
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
                      name="cardnumber"
                      type="text" 
                      inputMode="numeric"
                      required
                      autoComplete="cc-number"
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all font-mono text-lg font-bold text-gray-900 tracking-widest text-left"
                      placeholder="0000 0000 0000 0000"
                      dir="ltr"
                      maxLength={19}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label
                        className="block text-xs sm:text-sm font-bold text-gray-700 mb-1 sm:mb-2 truncate"
                        htmlFor="payment-cc-exp"
                      >
                        {t('expiryDate', 'تاريخ الانتهاء (MM/YY)').replace('(MM/YY)', '').trim()}
                      </label>
                      <input 
                        id="payment-cc-exp"
                        name="expiry"
                        type="text" 
                        required
                        autoComplete="cc-exp"
                        className="w-full px-3 sm:px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all font-mono text-base sm:text-lg font-bold text-gray-900 text-left"
                        placeholder="MM/YY"
                        dir="ltr"
                        maxLength={5}
                      />
                    </div>
                    <div>
                      <label className="block text-xs sm:text-sm font-bold text-gray-700 mb-1 sm:mb-2" htmlFor="payment-cc-csc">
                        {t('cvv')}
                      </label>
                      <input 
                        id="payment-cc-csc"
                        name="cvv"
                        type="text" 
                        inputMode="numeric"
                        required
                        autoComplete="cc-csc"
                        className="w-full px-3 sm:px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-gray-900/10 focus:border-gray-900 outline-none transition-all font-mono text-base sm:text-lg font-bold text-gray-900 text-left"
                        placeholder="123"
                        dir="ltr"
                        maxLength={4}
                      />
                    </div>
                  </div>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-gray-900 text-white py-4.5 rounded-2xl font-black text-lg hover:bg-black active:scale-[0.98] transition-all disabled:opacity-70 flex justify-center items-center shadow-lg shadow-gray-900/20 mt-6"
                  >
                    {isSubmitting ? (
                      <motion.div 
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        className="w-6 h-6 border-3 border-white border-t-transparent rounded-full"
                      />
                    ) : (
                      t('payNow')
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
          )}
        </motion.div>
      );
    }

    // Sell Form (Existing)
    const step1Title = activeAgentNumber ? t('paymentStep1') : t('sellComingSoon');
    const step1Label = activeAgentNumber ? t('asiaNumberText') : "لا يوجد وكيل نشط حالياً";
    const step1Number = activeAgentNumber?.phoneNumber || "—";
    const step1Amount = t('amountToTransfer');
    const step2Label = t('receivingNumber');



    return (
      <motion.div
        key="form-sell"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
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
                        onClick={() => handleCopy(step1Number)}
                        className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-200 transition-all active:scale-90"
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
                          value={sellAmount === 0 ? '' : sellAmount.toLocaleString()}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/\D/g, '');
                            const num = parseInt(raw, 10) || 0;
                            setSellAmount(num);
                          }}
                          className={`w-full pl-5 pr-16 py-4 bg-white border rounded-2xl focus:ring-4 outline-none transition-all font-mono text-xl font-black text-gray-900 
                            ${(sellAmount > 0 && (sellAmount < 5000 || sellAmount > 300000)) ? 'border-red-300 focus:ring-red-500/10 focus:border-red-500' : 'border-gray-200 focus:ring-red-500/10 focus:border-red-500'}`}
                          placeholder="0,000"
                          dir="ltr"
                        />
                        <div className="absolute inset-y-0 right-5 flex items-center pointer-events-none text-gray-400 font-bold">
                          {t('iqd')}
                        </div>
                      </div>
                      <div className="flex justify-between mt-2 px-1">
                        <span className={`text-[10px] font-bold uppercase tracking-tighter ${(sellAmount > 0 && (sellAmount < 5000 || sellAmount > 300000)) ? 'text-red-500 animate-pulse' : 'text-gray-400'}`}>
                          {sellAmount > 300000 ? t('maxSellLimit') : t('minSellLimit')}
                        </span>
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{t('maxBatchInfo')}</span>
                      </div>
                    </div>

                    {sellAmount > 60000 && (
                      <div className="p-3.5 rounded-xl border bg-orange-50 border-orange-100 flex items-center gap-3">
                        <ShieldAlert className="w-5 h-5 text-orange-500 shrink-0" />
                        <p className="text-xs font-bold text-orange-700 leading-relaxed">
                          {t('batchesCount').replace('{n}', Math.ceil(sellAmount / 60000).toString())}
                        </p>
                      </div>
                    )}

                    <div className={`flex justify-between items-center text-sm p-4 rounded-xl border transition-all 
                      ${(sellAmount > 0 && (sellAmount < 5000 || sellAmount > 300000)) ? 'bg-red-50 border-red-200 text-red-600' : 'bg-red-50 border-red-100'}`}>
                      <span className="font-bold">{t('youPay')}</span>
                      <div className="text-right">
                        <span className="font-black text-xl" dir="ltr">{sellAmount.toLocaleString()} {t('iqd')}</span>
                        {(sellAmount > 0 && (sellAmount < 5000 || sellAmount > 300000)) && (
                          <p className="text-[10px] font-black mt-1 uppercase tracking-wider">{sellAmount > 300000 ? t('maxSellLimit') : t('minSellLimit')}</p>
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
                  disabled={isSubmitting || sellAmount < 5000 || sellAmount > 300000}
                  className="w-full text-white py-4.5 rounded-2xl font-black text-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:grayscale flex justify-center items-center shadow-lg mt-6 bg-red-600 hover:bg-red-700 shadow-red-600/20"
                >
                  {isSubmitting ? (
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                      className="w-6 h-6 border-3 border-white border-t-transparent rounded-full"
                    />
                  ) : (
                    t('submit')
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </motion.div>
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
              <div className="w-24 h-24 bg-white rounded-3xl flex items-center justify-center shadow-md border border-red-100/50 overflow-hidden p-2">
                <BrandLogo alt={t('appTitle')} size="xl" priority />
              </div>
              <div>
                <h1 className="font-black text-xl tracking-tight text-gray-900">{t('appTitle')}</h1>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-none mt-1">Official Portal</p>
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
                href="https://t.me/sarafiq_support" 
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
          <div className="max-w-6xl mx-auto">
            
            <div className="lg:hidden">
              {renderUserGreeting()}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Column: Offers & Methods */}
              <div className={`lg:col-span-5 xl:col-span-6 space-y-6 ${selectedMethod && 'hidden lg:block'}`}>
                <div className="hidden lg:block">
                  {renderUserGreeting()}
                </div>

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
                        {currentMethods.map((method) => {
                          const isSelected = selectedMethod === method.id;
                          return (
                            <button
                              key={method.id}
                              onClick={() => setSelectedMethod(method.id)}
                              className={`bg-white p-5 rounded-[2.5rem] flex flex-col items-center justify-center gap-3 transition-all active:scale-[0.96] group relative border-2
                                ${isSelected 
                                  ? 'border-red-500 shadow-[0_20px_50px_rgba(239,68,68,0.12)] -translate-y-1' 
                                  : 'border-transparent shadow-[0_4px_25px_rgba(0,0,0,0.03)] hover:shadow-[0_15px_40px_rgba(0,0,0,0.06)] hover:-translate-y-0.5'}`}
                            >
                              <div className={`w-16 h-16 rounded-3xl flex items-center justify-center transition-all duration-300 relative
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
                                      alt={method.name} 
                                      className="w-full h-full object-contain filter drop-shadow-sm" 
                                      loading="eager" 
                                    />
                                  </div>
                                ) : (
                                  <method.icon className={`w-7 h-7 relative z-10 ${isSelected ? 'text-red-500' : 'text-gray-400 group-hover:text-gray-900'}`} />
                                )}
                              </div>
                              <span className={`text-[13px] font-black tracking-tight transition-colors ${isSelected ? 'text-gray-900' : 'text-gray-400 group-hover:text-gray-900'}`}>
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

              {/* Right Column: Form or Placeholder/History */}
              <div className={`lg:col-span-7 xl:col-span-6 ${!selectedMethod && 'hidden lg:block'}`}>
                <AnimatePresence mode="wait">
                  {((txType === 'buy' && appSettings.buy_coming_soon) || (txType === 'sell' && appSettings.sell_coming_soon)) ? (
                    <motion.div 
                      key="coming-soon-placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-full flex flex-col"
                    >
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
                    </motion.div>
                  ) : selectedMethod ? (
                    isSuccess ? (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-white rounded-3xl p-10 text-center shadow-sm border border-gray-100 h-full flex flex-col items-center justify-center min-h-[500px]"
                      >
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
                      </motion.div>
                    ) : (
                      renderTransactionForm()
                    )
                  ) : (
                    <motion.div 
                      key="placeholder"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-full flex flex-col"
                    >
                      {/* Desktop Empty State / Recent Activity */}
                      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 flex-1">
                        <div className="flex items-center justify-between mb-8">
                          <h2 className="text-xl font-black text-gray-900">{t('recentActivity')}</h2>
                          <button className="p-2 hover:bg-gray-50 rounded-lg transition-colors text-gray-400">
                            <Activity className="w-5 h-5" />
                          </button>
                        </div>
                        
                        <div className="space-y-4">
                          {transactions.slice(0, 3).map(tx => (
                            <div key={tx.id} className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:bg-gray-50 transition-colors cursor-default">
                              <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                                  tx.status === 'completed' ? 'bg-green-50 text-green-600' : tx.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'
                                }`}>
                                  <FileText className="w-6 h-6" />
                                </div>
                                <div>
                                  <p className="font-bold text-gray-900">
                                    {tx.type === 'sell' ? t('sellCredit') : t('buyCredit')} - {tx.method}
                                  </p>
                                  <p className="text-xs text-gray-500 font-medium">{new Date(tx.created_at).toLocaleDateString()}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="font-black text-gray-900">{Number(tx.amount).toLocaleString()} <span className="text-xs text-gray-500 font-bold">{tx.type === 'sell' ? t('iqd') : t('asiacell')}</span></p>
                                <p className={`text-xs font-bold mt-0.5 ${
                                  tx.status === 'completed' ? 'text-green-600' : tx.status === 'failed' ? 'text-red-600' : 'text-orange-600'
                                }`}>
                                  {tx.status === 'completed' ? t('statusCompleted') : tx.status === 'failed' ? t('statusFailed') : t('statusPending')}
                                </p>
                              </div>
                            </div>
                          ))}
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
                    </motion.div>
                  )}
                </AnimatePresence>
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans" dir={dir}>
        {renderMainContent()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 flex" dir={dir}>
      {currentView !== 'login' && currentView !== 'signup' && renderSidebar()}

      <div className="flex-1 flex flex-col min-w-0">
        {currentView !== 'login' && currentView !== 'signup' && renderMobileHeader()}

        <main
          className={`isolate flex-1 overflow-y-auto overscroll-y-contain ${currentView !== 'login' && currentView !== 'signup' ? 'pb-[calc(9rem+env(safe-area-inset-bottom,0px))] lg:pb-8 p-3 sm:p-6 lg:p-8' : ''}`}
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
