import {CheckCircle2, Clock, Zap} from 'lucide-react';
import {useLanguage} from '../context/LanguageContext';
import type {AppService} from '../lib/services';

type ServiceCardProps = {
  service: AppService;
  variant?: 'compact' | 'full';
  onAction?: () => void;
};

export function ServiceCard({service, variant = 'full', onAction}: ServiceCardProps) {
  const {lang, t} = useLanguage();
  const title = lang === 'ar' ? service.titleAr : service.titleEn;
  const description = lang === 'ar' ? service.descriptionAr : service.descriptionEn;
  const badge = lang === 'ar' ? service.badgeAr : service.badgeEn;
  const isCompact = variant === 'compact';

  if (isCompact) {
    return (
      <article className="group flex max-w-md flex-col overflow-hidden rounded-3xl border border-gray-200/80 bg-white shadow-sm">
        <div className="relative aspect-[16/10] overflow-hidden bg-gray-100">
          <img
            src={service.coverImage}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
        <div className="p-4">
          <h3 className="font-black text-gray-900">{title}</h3>
          <p className="mt-2 line-clamp-2 text-xs font-medium text-gray-500">{description}</p>
        </div>
      </article>
    );
  }

  return (
    <article
      role={service.comingSoon ? undefined : 'button'}
      tabIndex={service.comingSoon ? -1 : 0}
      onClick={service.comingSoon ? undefined : onAction}
      onKeyDown={(event) => {
        if (service.comingSoon || !onAction) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onAction();
        }
      }}
      className={`group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[1.35rem] border border-gray-200/90 bg-white shadow-[0_4px_24px_rgba(15,23,42,0.06)] transition-[box-shadow,transform] duration-200 hover:shadow-[0_12px_32px_rgba(15,23,42,0.08)] sm:rounded-[1.75rem] ${
        service.comingSoon ? '' : 'cursor-pointer'
      }`}
    >
      <div className="relative aspect-[5/4] shrink-0 overflow-hidden bg-slate-100 sm:aspect-[4/3]">
        <img
          src={service.coverImage}
          alt=""
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          loading="lazy"
          decoding="async"
        />
        {badge && (
          <div className="absolute top-3 start-3 inline-flex items-center gap-1 rounded-full border border-white/30 bg-black/45 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">
            <Zap className="h-3 w-3 shrink-0 fill-current" />
            {badge}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-4 md:p-5">
        <h3 className="text-sm font-black leading-snug text-gray-900 sm:text-base">{title}</h3>
        <p className="mt-2 line-clamp-3 text-xs font-medium leading-relaxed text-gray-500 sm:min-h-[3.25rem] sm:text-[13px]">
          {description}
        </p>

        <div className="mt-3 flex flex-col gap-2.5 border-t border-gray-100 pt-3 sm:mt-4 sm:gap-3">
          <span className="flex items-center gap-2 text-xs font-bold text-gray-500">
            {service.comingSoon ? (
              <>
                <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                {t('comingSoon')}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                {t('serviceInstant')}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAction?.();
            }}
            disabled={service.comingSoon}
            className={`w-full rounded-xl py-2.5 text-sm font-black transition-colors sm:py-3 ${
              service.comingSoon
                ? 'cursor-not-allowed bg-gray-100 text-gray-400'
                : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.98]'
            }`}
          >
            {service.comingSoon ? t('comingSoon') : t('serviceOrderNow')}
          </button>
        </div>
      </div>
    </article>
  );
}
