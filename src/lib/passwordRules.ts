/**
 * What a password must be (密码登录, src/lib/server/passwords.ts), the same on the page and the server:
 * 8 to 64 characters (counted as the characters they are, not bytes), none of the commonest passwords,
 * and not the email or its part before the @ (on QQ mail, the QQ number). No rules about capitals or
 * symbols: those make passwords harder to remember, not to guess.
 */

import { fmt, T } from "@/i18n";
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

/** The commonest passwords of 8 characters or more, here and abroad; compared without case */
const COMMON = new Set(
  [
    // figures
    "12345678", "123456789", "1234567890", "0123456789", "87654321", "987654321", "9876543210", "11111111",
    "22222222", "33333333", "44444444", "55555555", "66666666", "77777777", "88888888", "99999999", "00000000",
    "111111111", "000000000", "1111111111", "12341234", "11223344", "12121212", "11112222", "13131313",
    "12344321", "12312312", "123123123", "1234512345", "123456123", "12345612", "147258369", "159753456",
    "963852741", "741852963", "789456123", "456789123", "135792468", "246813579", "13572468", "24681357",
    "102030405", "520520520", "5201314520", "52013145", "13145200", "1314520520", "31415926", "314159265",
    "20082008", "20080808", "19491001", "11235813", "147852369", "159357456", "123654789", "321654987",
    "112233445566", "123456654321", "1234554321", "123321123", "12369874", "14789632", "98765432",
    // letters and figures
    "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword", "qwertyui",
    "qwertyuiop", "qwerty123", "qwerty12", "asdfghjk", "asdfghjkl", "zxcvbnm1", "zxcvbnma", "qazwsxedc",
    "1qaz2wsx", "1qaz2wsx3edc", "1q2w3e4r", "1q2w3e4r5t", "q1w2e3r4", "a1b2c3d4", "abcdefgh", "abcd1234",
    "abc12345", "abc123456", "a1234567", "a12345678", "a123456789", "aa123456", "aa12345678", "aaa12345",
    "aaaaaaaa", "abcabcabc", "1234abcd", "1234qwer", "qwer1234", "asdf1234", "zxcv1234", "123456aa",
    "123456ab", "123456abc", "123456qq", "123qweasd", "qweasdzxc", "qweasd123", "1qazxsw2", "zaq12wsx",
    "!qaz2wsx", "1qaz@wsx", "qwe12345", "qwe123456", "asd12345", "asd123456", "zxc12345", "zxc123456",
    "a1s2d3f4", "z1x2c3v4", "admin123", "admin888", "administrator", "root1234", "test1234", "welcome1",
    "sunshine", "princess", "football", "baseball", "superman", "starwars", "dragon12", "monkey12",
    "shadow12", "master12", "letmein1", "trustno1", "computer", "internet", "michael1", "jennifer",
    "88888888a", "a88888888", "qq123456", "qq12345678", "qq5201314", "5201314a", "a5201314", "abc5201314",
    "5201314123", "1314521a", "woaini1314", "woaini520", "woaini123", "woaini1234", "woaini5201314",
    "aini1314", "iloveyou", "iloveyou1", "iloveyou2", "woaiwojia", "wodemima", "mima1234", "123456mima",
    "zhangwei", "wangwei1", "liuyang1", "zhang123", "wang1234", "li123456", "chen1234", "huang123",
    "yang1234", "zhao1234", "qwertyu1", "1qa2ws3ed", "qazxswedc", "qazwsx123", "qazwsx12", "asdasdasd",
    "zxczxczxc", "qweqweqwe", "abcd12345", "abcde12345", "12345abc", "12345abcd", "12345qwert",
    // this site's own world
    "arknights", "arknights1", "arknights123", "mingrifangzhou", "rhodesisland", "amiya123", "amiya1234",
    "doctor123", "zhoupmap", "zhoupditu",
  ].map((p) => p.toLowerCase()),
);

/**
 * What is wrong with a password for this email, said to the player, or null. NFKC first, as the server
 * hashes it, so a full-width ｐａｓｓｗｏｒｄ is the password it looks like.
 */
export function passwordProblem(password: string, email: string): string | null {
  const pw = password.normalize("NFKC");
  const n = [...pw].length;
  if (n < PASSWORD_MIN) return fmt(T.lib.passwordRules.tooShort, { min: PASSWORD_MIN });
  if (n > PASSWORD_MAX) return fmt(T.lib.passwordRules.tooLong, { max: PASSWORD_MAX });
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return T.lib.passwordRules.tooCommon;
  const address = email.trim().toLowerCase();
  if (lower === address) return T.lib.passwordRules.sameAsEmail;
  const local = address.split("@")[0];
  if (local.length >= 4 && lower.includes(local)) return T.lib.passwordRules.hasQq;
  return null;
}
