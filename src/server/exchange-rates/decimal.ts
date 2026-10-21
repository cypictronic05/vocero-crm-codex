const DECIMAL = /^\+?(\d+)(?:\.(\d+))?$/;

type Decimal = { coefficient: bigint; scale: number };

function power10(value: number): bigint {
  return 10n ** BigInt(value);
}

export function parsePositiveDecimal(value: string): Decimal {
  const match = DECIMAL.exec(value.trim());
  if (!match) throw new Error("decimal_invalido");
  const fraction = match[2] ?? "";
  if (fraction.length > 12) throw new Error("precision_excedida");
  const coefficient = BigInt(`${match[1]}${fraction}`);
  if (coefficient <= 0n) throw new Error("decimal_no_positivo");
  return { coefficient, scale: fraction.length };
}

function roundedDivision(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export function formatDecimal(coefficient: bigint, scale: number): string {
  if (scale === 0) return coefficient.toString();
  const padded = coefficient.toString().padStart(scale + 1, "0");
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

/** Cociente exacto redondeado a `precision` con mitad alejándose de cero. */
export function divideDecimal(
  numeratorValue: string,
  denominatorValue: string,
  precision: number
): string {
  const numerator = parsePositiveDecimal(numeratorValue);
  const denominator = parsePositiveDecimal(denominatorValue);
  const scaled =
    numerator.coefficient * power10(denominator.scale + precision);
  const divisor = denominator.coefficient * power10(numerator.scale);
  return formatDecimal(roundedDivision(scaled, divisor), precision);
}

/** amount × rate, sin convertir nunca por IEEE-754. */
export function multiplyDecimal(
  amountValue: string,
  rateValue: string,
  precision: number
): string {
  const amount = parsePositiveDecimal(amountValue);
  const rate = parsePositiveDecimal(rateValue);
  const product = amount.coefficient * rate.coefficient;
  const scale = amount.scale + rate.scale;
  if (scale <= precision) {
    return formatDecimal(product * power10(precision - scale), precision);
  }
  return formatDecimal(roundedDivision(product, power10(scale - precision)), precision);
}

export function sameDecimal(left: string, right: string): boolean {
  const a = parsePositiveDecimal(left);
  const b = parsePositiveDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  return (
    a.coefficient * power10(scale - a.scale) ===
    b.coefficient * power10(scale - b.scale)
  );
}
