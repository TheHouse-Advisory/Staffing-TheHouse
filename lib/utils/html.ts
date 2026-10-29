// HTML → texto plano (búsqueda, vistas previas, Excel). Sin DOM: seguro en servidor y navegador
export function htmlToText(value: string): string {
  if (!value || !value.trimStart().startsWith("<")) return value ?? "";
  let text = value
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/(p|li|h[1-6])>|<br\s*\/?>/gi, "\n");
  // Elimina etiquetas hasta que no quede ninguna (evita reconstrucciones tipo "<<b>script>")
  let prev: string;
  do {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== prev);
  // Restos de "<" o ">" sueltos no son etiquetas válidas: se descartan
  text = text.replace(/[<>]/g, "");
  // Decodificar entidades al final; &amp; último para no generar entidades nuevas
  return text
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\n+$/, "");
}
