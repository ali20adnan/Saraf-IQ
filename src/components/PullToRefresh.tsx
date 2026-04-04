import React, { useState, useRef, useCallback } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  className = '',
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);
  const isDragging = useRef(false);

  const y = useMotionValue(0);
  const rotate = useTransform(y, [0, 100], [0, 360]);
  const opacity = useTransform(y, [0, 60], [0, 1]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only enable pull when at top of scroll
    if (window.scrollY === 0) {
      startY.current = e.touches[0].clientY;
      isDragging.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging.current) return;

    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;

    if (diff > 0 && window.scrollY === 0) {
      // Pulling down
      const resistance = 0.5;
      const pullDistance = diff * resistance;
      
      if (pullDistance > 0) {
        y.set(pullDistance);
        setPullProgress(Math.min(pullDistance / 80, 1));
        
        // Prevent default to stop scroll
        if (pullDistance > 10) {
          e.preventDefault();
        }
      }
    }
  }, [y]);

  const handleTouchEnd = useCallback(async () => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const diff = currentY.current - startY.current;
    
    if (diff > 80 && !isRefreshing) {
      // Trigger refresh
      setIsRefreshing(true);
      animate(y, 60, { type: 'spring', stiffness: 300, damping: 30 });
      
      try {
        await onRefresh();
      } catch (error) {
        console.error('Refresh failed:', error);
      } finally {
        setIsRefreshing(false);
        setPullProgress(0);
        animate(y, 0, { type: 'spring', stiffness: 500, damping: 30 });
      }
    } else {
      // Snap back
      setPullProgress(0);
      animate(y, 0, { type: 'spring', stiffness: 500, damping: 30 });
    }
  }, [isRefreshing, onRefresh, y]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      <motion.div
        style={{ y, opacity }}
        className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center h-16 pointer-events-none"
      >
        <motion.div
          style={{ rotate: isRefreshing ? rotate : 0 }}
          className="flex flex-col items-center gap-1"
        >
          <RefreshCw 
            className={`w-6 h-6 ${pullProgress >= 1 ? 'text-red-600' : 'text-gray-400'}`}
            style={{
              transform: `rotate(${pullProgress * 180}deg)`,
            }}
          />
          <span className="text-xs font-bold text-gray-400">
            {isRefreshing ? 'جاري التحديث...' : pullProgress >= 1 ? 'اترك للتحديث' : 'اسحب للتحديث'}
          </span>
        </motion.div>
      </motion.div>

      {/* Content */}
      <motion.div
        style={{ y }}
        className="min-h-screen"
      >
        {children}
      </motion.div>
    </div>
  );
};
