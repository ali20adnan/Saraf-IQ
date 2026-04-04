import React, { useState, useEffect } from 'react';
import { Home, Clock, User, Tag, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguage } from '../context/LanguageContext';
import { haptics } from '../lib/haptics';

type ViewType = 'home' | 'login' | 'signup' | 'admin' | 'history' | 'profile' | 'settings' | 'offers';

interface MobileBottomNavProps {
  currentView: ViewType;
  onNavigate: (view: ViewType) => void;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  currentView,
  onNavigate,
  isAdmin,
  isAuthenticated,
}) => {
  const { t } = useLanguage();
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  // Hide/show on scroll
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const handleNavigate = async (view: ViewType) => {
    await haptics.light();
    onNavigate(view);
  };

  const navItems: { id: ViewType; icon: typeof Home; label: string }[] = [
    { id: 'home', icon: Home, label: t('dashboard') },
    { id: 'offers', icon: Tag, label: t('bundles') },
    { id: 'history', icon: Clock, label: t('history') },
    { id: 'profile', icon: User, label: t('profile') },
    ...(isAdmin ? [{ id: 'settings' as ViewType, icon: Settings, label: t('settings') }] : []),
  ];

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.nav
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          exit={{ y: 100 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-xl border-t border-gray-200/80 safe-area-bottom"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center justify-around px-2 py-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={`relative flex flex-col items-center justify-center min-w-[64px] min-h-[48px] px-3 py-2 rounded-2xl transition-all duration-200 active:scale-95 ${
                    isActive
                      ? 'text-red-600 bg-red-50'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-6 h-6" strokeWidth={isActive ? 2.5 : 2} />
                    {isActive && (
                      <motion.div
                        layoutId="activeTab"
                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-red-600 rounded-full"
                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      />
                    )}
                  </div>
                  <span className="text-[10px] font-bold mt-1 leading-none">{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Home Indicator Area */}
          <div className="h-1 w-32 mx-auto bg-gray-300/50 rounded-full mt-1 mb-1" />
        </motion.nav>
      )}
    </AnimatePresence>
  );
};
