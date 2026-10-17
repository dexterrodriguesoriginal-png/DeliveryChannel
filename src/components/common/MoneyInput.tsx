import React, { useEffect, useState } from 'react';
import { Input } from '../ui/Input';
import { parseBRMoney } from '../../lib/pricing/deliveryLabel';

type Props = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: number | undefined | null;
  onValueChange: (v: number | undefined) => void;
};

const fmt = (v: number | undefined | null) => (v === undefined || v === null || Number.isNaN(v) ? '' : String(v).replace('.', ','));

/** Campo monetário que aceita "7,00" e "7.00". */
export const MoneyInput: React.FC<Props> = ({ value, onValueChange, ...rest }) => {
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    if (parseBRMoney(text) !== value) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseBRMoney(e.target.value);
        onValueChange(Number.isNaN(n) ? undefined : n);
      }}
    />
  );
};
