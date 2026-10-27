import { readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replayKey, type ChatMessage, type ChatRole } from "../src/llm/nemotron.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../recordings/llm");

type Recording = {
  request: {
    role: ChatRole;
    model: string;
    messages: ChatMessage[];
  };
};

type Item = { path: string; name: string; key: string };

const names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
const items: Item[] = names.map((name) => {
  const path = join(dir, name);
  const recorded = JSON.parse(readFileSync(path, "utf8")) as Recording;
  const { role, model, messages } = recorded.request;
  return { path, name, key: replayKey(role, model, messages) };
});

const groups = new Map<string, Item[]>();
for (const item of items) {
  const group = groups.get(item.key) ?? [];
  group.push(item);
  groups.set(item.key, group);
}

const keepers: Item[] = [];
const losers: { item: Item; kept: string }[] = [];
for (const [key, group] of groups) {
  const targetName = `${key}.json`;
  const keeper = group.find((item) => item.name === targetName) ?? group[0];
  keepers.push(keeper);
  for (const item of group) {
    if (item !== keeper) losers.push({ item, kept: targetName });
  }
}

for (const { item } of losers) unlinkSync(item.path);

const pending = keepers.filter((item) => item.name !== `${item.key}.json`);
for (const item of pending) {
  const temp = join(dir, `${item.key}.json.rekeying`);
  renameSync(item.path, temp);
  item.path = temp;
}
for (const item of pending) {
  renameSync(item.path, join(dir, `${item.key}.json`));
}

const unchanged = keepers.length - pending.length;
console.log(`files read: ${items.length}`);
console.log(`renamed: ${pending.length}`);
console.log(`unchanged: ${unchanged}`);
console.log(`collisions: ${losers.length}`);
for (const { item, kept } of losers) {
  console.log(`collision: dropped ${item.name}, kept ${kept}, key ${item.key}`);
}
