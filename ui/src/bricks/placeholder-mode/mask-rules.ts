export const MAX_NAMES = 12;
export const MAX_NAME_LENGTH = 80;
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const email = String.raw`[\w.!#$%&'*+/=?^\x60{|}~-]+@[\w-]+(?:\.[\w-]+)+`;
const phone = String.raw`(?<![\p{L}\p{N}_])\+?\d?[\s(]*\d[\d().\u00a0 -]{5,}\d(?:\s*(?:ext\.?|x)\s*\d{1,6})?(?![\p{L}\p{N}_])`;

/** One replacement pass: a configured name cannot rewrite a generated placeholder. */
export function makeMask(names: readonly string[], recipient?: string): (text: string) => string {
  const listed = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  const longestFirst = [...listed].sort((a, b) => b.length - a.length);
  const namePattern = listed.length ? `(?<![\\p{L}\\p{N}_])(?:${longestFirst.map(escapePattern).join("|")})(?![\\p{L}\\p{N}_])` : "(?!)";
  const recipientPattern = recipient ? `(?<![\\p{L}\\p{N}_])${escapePattern(recipient)}(?![\\p{L}\\p{N}_])` : "(?!)";
  const pattern = new RegExp(`(?<email>${email})|(?<phone>${phone})|(?<recipient>${recipientPattern})|(?<name>${namePattern})`, "giu");
  return text => text.replace(pattern, (match: string, ...args: unknown[]) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    if (groups.email) return "you@example.com";
    if (groups.phone) {
      const digits = match.replace(/(?:ext\.?|x)\s*\d+$/i, "").replace(/\D/g, "");
      // A calendar date or a long identifier is not a telephone number.
      if (digits.length < 7 || digits.length > 15 || /^\d{4}[- .]\d{2}[- .]\d{2}$/.test(match.trim())) return match;
      return "+1 (555) 010-0100";
    }
    return groups.recipient ? "Example recipient" : `Person ${listed.findIndex(name => name.toLocaleLowerCase() === match.toLocaleLowerCase()) + 1}`;
  });
}
