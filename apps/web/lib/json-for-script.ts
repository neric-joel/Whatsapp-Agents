/**
 * `JSON.stringify` does not escape `</script>` (or any `<`), so a serialized value
 * inserted verbatim into an inline `<script>` body can break out of that tag if the
 * value ever contains one. Escaping `<` to its unicode-escape form is a no-op for
 * `JSON.parse`/eval on the client but makes the substring unrepresentable in HTML.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
