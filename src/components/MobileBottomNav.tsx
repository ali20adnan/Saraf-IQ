import React, {memo, useCallback, useMemo} from 'react';
import {LayoutGrid, Clock, User, Gamepad2, Settings, ShieldAlert} from 'lucide-react';
import {motion} from 'motion/react';
import {useLanguage} from '../context/LanguageContext';
import {haptics} from '../lib/haptics';

type ViewType = 'home' | 'login' | 'signup' | 'admin' | 'history' | 'profile' | 'settings' | 'services';

interface MobileBottomNavProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

function MobileBottomNavInner({
  currentView,
  onNavigate,
  isAdmin,
  isAuthenticated: _isAuthenticated,
}: MobileBottomNavProps) {
  const {t, dir} = useLanguage();

  const handleNavigate = useCallback(
    (view: ViewType) => {
      onNavigate(view);
      void haptics.light();
    },
    [onNavigate],
  );

  const navItems: {id: ViewType; icon: typeof LayoutGrid; label: string}[] = useMemo(() => {
    const base: {id: ViewType; icon: typeof LayoutGrid; label: string}[] = [
      {id: 'home', icon: LayoutGrid, label: t('dashboard')},
      {id: 'services', icon: Gamepad2, label: t('bundles')},
      {id: 'history', icon: Clock, label: t('history')},
      {id: 'profile', icon: User, label: t('profile')},
      {id: 'settings', icon: Settings, label: t('settings')},
    ];
    if (!isAdmin) return base;
    return [
      {id: 'home', icon: LayoutGrid, label: t('dashboard')},
      {id: 'admin', icon: ShieldAlert, label: t('adminPanel')},
      {id: 'services', icon: Gamepad2, label: t('bundles')},
      {id: 'history', icon: Clock, label: t('history')},
      {id: 'profile', icon: User, label: t('profile')},
      {id: 'settings', icon: Settings, label: t('settings')},
    ];
  }, [isAdmin, t]);

  return (
    <nav
      className="lg:hidden fixed left-3 right-3 z-50 rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.10)]"
      style={{bottom: 'max(0.75rem, env(safe-area-inset-bottom))', paddingBottom: '0.35rem'}}
      dir={dir}
      aria-label={dir === 'rtl' ? 'التنقل الرئيسي' : 'Main navigation'}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-between gap-0.5 px-1.5 pt-1.5 pb-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => void handleNavigate(item.id)}
              className="relative flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-1 py-1 outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-2"
            >
              {isActive && (
                <motion.span
                  layoutId="mobile-nav-active"
                  className="absolute inset-x-0.5 inset-y-0.5 rounded-2xl bg-white shadow-[0_3px_12px_rgba(15,23,42,0.08)] ring-1 ring-gray-100"
                  transition={{type: 'spring', stiffness: 420, damping: 34}}
                  aria-hidden
                />
              )}
              <motion.span
                className="relative z-[1] flex flex-col items-center justify-center gap-0.5"
                animate={{scale: isActive ? 1 : 0.97}}
                transition={{type: 'spring', stiffness: 400, damping: 28}}
              >
                <Icon
                  className={`h-[22px] w-[22px] shrink-0 transition-colors duration-200 ${
                    isActive ? 'text-gray-900' : 'text-gray-400'
                  }`}
                  strokeWidth={isActive ? 2.5 : 2}
                  aria-hidden
                />
                <span
                  className={`max-w-[4.75rem] truncate text-center text-[9px] font-bold leading-tight transition-colors duration-200 sm:max-w-[5.5rem] sm:text-[10px] ${
                    isActive ? 'text-gray-900' : 'text-gray-500'
                  }`}
                >
                  {item.label}
                </span>
              </motion.span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export const MobileBottomNav = memo(MobileBottomNavInner);
