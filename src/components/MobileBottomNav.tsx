import React, { memo, useCallback } from 'react';
import { Home, Clock, User, Tag, Settings } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { haptics } from '../lib/haptics';

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
  isAdmin,
  isAuthenticated: _isAuthenticated,
}: MobileBottomNavProps) {
  const { t } = useLanguage();

  const handleNavigate = useCallback(
    async (view: ViewType) => {
      await haptics.light();
      onNavigate(view);
    },
    [onNavigate],
  );

  const navItems: { id: ViewType; icon: typeof Home; label: string }[] = [
    { id: 'home', icon: Home, label: t('dashboard') },
    { id: 'offers', icon: Tag, label: t('bundles') },
    { id: 'history', icon: Clock, label: t('history') },
    { id: 'profile', icon: User, label: t('profile') },
    ...(isAdmin ? [{ id: 'settings' as ViewType, icon: Settings, label: t('settings') }] : []),
  ];

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center justify-around px-1 py-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => void handleNavigate(item.id)}
              className={`relative flex min-h-[44px] min-w-[56px] flex-col items-center justify-center rounded-xl px-2 py-1 transition-colors active:opacity-80 ${
                isActive ? 'text-red-600' : 'text-gray-400'
              }`}
            >
              {isActive && (
                <span className="absolute inset-x-1 top-1 bottom-6 rounded-lg bg-red-50" aria-hidden />
              )}
              <Icon className="relative z-[1] h-6 w-6" strokeWidth={isActive ? 2.5 : 2} />
              <span className="relative z-[1] mt-0.5 max-w-[4.5rem] truncate text-[10px] font-bold leading-tight">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export const MobileBottomNav = memo(MobileBottomNavInner);
