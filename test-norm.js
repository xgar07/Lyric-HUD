function normalizeString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:feat\.?|ft\.?)\b/gi, 'feat')
    .replace(/[.,!?;:'"\\~@#$%^*_=+<>\/|\[\]\{\}\(\)\-–—•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
console.log(normalizeString('Nadin Amizah - Sorai'));
console.log(normalizeString('YOASOBI - Idol「アイドル」'));
console.log(normalizeString('Lathi (ꦭꦛꦶ)'));
