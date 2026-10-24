const whitespace = /\s+/g;
const ste = /\bste\b\.?/g;

export function normalize(field: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  if (text === "") return "";
  if (field === "address") return address(text);
  if (field === "phone") return phone(text);
  if (field === "accepting") return accepting(text);
  if (field === "status" || field === "specialty") return plain(text);
  throw new Error(`unknown field ${field}`);
}

export function addressValue(line1: unknown, zip: unknown): string {
  return [line1, zip]
    .map((part) => (part === null || part === undefined ? "" : String(part).trim()))
    .filter((part) => part !== "")
    .join(" ");
}

function address(value: string): string {
  const text = value
    .toLowerCase()
    .replace(ste, "suite")
    .replaceAll("#", " suite ");
  return text.replace(whitespace, " ").trim();
}

function phone(value: string): string {
  return [...value].filter((char) => char >= "0" && char <= "9").join("");
}

function accepting(value: string): string {
  const token = value.toLowerCase();
  if (token === "true" || token === "yes") return "true";
  if (token === "false" || token === "no") return "false";
  return token;
}

function plain(value: string): string {
  return value.toLowerCase().replace(whitespace, " ").trim();
}
