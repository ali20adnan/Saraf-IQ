import React, {useMemo} from 'react';
import {useLanguage} from '../context/LanguageContext';

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 font-medium text-gray-900 outline-none transition-[border-color,box-shadow] focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10';

const selectClass =
  'w-full appearance-none rounded-xl border border-gray-200 bg-white px-4 py-3.5 font-mono text-base font-bold text-gray-900 outline-none transition-[border-color,box-shadow] focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10';

type CreditCardPaymentFieldsProps = {
  idPrefix?: string;
  className?: string;
};

export function CreditCardPaymentFields({idPrefix = 'cc', className = ''}: CreditCardPaymentFieldsProps) {
  const {t, dir} = useLanguage();

  const cardExpiryMonths = useMemo(
    () => Array.from({length: 12}, (_, i) => String(i + 1).padStart(2, '0')),
    [],
  );
  const cardExpiryYears = useMemo(() => {
    const start = new Date().getFullYear();
    return Array.from({length: 16}, (_, i) => start + i);
  }, []);

  const nameId = `${idPrefix}-name`;
  const numberId = `${idPrefix}-number`;
  const monthId = `${idPrefix}-exp-month`;
  const yearId = `${idPrefix}-exp-year`;
  const cscId = `${idPrefix}-csc`;

  return (
    <div className={`space-y-4 ${className}`.trim()} dir={dir}>
      <div>
        <label className="mb-2 block text-sm font-bold text-gray-700" htmlFor={nameId}>
          {t('cardHolderName')}
        </label>
        <input
          id={nameId}
          name="cc-name"
          type="text"
          required
          autoComplete="cc-name"
          enterKeyHint="next"
          dir="ltr"
          className={`${inputClass} text-left`}
          placeholder="John Doe"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-bold text-gray-700" htmlFor={numberId}>
          {t('cardNumber')}
        </label>
        <input
          id={numberId}
          name="cc-number"
          type="text"
          inputMode="numeric"
          required
          autoComplete="cc-number"
          enterKeyHint="next"
          dir="ltr"
          maxLength={19}
          className={`${inputClass} text-left font-mono text-lg font-bold tracking-widest`}
          placeholder="0000 0000 0000 0000"
        />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-bold text-gray-700">{t('cardExpiryGroup')}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-gray-700" htmlFor={monthId}>
              {t('monthShort')}
            </label>
            <select
              id={monthId}
              name="cc-exp-month"
              required
              autoComplete="cc-exp-month"
              defaultValue=""
              dir="ltr"
              className={selectClass}
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
            <label className="mb-1.5 block text-xs font-bold text-gray-700" htmlFor={yearId}>
              {t('yearShort')}
            </label>
            <select
              id={yearId}
              name="cc-exp-year"
              required
              autoComplete="cc-exp-year"
              defaultValue=""
              dir="ltr"
              className={selectClass}
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
      </div>

      <div>
        <label className="mb-2 block text-sm font-bold text-gray-700" htmlFor={cscId}>
          {t('cvv')}
        </label>
        <input
          id={cscId}
          name="cc-csc"
          type="text"
          inputMode="numeric"
          required
          autoComplete="cc-csc"
          enterKeyHint="done"
          dir="ltr"
          maxLength={4}
          className={`${inputClass} text-left font-mono text-lg font-bold`}
          placeholder="123"
        />
      </div>
    </div>
  );
}
