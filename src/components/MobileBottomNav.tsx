import React, {memo, useCallback} from 'react';
import {LayoutGrid, Clock, User, Tag, Settings} from 'lucide-react';
import {motion} from 'motion/react';
import {useLanguage} from '../context/LanguageContext';
import {haptics} from '../lib/haptics';

type ViewType = 'home' | 'login' | 'signup' | 'admin' | 'history' | 'profile' | 'settings' | 'offers';

interface MobileBottomNavProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

function MobileBottomNavInner({
  currentView,
  onNavigate,
  isAdmin: _isAdmin,
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

  const navItems: {id: ViewType; icon: typeof LayoutGrid; label: string}[] = [
    {id: 'home', icon: LayoutGrid, label: t('dashboard')},
    {id: 'offers', icon: Tag, label: t('bundles')},
    {id: 'history', icon: Clock, label: t('history')},
    {id: 'profile', icon: User, label: t('profile')},
    {id: 'settings', icon: Settings, label: t('settings')},
  ];

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200/80 bg-white/90 shadow-[0_-8px_32px_rgba(15,23,42,0.07)] backdrop-blur-xl backdrop-saturate-150"
      style={{paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom))'}}
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
                  className="absolute inset-x-0.5 inset-y-0.5 rounded-2xl bg-gradient-to-b from-red-50 to-red-50/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] ring-1 ring-red-100/80"
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
                    isActive ? 'text-red-600' : 'text-gray-400'
                  }`}
                  strokeWidth={isActive ? 2.5 : 2}
                  aria-hidden
                />
                <span
                  className={`max-w-[4.75rem] truncate text-center text-[9px] font-bold leading-tight transition-colors duration-200 sm:max-w-[5.5rem] sm:text-[10px] ${
                    isActive ? 'text-red-700' : 'text-gray-500'
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
