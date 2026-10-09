// Shared validation for Pix gift keys in customer pages and the Worker.
// This checks the *format*, not whether a key is registered or active.
function digits(value) {
  return String(value || '').replace(/\D/g, '');
}
function cpfIsValid(value) {
  const number = digits(value);
  if (!/^\d{11}$/.test(number) || /^(\d)\1{10}$/.test(number)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(number[i]) * (length + 1 - i);
    const check = (sum * 10) % 11;
    if (Number(number[length]) !== (check === 10 ? 0 : check)) return false;
  }
  return true;
}
function cnpjIsValid(value) {
  const number = digits(value);
  if (!/^\d{14}$/.test(number) || /^(\d)\1{13}$/.test(number)) return false;
  for (const [length, weights] of [
    [12, [5,4,3,2,9,8,7,6,5,4,3,2]],
    [13, [6,5,4,3,2,9,8,7,6,5,4,3,2]],
  ]) {
    const sum = weights.reduce((total, weight, index) =>
      total + Number(number[index]) * weight, 0);
    const rest = sum % 11;
    if (Number(number[length]) !== (rest < 2 ? 0 : 11 - rest)) return false;
  }
  return true;
}
export const GIFT_PIX_TYPE_LABELS = Object.freeze({
  cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail',
  phone: 'Telefone', random: 'Chave aleatória',
});

export function giftPixKeyError(type, key) {
  const value = String(key ?? '').trim();
  if (!value) return null; // The existing required-field validation handles empties.
  switch (type) {
    case 'cpf':
      return cpfIsValid(value) ? null : 'Confira o CPF informado como chave Pix.';
    case 'cnpj':
      return cnpjIsValid(value) ? null : 'Confira o CNPJ informado como chave Pix.';
    case 'email':
      return value.length <= 77 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null : 'Digite um e-mail válido para a chave Pix.';
    case 'phone':
      return /^\+55\d{10,11}$/.test(value)
        ? null : 'Informe o telefone Pix com +55 e DDD. Exemplo: +5561999999999.';
    case 'random':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        ? null : 'A chave aleatória Pix deve ter o formato UUID (com hífens).';
    default:
      return value ? 'Selecione o tipo correto da chave Pix.' : null;
  }
}
