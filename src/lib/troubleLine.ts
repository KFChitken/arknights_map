/**
 * One line of what went wrong on a page, as fit to keep on the server and to show in a mail: nothing in it could
 * be the visitor's, and nothing reads as a link. What was in double quotes or backquotes goes (a value, a piece
 * of the page's data), so does anything long in single quotes, and so do web and email addresses, decimals (a
 * place) and numbers of five digits or more; then only Latin letters, digits, spaces and _ ' ( ) # : + - are
 * kept, so no Chinese (the site's own messages, which may quote a name) and no dots; at most 100 characters.
 * The page makes its line with it, and the server again with whatever it is sent.
 */
export function troubleLine(text: string): string {
  return text
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, "``")
    .replace(/'[^']{41,}'/g, "''")
    .replace(/\b[a-z][\w+.-]*:\/\/\S*/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/\d+\.\d+/g, "N")
    .replace(/\d{5,}/g, "N")
    .replace(/[^A-Za-z0-9 _'()#:+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
}
