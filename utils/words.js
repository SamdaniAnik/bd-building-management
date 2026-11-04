// Amount in words for Bangladeshi documents, using the crore / lakh / thousand / hundred system.
//   amountInWordsEn(125000.5) → "Taka One Lakh Twenty-Five Thousand and Fifty Paisa Only"
//   amountInWordsBn(125000)   → "এক লক্ষ পঁচিশ হাজার টাকা মাত্র"

const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

// Bangla has a distinct word for every number 0–99.
const BN_0_99 = [
  'শূন্য', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
  'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোলো', 'সতেরো', 'আঠারো', 'উনিশ',
  'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আটাশ', 'ঊনত্রিশ',
  'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁইত্রিশ', 'আটত্রিশ', 'ঊনচল্লিশ',
  'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'ঊনপঞ্চাশ',
  'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'ঊনষাট',
  'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'ঊনসত্তর',
  'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'ঊনআশি',
  'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
  'নব্বই', 'একানব্বই', 'বিরানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই',
];

function splitAmount(amount) {
  const paisaTotal = Math.round(Math.abs(Number(amount) || 0) * 100);
  return { taka: Math.floor(paisaTotal / 100), paisa: paisaTotal % 100 };
}

// Breaks an integer into crore (may itself exceed 99), lakh, thousand, hundred, remainder.
function parts(n) {
  return {
    crore: Math.floor(n / 1e7),
    lakh: Math.floor(n / 1e5) % 100,
    thousand: Math.floor(n / 1e3) % 100,
    hundred: Math.floor(n / 100) % 10,
    rest: n % 100,
  };
}

function en2(n) {
  if (n < 20) return EN_ONES[n];
  return EN_TENS[Math.floor(n / 10)] + (n % 10 ? '-' + EN_ONES[n % 10] : '');
}

function enInt(n) {
  if (n === 0) return 'Zero';
  const p = parts(n);
  const out = [];
  if (p.crore) out.push(enInt(p.crore) + ' Crore');
  if (p.lakh) out.push(en2(p.lakh) + ' Lakh');
  if (p.thousand) out.push(en2(p.thousand) + ' Thousand');
  if (p.hundred) out.push(EN_ONES[p.hundred] + ' Hundred');
  if (p.rest) out.push(en2(p.rest));
  return out.join(' ');
}

function bnInt(n) {
  if (n === 0) return BN_0_99[0];
  const p = parts(n);
  const out = [];
  if (p.crore) out.push(bnInt(p.crore) + ' কোটি');
  if (p.lakh) out.push(BN_0_99[p.lakh] + ' লক্ষ');
  if (p.thousand) out.push(BN_0_99[p.thousand] + ' হাজার');
  if (p.hundred) out.push(BN_0_99[p.hundred] + ' শত');
  if (p.rest) out.push(BN_0_99[p.rest]);
  return out.join(' ');
}

function amountInWordsEn(amount) {
  const { taka, paisa } = splitAmount(amount);
  return `Taka ${enInt(taka)}${paisa ? ` and ${en2(paisa)} Paisa` : ''} Only`;
}

function amountInWordsBn(amount) {
  const { taka, paisa } = splitAmount(amount);
  return `${bnInt(taka)} টাকা${paisa ? ` ${BN_0_99[paisa]} পয়সা` : ''} মাত্র`;
}

module.exports = { amountInWordsEn, amountInWordsBn, enInt, bnInt };
